#!/usr/bin/env python3
"""Pinned SQL+files recovery into a NEW isolated Linux/Docker copy. Never repairs the source.

Default: print a deterministic read-only plan. --execute requires its trusted SHA256.
Failures retain private intent/results; no automatic retry, cleanup, or source mutation.
"""
import argparse
import base64
import datetime
from contextlib import contextmanager
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import time


class RecoveryError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise RecoveryError(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def pin(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def regular(path, private=False):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path and not path.is_symlink(), 'CANONICAL_FILE_REQUIRED')
    info = path.stat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'REGULAR_SINGLE_LINK_FILE_REQUIRED')
    if private and os.name == 'posix':
        need(info.st_uid == 0 and info.st_mode & 0o077 == 0, 'PRIVATE_ROOT_FILE_REQUIRED')
    return path


def pinned_json(path, expected):
    need(pin(expected), 'HASH_PIN_REQUIRED')
    file = regular(path)
    need(file.stat().st_size <= 4 * 1024 * 1024, 'JSON_LIMIT')
    raw = file.read_bytes()
    need(hashlib.sha256(raw).hexdigest() == expected, 'JSON_PIN_MISMATCH')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=unique)
    need(isinstance(value, dict), 'JSON_OBJECT_REQUIRED')
    return value


def member_name(member):
    raw = member.name
    need(isinstance(raw, str) and len(raw.encode()) <= 4096 and '\\' not in raw and ':' not in raw
         and not re.search(r'[\x00-\x1f\x7f]', raw), 'ARCHIVE_PATH_INVALID')
    path = PurePosixPath(raw)
    need(not path.is_absolute() and '..' not in path.parts, 'ARCHIVE_TRAVERSAL')
    need(member.isdir() or member.isreg(), 'ARCHIVE_LINK_OR_SPECIAL_FORBIDDEN')
    need(not getattr(member, 'sparse', None), 'ARCHIVE_SPARSE_FORBIDDEN')
    if str(path) == '.':
        need(member.isdir(), 'ARCHIVE_ROOT_FILE_FORBIDDEN')
        return None
    need(0 <= member.size <= 512 * 1024 * 1024, 'ARCHIVE_MEMBER_LIMIT')
    return str(path)


def archive_inventory(path):
    """Streaming validation before any destination is made. No extraction/library filter trust."""
    count = 0
    total = 0
    seen = {}
    ledger = hashlib.sha256()
    with tarfile.open(path, 'r|gz') as archive:
        for member in archive:
            name = member_name(member)
            if name is None:
                continue
            count += 1
            need(count <= 250000, 'ARCHIVE_COUNT_LIMIT')
            need(name not in seen, 'ARCHIVE_DUPLICATE_PATH')
            seen[name] = 'directory' if member.isdir() else 'file'
            total += member.size
            need(total <= 8 * 1024 * 1024 * 1024, 'ARCHIVE_EXPANDED_LIMIT')
            ledger.update(canonical([name, seen[name], member.size]) + b'\n')
            archive.members.clear()
    for name in seen:
        for parent in PurePosixPath(name).parents:
            need(seen.get(str(parent)) != 'file', 'ARCHIVE_PARENT_IS_FILE')
    need(count > 0, 'ARCHIVE_EMPTY')
    return {'entries': count, 'expanded_bytes': total, 'entry_ledger_sha256': ledger.hexdigest()}


def extract_files(archive_path, target, expected, receipt_path):
    target = Path(target)
    need(not target.exists() and not target.is_symlink(), 'NEW_WEB_ROOT_REQUIRED')
    target.mkdir(mode=0o755)
    count = 0
    total = 0
    seen = set()
    directory_modes = {}
    ledger = hashlib.sha256()
    with open(receipt_path, 'xb') as proof, tarfile.open(archive_path, 'r|gz') as archive:
        os.chmod(receipt_path, 0o600)
        for member in archive:
            name = member_name(member)
            if name is None:
                continue
            need(name not in seen, 'ARCHIVE_DUPLICATE_PATH')
            seen.add(name)
            kind = 'directory' if member.isdir() else 'file'
            ledger.update(canonical([name, kind, member.size]) + b'\n')
            count += 1
            total += member.size
            need(count <= expected['entries'] and total <= expected['expanded_bytes'], 'ARCHIVE_CHANGED')
            destination = target.joinpath(*PurePosixPath(name).parts)
            need(destination.resolve().is_relative_to(target.resolve()), 'EXTRACTION_ESCAPE')
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if member.isdir():
                destination.mkdir(exist_ok=True, mode=0o755)
                directory_modes[destination] = member.mode & 0o777
            else:
                need(not destination.exists(), 'EXTRACTION_OVERWRITE')
                h = hashlib.sha256()
                copied = 0
                with archive.extractfile(member) as stream, destination.open('xb') as out:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        copied += len(chunk)
                        need(copied <= member.size, 'ARCHIVE_FILE_SIZE_MISMATCH')
                        h.update(chunk)
                        out.write(chunk)
                need(copied == member.size and digest(destination) == h.hexdigest(), 'FILES_READBACK_MISMATCH')
                os.chmod(destination, member.mode & 0o666)
                proof.write(canonical({'path': name, 'size': copied, 'sha256': h.hexdigest(), 'restored_mode': member.mode & 0o666}) + b'\n')
            archive.members.clear()
        proof.flush()
        os.fsync(proof.fileno())
    actual = {'entries': count, 'expanded_bytes': total, 'entry_ledger_sha256': ledger.hexdigest()}
    need(actual == expected, 'ARCHIVE_CHANGED')
    for directory, mode in sorted(directory_modes.items(), key=lambda pair: len(pair[0].parts), reverse=True):
        os.chmod(directory, mode)
    return actual | {'file_readback_ledger_sha256': digest(receipt_path)}


def valid_image(image):
    return isinstance(image, str) and re.fullmatch(r'(?:[A-Za-z0-9./_:-]+@)?sha256:[a-f0-9]{64}', image) is not None


def validate_source_database(binding, project):
    fields = {'container_id', 'image_id', 'network_id', 'network_name', 'ip_address'}
    need(isinstance(binding, dict) and set(binding) == fields, 'SOURCE_DATABASE_BASELINE_REQUIRED')
    need(pin(binding.get('container_id')) and pin(binding.get('network_id'))
         and isinstance(binding.get('image_id'), str) and re.fullmatch('sha256:[a-f0-9]{64}', binding['image_id'])
         and binding.get('network_name') == 'upgrade-' + project + '-isolated', 'SOURCE_DATABASE_BASELINE_IDENTITY_INVALID')
    try:
        address = ipaddress.IPv4Address(binding['ip_address'])
    except (ValueError, TypeError):
        raise RecoveryError('SOURCE_DATABASE_BASELINE_IP_INVALID') from None
    need(str(address) == binding['ip_address'] and address.is_private and not address.is_loopback
         and not address.is_link_local and not address.is_multicast and not address.is_unspecified, 'SOURCE_DATABASE_BASELINE_IP_INVALID')
    return dict(binding)


def compose_plan(source, source_root, destination, project, clone_project, clone_target, subnet, bridge, source_database):
    """Whitelist projection, never a blind copy of source Docker options or host paths."""
    need(re.fullmatch('[a-z0-9][a-z0-9-]{0,40}', clone_project) is not None and clone_project != project, 'DISTINCT_CLONE_PROJECT_REQUIRED')
    need(re.fullmatch('[a-z0-9][a-z0-9-]{0,80}', clone_target) is not None, 'CLONE_TARGET_INVALID')
    need(re.fullmatch('br-upg[a-z0-9-]{1,9}', bridge) is not None and len(bridge) <= 15, 'BRIDGE_INVALID')
    network = ipaddress.IPv4Network(subnet, strict=True)
    need(network.is_private and network.prefixlen == 24 and not network.is_loopback and not network.is_link_local, 'SUBNET_INVALID')
    need(source.get('name') == project and set(source.get('services', {})) == {'db', 'php', 'nginx'}, 'SOURCE_COMPOSE_BINDING')
    root = PurePosixPath(source_root)
    dest = PurePosixPath(destination)
    need(root.is_absolute() and dest.is_absolute() and '..' not in root.parts + dest.parts
         and not dest.is_relative_to(root) and not root.is_relative_to(dest), 'DISTINCT_ROOT_REQUIRED')
    expected = {
        'php': {'/var/www/html', '/var/lib/upgrade', '/opt/upgrade/probe-isolation.php', '/usr/local/etc/php/conf.d/20-upgrade-bitrix.ini'},
        'nginx': {'/var/www/html', '/etc/nginx/conf.d/default.conf', '/etc/nginx/demo.htpasswd'},
        'db': {'/var/lib/mysql'},
    }
    mounts = {}
    for name, service in source['services'].items():
        need(isinstance(service, dict) and valid_image(service.get('image')), 'IMAGE_PIN_REQUIRED')
        need(not service.get('privileged') and not service.get('ports') and not service.get('network_mode')
             and not service.get('pid') and not service.get('devices') and service.get('restart', 'no') == 'no', 'SOURCE_SERVICE_UNSAFE')
        need(service.get('entrypoint') is None and (name == 'db' or service.get('command') is None), 'SOURCE_ENTRYPOINT_UNSUPPORTED')
        need(set(service.get('networks', {})) == {'isolated'}, 'SOURCE_NETWORK_INVALID')
        by_target = {}
        for mount in service.get('volumes', []):
            need(isinstance(mount, dict) and mount.get('target') in expected[name] and mount['target'] not in by_target, 'SOURCE_MOUNT_NOT_ALLOWLISTED')
            need(mount.get('type') == ('volume' if name == 'db' else 'bind') and isinstance(mount.get('source'), str), 'SOURCE_MOUNT_INVALID')
            need(not mount.get('bind', {}).get('propagation'), 'MOUNT_PROPAGATION_FORBIDDEN')
            by_target[mount['target']] = mount
        need(set(by_target) == expected[name], 'SOURCE_MOUNT_SET_UNSUPPORTED')
        mounts[name] = by_target
    need(mounts['php']['/var/www/html']['source'] == str(root / 'cms-root')
         and mounts['nginx']['/var/www/html']['source'] == str(root / 'cms-root')
         and mounts['php']['/var/lib/upgrade']['source'] == str(root / 'state'), 'SOURCE_ROOT_BINDING')
    environment = source['services']['php'].get('environment', {})
    need(environment.get('UPGRADE_PROJECT_ID') == project and environment.get('UPGRADE_DEMO') == '1'
         and environment.get('UPGRADE_TARGET_ID') != clone_target, 'SOURCE_ENV_BINDING')
    need(source['services']['db'].get('environment') == {'MYSQL_DATABASE': 'upgrade', 'MYSQL_USER': 'upgrade', 'MYSQL_PASSWORD_FILE': '/run/secrets/db_password', 'MYSQL_ROOT_PASSWORD_FILE': '/run/secrets/db_root_password'}, 'SOURCE_DB_BINDING')
    source_ip = source['services']['nginx']['networks']['isolated'].get('ipv4_address')
    need(isinstance(source_ip, str), 'SOURCE_FIXED_NGINX_IP_REQUIRED')
    source_subnet = ipaddress.IPv4Network(source_ip + '/24', strict=False)
    database_binding = validate_source_database(source_database, project)
    source_db_ip = database_binding['ip_address']
    source_db_network = source['services']['db']['networks']['isolated']
    need(source_db_network is None or isinstance(source_db_network, dict), 'SOURCE_DB_COMPOSE_NETWORK_INVALID')
    if isinstance(source_db_network, dict) and 'ipv4_address' in source_db_network:
        need(source_db_network['ipv4_address'] == source_db_ip, 'SOURCE_DB_COMPOSE_BASELINE_IP_MISMATCH')
    excluded_ips = {source_ip, str(source_subnet.network_address), str(source_subnet.broadcast_address), str(source_subnet.network_address + 1)}
    for name in ('php', 'nginx'):
        settings = source['services'][name]['networks']['isolated']
        if isinstance(settings, dict) and isinstance(settings.get('ipv4_address'), str):
            excluded_ips.add(settings['ipv4_address'])
    need(ipaddress.IPv4Address(source_db_ip) in source_subnet and source_db_ip not in excluded_ips, 'SOURCE_DB_BASELINE_SUBNET_OR_ADDRESS_INVALID')
    source_db_image = source['services']['db']['image']
    if source_db_image.startswith('sha256:'):
        need(source_db_image == database_binding['image_id'], 'SOURCE_DB_COMPOSE_BASELINE_IMAGE_MISMATCH')
    need(not network.overlaps(source_subnet), 'SOURCE_NETWORK_OVERLAP')
    source_network = source.get('networks', {}).get('isolated', {})
    need(source_network.get('external') is True and source_network.get('name') == 'upgrade-' + project + '-isolated', 'SOURCE_NETWORK_BINDING')
    need(set(source.get('secrets', {})) == {'db_password', 'db_root_password'}, 'SOURCE_SECRETS_UNSUPPORTED')
    for key in ('db_password', 'db_root_password'):
        need(isinstance(source['secrets'][key].get('file'), str), 'SECRET_FILE_REQUIRED')
    copies = {
        'nginx.conf': mounts['nginx']['/etc/nginx/conf.d/default.conf']['source'],
        'demo.htpasswd': mounts['nginx']['/etc/nginx/demo.htpasswd']['source'],
        'bitrix.ini': mounts['php']['/usr/local/etc/php/conf.d/20-upgrade-bitrix.ini']['source'],
        'db_password': source['secrets']['db_password']['file'],
        'db_root_password': source['secrets']['db_root_password']['file'],
    }
    for name, path in copies.items():
        allowed_root = root / 'config' if name in ('nginx.conf', 'bitrix.ini') else PurePosixPath('/opt/upgrade/private/bitrix')
        value = PurePosixPath(path)
        need(value.is_absolute() and '..' not in value.parts and value.is_relative_to(allowed_root), 'SOURCE_CONFIG_PATH_NOT_ALLOWLISTED')
    def bind(path, target, readonly=True):
        return {'type': 'bind', 'source': str(dest / path), 'target': target, 'read_only': readonly, 'bind': {'create_host_path': False}}
    def common(image, number):
        return {'image': image, 'pull_policy': 'never', 'restart': 'no', 'dns': ['127.0.0.1'], 'security_opt': ['no-new-privileges:true'],
                'networks': {'isolated': {'ipv4_address': str(network.network_address + number)}}}
    services = {name: common(source['services'][name]['image'], number) for name, number in [('php', 2), ('db', 3), ('nginx', 4)]}
    services['db'].update(command=['--event-scheduler=OFF', '--local-infile=OFF'], environment=dict(source['services']['db']['environment']),
                          secrets=['db_password', 'db_root_password', 'recovery_mysql'], volumes=[{'type': 'volume', 'source': 'database', 'target': '/var/lib/mysql'}],
                          healthcheck={'test': ['CMD', 'mysqladmin', 'ping', '--silent'], 'interval': '5s', 'timeout': '3s', 'retries': 60})
    services['php'].update(environment={'UPGRADE_DEMO': '1', 'UPGRADE_PROJECT_ID': project, 'UPGRADE_TARGET_ID': clone_target},
                           cap_drop=['ALL'], cap_add=['CHOWN', 'SETGID', 'SETUID'], tmpfs=['/tmp'],
                           volumes=[bind('cms-root', '/var/www/html', False), bind('state', '/var/lib/upgrade', False),
                                    bind('config/bitrix.ini', '/usr/local/etc/php/conf.d/20-upgrade-bitrix.ini'),
                                    bind('config/recovery-probe.php', '/opt/upgrade/recovery-probe.php')])
    services['nginx'].update(volumes=[bind('cms-root', '/var/www/html'), bind('config/nginx.conf', '/etc/nginx/conf.d/default.conf'), bind('config/demo.htpasswd', '/etc/nginx/demo.htpasswd')])
    result = {'name': clone_project, 'services': services, 'networks': {'isolated': {'name': 'upgrade-' + clone_project + '-isolated', 'external': True}},
              'volumes': {'database': {'name': clone_project + '-database'}},
              'secrets': {name: {'file': str(dest / 'private' / name)} for name in ['db_password', 'db_root_password', 'recovery_mysql']}}
    return {'compose': result, 'copies': copies, 'source_network': source_network['name'], 'source_gateway': str(source_subnet.network_address + 1), 'source_db_ip': source_db_ip,
            'source_database_binding': database_binding,
            'gateway': str(network.network_address + 1), 'nginx_ip': str(network.network_address + 4), 'db_ip': str(network.network_address + 3), 'network': 'upgrade-' + clone_project + '-isolated'}


def validate_baseline(baseline, project, target):
    need(baseline.get('schema_version') == 1 and baseline.get('project_id') == project and baseline.get('target_id') == target, 'BASELINE_BINDING')
    validate_source_database(baseline.get('source_database'), project)
    need(isinstance(baseline.get('trusted_host'), str) and re.fullmatch(r'[a-z0-9.-]+(?::[0-9]{1,5})?', baseline['trusted_host']), 'BASELINE_HOST_INVALID')
    need(pin(baseline.get('php_prepend_sha256')), 'PREPEND_PIN_REQUIRED')
    counts = baseline.get('database_counts')
    need(isinstance(counts, dict) and {'ug_entity', 'ug_route', 'ug_operation', 'b_sale_order', 'b_event', 'b_user'} <= set(counts) and len(counts) <= 30, 'READBACK_COUNTS_REQUIRED')
    for table, count in counts.items():
        need(re.fullmatch(r'(?:b|ug)_[a-z0-9_]{1,64}', table) and type(count) is int and 0 <= count <= 1000000000, 'READBACK_COUNT_INVALID')
    pages = baseline.get('http')
    need(isinstance(pages, list) and 1 <= len(pages) <= 20, 'HTTP_BASELINE_REQUIRED')
    for page in pages:
        target_path = page.get('request_target')
        need(isinstance(target_path, str) and len(target_path) <= 8192 and target_path.startswith('/') and not target_path.startswith('//')
             and not re.search(r'[\x00-\x20\x7f\\#]', target_path), 'HTTP_TARGET_INVALID')
        need(page.get('status') in (200, 404, 410), 'HTTP_STATUS_UNSUPPORTED')
        if page['status'] == 200:
            need(pin(page.get('body_sha256')) or (isinstance(page.get('contains'), list) and 1 <= len(page['contains']) <= 20
                 and all(isinstance(text, str) and 1 <= len(text) <= 2000 for text in page['contains'])), 'HTTP_FACT_WITNESS_REQUIRED')
    need(any(page['status'] == 200 for page in pages) and any(page['status'] == 404 for page in pages), 'HTTP_POSITIVE_AND_NEGATIVE_REQUIRED')
    if 'entity' in baseline:
        entity = baseline['entity']
        need(isinstance(entity, dict) and type(entity.get('id')) is int and entity['id'] > 0
             and isinstance(entity.get('xml_id'), str) and re.fullmatch('upgrade:[a-f0-9]{64}', entity['xml_id']), 'ENTITY_READBACK_INVALID')
        need('name' not in entity or isinstance(entity['name'], str), 'ENTITY_READBACK_INVALID')


def make_plan(args):
    receipt = pinned_json(args.receipt, args.receipt_sha256)
    source = pinned_json(args.source_compose, args.source_compose_sha256)
    baseline = pinned_json(args.baseline, args.baseline_sha256)
    need(receipt.get('schema_version') == '1.0' and receipt.get('project_id') == args.project and receipt.get('target_id') == args.target_id
         and receipt.get('status') == 'INTEGRITY_VERIFIED', 'BACKUP_BINDING')
    validate_baseline(baseline, args.project, args.target_id)
    root = Path(args.source_root)
    destination = Path(args.destination)
    need(root == Path('/opt/upgrade/targets') / args.project and root.resolve() == root and root.is_dir(), 'SOURCE_ROOT_INVALID')
    need(destination.parent == Path('/opt/upgrade/recovery') and destination.resolve() == destination
         and not destination.exists() and not destination.is_symlink(), 'NEW_RECOVERY_DESTINATION_REQUIRED')
    need(regular(args.source_compose).is_relative_to(root / 'config'), 'SOURCE_COMPOSE_PATH_INVALID')
    need(pin(args.guard_sha256) and digest(regular(args.guard)) == args.guard_sha256, 'GUARD_PIN_MISMATCH')
    archive = None
    for kind in ('database', 'files'):
        file = regular(receipt.get(kind + '_file', ''))
        need(file.is_relative_to(root / 'state' / 'backups') and file.stat().st_size <= 8 * 1024 * 1024 * 1024, 'BACKUP_PATH_OR_SIZE_INVALID')
        need(pin(receipt.get(kind + '_sha256')) and digest(file) == receipt[kind + '_sha256'], 'BACKUP_BYTES_MISMATCH')
        if kind == 'files':
            archive = archive_inventory(file)
    projection = compose_plan(source, str(root), str(destination), args.project, args.clone_project, args.clone_target_id, args.subnet, args.bridge, baseline['source_database'])
    need(source['services']['php']['environment']['UPGRADE_TARGET_ID'] == args.target_id, 'SOURCE_TARGET_BINDING')
    config_pins = {}
    for name, source_path in projection['copies'].items():
        file = regular(source_path, private=name in ('db_password', 'db_root_password'))
        need(file.stat().st_size <= 1024 * 1024, 'CONFIG_SIZE_LIMIT')
        if name not in ('db_password', 'db_root_password'):
            config_pins[name] = digest(file)
    need(1 <= regular(args.auth_password_file, private=True).stat().st_size <= 1024, 'AUTH_SECRET_SIZE_LIMIT')
    need(re.fullmatch('[A-Za-z0-9_-]{1,64}', args.auth_user) is not None, 'AUTH_USER_INVALID')
    plan = {'schema_version': 1, 'mode': 'NEW_ISOLATED_SQL_AND_FILES_COPY', 'source_project': args.project, 'source_target': args.target_id,
            'source_root': str(root), 'destination': str(destination), 'clone_project': args.clone_project, 'clone_target': args.clone_target_id,
            'subnet': args.subnet, 'bridge': args.bridge, 'receipt_sha256': args.receipt_sha256, 'source_compose_sha256': args.source_compose_sha256,
            'baseline_sha256': args.baseline_sha256, 'guard_sha256': args.guard_sha256, 'executor_sha256': digest(Path(__file__).resolve()),
            'database_sha256': receipt['database_sha256'], 'files_sha256': receipt['files_sha256'], 'archive': archive,
            'config_pins': config_pins, 'projection': projection, 'baseline': baseline, 'configuration_derivation': settings_derivation_policy(projection),
            'production_recovery': 'NOT_RUN', 'source_actions': 'READ_ONLY', 'automatic_cleanup': False}
    return plan, receipt


def write_private(path, value):
    with open(path, 'xb') as stream:
        os.chmod(path, 0o600)
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def mysql_defaults(password):
    need(isinstance(password, str) and 1 <= len(password) <= 512 and not re.search(r'[\x00-\x1f\x7f]', password), 'SECRET_VALUE_INVALID')
    return ('[client]\nuser=root\npassword="' + password.replace('\\', '\\\\').replace('"', '\\"') + '"\nhost=127.0.0.1\nprotocol=tcp\n').encode()


def projected_nginx(raw, source_gateway, new_gateway):
    need(len(raw) <= 1024 * 1024 and b'auth_basic_user_file /etc/nginx/demo.htpasswd;' in raw
         and b'noindex' in raw and b'fastcgi_pass php:9000;' in raw, 'NGINX_PRIVATE_POLICY_REQUIRED')
    old = ('"' + source_gateway + '|https"').encode()
    need(raw.count(old) == 1, 'NGINX_GATEWAY_MAPPING_REQUIRED')
    return raw.replace(old, ('"' + new_gateway + '|https"').encode())


class LiteralPhpSettings:
    """Deliberately small inert grammar: PHP open tag, return literal array, semicolon.

    No include, calls, constants, variables, concatenation, interpolation or execution.
    Duplicate keys (including PHP integer-key coercion) are rejected at every depth.
    """
    def __init__(self, raw):
        self.raw, self.pos, self.nodes = raw, 0, 0
        self.value_spans = {}

    def reject(self):
        raise RecoveryError('RESTORED_SETTINGS_LITERAL_UNSUPPORTED')

    def space(self):
        while self.pos < len(self.raw):
            if self.raw[self.pos].isspace():
                self.pos += 1
            elif self.raw.startswith('/*', self.pos):
                end = self.raw.find('*/', self.pos + 2)
                if end < 0: self.reject()
                self.pos = end + 2
            elif self.raw.startswith('//', self.pos) or self.raw.startswith('#', self.pos):
                end = self.raw.find('\n', self.pos)
                # A closing tag in a line comment ends PHP; do not reinterpret it.
                if '?>' in self.raw[self.pos:end if end >= 0 else len(self.raw)]: self.reject()
                self.pos = end if end >= 0 else len(self.raw)
            else:
                break

    def take(self, token):
        self.space()
        if self.raw.startswith(token, self.pos):
            self.pos += len(token)
            return True
        return False

    def keyword(self, word):
        self.space()
        end = self.pos + len(word)
        if self.raw[self.pos:end].lower() == word and (end == len(self.raw) or not re.match(r'[A-Za-z0-9_]', self.raw[end])):
            self.pos = end
            return True
        return False

    def string(self):
        quote = self.raw[self.pos]
        self.pos += 1
        value = []
        escapes = {'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', 'e': '\x1b', 'f': '\f', '\\': '\\', '$': '$', '"': '"'}
        while self.pos < len(self.raw):
            char = self.raw[self.pos]
            self.pos += 1
            if char == quote: return ''.join(value)
            if quote == '"' and char == '$': self.reject()
            if char == '\\':
                if self.pos == len(self.raw): self.reject()
                following = self.raw[self.pos]
                self.pos += 1
                if quote == "'":
                    value.append(following if following in ("'", '\\') else '\\' + following)
                elif following in escapes:
                    value.append(escapes[following])
                else:
                    # Reject octal/hex/unicode and unknown escape semantics conservatively.
                    self.reject()
            else:
                value.append(char)
        self.reject()

    def value(self, depth=0):
        self.nodes += 1
        if depth > 64 or self.nodes > 50000: self.reject()
        self.space()
        if self.pos >= len(self.raw): self.reject()
        if self.raw[self.pos] in ("'", '"'): return self.string()
        if self.take('['): return self.array(']', depth + 1)
        if self.keyword('array'):
            if not self.take('('): self.reject()
            return self.array(')', depth + 1)
        for word, value in [('true', True), ('false', False), ('null', None)]:
            if self.keyword(word): return value
        # Decimal integers only; no PHP octal, floating point or expression coercion.
        match = re.match(r'-?(?:0|[1-9][0-9]*)', self.raw[self.pos:])
        if match:
            self.pos += len(match[0])
            value = int(match[0])
            if abs(value) > 9223372036854775807: self.reject()
            return value
        self.reject()

    def array(self, end, depth):
        result, next_index = {}, 0
        while not self.take(end):
            item = self.value(depth)
            if self.take('=>'):
                key = item
                if type(key) not in (str, int): self.reject()
                # Match PHP canonical decimal string keys; disallow out-of-range keys.
                if isinstance(key, str) and re.fullmatch(r'(?:0|-?[1-9][0-9]*)', key):
                    if abs(int(key)) > 9223372036854775807: self.reject()
                    key = int(key)
                self.space()
                start = self.pos
                value = self.value(depth)
                self.value_spans[(id(result), key)] = (start, self.pos)
            else:
                key, value = next_index, item
            if key in result: self.reject()
            result[key] = value
            if type(key) is int and key >= next_index: next_index = key + 1
            if self.take(end): return result
            if not self.take(','): self.reject()
        return result

    def parse(self):
        if not re.match(r'<\?php\s', self.raw, re.I): self.reject()
        self.pos = 5
        if not self.keyword('return'): self.reject()
        value = self.value()
        if type(value) is not dict or not self.take(';'): self.reject()
        self.space()
        if self.raw.startswith('?>', self.pos): self.pos += 2
        # After closing PHP, even comment-looking output is not a settings literal.
        if self.raw[self.pos:].strip(): self.reject()
        return value


def parsed_connection(raw):
    need(isinstance(raw, bytes) and len(raw) <= 1024 * 1024, 'CMS_SETTINGS_LIMIT')
    parser = LiteralPhpSettings(raw.decode('utf-8', errors='strict'))
    value = parser.parse()
    connections = value.get('connections')
    need(type(connections) is dict and type(connections.get('value')) is dict
         and set(connections['value']) == {'default'}, 'RESTORED_SETTINGS_DB_BINDING_UNSUPPORTED')
    default = connections['value']['default']
    need(type(default) is dict and type(default.get('host')) is str and default.get('database') == 'upgrade',
         'RESTORED_SETTINGS_DB_BINDING_UNSUPPORTED')
    return parser, default


def verify_settings(root):
    settings = regular(Path(root) / 'bitrix' / '.settings.php')
    need(settings.stat().st_size <= 1024 * 1024, 'CMS_SETTINGS_LIMIT')
    _, connection = parsed_connection(settings.read_bytes())
    need(connection['host'] == 'db', 'RESTORED_SETTINGS_DB_BINDING_UNSUPPORTED')


def settings_derivation_policy(projection):
    return {'mode': 'CLONE_ONLY_LITERAL_DB_HOST', 'path': 'bitrix/.settings.php', 'database': 'upgrade',
            'allowed_original_hosts': ['db', projection['source_db_ip']], 'derived_host': 'db',
            'required_source_binding': 'PINNED_BASELINE_EXACT_RUNNING_DB_ID_IMAGE_NETWORK_IP',
            'backup_and_files_readback': 'PRESERVE_ORIGINAL_BYTES_AND_LEDGER', 'on_partial_destination': 'REFUSE_REUSE'}


def attest_source_db(source_db, projection, image_id):
    expected = projection['source_database_binding']
    need(source_db.get('service') == 'db' and source_db.get('id') == expected['container_id']
         and source_db.get('image') == image_id == expected['image_id'], 'SOURCE_DB_CONTAINER_BINDING')
    need(set(source_db.get('networks', {})) == {projection['source_network']}, 'SOURCE_DB_NETWORK_BINDING')
    network = source_db['networks'][projection['source_network']]
    need(projection['source_network'] == expected['network_name'] and network.get('NetworkID') == expected['network_id'], 'SOURCE_DB_NETWORK_IDENTITY_MISMATCH')
    need(network.get('IPAddress') == projection['source_db_ip'] == expected['ip_address'], 'SOURCE_DB_BASELINE_IP_MISMATCH')
    return {**expected, 'network': expected['network_name'], 'source_db_ip': expected['ip_address']}


def derive_settings_bytes(raw, source_ip):
    need(isinstance(source_ip, str) and str(ipaddress.IPv4Address(source_ip)) == source_ip
         and ipaddress.IPv4Address(source_ip).is_private, 'SOURCE_DB_STATIC_IP_INVALID')
    parser, connection = parsed_connection(raw)
    before_host = connection['host']
    need(before_host in ('db', source_ip), 'RESTORED_SETTINGS_HOST_NOT_ATTESTED')
    start, end = parser.value_spans[(id(connection), 'host')]
    derived = raw if before_host == 'db' else (parser.raw[:start] + "'db'" + parser.raw[end:]).encode('utf-8')
    _, verified = parsed_connection(derived)
    need(verified['host'] == 'db', 'DERIVED_SETTINGS_BINDING_INVALID')
    return derived, {'path': 'bitrix/.settings.php', 'host_before': before_host, 'host_after': 'db',
                     'changed': derived != raw, 'before_sha256': digest_bytes(raw), 'after_sha256': digest_bytes(derived)}


def validate_clone_container(container, service_name, projection, image_id):
    config = projection['compose']
    service = config['services'][service_name]
    labels = container['Config'].get('Labels', {})
    need(labels.get('com.docker.compose.project') == config['name'] and labels.get('com.docker.compose.service') == service_name
         and container['State']['Running'] is True and container['Image'] == image_id, 'CLONE_CONTAINER_IDENTITY_MISMATCH')
    host = container['HostConfig']
    need(host.get('Privileged') is False and host.get('RestartPolicy', {}).get('Name') in ('no', '')
         and not host.get('PortBindings') and host.get('Dns') == ['127.0.0.1']
         and 'no-new-privileges:true' in host.get('SecurityOpt', []), 'CLONE_RUNTIME_POLICY_MISMATCH')
    networks = container['NetworkSettings']['Networks']
    need(set(networks) == {projection['network']}
         and networks[projection['network']]['IPAddress'] == service['networks']['isolated']['ipv4_address'], 'CLONE_RUNTIME_NETWORK_MISMATCH')
    expected = {mount['target']: mount for mount in service['volumes']}
    for name in service.get('secrets', []):
        expected['/run/secrets/' + name] = {'type': 'bind', 'source': config['secrets'][name]['file'], 'read_only': True}
    mounts = container['Mounts']
    need(len(mounts) == len(expected) and {mount['Destination'] for mount in mounts} == set(expected), 'CLONE_RUNTIME_MOUNT_SET_MISMATCH')
    for mount in mounts:
        wanted = expected[mount['Destination']]
        need(mount['Type'] == wanted['type'] and mount['RW'] is (not wanted.get('read_only', False)), 'CLONE_RUNTIME_MOUNT_MODE_MISMATCH')
        if wanted['type'] == 'volume':
            need(mount.get('Name') == config['volumes'][wanted['source']]['name'], 'CLONE_RUNTIME_VOLUME_MISMATCH')
        else:
            need(mount['Source'] == wanted['source'], 'CLONE_RUNTIME_BIND_MISMATCH')


PROBE = r'''<?php
declare(strict_types=1);
$disabled=[];foreach(['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $name)$disabled[$name]=!function_exists($name);
$own=@fsockopen('db',3306,$errno,$error,3);$ownOK=is_resource($own);if($ownOK)fclose($own);
$foreign=@fsockopen($argv[1],3306,$errno,$error,3);$foreignOK=is_resource($foreign);if($foreignOK)fclose($foreign);
$result=['scope'=>'PRE_CMS_CLONE_RUNTIME','prepend_active'=>defined('UPGRADE_SANDBOX_PREPEND_ACTIVE'),'prepend_file'=>ini_get('auto_prepend_file'),'prepend_sha256'=>hash_file('sha256','/opt/upgrade/prepend.php'),'disabled'=>$disabled,'allow_url_fopen'=>(bool)ini_get('allow_url_fopen'),'own_db_connected'=>$ownOK,'source_db_connected'=>$foreignOK,'external_dns_failed'=>gethostbyname('example.org')==='example.org'];
echo json_encode($result,JSON_THROW_ON_ERROR);
'''


class Executor:
    def __init__(self, args, plan, receipt):
        self.args, self.plan, self.receipt = args, plan, receipt
        self.root = Path(args.destination)
        self.events = []
        self.created = False
        self.root_identity = None
        self.intent_bytes = None
        self.event_identity = None
        self.persisted_events = 0
        self.stage = 'PREFLIGHT'
        self.compose_file = self.root / 'config' / 'compose.json'
        self.prefix = ['docker', 'compose', '--project-name', args.clone_project, '--file', str(self.compose_file)]

    def claim_destination(self, expected_plan):
        """Atomic mkdir is the destination lock across different clone-project locks.

        Never adopt an existing root or intent, including one created during preflight.
        A crash before intent durability leaves an unadoptable partial directory.
        """
        need(expected_plan == digest_bytes(canonical(self.plan)), 'ACCEPTED_PLAN_PIN_MISMATCH')
        need(not self.created, 'RECOVERY_DESTINATION_ALREADY_CLAIMED')
        try:
            self.root.mkdir(mode=0o700)
        except FileExistsError:
            raise RecoveryError('NEW_RECOVERY_DESTINATION_REQUIRED')
        info = self.root.lstat()
        self.root_identity = (info.st_dev, info.st_ino)
        self.intent_bytes = canonical({'plan_sha256': expected_plan, 'plan': self.plan,
                                       'ownership_nonce': secrets.token_hex(32)}) + b'\n'
        write_private(self.root / 'intent.json', self.intent_bytes)
        self.created = True
        self.assert_ownership()

    def assert_ownership(self):
        need(self.created and self.root_identity is not None and self.intent_bytes is not None,
             'RECOVERY_DESTINATION_NOT_OWNED')
        info = self.root.lstat()
        need(stat.S_ISDIR(info.st_mode) and not self.root.is_symlink()
             and (info.st_dev, info.st_ino) == self.root_identity and self.root.resolve() == self.root,
             'RECOVERY_DESTINATION_OWNERSHIP_CHANGED')
        if os.name == 'posix':
            need(info.st_uid == os.geteuid() and info.st_mode & 0o077 == 0, 'PRIVATE_RECOVERY_DESTINATION_REQUIRED')
        path = regular(self.root / 'intent.json')
        need(path.stat().st_size == len(self.intent_bytes) and path.read_bytes() == self.intent_bytes,
             'RECOVERY_INTENT_OWNERSHIP_CHANGED')

    def write_result(self, result):
        self.assert_ownership()
        write_private(self.root / 'result.json', canonical(result) + b'\n')

    def derive_clone_settings(self, attestation, readback):
        self.assert_ownership()
        projection = self.plan['projection']
        need(self.plan.get('configuration_derivation') == settings_derivation_policy(projection), 'CONFIGURATION_DERIVATION_NOT_IN_PLAN')
        expected = projection['source_database_binding']
        need(attestation == {**expected, 'network': expected['network_name'], 'source_db_ip': expected['ip_address']}
             and attestation['source_db_ip'] == projection['source_db_ip'] and attestation['network'] == projection['source_network'],
             'SOURCE_DB_DERIVATION_BINDING')
        ledger = regular(self.root / 'files-readback.jsonl')
        need(digest(ledger) == readback['file_readback_ledger_sha256'], 'FILES_READBACK_LEDGER_CHANGED')
        settings = regular(self.root / 'cms-root' / 'bitrix' / '.settings.php')
        info = settings.stat()
        need(info.st_size <= 1024 * 1024, 'CMS_SETTINGS_LIMIT')
        original = settings.read_bytes()
        rows = []
        with ledger.open('rb') as stream:
            for line in stream:
                need(len(line) <= 65536, 'FILES_READBACK_ROW_LIMIT')
                row = json.loads(line)
                if row.get('path') == 'bitrix/.settings.php': rows.append(row)
        need(len(rows) == 1 and rows[0].get('sha256') == digest_bytes(original) and rows[0].get('size') == len(original),
             'RESTORED_SETTINGS_READBACK_MISMATCH')
        derived, change = derive_settings_bytes(original, attestation['source_db_ip'])
        intent = {'schema_version': 1, 'mode': 'CLONE_ONLY_LITERAL_DB_HOST', **change, 'source_db_attestation': attestation,
                  'source_compose_sha256': self.plan['source_compose_sha256'], 'backup_files_sha256': self.plan['files_sha256'],
                  'files_readback_ledger_sha256': readback['file_readback_ledger_sha256'], 'plan_sha256': digest_bytes(canonical(self.plan))}
        write_private(self.root / 'private' / 'settings-derivation-intent.json', canonical(intent) + b'\n')
        if change['changed']:
            # Stage exact derived bytes privately. Nothing in the source archive or
            # source target is changed; this path belongs to the newly claimed clone.
            staged = settings.parent / ('.settings.php.upgrade-' + secrets.token_hex(16))
            write_private(staged, derived)
            os.chmod(staged, stat.S_IMODE(info.st_mode))
            if os.name == 'posix': os.chown(staged, info.st_uid, info.st_gid)
            self.assert_ownership()
            current = regular(settings).stat()
            need((current.st_dev, current.st_ino) == (info.st_dev, info.st_ino) and digest(settings) == change['before_sha256'],
                 'RESTORED_SETTINGS_CHANGED_BEFORE_DERIVATION')
            os.replace(staged, settings)
            if os.name == 'posix':
                directory_fd = os.open(settings.parent, os.O_RDONLY | os.O_DIRECTORY)
                try: os.fsync(directory_fd)
                finally: os.close(directory_fd)
        verify_settings(self.root / 'cms-root')
        need(digest(settings) == change['after_sha256'] and digest(ledger) == readback['file_readback_ledger_sha256'],
             'DERIVED_SETTINGS_READBACK_MISMATCH')
        receipt = self.root / 'private' / 'settings-derivation.json'
        write_private(receipt, canonical(intent | {'status': 'DERIVED_AND_READBACK_VERIFIED'}) + b'\n')
        self.record('SETTINGS_DERIVATION', status='PASS', **change, receipt_sha256=digest(receipt))
        return {'status': 'PASS', 'changed': change['changed'], 'receipt_sha256': digest(receipt)}

    def record(self, name, **details):
        event = {'stage': name, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **details}
        self.events.append(event)
        # Preflight is read-only even if another executor creates this path meanwhile.
        if not self.created:
            return
        self.assert_ownership()
        flags = os.O_WRONLY | os.O_APPEND | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0)
        if self.event_identity is None:
            flags |= os.O_CREAT | os.O_EXCL
        fd = os.open(self.root / 'events.jsonl', flags, 0o600)
        with os.fdopen(fd, 'ab') as stream:
            info = os.fstat(stream.fileno())
            identity = (info.st_dev, info.st_ino)
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                 and (self.event_identity is None or identity == self.event_identity), 'RECOVERY_EVENT_FILE_CHANGED')
            self.event_identity = identity
            if os.name == 'posix': os.fchmod(stream.fileno(), 0o600)
            for pending in self.events[self.persisted_events:]:
                stream.write(canonical(pending) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
            self.persisted_events = len(self.events)

    def run(self, label, command, timeout=60, input_bytes=None, input_file=None, allow_fail=False):
        self.record(label, status='STARTED')
        try:
            result = subprocess.run(command, input=input_bytes, stdin=input_file, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            self.record(label, status='UNKNOWN_TIMEOUT')
            raise RecoveryError('COMMAND_OUTCOME_UNKNOWN_' + label)
        self.record(label, exit_code=result.returncode, stdout_sha256=hashlib.sha256(result.stdout).hexdigest(), stderr_sha256=hashlib.sha256(result.stderr).hexdigest())
        need(allow_fail or result.returncode == 0, 'COMMAND_FAILED_' + label)
        return result

    def compose(self, label, command, **kwargs):
        return self.run(label, self.prefix + command, **kwargs)

    def sql(self, query=None, file=None, label='SQL_READBACK', timeout=120):
        return self.compose(label, ['exec', '-T', '--user', '0:0', 'db', 'mysql', '--defaults-extra-file=/run/secrets/recovery_mysql', '--binary-mode', '--local-infile=0', '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names', 'upgrade'],
                            input_bytes=query.encode() if query is not None else None, input_file=file, timeout=timeout).stdout

    def counts(self):
        counts = {}
        for table, expected in sorted(self.plan['baseline']['database_counts'].items()):
            raw = self.sql('SELECT COUNT(*) FROM `' + table + '`;\n').decode().strip()
            need(re.fullmatch('[0-9]+', raw) is not None, 'READBACK_NOT_SCALAR')
            counts[table] = int(raw)
            need(counts[table] == expected, 'RESTORED_TABLE_COUNT_MISMATCH_' + table)
        if 'entity' in self.plan['baseline']:
            entity = self.plan['baseline']['entity']
            query = "SELECT JSON_OBJECT('id',ID,'xml_id',XML_ID,'name',NAME) FROM b_iblock_element WHERE ID=" + str(entity['id']) + ';\n'
            actual = json.loads(self.sql(query).decode())
            need(all(actual.get(key) == value for key, value in entity.items()), 'RESTORED_ENTITY_IDENTITY_MISMATCH')
        return counts

    def source_inspect(self):
        prefix = ['docker', 'compose', '--project-name', self.args.project, '--file', self.args.source_compose]
        ids = self.run('SOURCE_CONTAINER_IDS', prefix + ['ps', '-q'], timeout=30).stdout.decode().split()
        need(len(ids) == 3 and all(re.fullmatch('[a-f0-9]{12,64}', value) for value in ids), 'SOURCE_THREE_CONTAINERS_REQUIRED')
        values = json.loads(self.run('SOURCE_INSPECT', ['docker', 'inspect', *ids]).stdout)
        result = []
        for item in values:
            labels = item['Config'].get('Labels', {})
            need(labels.get('com.docker.compose.project') == self.args.project and item['State']['Running'], 'SOURCE_CONTAINER_BINDING')
            # Docker does not promise Mounts enumeration order between inspect calls.
            # Keep every mount field intact; only the order by destination is canonical.
            mounts = sorted(item['Mounts'], key=lambda mount: mount['Destination'])
            result.append({'id': item['Id'], 'service': labels.get('com.docker.compose.service'), 'image': item['Image'], 'mounts': mounts, 'networks': item['NetworkSettings']['Networks']})
        need({item['service'] for item in result} == {'db', 'php', 'nginx'}, 'SOURCE_SERVICE_BINDING')
        return sorted(result, key=lambda row: row['service'])

    def attest(self, services):
        for service in services:
            ids = self.compose('CLONE_CONTAINER_ID', ['ps', '-q', service]).stdout.decode().split()
            need(len(ids) == 1 and re.fullmatch('[a-f0-9]{12,64}', ids[0]), 'EXACT_CLONE_CONTAINER_REQUIRED')
            container = json.loads(self.run('CLONE_INSPECT', ['docker', 'inspect', ids[0]]).stdout)[0]
            image = self.plan['projection']['compose']['services'][service]['image']
            image_info = json.loads(self.run('PINNED_IMAGE_INSPECT', ['docker', 'image', 'inspect', image]).stdout)
            need(len(image_info) == 1, 'PINNED_IMAGE_MISSING')
            validate_clone_container(container, service, self.plan['projection'], image_info[0]['Id'])
            self.record('CLONE_ATTESTATION', status='PASS', service=service, container_id=container['Id'], image_id=container['Image'])

    def http(self, target, auth=None):
        connection = http.client.HTTPConnection(self.plan['projection']['nginx_ip'], 8080, timeout=45)
        headers = {'Host': self.plan['baseline']['trusted_host'], 'X-Forwarded-Proto': 'https'}
        if auth is not None:
            headers['Authorization'] = auth
        try:
            connection.request('GET', target, headers=headers)
            response = connection.getresponse()
            body = response.read(4 * 1024 * 1024 + 1)
            need(len(body) <= 4 * 1024 * 1024, 'HTTP_RESPONSE_LIMIT')
            received = {key.lower(): value for key, value in response.getheaders()}
            need('noindex' in received.get('x-robots-tag', '') and 'no-store' in received.get('cache-control', ''), 'HTTP_PRIVATE_HEADERS_MISSING')
            return response.status, received, body
        finally:
            connection.close()

    def execute(self):
        need(sys.platform.startswith('linux') and os.geteuid() == 0, 'LINUX_ROOT_EXECUTION_REQUIRED')
        expected_plan = hashlib.sha256(canonical(self.plan)).hexdigest()
        need(pin(self.args.accept_plan_sha256) and self.args.accept_plan_sha256 == expected_plan, 'ACCEPTED_PLAN_PIN_MISMATCH')
        need(not self.root.exists() and not self.root.is_symlink(), 'NEW_RECOVERY_DESTINATION_REQUIRED')
        for directory in (Path('/opt'), Path('/opt/upgrade'), self.root.parent):
            if directory.exists():
                info = directory.stat()
                need(directory.resolve() == directory and info.st_uid == 0 and info.st_mode & 0o022 == 0, 'ROOT_OWNED_RECOVERY_ANCESTORS_REQUIRED')
        # Keep a conservative reserve for the shared host. This is a preflight floor,
        # not an estimate of all possible MySQL expansion or a guarantee against disk exhaustion.
        sql_size = Path(self.receipt['database_file']).stat().st_size
        tar_size = Path(self.receipt['files_file']).stat().st_size
        required = self.plan['archive']['expanded_bytes'] + tar_size + sql_size * 3 + 2 * 1024 * 1024 * 1024
        need(shutil.disk_usage('/opt/upgrade').free >= required, 'SHARED_HOST_DISK_RESERVE_REQUIRED')
        docker_root = json.loads(self.run('DOCKER_STORAGE_LOCATION', ['docker', 'info', '--format', '{{json .DockerRootDir}}']).stdout)
        need(isinstance(docker_root, str) and Path(docker_root).is_absolute() and Path(docker_root).is_dir(), 'DOCKER_STORAGE_LOCATION_INVALID')
        need(shutil.disk_usage(docker_root).free >= sql_size * 3 + 2 * 1024 * 1024 * 1024, 'DOCKER_STORAGE_RESERVE_REQUIRED')
        # Read-only absence checks before any clone resource creation. A stale partial run is not adopted.
        projection = self.plan['projection']
        need(self.run('NEW_VOLUME_CHECK', ['docker', 'volume', 'inspect', self.args.clone_project + '-database'], allow_fail=True).returncode != 0, 'CLONE_VOLUME_ALREADY_EXISTS')
        need(self.run('NEW_NETWORK_CHECK', ['docker', 'network', 'inspect', projection['network']], allow_fail=True).returncode != 0, 'CLONE_NETWORK_ALREADY_EXISTS')
        found = self.run('NEW_PROJECT_CHECK', ['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + self.args.clone_project]).stdout.strip()
        need(not found, 'CLONE_CONTAINERS_ALREADY_EXIST')
        source_before = self.source_inspect()
        source_db = next(item for item in source_before if item['service'] == 'db')
        source_image = projection['compose']['services']['db']['image']
        image_info = json.loads(self.run('SOURCE_PINNED_DB_IMAGE', ['docker', 'image', 'inspect', source_image]).stdout)
        need(len(image_info) == 1, 'PINNED_SOURCE_DB_IMAGE_MISSING')
        source_attestation = attest_source_db(source_db, projection, image_info[0]['Id'])
        source_ip = source_attestation['source_db_ip']
        self.root.parent.mkdir(mode=0o700, parents=False, exist_ok=True)
        self.claim_destination(expected_plan)
        for name in ('private', 'inputs', 'config', 'state'):
            (self.root / name).mkdir(mode=0o700)
        write_private(self.root / 'source-before.json', canonical(source_before) + b'\n')
        self.record('INTENT_SAVED', status='RUNNING', plan_sha256=expected_plan)
        self.stage = 'COPY_VERIFIED_INPUTS'
        for kind, filename in [('database', 'database.sql'), ('files', 'site.tar.gz')]:
            source_path = regular(self.receipt[kind + '_file'])
            destination = self.root / 'inputs' / filename
            with source_path.open('rb') as source, destination.open('xb') as out:
                os.chmod(destination, 0o600)
                shutil.copyfileobj(source, out, 1024 * 1024)
            need(digest(destination) == self.receipt[kind + '_sha256'], 'COPIED_BACKUP_HASH_MISMATCH')
        guard = self.root / 'config' / 'isolate-network.sh'
        write_private(guard, regular(self.args.guard).read_bytes())
        need(digest(guard) == self.plan['guard_sha256'], 'COPIED_GUARD_HASH_MISMATCH')
        for name, path in projection['copies'].items():
            raw = regular(path, private=name.startswith('db_')).read_bytes()
            if name in self.plan['config_pins']:
                need(hashlib.sha256(raw).hexdigest() == self.plan['config_pins'][name], 'CONFIG_CHANGED')
            if name == 'nginx.conf':
                raw = projected_nginx(raw, projection['source_gateway'], projection['gateway'])
            destination = self.root / ('private' if name.startswith('db_') else 'config') / name
            write_private(destination, raw)
            if not name.startswith('db_'):
                os.chmod(destination, 0o644)
            else:
                # Compose local secrets are read-only bind mounts. MySQL drops to its own UID
                # before reading *_FILE; host access is still protected by both 0700 parents.
                os.chmod(destination, 0o444)
        password = (self.root / 'private' / 'db_root_password').read_text().rstrip('\r\n')
        write_private(self.root / 'private' / 'recovery_mysql', mysql_defaults(password))
        password = None
        write_private(self.root / 'config' / 'recovery-probe.php', PROBE.encode())
        os.chmod(self.root / 'config' / 'recovery-probe.php', 0o644)
        write_private(self.compose_file, canonical(projection['compose']) + b'\n')
        self.stage = 'FILES_RESTORE'
        readback = extract_files(self.root / 'inputs' / 'site.tar.gz', self.root / 'cms-root', self.plan['archive'], self.root / 'files-readback.jsonl')
        need((self.root / 'cms-root/bitrix/modules/main/include/prolog_before.php').is_file()
             and (self.root / 'cms-root/local/upgrade-route.php').is_file(), 'RESTORED_CMS_AND_OWN_ROUTER_REQUIRED')
        self.record('FILES_READBACK', status='PASS', **readback)
        self.stage = 'CLONE_CONFIGURATION_DERIVATION'
        configuration_derivation = self.derive_clone_settings(source_attestation, readback)
        for base, directories, files in os.walk(self.root / 'cms-root', followlinks=False):
            os.chown(base, 33, 33)
            for filename in files:
                path = Path(base) / filename
                need(not path.is_symlink(), 'EXTRACTED_SYMLINK')
                os.chown(path, 33, 33)
        os.chown(self.root / 'state', 33, 33)
        self.stage = 'NETWORK_GUARD'
        guard_args = [self.args.clone_project, projection['network'], self.args.bridge, self.args.subnet, '/opt/upgrade/private/network-guards']
        self.run('GUARD_APPLY', ['bash', str(guard), 'apply', *guard_args], timeout=120)
        self.run('GUARD_CHECK_BEFORE_DB', ['bash', str(guard), 'check', *guard_args], timeout=120)
        self.compose('COMPOSE_VALIDATE', ['config', '--quiet'])
        self.stage = 'DATABASE_RESTORE'
        self.compose('DB_START', ['up', '-d', '--no-deps', '--pull', 'never', 'db'], timeout=180)
        self.attest(['db'])
        ready = False
        for _ in range(60):
            check = self.compose('DB_READY', ['exec', '-T', '--user', '0:0', 'db', 'mysqladmin', '--defaults-extra-file=/run/secrets/recovery_mysql', 'ping', '--silent'], timeout=10, allow_fail=True)
            if check.returncode == 0:
                ready = True
                break
            time.sleep(2)
        need(ready, 'DATABASE_START_TIMEOUT')
        with (self.root / 'inputs' / 'database.sql').open('rb') as sql:
            self.sql(file=sql, label='SQL_IMPORT', timeout=1800)
        counts_before = self.counts()
        self.record('DATABASE_READBACK', status='PASS', counts=counts_before)
        self.stage = 'PRE_CMS_ISOLATION'
        # Host positive control ensures the source DB denial cannot be attributed to a stopped service.
        with socket.create_connection((source_ip, 3306), timeout=5):
            pass
        self.run('GUARD_CHECK_BEFORE_PHP', ['bash', str(guard), 'check', *guard_args], timeout=120)
        raw = self.compose('PRE_CMS_RUNTIME_PROBE', ['run', '--rm', '--no-deps', '-T', '--user', '33:33', '--entrypoint', 'php', 'php', '/opt/upgrade/recovery-probe.php', source_ip], timeout=45).stdout
        probe = json.loads(raw)
        need(probe.get('prepend_active') is True and probe.get('prepend_file') == '/opt/upgrade/prepend.php'
             and probe.get('prepend_sha256') == self.plan['baseline']['php_prepend_sha256']
             and probe.get('allow_url_fopen') is False and probe.get('own_db_connected') is True
             and probe.get('source_db_connected') is False and probe.get('external_dns_failed') is True
             and all(probe.get('disabled', {}).get(key) is True for key in ['mail', 'exec', 'passthru', 'shell_exec', 'system', 'popen', 'proc_open']), 'PRE_CMS_ISOLATION_FAILED')
        self.record('PRE_CMS_ISOLATION', status='PASS', source_db_host_positive=True, evidence=probe, external_packet_capture='NOT_RUN')
        self.stage = 'HTTP_SMOKE'
        self.compose('WEB_START', ['up', '-d', '--no-deps', '--pull', 'never', 'php', 'nginx'], timeout=180)
        self.attest(['db', 'php', 'nginx'])
        self.compose('NGINX_CONFIG', ['exec', '-T', 'nginx', 'nginx', '-t'], timeout=30)
        time.sleep(2)
        auth_password = regular(self.args.auth_password_file, private=True).read_text().rstrip('\r\n')
        need(1 <= len(auth_password) <= 512 and not re.search(r'[\x00-\x1f\x7f]', auth_password), 'AUTH_SECRET_INVALID')
        auth = 'Basic ' + base64.b64encode((self.args.auth_user + ':' + auth_password).encode()).decode()
        auth_password = None
        status_code, headers, _ = self.http('/')
        need(status_code == 401 and 'basic' in headers.get('www-authenticate', '').lower(), 'AUTHENTICATION_NOT_ENFORCED')
        self.record('UNAUTHENTICATED_HTTP', status='PASS', http_status=status_code)
        for case in self.plan['baseline']['http']:
            status_code, _, body = self.http(case['request_target'], auth)
            need(status_code == case['status'], 'HTTP_STATUS_MISMATCH')
            if 'body_sha256' in case:
                need(digest_bytes(body) == case['body_sha256'], 'HTTP_BODY_HASH_MISMATCH')
            text = body.decode('utf-8', errors='strict')
            need(all(value in text for value in case.get('contains', [])), 'HTTP_FACT_WITNESS_MISSING')
            self.record('AUTHENTICATED_HTTP', status='PASS', request_target=case['request_target'], http_status=status_code, body_sha256=digest_bytes(body), bytes=len(body))
        for target in ('/bitrix/.settings.php', '/local/upgrade-route.php', '/bitrix/admin/index.php'):
            status_code, _, _ = self.http(target, auth)
            need(status_code == 404, 'PRIVATE_PATH_EXPOSED')
        auth = None
        counts_after = self.counts()
        need(counts_before == counts_after, 'HTTP_CHANGED_DATABASE_COUNTS')
        need(self.source_inspect() == source_before, 'SOURCE_RUNTIME_CHANGED_DURING_RECOVERY')
        self.run('GUARD_CHECK_FINAL', ['bash', str(guard), 'check', *guard_args], timeout=120)
        self.record('FINAL_READBACK', status='PASS', counts=counts_after, source_runtime_unchanged=True)
        return {'status': 'ISOLATED_COPY_RESTORED_AND_SMOKE_VERIFIED', 'files_restore': 'PASS', 'database_import': 'PASS', 'database_readback': 'PASS',
                'files_readback_scope': 'BACKUP_BYTES_BEFORE_DECLARED_CLONE_CONFIGURATION_DERIVATION', 'configuration_derivation': configuration_derivation,
                'http_smoke': 'PASS', 'mail_disabled': 'PASS', 'orders_events_counts_unchanged': 'PASS', 'source_runtime_unchanged': 'PASS',
                'external_packet_capture': 'NOT_RUN', 'production_recovery': 'NOT_RUN', 'original_site_modified': False, 'cleanup': 'NOT_RUN', 'plan_sha256': expected_plan}


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


@contextmanager
def execution_lock(args, plan):
    """OS releases this lock on process death; an existing partial copy is still never adopted."""
    need(sys.platform.startswith('linux') and os.geteuid() == 0, 'LINUX_ROOT_EXECUTION_REQUIRED')
    need(pin(args.accept_plan_sha256) and args.accept_plan_sha256 == digest_bytes(canonical(plan)), 'ACCEPTED_PLAN_PIN_MISMATCH')
    import fcntl
    parent = Path('/opt/upgrade/recovery')
    for ancestor in (Path('/opt'), Path('/opt/upgrade'), parent):
        if ancestor.exists():
            info = ancestor.stat()
            need(ancestor.resolve() == ancestor and info.st_uid == 0 and info.st_mode & 0o022 == 0, 'ROOT_OWNED_RECOVERY_ANCESTORS_REQUIRED')
    parent.mkdir(mode=0o700, exist_ok=True)
    path = parent / ('.' + args.clone_project + '.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and info.st_mode & 0o077 == 0, 'PRIVATE_RECOVERY_LOCK_REQUIRED')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RecoveryError('RECOVERY_PROJECT_BUSY')
        yield
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project', 'target-id', 'source-root', 'source-compose', 'source-compose-sha256', 'receipt', 'receipt-sha256', 'baseline', 'baseline-sha256',
                 'destination', 'clone-project', 'clone-target-id', 'subnet', 'bridge', 'guard', 'guard-sha256', 'auth-password-file'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--auth-user', default='upgrade')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--accept-plan-sha256')
    args = parser.parse_args()
    executor = None
    try:
        plan, receipt = make_plan(args)
        if not args.execute:
            print(json.dumps({'status': 'PLAN_ONLY', 'plan_sha256': digest_bytes(canonical(plan)), 'plan': plan}, ensure_ascii=False, sort_keys=True))
            return 0
        executor = Executor(args, plan, receipt)
        with execution_lock(args, plan):
            result = executor.execute()
            executor.write_result(result)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        result = {'status': 'FAILED', 'code': code, 'stage': executor.stage if executor else 'PLAN_VALIDATION', 'production_recovery': 'NOT_RUN',
                  'automatic_cleanup': False, 'recovery_pass': False, 'retry_policy': 'DO_NOT_REPLAY_INTO_PARTIAL_DESTINATION'}
        if executor is not None and executor.created:
            try:
                executor.write_result(result)
            except (RecoveryError, OSError):
                # A changed/foreign root or pre-existing receipt is never written to.
                result['failure_receipt'] = 'NOT_WRITTEN_OWNERSHIP_OR_EXCLUSIVE_WRITE_FAILED'
        print(json.dumps(result, sort_keys=True))
        return 1


if __name__ == '__main__':
    sys.exit(main())
