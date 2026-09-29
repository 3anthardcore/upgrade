"""Read-only HTTPS verification of a pinned, already imported isolated package."""
import argparse, base64, concurrent.futures, hashlib, html, json, pathlib, re, urllib.request, urllib.error
from datetime import datetime, timezone
from urllib.parse import urlsplit
from html.parser import HTMLParser

parser = argparse.ArgumentParser()
parser.add_argument('--intent', required=True)
parser.add_argument('--origin', required=True)
parser.add_argument('--username', required=True)
parser.add_argument('--password-file', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
origin = urlsplit(args.origin)
assert origin.scheme == 'https' and origin.netloc and not origin.username and origin.path in ('', '/') and not origin.query and not origin.fragment
intent = json.loads(pathlib.Path(args.intent).read_bytes())
package = pathlib.Path(intent['package']).resolve()
raw = (package / 'manifest.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == intent['manifest_sha256']
manifest = json.loads(raw)
assert not manifest['blockers'] and manifest['project_id'] == intent['project']
for name, pin in manifest['files'].items():
    f = package / name
    assert f.resolve().is_relative_to(package) and hashlib.sha256(f.read_bytes()).hexdigest() == pin
routes = json.loads((package / 'data/routes.json').read_bytes())
entities = {e['stable_key']: e for e in json.loads((package / 'data/entities.json').read_bytes())}
assert routes and all(r['expected_status'] == 200 and r['entity_key'] in entities for r in routes)
assets = json.loads((package / 'data/assets.json').read_bytes())
scope = json.loads((package / 'data/operator-scope.json').read_bytes())
token = base64.b64encode((args.username + ':' + pathlib.Path(args.password_file).read_text().strip()).encode()).decode()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *unused, **kwargs):
        return None

class ProseText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag == 'div':
            if self.depth:
                self.depth += 1
            elif 'prose' in dict(attrs).get('class', '').split():
                self.depth = 1
    def handle_endtag(self, tag):
        if tag == 'div' and self.depth:
            self.depth -= 1
    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)

def normalized(text):
    return ' '.join(text.split())

def factual_texts(entity):
    for block in entity['blocks']:
        if block['type'] in ('paragraph', 'heading', 'quote', 'link', 'card', 'document') and block.get('text'):
            yield block['text']
        if block['type'] in ('list', 'card'):
            yield from block.get('items', [])
        if block['type'] == 'table':
            for row in block['rows']:
                yield from row

def get(target, method='GET', authenticated=True):
    assert target.startswith('/') and not target.startswith('//') and not re.search(r'[\x00-\x20\x7f\\]', target)
    headers = {'User-Agent': 'Upgrade-target-verifier/1'}
    if authenticated:
        headers['Authorization'] = 'Basic ' + token
    request = urllib.request.Request(args.origin.rstrip('/') + target, headers=headers, method=method)
    try:
        response = urllib.request.build_opener(NoRedirect).open(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read(16 * 1024 * 1024 + 1)

def route_check(route):
    try:
        status, headers, body = get(route['request_target'])
        entity = entities[route['entity_key']]
        text = body.decode('utf-8')
        observed_h1 = html.unescape(re.search(r'<h1[^>]*>(.*?)</h1>', text, re.S)[1])
        expected_h1 = (entity.get('seo') or {}).get('h1') or entity['title']
        parser = ProseText()
        parser.feed(text)
        prose = normalized(' '.join(parser.parts))
        facts = list(factual_texts(entity))
        checks = {'status': status == route['expected_status'], 'h1': observed_h1 == expected_h1,
                  'entity': 'data-upgrade-entity="' + route['entity_key'] + '"' in text,
                  'facts': all(normalized(fact) in prose for fact in facts),
                  'noindex': 'noindex' in headers.get('x-robots-tag', ''),
                  'demo': 'Частичный снимок' in text or 'Частичная' in text}
        return {'request_target': route['request_target'], 'status': status, 'factual_texts_checked': len(facts), 'checks': checks, 'pass': all(checks.values())}
    except Exception as error:
        return {'request_target': route['request_target'], 'pass': False, 'error_type': type(error).__name__}

def asset_check(asset):
    try:
        status, headers, body = get(asset['public_path'])
        return {'path': asset['public_path'], 'status': status, 'sha256': hashlib.sha256(body).hexdigest(),
                'pass': status == 200 and hashlib.sha256(body).hexdigest() == asset['sha256']}
    except Exception as error:
        return {'path': asset['public_path'], 'pass': False, 'error_type': type(error).__name__}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    checked_routes = list(pool.map(route_check, routes))
    checked_assets = list(pool.map(asset_check, {a['public_path']: a for a in assets}.values()))
isolation = []
for path, method, authenticated, expected in [('/', 'GET', False, 401), ('/', 'POST', True, 403),
        ('/bitrix/admin/', 'GET', True, 404), ('/bitrix/license_key.php', 'GET', True, 404),
        ('/local/upgrade-installer-resume.php', 'GET', True, 404), ('/absent-upgrade-route', 'GET', True, 404)]:
    try:
        status, _, _ = get(path, method, authenticated)
        isolation.append({'path': path, 'method': method, 'authenticated': authenticated, 'status': status, 'expected': expected, 'pass': status == expected})
    except Exception as error:
        isolation.append({'path': path, 'method': method, 'pass': False, 'error_type': type(error).__name__})
result = {'scope': 'SELECTED_BITRIX_ROUTES_AND_VERIFIED_MEDIA_ONLY', 'created_at': datetime.now(timezone.utc).isoformat(),
          'manifest_sha256': intent['manifest_sha256'], 'known_url_count': scope['known_url_count'],
          'selected_url_count': scope['selected_url_count'], 'unresolved_url_count': scope['unresolved_url_count'],
          'full_source_denominator': 'UNKNOWN', 'readiness': 'NOT_READY', 'privacy_header_matrix': 'NOT_RUN_BY_THIS_SCRIPT', 'routes': checked_routes, 'assets': checked_assets, 'isolation': isolation}
result['pass'] = all(x['pass'] for x in checked_routes + checked_assets + isolation)
with pathlib.Path(args.output).open('x', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(json.dumps({'pass': result['pass'], 'routes': len(checked_routes), 'assets': len(checked_assets),
                  'failures': [x for x in checked_routes + checked_assets + isolation if not x['pass']]}, ensure_ascii=False))
raise SystemExit(0 if result['pass'] else 1)
