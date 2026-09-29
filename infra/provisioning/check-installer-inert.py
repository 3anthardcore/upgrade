#!/usr/bin/env python3
"""Read-only HTTP checks for an Upgrade-owned inert root, NEVER a live CMS.

Run on the deployment host with the temporary installer profile and its matching
inert canaries. Credentials are read from a private file, never logged. The first
authenticated GET must identify INERT_INSTALLER_PREFLIGHT before any other probe.
"""
import argparse
import base64
import datetime
import hashlib
import http.client
import json
from pathlib import Path
import re
import ssl
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8090)
    parser.add_argument('--tls-host', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--inert-root', required=True)
    parser.add_argument('--inert-php-sha256', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists() or output.is_symlink():
        raise SystemExit('NEW_RECEIPT_PATH_REQUIRED: previous results are immutable')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,40}', args.project):
        raise SystemExit('INVALID_PROJECT')
    root = Path(args.inert_root)
    expected_root = Path('/opt/upgrade/targets') / args.project / 'document-root'
    if root != expected_root or root.resolve() != expected_root:
        raise SystemExit('DEDICATED_INERT_ROOT_REQUIRED')
    script_paths = ['index.php', 'bitrix/admin/index.php',
        'bitrix/admin/site_checker.php', 'bitrix/admin/settings.php',
        'bitrix/admin/update_system.php', 'bitrix/legal/license.php']
    if not re.fullmatch(r'[a-f0-9]{64}', args.inert_php_sha256):
        raise SystemExit('PINNED_INERT_SCRIPT_HASH_REQUIRED')
    for name in script_paths:
        p = root / name
        if p.resolve() != p or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != args.inert_php_sha256:
            raise SystemExit('INERT_FILE_PIN_MISMATCH')
    containers = json.loads(subprocess.check_output(['docker', 'inspect',
        args.project + '-php-1', args.project + '-nginx-1'], timeout=15))
    expected_names = {'/' + args.project + '-php-1', '/' + args.project + '-nginx-1'}
    if len(containers) != 2 or {c['Name'] for c in containers} != expected_names:
        raise SystemExit('EXACT_TARGET_CONTAINERS_REQUIRED')
    mounts = []
    for container in containers:
        if any(m['Destination'].startswith('/var/www/html/') or
               m['Destination'] in ['/', '/var', '/var/www'] for m in container['Mounts']):
            raise SystemExit('WEB_ROOT_OVERLAY_FORBIDDEN')
        web = [m for m in container['Mounts'] if m['Destination'] == '/var/www/html']
        if len(web) != 1 or web[0]['Source'] != str(root):
            raise SystemExit('INERT_MOUNT_REQUIRED_BEFORE_HTTP')
        mounts.append({'container': container['Name'], 'id': container['Id'],
            'image': container['Image'], 'web_root': web[0]['Source']})
    auth = 'Basic ' + base64.b64encode(
        ('upgrade:' + Path(args.password_file).read_text().strip()).encode()
    ).decode()
    checks = []

    def request(path, authenticated=True, tls=False, method='GET'):
        conn = (http.client.HTTPSConnection(args.tls_host, timeout=15,
                    context=ssl.create_default_context()) if tls else
                http.client.HTTPConnection(args.host, args.port, timeout=15))
        headers = {'Authorization': auth} if authenticated else {}
        # Spoofed input to host ingress must be overwritten by that proxy.
        headers['X-Forwarded-Proto'] = 'https' if not tls else 'http'
        try:
            conn.request(method, path, headers=headers)
            response = conn.getresponse()
            body = response.read(1024 * 1024)
            h = dict(response.getheaders())
            if response.status in (200, 401, 404):
                check('response-headers:' + method + ':' + path + ':' + str(authenticated) + ':' + str(tls),
                      'noindex' in h.get('X-Robots-Tag', '') and 'no-store' in h.get('Cache-Control', ''))
            return response.status, h, body
        finally:
            conn.close()

    def check(name, passed, **evidence):
        checks.append({'id': name, 'status': 'PASS' if passed else 'FAIL', **evidence})

    status, headers, body = request('/index.php')
    try:
        first = json.loads(body)
    except (ValueError, UnicodeError):
        raise SystemExit('INERT_ROOT_REQUIRED: first response is not probe JSON')
    if status != 200 or first.get('scope') != 'INERT_INSTALLER_PREFLIGHT':
        raise SystemExit('INERT_ROOT_REQUIRED: refusing further requests')
    check('fpm-sandbox', first.get('sapi') == 'fpm-fcgi'
          and first.get('project') == args.project and first.get('prepend') is True
          and all(first.get('disabled', {}).get(k) is True for k in
                  ['mail', 'exec', 'passthru', 'shell_exec', 'system', 'popen', 'proc_open']),
          observed=first)
    expected = {'short_open_tag': '1', 'default_charset': 'UTF-8',
        'max_input_vars': '10000', 'max_file_uploads': '100',
        'pcre.backtrack_limit': '1000000', 'pcre.recursion_limit': '14000',
        'realpath_cache_size': '4096k', 'cgi.fix_pathinfo': '0',
        'auto_prepend_file': '/opt/upgrade/prepend.php', 'allow_url_fopen': ''}
    check('fpm-ini', all(first.get('ini', {}).get(k) == v for k, v in expected.items()))
    check('host-overwrites-spoofed-proto', first.get('https') == '')
    php_paths = ['/', '/index.php', '/bitrix/admin/', '/bitrix/admin/index.php',
        '/bitrix/admin/site_checker.php', '/bitrix/admin/settings.php',
        '/bitrix/admin/update_system.php', '/bitrix/legal/license.php']
    for path in php_paths:
        code, h, data = request(path, False)
        check('unauth:' + path, code == 401 and b'INERT_INSTALLER_PREFLIGHT' not in data,
              http_status=code)
        code, h, data = request(path)
        try:
            record = json.loads(data)
        except (ValueError, UnicodeError):
            record = {}
        script = 'index.php' if path == '/' else path.lstrip('/')
        if path == '/bitrix/admin/':
            script += 'index.php'
        check('authenticated:' + path, code == 200
              and record.get('scope') == 'INERT_INSTALLER_PREFLIGHT'
              and record.get('project') == args.project
              and record.get('script') == '/var/www/html/' + script, http_status=code)
    exact = '/index.php?x=&x=2&v=one%2Ftwo'
    code, h, data = request(exact)
    check('exact-query', code == 200 and json.loads(data).get('uri') == exact)
    code, h, data = request(exact, tls=True)
    tls = json.loads(data)
    check('tls-forwarding', code == 200 and tls.get('https') == 'on'
          and str(tls.get('port')) == '443' and tls.get('uri') == exact
          and tls.get('scheme') == 'https' and tls.get('forwarded_proto') == 'https',
          observed=tls)
    denied = ['/bitrix/license_key.php', '/bitrix/license_key.php.css',
        '/bitrix/.settings.php', '/bitrix/.settings_extra.php',
        '/bitrix/php_interface/dbconn.php', '/bitrix/backup/test.zip',
        '/index.php/path', '/bitrix/tools/anything.php', '/upload/test.php',
        '/.git/config', '/bitrix/js/.env.css', '/bitrix/js/dump.sql.css',
        '/bitrix/js/leak.php.css', '/bitrix/js/test.php/image.jpg',
        '/bitrix/%2esettings.php', '/bitrix/js/../license_key.php',
        '/bitrix/js/%2e%2e/license_key.php', '/bitrix/legal/license.php/path',
        '//Exact%2FPath?x=&x=2&v=one%2Ftwo']
    for path in denied:
        code, h, data = request(path)
        check('denied:' + path, code == 404 and b'INERT_SECRET_CANARY' not in data
              and b'INERT_INSTALLER_PREFLIGHT' not in data, http_status=code)
        check('headers:' + path, 'noindex' in h.get('X-Robots-Tag', '')
              and 'no-store' in h.get('Cache-Control', ''))
    for path in ['/bitrix/modules/main/install/wizard/script.js',
                 '/bitrix/modules/main/install/js/main/md5/dist/md5.bundle.js']:
        code, h, data = request(path)
        check('static:' + path, code == 200 and b'INERT_INSTALLER_ASSET' in data)
        code, h, data = request(path, False)
        check('static-unauth:' + path, code == 401)
        code, h, data = request(path, method='POST')
        check('static-post-denied:' + path, code == 403)
    code, h, data = request('/bitrix/legal/license.php', method='POST')
    check('legal-post-denied', code == 403)
    result = {'scope': 'INERT_INSTALLER_ONLY',
        'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'inert_php_sha256': args.inert_php_sha256, 'verified_before_http': mounts,
        'checks': checks, 'status': 'PASS' if all(c['status'] == 'PASS' for c in checks) else 'FAIL'}
    with output.open('x') as receipt:
        receipt.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'checks': len(checks),
        'failed': [c['id'] for c in checks if c['status'] != 'PASS']}))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
