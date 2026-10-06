#!/usr/bin/env python3
"""Bounded verifier of Upgrade's synthetic demo HTTP contract; no CMS/DB access.

Only a caller-pinned product GET and exact /__upgrade routes are requested.
Never prints responses, authentication, cookies, CSRF or server exceptions.
"""
import argparse
import base64
import decimal
import hashlib
import http.client
from html.parser import HTMLParser
import ipaddress
import json
import math
import os
from pathlib import Path
import queue
import re
import secrets
import socket
import ssl
import stat
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit

HEX = re.compile(r"[a-f0-9]{64}\Z")
ACTIONS = {
    'cart.add': {'item_id', 'variant_id', 'quantity'},
    'cart.update': {'line_id', 'quantity'},
    'cart.remove': {'line_id'},
    'demo.checkout': {'synthetic', 'identity', 'consent', 'delivery', 'payment'},
    'demo.lead': {'synthetic', 'identity', 'consent', 'topic', 'item_id'},
}
COMMON = {'action', 'csrf', 'expected_snapshot_id', 'idempotency_key'}
OWN = {'/__upgrade/search', '/__upgrade/cart', '/__upgrade/lead', '/__upgrade/receipt'}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


class VerifyError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise VerifyError(code)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def pairs_unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'JSON_DUPLICATE_KEY')
        result[key] = value
    return result


def private_file(path, maximum=2 * 1024 * 1024):
    path = Path(path)
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum, 'PRIVATE_FILE_INVALID')
    if os.name == 'posix':
        need(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, 'PRIVATE_FILE_PERMISSIONS')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        need((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino), 'PRIVATE_FILE_CHANGED')
        data = stream.read(maximum + 1)
    need(len(data) <= maximum, 'PRIVATE_FILE_LIMIT')
    return data


def atomic_json(path, data):
    temporary = path.with_name('.' + path.name + '.' + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(canonical(data) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name == 'posix':
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def request_target(value):
    need(isinstance(value, str) and 0 < len(value) <= 8192 and value.startswith('/') and not value.startswith('//'), 'TARGET_INVALID')
    need(not re.search(r'[\x00-\x20\x7f\\#]', value) and value.isascii(), 'TARGET_INVALID')
    need(not re.search(r'%(?![a-fA-F0-9]{2})', value), 'TARGET_INVALID')
    return value


def validate_base(base, host):
    parsed = urlsplit(base)
    need(parsed.scheme in {'https', 'http'} and parsed.hostname and parsed.username is None and parsed.password is None and parsed.path in {'', '/'} and not parsed.query and not parsed.fragment, 'BASE_URL_INVALID')
    need(re.fullmatch(r'(?:[A-Za-z0-9][A-Za-z0-9.-]{0,251}|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?', host) is not None, 'TRUSTED_HOST_INVALID')
    host_parts = urlsplit('http://' + host)
    need(host_parts.port is None or 1 <= host_parts.port <= 65535, 'TRUSTED_HOST_INVALID')
    if parsed.scheme == 'http':
        try:
            local = ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            local = False
        need(local, 'PLAINTEXT_REQUIRES_LITERAL_LOOPBACK')
    else:
        need(parsed.netloc.lower() == host.lower(), 'TLS_HOST_BINDING_REQUIRED')
    need(parsed.port is None or 1 <= parsed.port <= 65535, 'BASE_URL_INVALID')
    return parsed


class Forms(HTMLParser):
    """Parse only the own .demo-view region; arbitrary source forms stay inert."""
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.forms = []
        self.form = None
        self.select = None
        self.option = None
        self.text = []
        self.titles = []
        self.title = None
        self.receipt = False
        self.nodes = 0
        self.views = 0
        self.feed(html)
        self.close()
        need(self.form is None and self.views == 1, 'OWN_VIEW_MISSING_OR_AMBIGUOUS')

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        need(self.nodes <= 150000, 'HTML_NODE_LIMIT')
        values = {}
        for key, value in attrs:
            need(key not in values, 'HTML_DUPLICATE_ATTRIBUTE')
            values[key] = value or ''
        classes = set(values.get('class', '').split())
        active = any(row[1] for row in self.stack) or 'demo-view' in classes
        if 'demo-view' in classes:
            self.views += 1
        if tag not in VOID:
            need(len(self.stack) < 256, 'HTML_DEPTH_LIMIT')
            self.stack.append((tag, active, classes))
        if not active:
            return
        if 'demo-receipt' in classes:
            self.receipt = True
        if tag == 'h2' and any('demo-result-card' in row[2] for row in self.stack):
            self.title = []
        if tag == 'form':
            need(self.form is None and len(self.forms) < 2000, 'FORM_NESTING_OR_LIMIT')
            method = values.get('method', 'get').lower()
            action = values.get('action', '')
            need((method == 'post' and action == '/__upgrade/action' and 'demo-action' in classes) or (method == 'get' and action == '/__upgrade/search'), 'FOREIGN_FORM_REJECTED')
            self.form = {'method': method, 'target': action, 'fields': {}, 'controls': {}}
        elif self.form is not None and tag in {'input', 'select', 'textarea'}:
            name = values.get('name')
            need(tag != 'textarea' and isinstance(name, str) and re.fullmatch(r'[a-z][a-z0-9_]{0,39}', name), 'FORM_CONTROL_INVALID')
            need(name not in self.form['controls'] and len(self.form['controls']) < 32, 'FORM_DUPLICATE_OR_LIMIT')
            need('disabled' not in values and 'formaction' not in values and 'form' not in values, 'FORM_OVERRIDE_INVALID')
            self.form['controls'][name] = dict(values)
            if tag == 'select':
                self.select = name
                self.form['controls'][name]['options'] = []
            else:
                kind = values.get('type', 'text').lower()
                need(kind in {'hidden', 'number', 'search', 'checkbox'}, 'FORM_CONTROL_INVALID')
                if kind != 'checkbox' or 'checked' in values:
                    self.form['fields'][name] = values.get('value', '')
        elif self.form is not None and tag == 'option':
            need(self.select is not None and self.option is None, 'OPTION_INVALID')
            self.option = {'value': values.get('value', ''), 'selected': 'selected' in values, 'text': []}

    def handle_endtag(self, tag):
        if tag == 'option' and self.option is not None:
            choices = self.form['controls'][self.select]['options']
            need(len(choices) < 250, 'OPTION_LIMIT')
            choices.append({'value': self.option['value'], 'selected': self.option['selected']})
            self.option = None
        if tag == 'select' and self.select is not None:
            choices = self.form['controls'][self.select]['options']
            selected = [choice for choice in choices if choice['selected']]
            need(len(selected) <= 1, 'OPTION_AMBIGUOUS')
            self.form['fields'][self.select] = (selected or choices or [{'value': ''}])[0]['value']
            self.select = None
        if tag == 'form' and self.form is not None:
            need(self.select is None, 'FORM_UNCLOSED_SELECT')
            self.forms.append(self.form)
            self.form = None
        if tag == 'h2' and self.title is not None:
            self.titles.append(' '.join(''.join(self.title).split()))
            self.title = None
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if any(row[1] for row in self.stack) and not any(row[0] in {'script', 'style'} for row in self.stack):
            self.text.append(data)
            if self.title is not None:
                self.title.append(data)

    def action(self, name, variant=None):
        matching = [form for form in self.forms if form['fields'].get('action') == name and (variant is None or form['fields'].get('variant_id') == variant)]
        need(bool(matching), 'REQUIRED_FORM_MISSING')
        if name != 'cart.add':
            need(len(matching) == 1, 'FORM_AMBIGUOUS')
        return matching[0]


def form_fields(form, pin):
    fields = dict(form['fields'])
    action = fields.get('action')
    need(action in ACTIONS and form['method'] == 'post' and form['target'] == '/__upgrade/action', 'ACTION_INVALID')
    need(set(form['controls']) <= COMMON | ACTIONS[action], 'UNEXPECTED_FORM_FIELD')
    need(COMMON <= set(fields) and HEX.fullmatch(fields['csrf']) and fields['expected_snapshot_id'] == pin, 'FORM_SNAPSHOT_OR_CSRF_INVALID')
    need(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{15,127}', fields['idempotency_key']) is not None, 'IDEMPOTENCY_KEY_INVALID')
    need(all(isinstance(value, str) and len(value.encode()) <= 2000 and not re.search(r'[\x00-\x1f\x7f]', value) for value in fields.values()), 'FORM_VALUE_INVALID')
    if action.startswith('demo.'):
        need(fields.get('synthetic') == '1' and fields.get('identity') == 'demo-customer' and form['controls'].get('consent', {}).get('value') == '1', 'SYNTHETIC_FORM_INVALID')
        fields['consent'] = '1'
        if action == 'demo.checkout':
            need(fields.get('delivery') == 'demo-pickup' and fields.get('payment') == 'demo-none', 'SYNTHETIC_FORM_INVALID')
        else:
            fields['topic'] = 'general'
    return fields


def validate_submission(fields, pin):
    """Revalidate persisted intent before every POST, including a resumed intent."""
    need(isinstance(fields, dict) and fields.get('action') in ACTIONS, 'SUBMISSION_INVALID')
    action = fields['action']
    need(COMMON <= set(fields) <= COMMON | ACTIONS[action], 'SUBMISSION_INVALID')
    need(all(isinstance(value, str) and len(value.encode()) <= 2000 and not re.search(r'[\x00-\x1f\x7f]', value) for value in fields.values()), 'SUBMISSION_INVALID')
    need(HEX.fullmatch(fields['csrf']) and fields['expected_snapshot_id'] == pin and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{15,127}', fields['idempotency_key']), 'SUBMISSION_BINDING_INVALID')
    if action == 'cart.add':
        need(isinstance(fields.get('item_id'), str) and 0 < len(fields['item_id'].encode()) <= 160, 'SUBMISSION_INVALID')
    if action in {'cart.add', 'cart.update'}:
        quantity(fields.get('quantity'))
    if action in {'cart.update', 'cart.remove'}:
        need(isinstance(fields.get('line_id'), str) and HEX.fullmatch(fields['line_id']), 'SUBMISSION_INVALID')
    if action.startswith('demo.'):
        need(fields.get('synthetic') == '1' and fields.get('identity') == 'demo-customer' and fields.get('consent') == '1', 'SYNTHETIC_SUBMISSION_INVALID')
        if action == 'demo.checkout':
            need(fields.get('delivery') == 'demo-pickup' and fields.get('payment') == 'demo-none', 'SYNTHETIC_SUBMISSION_INVALID')
        else:
            need(fields.get('topic') == 'general', 'SYNTHETIC_SUBMISSION_INVALID')


def quantity(value):
    need(isinstance(value, str) and re.fullmatch(r'(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,6})?', value), 'QUANTITY_INVALID')
    number = decimal.Decimal(value)
    need(0 < number <= 10000, 'QUANTITY_INVALID')
    return number


def next_quantity(control, old, explicit=None):
    current = quantity(old)
    minimum = quantity(control.get('min', '0.000001'))
    maximum = quantity(control.get('max', '10000'))
    raw_step = control.get('step', 'any')
    step = decimal.Decimal('1') if raw_step == 'any' else quantity(raw_step)
    chosen = quantity(explicit) if explicit is not None else current + step
    if explicit is None and chosen > maximum:
        chosen = current - step
    need(minimum <= chosen <= maximum and chosen != current, 'DISTINCT_UPDATE_QUANTITY_UNAVAILABLE')
    if raw_step != 'any':
        need((chosen - minimum) % step == 0, 'QUANTITY_STEP_MISMATCH')
    return format(chosen, 'f').rstrip('0').rstrip('.') if '.' in format(chosen, 'f') else str(chosen)


class Runner:
    def __init__(self, args):
        self.args = args
        self.base = validate_base(args.base_url, args.trusted_host)
        request_target(args.product_route)
        need(not args.product_route.split('?', 1)[0].startswith('/__upgrade'), 'PRODUCT_ROUTE_INVALID')
        need(HEX.fullmatch(args.snapshot_id), 'SNAPSHOT_INVALID')
        need(1 <= args.timeout <= 30 and 30 <= args.max_seconds <= 1200 and 30 <= args.max_requests <= 200 and 65536 <= args.max_body <= 8 * 1024 * 1024, 'LIMIT_INVALID')
        need(re.fullmatch(r'[A-Za-z0-9._-]{1,80}', args.auth_user), 'AUTH_USER_INVALID')
        need(len(args.search_query) <= 200 and not re.search(r'[\x00-\x1f\x7f]', args.search_query), 'SEARCH_QUERY_INVALID')
        password = private_file(args.auth_password_file, 4096).decode('utf-8').rstrip('\r\n')
        need(bool(password) and not re.search(r'[\x00-\x1f\x7f]', password), 'AUTH_PASSWORD_INVALID')
        self.auth = 'Basic ' + base64.b64encode((args.auth_user + ':' + password).encode()).decode()
        self.origin = self.base.scheme + '://' + args.trusted_host
        self.output = Path(args.output).absolute()
        self.binding = {key: getattr(args, key) for key in ('base_url', 'trusted_host', 'auth_user', 'snapshot_id', 'product_route', 'variant_id', 'quantity', 'update_quantity', 'search_query', 'timeout', 'max_seconds', 'max_requests', 'max_body')}
        self.binding['verifier_sha256'] = sha(Path(__file__).read_bytes())
        self.started = time.monotonic()
        self.lock = None
        if args.resume:
            info = self.output.lstat()
            need(stat.S_ISDIR(info.st_mode) and not self.output.is_symlink(), 'PRIVATE_DIRECTORY_INVALID')
        else:
            self.output.mkdir(mode=0o700, parents=False, exist_ok=False)
        need(self.output.resolve() == self.output, 'PRIVATE_DIRECTORY_INVALID')
        if os.name == 'posix':
            info = self.output.stat()
            need(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, 'PRIVATE_DIRECTORY_PERMISSIONS')
        self.acquire_lock()
        try:
            self.load_state(args)
        except BaseException:
            self.lock.close()
            raise
        self.elapsed_before = self.state['elapsed']

    def load_state(self, args):
        if args.resume:
            self.state = json.loads(private_file(self.output / 'checkpoint.json'), object_pairs_hook=pairs_unique)
            need(self.state.get('schema_version') == 1 and self.state.get('binding') == self.binding, 'CHECKPOINT_BINDING_MISMATCH')
            need(type(self.state.get('requests')) is int and 0 <= self.state['requests'] <= args.max_requests and type(self.state.get('step')) is int and 0 <= self.state['step'] <= 12, 'CHECKPOINT_INVALID')
            need(type(self.state.get('elapsed')) in {float, int} and math.isfinite(self.state['elapsed']) and self.state['elapsed'] >= 0, 'CHECKPOINT_INVALID')
            need(self.state.get('cookie') is None or isinstance(self.state['cookie'], str) and HEX.fullmatch(self.state['cookie']), 'CHECKPOINT_INVALID')
            need(isinstance(self.state.get('context'), dict) and isinstance(self.state.get('checks'), list) and isinstance(self.state.get('exchanges'), list), 'CHECKPOINT_INVALID')
            need(len(self.state['exchanges']) <= args.max_requests and len(self.state['checks']) <= 20, 'CHECKPOINT_INVALID')
        else:
            self.state = {'schema_version': 1, 'binding': self.binding, 'run_id': secrets.token_hex(16), 'step': 0, 'requests': 0, 'elapsed': 0, 'cookie': None, 'pending': None, 'context': {}, 'checks': [], 'exchanges': [], 'status': 'RUNNING'}
            self.save()

    def acquire_lock(self):
        path = self.output / '.lock'
        need(not path.is_symlink(), 'PRIVATE_LOCK_INVALID')
        if path.exists():
            info = path.lstat()
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 16, 'PRIVATE_LOCK_INVALID')
            if os.name == 'posix':
                need(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, 'PRIVATE_LOCK_PERMISSIONS')
        fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        self.lock = os.fdopen(fd, 'r+b')
        try:
            if os.name == 'posix':
                import fcntl
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            else:
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    self.lock.write(b'0'); self.lock.flush()
                self.lock.seek(0)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            self.lock.close()
            raise VerifyError('RUNNER_BUSY') from None

    def save(self):
        if hasattr(self, 'elapsed_before'):
            self.state['elapsed'] = round(self.elapsed_before + time.monotonic() - self.started, 3)
        atomic_json(self.output / 'checkpoint.json', self.state)
        receipt = {'schema_version': 1, 'run_id': self.state['run_id'], 'status': self.state['status'], 'snapshot_id': self.args.snapshot_id, 'verifier_sha256': self.binding['verifier_sha256'], 'base_url': self.args.base_url, 'product_route': self.args.product_route, 'requests': self.state['requests'], 'elapsed_seconds': self.state['elapsed'], 'checks': self.state['checks'], 'exchanges': self.state['exchanges'], 'error_code': self.state.get('error_code'), 'unknown_write': self.state['pending'] is not None or bool(self.state.get('unresolved_post')), 'native_bitrix': 'NOT_ASSERTED_BY_HTTP_VERIFIER', 'native_orders_mail_payments_database_counters': 'NOT_RUN', 'network_egress_isolation': 'NOT_RUN', 'source_coverage': 'NOT_RUN', 'browser_native_form_semantics': 'NOT_RUN'}
        atomic_json(self.output / 'receipt.json', receipt)

    def check(self, identifier, details, status='PASS'):
        self.state['checks'] = [entry for entry in self.state['checks'] if entry['id'] != identifier]
        self.state['checks'].append({'id': identifier, 'status': status, 'details': details})

    def exchange(self, method, target, fields=None, *, authenticate=True, origin=None, cookies=True):
        request_target(target)
        path = target.split('?', 1)[0]
        need((method == 'GET' and (path in OWN or target == self.args.product_route)) or (method == 'POST' and target == '/__upgrade/action'), 'REQUEST_OUTSIDE_SCOPE')
        need(self.state['requests'] < self.args.max_requests, 'REQUEST_BUDGET_EXHAUSTED')
        remaining = self.args.max_seconds - self.elapsed_before - (time.monotonic() - self.started)
        need(remaining > 0, 'TIME_BUDGET_EXHAUSTED')
        timeout = min(self.args.timeout, remaining)
        body = urlencode(fields).encode() if fields is not None else None
        if method == 'POST':
            validate_submission(fields, self.args.snapshot_id)
        need(body is None or len(body) <= 8192, 'REQUEST_BODY_LIMIT')
        headers = {'Host': self.args.trusted_host, 'Accept': 'text/html', 'Accept-Encoding': 'identity', 'User-Agent': 'UpgradeDemoVerifier/1 (synthetic demo only)', 'Connection': 'close'}
        if authenticate:
            headers['Authorization'] = self.auth
        if cookies and self.state['cookie']:
            headers['Cookie'] = 'upgrade_demo_session=' + self.state['cookie']
        if method == 'POST':
            headers.update({'Content-Type': 'application/x-www-form-urlencoded', 'Origin': self.origin if origin is None else origin})
        self.state['requests'] += 1
        self.state['unresolved_post'] = method == 'POST'
        self.save()  # Charge every attempted request before I/O, including unknown outcomes.
        result = queue.Queue(maxsize=1)
        holder = []

        def work():
            connection = None
            try:
                cls = http.client.HTTPSConnection if self.base.scheme == 'https' else http.client.HTTPConnection
                connection = cls(self.base.hostname, self.base.port, timeout=timeout, **({'context': ssl.create_default_context()} if self.base.scheme == 'https' else {}))
                holder.append(connection)
                connection.request(method, target, body=body, headers=headers)
                response = connection.getresponse()
                need(len(response.getheaders()) <= 100, 'RESPONSE_HEADER_LIMIT')
                header_map = {}
                for key, value in response.getheaders():
                    need(len(key) + len(value) <= 16384, 'RESPONSE_HEADER_LIMIT')
                    header_map.setdefault(key.lower(), []).append(value)
                length = header_map.get('content-length', [])
                need(len(length) <= 1 and (not length or length[0].isdigit() and int(length[0]) <= self.args.max_body), 'RESPONSE_BODY_LIMIT')
                need(header_map.get('content-encoding', ['identity']) == ['identity'], 'RESPONSE_ENCODING_INVALID')
                data = response.read(self.args.max_body + 1)
                need(len(data) <= self.args.max_body and (not length or len(data) == int(length[0])), 'RESPONSE_BODY_LIMIT_OR_INCOMPLETE')
                result.put((response.status, header_map, data))
            except Exception as error:
                result.put(error)
            finally:
                if connection:
                    connection.close()

        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        worker.join(timeout)
        if worker.is_alive():
            if holder:
                holder[0].close()
            raise VerifyError('HTTP_ABSOLUTE_TIMEOUT')
        outcome = result.get_nowait()
        if isinstance(outcome, Exception):
            if isinstance(outcome, VerifyError):
                raise outcome
            raise VerifyError('HTTP_TRANSPORT_FAILED') from None
        status, response_headers, data = outcome
        self.state['unresolved_post'] = False
        self.state['exchanges'].append({'sequence': self.state['requests'], 'method': method, 'request_target': target, 'status': status, 'body_bytes': len(data), 'body_sha256': sha(data)})
        self.save()
        need(len(response_headers.get('location', [])) <= 1, 'REDIRECT_AMBIGUOUS')
        if status != 401:
            need('no-store' in ','.join(response_headers.get('cache-control', [])).lower() and 'noindex' in ','.join(response_headers.get('x-robots-tag', [])).lower(), 'DEMO_RESPONSE_HEADERS_MISSING')
        # CMS/vendor cookies are never stored or replayed. Only our opaque token
        # participates in this verifier; duplicates of that token fail closed.
        setters = [value for value in response_headers.get('set-cookie', []) if re.match(r'^upgrade_demo_session(?:[=;\s]|$)', value.strip())]
        if setters:
            need(cookies and len(setters) == 1, 'COOKIE_UNEXPECTED')
            match = re.fullmatch(r'upgrade_demo_session=([a-f0-9]{64}); Path=/; HttpOnly; SameSite=Strict(; Secure)?', setters[0])
            need(match is not None and bool(match.group(2)) == (self.base.scheme == 'https'), 'COOKIE_POLICY_INVALID')
            need(self.state['cookie'] is None or self.state['cookie'] == match.group(1), 'SESSION_CHANGED')
            self.state['cookie'] = match.group(1)
            self.save()
        return status, response_headers, data

    def get(self, target, expected=200):
        status, headers, data = self.exchange('GET', target)
        need(status == expected, 'GET_STATUS_UNEXPECTED')
        need(status not in {301, 302, 303, 307, 308}, 'GET_REDIRECT_REJECTED')
        need(any(value.lower().startswith('text/html') for value in headers.get('content-type', [])), 'CONTENT_TYPE_INVALID')
        try:
            return Forms(data.decode('utf-8', errors='strict'))
        except UnicodeError:
            raise VerifyError('HTML_UTF8_INVALID') from None

    def mutation(self, name, fields=None, *, force_replay=False):
        pending = self.state['pending']
        if pending is None:
            need(fields is not None and fields.get('action') in ACTIONS, 'MUTATION_INTENT_MISSING')
            operation = sha(fields['idempotency_key'].encode())
            target = '/__upgrade/' + ('cart' if fields['action'].startswith('cart.') else 'receipt') + '?operation=' + operation
            pending = {'name': name, 'fields': fields, 'operation_target': target, 'post_attempted': False, 'force_replay': force_replay}
            self.state['pending'] = pending
            self.save()
        need(pending['name'] == name, 'CHECKPOINT_PENDING_MISMATCH')
        validate_submission(pending['fields'], self.args.snapshot_id)
        expected_target = '/__upgrade/' + ('cart' if pending['fields']['action'].startswith('cart.') else 'receipt') + '?operation=' + sha(pending['fields']['idempotency_key'].encode())
        need(pending['operation_target'] == expected_target, 'CHECKPOINT_OPERATION_MISMATCH')
        # On restart first inspect the exact operation receipt. Never invent a new key.
        if pending['post_attempted'] and not force_replay:
            status, _, _ = self.exchange('GET', pending['operation_target'])
            need(status in {200, 404}, 'UNKNOWN_WRITE_RECONCILIATION_FAILED')
            if status == 200:
                return self.get(pending['operation_target'])
        pending['post_attempted'] = True
        self.save()
        status, headers, _ = self.exchange('POST', '/__upgrade/action', pending['fields'])
        need(status == 303 and headers.get('location') == [pending['operation_target']], 'POST_PRG_OR_OPERATION_MISMATCH')
        return self.get(pending['operation_target'])

    def finish(self):
        self.state['pending'] = None
        self.state['step'] += 1
        self.save()

    def run(self):
        if self.state['status'] == 'HTTP_SCENARIOS_VERIFIED':
            return
        self.state['status'] = 'RUNNING'
        self.state.pop('error_code', None)
        self.save()
        while self.state['step'] < 12:
            step = self.state['step']
            context = self.state['context']
            if step == 0:
                status, headers, _ = self.exchange('GET', '/__upgrade/search', authenticate=False, cookies=False)
                need(status == 401 and any(value.lower().startswith('basic ') for value in headers.get('www-authenticate', [])), 'BASIC_AUTH_GATE_FAILED')
                self.check('authentication', 'Unauthenticated own search returns 401 Basic; no redirect followed.')
            elif step == 1:
                search = self.get('/__upgrade/search')
                forms = [form for form in search.forms if form['method'] == 'get']
                need(len(forms) == 1, 'SEARCH_FORM_INVALID')
                form = forms[0]
                need(set(form['controls']) <= {'q', 'category', 'sort', *('a' + str(i) for i in range(20))} and {'q', 'sort'} <= set(form['controls']), 'SEARCH_FORM_INVALID')
                params = {'q': self.args.search_query, 'sort': 'title_asc'}
                sorted_view = self.get('/__upgrade/search?' + urlencode(params))
                sorted_form = next(form for form in sorted_view.forms if form['method'] == 'get')
                need(sorted_form['fields'].get('sort') == 'title_asc' and sorted_form['fields'].get('q') == self.args.search_query, 'SEARCH_STATE_NOT_PRESERVED')
                need(bool(sorted_view.titles), 'SEARCH_NO_OBSERVED_RESULT')
                need(sorted_view.titles == sorted(sorted_view.titles, key=lambda value: value.lower().encode('utf-8')), 'TITLE_SORT_MISMATCH')
                empty_search = self.get('/__upgrade/search?' + urlencode({'q': 'upgrade-verifier-missing-' + self.state['run_id'], 'sort': 'title_asc'}))
                need(not empty_search.titles, 'SEARCH_NONMATCHING_QUERY_NOT_EMPTY')
                self.check('search-sort', 'Own search returns observed titles ordered title_asc and echoes query; random nonmatching query has no result cards.')
                facets = [(key, choice['value']) for key, control in form['controls'].items() if key == 'category' or re.fullmatch(r'a(?:[0-9]|1[0-9])', key) for choice in control.get('options', []) if choice['value']]
                if facets:
                    key, value = facets[0]
                    filtered = self.get('/__upgrade/search?' + urlencode({'q': '', 'sort': 'title_asc', key: value}))
                    filter_form = next(form for form in filtered.forms if form['method'] == 'get')
                    need(filter_form['fields'].get(key) == value and bool(filtered.titles), 'FILTER_STATE_NOT_PRESERVED')
                    self.check('filter', 'An observed facet is accepted and retained in the rendered control; full semantic fixture coverage is separate.')
                else:
                    self.check('filter', 'No observed facet option in own search form.', 'NOT_APPLICABLE')
                need(self.state['cookie'] is None, 'SEARCH_CREATED_SESSION')
            elif step == 2:
                product = self.get(self.args.product_route)
                fields = form_fields(product.action('cart.add', self.args.variant_id), self.args.snapshot_id)
                if self.args.quantity is not None:
                    quantity(self.args.quantity)
                    fields['quantity'] = self.args.quantity
                quantity(fields.get('quantity'))
                need(self.state['cookie'] is not None, 'PRODUCT_SESSION_MISSING')
                context['add'] = fields
                self.check('product-session', 'Pinned product presents own add form, snapshot binding and fresh constrained session cookie.')
            elif step == 3:
                fields = dict(context['add'])
                fields['csrf'] = ('0' if fields['csrf'][0] != '0' else '1') + fields['csrf'][1:]
                status, _, _ = self.exchange('POST', '/__upgrade/action', fields)
                need(status == 403, 'BAD_CSRF_ACCEPTED')
                status, _, _ = self.exchange('POST', '/__upgrade/action', context['add'], origin='https://invalid.example')
                need(status == 403, 'BAD_ORIGIN_ACCEPTED')
                empty = self.get('/__upgrade/cart')
                need(not any(form['fields'].get('action', '').startswith('cart.') for form in empty.forms), 'REJECTED_POST_MUTATED_CART')
                self.check('csrf-origin', 'Bad CSRF and foreign Origin return 403; own session cart remains empty.')
            elif step == 4:
                cart = self.mutation('add', context['add'])
                update = form_fields(cart.action('cart.update'), self.args.snapshot_id)
                need(quantity(update['quantity']) == quantity(context['add']['quantity']), 'CART_ADD_QUANTITY_MISMATCH')
                context['line_id'] = update['line_id']
                self.check('cart-add', 'POST redirects to the SHA-bound operation; readback shows one line with exact requested quantity.')
            elif step == 5:
                cart = self.mutation('add-exact-replay', context['add'], force_replay=True)
                update = form_fields(cart.action('cart.update'), self.args.snapshot_id)
                need(update['line_id'] == context['line_id'] and quantity(update['quantity']) == quantity(context['add']['quantity']), 'EXACT_REPLAY_DUPLICATED_CART')
                context['update'] = update
                context['update']['quantity'] = next_quantity(cart.action('cart.update')['controls']['quantity'], update['quantity'], self.args.update_quantity)
                self.check('exact-replay', 'Exact add retry returns same operation route; line ID and quantity remain unchanged.')
            elif step == 6:
                cart = self.mutation('update', context['update'])
                updated = form_fields(cart.action('cart.update'), self.args.snapshot_id)
                need(updated['line_id'] == context['line_id'] and quantity(updated['quantity']) == quantity(context['update']['quantity']), 'CART_UPDATE_MISMATCH')
                context['remove'] = form_fields(cart.action('cart.remove'), self.args.snapshot_id)
                self.check('cart-update', 'Readback confirms a distinct valid quantity on the same line.')
            elif step == 7:
                cart = self.mutation('remove', context['remove'])
                need(not any(form['fields'].get('action', '').startswith('cart.') for form in cart.forms), 'CART_REMOVE_FAILED')
                self.check('cart-remove', 'Readback is empty after removing the selected line.')
            elif step == 8:
                if self.state['pending'] is None:
                    product = self.get(self.args.product_route)
                    context['checkout_add'] = form_fields(product.action('cart.add', self.args.variant_id), self.args.snapshot_id)
                    context['checkout_add']['quantity'] = context['add']['quantity']
                cart = self.mutation('checkout-add', context['checkout_add'])
                context['checkout'] = form_fields(cart.action('demo.checkout'), self.args.snapshot_id)
                self.check('synthetic-checkout-form', 'Only demo-pickup/demo-none and fixed demo-customer consent will be submitted.')
            elif step == 9:
                receipt = self.mutation('checkout', context['checkout'])
                self.receipt_check(receipt, 'Тестовое оформление')
                context['checkout_receipt'] = self.state['pending']['operation_target']
                again = self.get(context['checkout_receipt'])
                self.receipt_check(again, 'Тестовое оформление')
                empty = self.get('/__upgrade/cart')
                need(not any(form['fields'].get('action', '').startswith('cart.') for form in empty.forms), 'CHECKOUT_DID_NOT_CLEAR_CART')
                self.check('synthetic-checkout-receipt', 'Own synthetic receipt survives reload and cart is empty. Rendered no-send/no-order/no-payment declaration verified; DB side effects require separate native counters.')
            elif step == 10:
                if self.state['pending'] is None:
                    lead = self.get('/__upgrade/lead')
                    context['lead'] = form_fields(lead.action('demo.lead'), self.args.snapshot_id)
                receipt = self.mutation('lead', context['lead'])
                self.receipt_check(receipt, 'Тестовое обращение')
                context['lead_receipt'] = self.state['pending']['operation_target']
                self.check('synthetic-lead-receipt', 'Fixed synthetic general-topic lead has own saved receipt; no personal input fields submitted.')
            elif step == 11:
                self.receipt_check(self.get(context['lead_receipt']), 'Тестовое обращение')
                self.receipt_check(self.get(context['checkout_receipt']), 'Тестовое оформление')
                self.check('receipt-readback', 'Both operation receipts remain available in the same session after subsequent requests.')
            self.finish()
        self.state['status'] = 'HTTP_SCENARIOS_VERIFIED'
        self.save()

    @staticmethod
    def receipt_check(view, scenario):
        text = ' '.join(' '.join(view.text).split())
        need(view.receipt and not view.forms and 'Демо-запись сохранена' in text and scenario in text and 'Сообщение не отправлено. Реальный заказ и платёж не создавались.' in text, 'SYNTHETIC_RECEIPT_NOT_CONFIRMED')


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('base-url', 'trusted-host', 'auth-password-file', 'snapshot-id', 'product-route', 'output'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--auth-user', default='upgrade')
    parser.add_argument('--variant-id')
    parser.add_argument('--quantity')
    parser.add_argument('--update-quantity')
    parser.add_argument('--search-query', default='')
    parser.add_argument('--timeout', type=float, default=15)
    parser.add_argument('--max-seconds', type=float, default=300)
    parser.add_argument('--max-requests', type=int, default=80)
    parser.add_argument('--max-body', type=int, default=4 * 1024 * 1024)
    parser.add_argument('--resume', action='store_true')
    return parser.parse_args()


def main():
    runner = None
    try:
        runner = Runner(arguments())
        runner.run()
        print(json.dumps({'status': runner.state['status'], 'requests': runner.state['requests'], 'receipt': 'receipt.json'}, separators=(',', ':')))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, VerifyError) and re.fullmatch(r'[A-Z0-9_]{1,100}', str(error)) else 'VERIFIER_FAILED'
        status = 'FAILED'
        if runner is not None and hasattr(runner, 'state'):
            status = 'UNKNOWN_WRITE' if runner.state['pending'] is not None or runner.state.get('unresolved_post') else 'FAILED'
            runner.state.update(status=status, error_code=code)
            try:
                runner.save()
            except Exception:
                code = 'CHECKPOINT_SAVE_FAILED'
        print(json.dumps({'status': status, 'error_code': code}, separators=(',', ':')))
        return 3
    finally:
        if runner is not None and runner.lock is not None:
            runner.lock.close()


if __name__ == '__main__':
    sys.exit(main())
