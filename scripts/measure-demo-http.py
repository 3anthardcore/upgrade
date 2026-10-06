"""Bounded, GET-only privacy/latency observation of an authorized private demo.

This is not Lighthouse, load capacity certification, or a readiness setter.
The pinned plan enumerates exact target paths; redirects are never followed.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import statistics
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit


def need(condition, code):
    if not condition:
        raise ValueError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bounded_read(path, limit):
    with Path(path).open('rb') as stream:
        result = stream.read(limit + 1)
    need(len(result) <= limit, 'INPUT_SIZE_LIMIT')
    return result


def absolute_call(action, seconds, abort):
    """Return at a wall-time deadline, even while DNS/body IO is stalled.

    A timeout aborts all later requests. An in-flight daemon can only finish its
    one bounded GET; it is terminated when this standalone process exits.
    """
    need(seconds > 0 and not abort.is_set(), 'RUN_DEADLINE_OR_ABORT')
    outcome = queue.Queue(maxsize=1)

    def worker():
        try:
            outcome.put((True, action()))
        except Exception as error:
            outcome.put((False, error))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(seconds)
    if thread.is_alive():
        abort.set()
        raise TimeoutError('ABSOLUTE_HTTP_DEADLINE')
    ok, result = outcome.get_nowait()
    if not ok:
        raise result
    return result


def validate_plan(plan):
    need(set(plan) == {'schema_version', 'project_id', 'target_id', 'package_manifest_sha256',
                       'origin', 'routes', 'performance_paths', 'clients', 'rounds', 'timeout_seconds'}, 'PLAN_FIELDS')
    need(plan['schema_version'] == 1, 'PLAN_VERSION')
    for field in ['project_id', 'target_id']:
        need(isinstance(plan[field], str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', plan[field]), 'PLAN_ID')
    need(re.fullmatch(r'[a-f0-9]{64}', plan['package_manifest_sha256'] or ''), 'PACKAGE_PIN')
    origin = urlsplit(plan['origin'])
    need(origin.scheme == 'https' and origin.hostname and not origin.username and not origin.password
         and plan['origin'] == 'https://' + origin.netloc and not origin.query and not origin.fragment, 'ORIGIN')
    need(isinstance(plan['routes'], list) and 0 < len(plan['routes']) <= 10000, 'ROUTE_COUNT')
    need(len(set(plan['routes'])) == len(plan['routes']), 'DUPLICATE_ROUTE')
    for route in plan['routes']:
        need(isinstance(route, str) and 0 < len(route) <= 8192 and route.startswith('/') and not route.startswith('//')
             and not re.search(r'[\x00-\x20\x7f\\#]', route), 'ROUTE_SYNTAX')
    need(isinstance(plan['performance_paths'], list) and 0 < len(plan['performance_paths']) <= 8
         and len(set(plan['performance_paths'])) == len(plan['performance_paths'])
         and all(route in plan['routes'] for route in plan['performance_paths']), 'PERFORMANCE_SCOPE')
    for key, maximum in [('clients', 10), ('rounds', 10), ('timeout_seconds', 30)]:
        need(type(plan[key]) is int and 1 <= plan[key] <= maximum, 'BOUNDED_' + key.upper())
    return plan


def privacy(headers):
    robots = {p.strip().lower() for p in headers.get('x-robots-tag', '').split(',')}
    cache = {p.strip().lower() for p in headers.get('cache-control', '').split(',')}
    directives = {}
    for directive in headers.get('content-security-policy', '').split(';'):
        words = directive.strip().split()
        if words:
            if words[0] in directives:
                return {'duplicate_csp_directive': False}
            directives[words[0]] = words[1:]
    checks = {'noindex': {'noindex', 'nofollow', 'noarchive'} <= robots,
              'no_store': 'no-store' in cache, 'nosniff': headers.get('x-content-type-options', '').lower() == 'nosniff',
              'referrer': headers.get('referrer-policy', '').lower() in ['no-referrer', 'same-origin']}
    for name, expected in {'default-src': ["'none'"], 'script-src': ["'none'"], 'connect-src': ["'none'"],
                           'form-action': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'none'"],
                           'frame-ancestors': ["'none'"]}.items():
        checks['csp_' + name] = directives.get(name) == expected
    return checks


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--username', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    raw = bounded_read(args.plan, 2_000_000)
    need(sha(raw) == args.plan_sha256 and len(raw) <= 2_000_000, 'PLAN_PIN')
    plan = validate_plan(json.loads(raw))
    need(not re.search(r'[:\r\n]', args.username), 'AUTH_USERNAME')
    password = bounded_read(args.password_file, 4096).decode('utf-8').strip()
    need(0 < len(password) <= 1024 and not re.search(r'[\r\n]', password), 'AUTH_PASSWORD')
    auth = 'Basic ' + base64.b64encode((args.username + ':' + password).encode()).decode()
    output = Path(args.output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    (output / 'intent.json').write_bytes(raw)
    started = time.time()
    deadline = time.monotonic() + 600
    abort = threading.Event()

    def fetch(route, cookie=None, authenticated=True):
        headers = {'User-Agent': 'Upgrade-demo-measurement/1'}
        if authenticated:
            headers['Authorization'] = auth
        if cookie:
            headers['Cookie'] = cookie
        start = time.perf_counter()
        try:
            req = urllib.request.Request(plan['origin'] + route, headers=headers, method='GET')
            try:
                response = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect).open(req, timeout=plan['timeout_seconds'])
            except urllib.error.HTTPError as error:
                response = error
            with response:
                response_headers = {k.lower(): v for k, v in response.headers.items()}
                body = response.read(16 * 1024 * 1024 + 1)
                need(len(body) <= 16 * 1024 * 1024, 'RESPONSE_LIMIT')
                # Session token only retained in memory, never in measurement receipts.
                new_cookie = response_headers.get('set-cookie', '').split(';', 1)[0]
                if not re.fullmatch(r'upgrade_demo_session=[a-f0-9]{64}', new_cookie):
                    new_cookie = None
                checks = privacy(response_headers)
                return {'route': route, 'status': response.status, 'milliseconds': (time.perf_counter() - start) * 1000,
                        'bytes': len(body), 'body_sha256': sha(body), 'privacy': checks,
                        'privacy_pass': all(checks.values())}, new_cookie
        except Exception as error:
            return {'route': route, 'error_type': type(error).__name__, 'milliseconds': (time.perf_counter() - start) * 1000,
                    'privacy_pass': False}, None

    def request(route, cookie=None, authenticated=True):
        start = time.perf_counter()
        try:
            return absolute_call(lambda: fetch(route, cookie, authenticated),
                                 min(plan['timeout_seconds'], deadline - time.monotonic()), abort)
        except Exception as error:
            abort.set()
            return {'route': route, 'error_type': type(error).__name__, 'milliseconds': (time.perf_counter() - start) * 1000,
                    'privacy_pass': False}, None

    warm, cookie = request(plan['performance_paths'][0])
    routes = []
    for route in plan['routes']:
        result, new_cookie = request(route, cookie)
        cookie = cookie or new_cookie
        routes.append(result)
    denied, _ = request(plan['routes'][0], authenticated=False)

    def client(index):
        warmup, own_cookie = request(plan['performance_paths'][0])
        measurements = []
        for unused in range(plan['rounds']):
            for route in plan['performance_paths']:
                result, new_cookie = request(route, own_cookie)
                own_cookie = own_cookie or new_cookie
                measurements.append(result)
        return {'client': index, 'warmup': warmup, 'samples': measurements}

    with concurrent.futures.ThreadPoolExecutor(max_workers=plan['clients']) as pool:
        clients = list(pool.map(client, range(plan['clients'])))
    samples = [sample for client_result in clients for sample in client_result['samples']]
    timings = sorted(row['milliseconds'] for row in samples)
    p95 = timings[math.ceil(len(timings) * .95) - 1]
    success = all(row.get('status') == 200 and row['privacy_pass']
                  for row in routes + samples + [warm] + [row['warmup'] for row in clients])
    success = success and denied.get('status') == 401 and denied['privacy_pass']
    result = {'schema_version': 1, 'scope': 'PINNED_GET_ONLY_DEMO_PRIVACY_AND_WARM_HTTP_LATENCY',
              'plan_sha256': args.plan_sha256, 'project_id': plan['project_id'], 'target_id': plan['target_id'],
              'package_manifest_sha256': plan['package_manifest_sha256'], 'origin': plan['origin'],
              'started_unix': started, 'elapsed_seconds': time.time() - started, 'warmup': warm,
              'routes': routes, 'unauthenticated': denied, 'clients': clients,
              'performance': {'concurrent_clients': plan['clients'], 'sample_count': len(samples),
                              'median_ms': statistics.median(timings), 'p95_ms': p95,
                              'proposed_p95_under_1000ms': p95 < 1000, 'cache_mode': 'WARM_APPLICATION_HTTP_NO_STORE'},
              'privacy_and_http_pass': success, 'lighthouse': 'NOT_RUN', 'capacity_certification': 'NOT_RUN',
              'absolute_run_limit_seconds': 600, 'aborted': abort.is_set(),
              'timeout_policy': 'STOP_NEW_REQUESTS_AND_EXIT_WITH_ANY_INFLIGHT_DAEMON_GET',
              'source_coverage': 'NOT_EVALUATED', 'readiness': 'NOT_EVALUATED'}
    with (output / 'receipt.json').open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps({'privacy_and_http_pass': success, 'routes': len(routes), 'performance': result['performance']}))
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
