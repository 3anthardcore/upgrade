#!/usr/bin/env python3
"""Consistent private backup of one pinned isolated target. Default is plan only.

No restore, CMS execution, content Store writes or foreign container mutations.
An interrupted execute can only resume runtime recovery, never partial copying.
"""
import argparse
from contextlib import contextmanager
import datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import queue
import secrets
import sqlite3
import stat
import subprocess
import sys
import tarfile
import threading
import time


class BackupError(Exception):
    pass


def need(value, code):
    if not value:
        raise BackupError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def pin(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for part in iter(lambda: source.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def load_json(raw, limit=8 * 1024 * 1024):
    def pairs(entries):
        result = {}
        for key, value in entries:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    need(len(raw) <= limit, 'JSON_LIMIT')
    try:
        value = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        raise BackupError('JSON_INVALID') from None
    need(isinstance(value, dict), 'JSON_OBJECT_REQUIRED')
    return value


def path_checked(value, directory=False, private=False, absent=False):
    p = Path(value)
    need(p.is_absolute() and p.resolve() == p and str(p) != p.anchor, 'CANONICAL_PATH_REQUIRED')
    for parent in [p, *p.parents]:
        need(not parent.is_symlink(), 'SYMLINK_PATH_FORBIDDEN')
    if absent:
        need(not p.exists(), 'DESTINATION_EXISTS')
        path_checked(str(p.parent), directory=True, private=True)
        return p
    info = p.stat()
    need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
         'DIRECTORY_REQUIRED' if directory else 'REGULAR_SINGLE_LINK_REQUIRED')
    if private and os.name == 'posix':
        need(info.st_uid == 0 and info.st_mode & 0o077 == 0, 'ROOT_PRIVATE_PATH_REQUIRED')
    return p


def pinned(path, expected, private=False):
    need(pin(expected), 'HASH_REQUIRED')
    p = path_checked(path, private=private)
    need(digest(p) == expected, 'FILE_PIN_MISMATCH')
    return p


def fsync_dir(path):
    if os.name == 'posix':
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_private(path, body, replace=False):
    path = Path(path)
    pending = path.with_name(path.name + '.pending-' + secrets.token_hex(8))
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        if not replace:
            need(not path.exists(), 'OUTPUT_EXISTS')
        os.replace(pending, path)
        fsync_dir(path.parent)
    finally:
        if pending.exists():
            pending.unlink()


def immutable_container(item):
    return {key: sorted(item.get(key, []), key=lambda x: x.get('Destination', '')) if key == 'Mounts'
            else item.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts')}


def validate_profile(path, expected):
    p = pinned(path, expected, private=True)
    value = load_json(p.read_bytes())
    keys = {'schema_version', 'project_id', 'target_id', 'cms_root', 'state_root', 'native_journal_dir',
            'destination', 'docker', 'containers', 'network', 'guard', 'database', 'limits', 'active_pointer_sha256'}
    need(set(value) == keys and value['schema_version'] == 1, 'PROFILE_SCHEMA')
    for key in ('project_id', 'target_id'):
        need(isinstance(value[key], str) and re.fullmatch('[a-z0-9][a-z0-9-]{0,79}', value[key]), 'IDENTITY_INVALID')
    need(len(value['project_id']) <= 40, 'PROJECT_LIMIT')
    roots = [path_checked(value[k], directory=True) for k in ('cms_root', 'state_root', 'native_journal_dir')]
    need(roots[2].name == value['target_id'], 'JOURNAL_TARGET_MISMATCH')
    destination = Path(value['destination'])
    path_checked(str(destination.parent), directory=True, private=True)
    need(destination.is_absolute() and destination.resolve() == destination, 'DESTINATION_CANONICAL')
    all_roots = roots + [destination]
    need(all(a != b and a not in b.parents and b not in a.parents for i, a in enumerate(all_roots)
             for b in all_roots[i + 1:]), 'ROOTS_OVERLAP')
    for key in ('docker', 'guard'):
        need(set(value[key]) == {'path', 'sha256'}, 'TOOL_SCHEMA')
        pinned(value[key]['path'], value[key]['sha256'])
    network = value['network']
    need(set(network) == {'name', 'id', 'bridge', 'subnet'}, 'NETWORK_SCHEMA')
    need(network['name'] == 'upgrade-' + value['project_id'] + '-isolated' and pin(network['id']), 'NETWORK_IDENTITY')
    need(re.fullmatch('br-upg[a-z0-9-]{1,9}', network['bridge']), 'BRIDGE_INVALID')
    subnet = ipaddress.ip_network(network['subnet'], strict=True)
    need(subnet.version == 4 and subnet.is_private and subnet.prefixlen == 24 and not subnet.is_loopback and not subnet.is_link_local, 'PRIVATE_SUBNET_REQUIRED')
    need(set(value['containers']) == {'db', 'php', 'nginx'}, 'CONTAINER_ROLES')
    for role, item in value['containers'].items():
        need(set(item) == {'id', 'image_id', 'static_sha256', 'ip', 'running'}, 'CONTAINER_SCHEMA')
        need(pin(item['id']) and pin(item['static_sha256']) and re.fullmatch('sha256:[a-f0-9]{64}', item['image_id']), 'CONTAINER_PIN')
        need(type(item['running']) is bool and ipaddress.ip_address(item['ip']) in subnet, 'CONTAINER_STATE')
    need(len({c['id'] for c in value['containers'].values()}) == 3 and value['containers']['db']['running'], 'DISTINCT_RUNNING_DATABASE_REQUIRED')
    db = value['database']
    need(set(db) == {'name', 'cnf_path', 'cnf_sha256', 'dump_executable', 'query_executable'}, 'DATABASE_SCHEMA')
    need(db['name'] == 'upgrade', 'DATABASE_SCOPE')
    need(db['dump_executable'] in ('/usr/bin/mysqldump', '/usr/bin/mariadb-dump') and
         db['query_executable'] in ('/usr/bin/mysql', '/usr/bin/mariadb'), 'DATABASE_TOOL_SCOPE')
    cnf = pinned(db['cnf_path'], db['cnf_sha256'], private=True)
    need(0 < cnf.stat().st_size <= 16384 and all(cnf != r and r not in cnf.parents for r in all_roots), 'CREDENTIAL_PATH_OR_LIMIT')
    limits = value['limits']
    need(set(limits) == {'max_files', 'max_total_bytes', 'max_file_bytes', 'command_timeout_seconds', 'stop_timeout_seconds'}, 'LIMIT_SCHEMA')
    for k, low, high in [('max_files', 1, 500000), ('max_total_bytes', 1, 64 * 1024 ** 3), ('max_file_bytes', 1, 16 * 1024 ** 3),
                         ('command_timeout_seconds', 10, 1800), ('stop_timeout_seconds', 10, 300)]:
        need(type(limits[k]) is int and low <= limits[k] <= high, 'LIMIT_INVALID')
    need(pin(value['active_pointer_sha256']), 'ACTIVE_POINTER_PIN_REQUIRED')
    verify_active(value)
    binding = load_json(path_checked(str(roots[2] / 'binding.json')).read_bytes())
    need(binding.get('project_id') == value['project_id'] and binding.get('target_id') == value['target_id']
         and binding.get('document_root') == '/var/www/html' and binding.get('state_dir') == '/var/lib/upgrade', 'NATIVE_JOURNAL_BINDING')
    path_checked(str(roots[1] / ('upgrade-' + value['project_id'] + '.lock')))
    path_checked(str(roots[2] / 'transport-lock.sqlite'))
    return value


def verify_active(profile):
    root = Path(profile['state_root'])
    pointer = pinned(str(root / 'demo-active.json'), profile['active_pointer_sha256'])
    config = load_json(pointer.read_bytes(), 4096)
    need(config.get('schema_version') == 1 and config.get('project_id') == profile['project_id'] and
         config.get('target_id') == profile['target_id'] and pin(config.get('sha256')) and
         isinstance(config.get('relative_path'), str) and re.fullmatch('[a-zA-Z0-9_-]+/data/demo-snapshot.json', config['relative_path']), 'ACTIVE_POINTER_BINDING')
    snapshot = pinned(str(root / config['relative_path']), config['sha256'])
    need(snapshot.stat().st_size <= 64 * 1024 * 1024, 'ACTIVE_SNAPSHOT_LIMIT')
    body = load_json(snapshot.read_bytes(), 64 * 1024 * 1024)
    need(body.get('schema_version') == 1 and body.get('project_id') == profile['project_id'] and pin(body.get('snapshot_id')), 'ACTIVE_SNAPSHOT_BINDING')
    return {'relative_path': config['relative_path'], 'sha256': config['sha256'], 'snapshot_id': body['snapshot_id']}


class Host:
    def __init__(self, profile):
        self.p = profile

    def run(self, args, stdin=None, timeout=None):
        try:
            result = subprocess.run(args, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    timeout=timeout or self.p['limits']['command_timeout_seconds'], check=False,
                                    env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
        except subprocess.TimeoutExpired:
            raise BackupError('COMMAND_OUTCOME_UNKNOWN') from None
        need(result.returncode == 0, 'COMMAND_FAILED')
        need(len(result.stdout) <= 8 * 1024 * 1024, 'COMMAND_OUTPUT_LIMIT')
        return result.stdout

    def docker(self, *args):
        return self.run([self.p['docker']['path'], *args])

    def inspect(self, role):
        data = json.loads(self.docker('inspect', self.p['containers'][role]['id']))
        need(isinstance(data, list) and len(data) == 1, 'CONTAINER_INSPECT_INVALID')
        return data[0]

    def network(self):
        data = json.loads(self.docker('network', 'inspect', self.p['network']['id']))
        need(isinstance(data, list) and len(data) == 1, 'NETWORK_INSPECT_INVALID')
        return data[0]

    def guard(self):
        n = self.p['network']
        pinned(self.p['guard']['path'], self.p['guard']['sha256'])
        self.run(['/bin/bash', self.p['guard']['path'], 'check', self.p['project_id'], n['name'], n['bridge'], n['subnet'], '/opt/upgrade/private/network-guards'])

    def stop(self, role):
        self.docker('stop', '--time', str(self.p['limits']['stop_timeout_seconds']), self.p['containers'][role]['id'])

    def start(self, role):
        self.docker('start', self.p['containers'][role]['id'])

    def database_check(self):
        d = self.p['database']
        auth = pinned(d['cnf_path'], d['cnf_sha256'], private=True).read_bytes()
        raw = self.run([self.p['docker']['path'], 'exec', '-i', '-u', '0:0', self.p['containers']['db']['id'],
                        d['query_executable'], '--defaults-extra-file=/dev/stdin', '--batch', '--skip-column-names',
                        '--host=127.0.0.1', '--port=3306', '--protocol=TCP',
                        '--execute=SELECT @@GLOBAL.event_scheduler; SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=\'upgrade\';'], stdin=auth)
        need(raw.strip().splitlines() in ([b'OFF', b'1'], [b'DISABLED', b'1']), 'DATABASE_WRITER_POLICY')

    def dump(self, output):
        d = self.p['database']
        auth_file = pinned(d['cnf_path'], d['cnf_sha256'], private=True)
        args = [self.p['docker']['path'], 'exec', '-i', '-u', '0:0', self.p['containers']['db']['id'], d['dump_executable'],
                '--defaults-extra-file=/dev/stdin', '--single-transaction', '--routines', '--triggers', '--events',
                '--host=127.0.0.1', '--port=3306', '--protocol=TCP', '--hex-blob', '--databases', 'upgrade']
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as out, auth_file.open('rb') as auth:
            process = subprocess.Popen(args, stdin=auth, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
            chunks = queue.Queue(maxsize=2)
            stop_reader = threading.Event()
            def read_chunks():
                try:
                    while not stop_reader.is_set():
                        part = process.stdout.read(1024 * 1024)
                        while not stop_reader.is_set():
                            try:
                                chunks.put(part, timeout=0.1)
                                break
                            except queue.Full:
                                pass
                        if not part:
                            break
                except OSError:
                    stop_reader.set()
            reader = threading.Thread(target=read_chunks, daemon=True)
            reader.start()
            try:
                until = time.monotonic() + self.p['limits']['command_timeout_seconds']
                total = 0
                while True:
                    need(time.monotonic() < until, 'DUMP_TIMEOUT')
                    need(not stop_reader.is_set(), 'DUMP_READ_FAILED')
                    try:
                        part = chunks.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    if not part:
                        break
                    total += len(part)
                    need(total <= self.p['limits']['max_file_bytes'], 'DUMP_SIZE_LIMIT')
                    out.write(part)
                process.wait(timeout=max(0.1, until - time.monotonic()))
                need(process.returncode == 0, 'DUMP_FAILED')
                out.flush()
                os.fsync(out.fileno())
            finally:
                stop_reader.set()
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)
                reader.join(timeout=2)
                if not reader.is_alive():
                    process.stdout.close()
        validate_sql(output, self.p['limits']['max_file_bytes'])


def verify_container(profile, role, item, running=None):
    expected = profile['containers'][role]
    need(item.get('Id') == expected['id'] and item.get('Image') == expected['image_id'] and
         sha(canonical(immutable_container(item))) == expected['static_sha256'], 'CONTAINER_IDENTITY_CHANGED')
    state = item.get('State', {})
    need(state.get('Status') in ('running', 'exited') and not any(state.get(x) for x in ('Paused', 'Restarting', 'Dead')), 'CONTAINER_UNSTABLE')
    need(type(state.get('Running')) is bool and (running is None or state['Running'] == running), 'CONTAINER_RUNNING_MISMATCH')
    config = item.get('HostConfig') or {}
    need(not config.get('Privileged') and (config.get('RestartPolicy') or {}).get('Name', 'no') in ('no', ''), 'CONTAINER_AUTO_RESTART_FORBIDDEN')
    labels = (item.get('Config') or {}).get('Labels') or {}
    need(labels.get('com.docker.compose.project') == profile['project_id'] and labels.get('com.docker.compose.service') == role, 'CONTAINER_LABEL_MISMATCH')
    networks = item.get('NetworkSettings', {}).get('Networks', {})
    need(set(networks) == {profile['network']['name']}, 'CONTAINER_NETWORK_SET')
    attachment = networks[profile['network']['name']]
    if state['Running']:
        need(attachment.get('NetworkID') == profile['network']['id'] and attachment.get('IPAddress') == expected['ip'], 'CONTAINER_NETWORK_IDENTITY')
    else:
        need(attachment.get('NetworkID') in ('', profile['network']['id']) and attachment.get('IPAddress') in ('', expected['ip']), 'STOPPED_NETWORK_IDENTITY')
    mounts = {m.get('Destination'): m for m in item.get('Mounts', [])}
    if role in ('php', 'nginx'):
        need(mounts.get('/var/www/html', {}).get('Source') == profile['cms_root'], 'CMS_MOUNT_MISMATCH')
        if role == 'nginx':
            need(mounts['/var/www/html'].get('RW') is False, 'NGINX_CMS_READONLY_REQUIRED')
        else:
            need(mounts.get('/var/lib/upgrade', {}).get('Source') == profile['state_root'], 'STATE_MOUNT_MISMATCH')
    else:
        need('/var/lib/mysql' in mounts, 'DATABASE_MOUNT_REQUIRED')
    return state['Running']


def verify_network(profile, item):
    n = profile['network']
    need(item.get('Id') == n['id'] and item.get('Name') == n['name'] and item.get('Driver') == 'bridge'
         and item.get('Internal') is True and item.get('EnableIPv6') is False, 'NETWORK_ISOLATION_MISMATCH')
    need(item.get('Options', {}).get('com.docker.network.bridge.name') == n['bridge'] and
         item.get('Labels', {}).get('upgrade.project') == profile['project_id'], 'NETWORK_OWNERSHIP_MISMATCH')
    need([x.get('Subnet') for x in item.get('IPAM', {}).get('Config', [])] == [n['subnet']], 'NETWORK_SUBNET_MISMATCH')


def make_plan(profile, profile_sha256, host):
    verify_network(profile, host.network())
    for role in ('db', 'php', 'nginx'):
        observed = host.inspect(role)
        verify_container(profile, role, observed, profile['containers'][role]['running'])
        if role == 'php':
            binding = load_json(path_checked(str(Path(profile['native_journal_dir']) / 'binding.json')).read_bytes())
            need(binding.get('container') in (observed['Id'], observed.get('Name', '').lstrip('/')), 'JOURNAL_CONTAINER_MISMATCH')
    # Read-only SELECT also validates stdin credentials before any target downtime.
    host.database_check()
    return {'schema_version': 1, 'kind': 'CURRENT_RUNTIME_BACKUP', 'profile_sha256': profile_sha256,
            'runner_sha256': digest(Path(__file__).resolve()), 'profile': profile,
            'actions': ['lock-native-transport', 'lock-target-importer', 'stop-nginx', 'stop-php',
                        'check-db-events-off', 'dump-sql', 'archive-cms', 'archive-private-state',
                        'archive-native-journal', 'verify-copies', 'restore-original-runtime'],
            'resume_policy': 'RECOVER_RUNTIME_ONLY_NO_COPY_RETRY', 'restore_test': 'NOT_RUN'}


@contextmanager
def source_locks(profile):
    import fcntl
    lock = path_checked(str(Path(profile['state_root']) / ('upgrade-' + profile['project_id'] + '.lock')))
    sql = path_checked(str(Path(profile['native_journal_dir']) / 'transport-lock.sqlite'))
    connection = sqlite3.connect(sql.as_uri() + '?mode=rw', uri=True, timeout=0, isolation_level=None)
    fd = None
    try:
        connection.execute('PRAGMA busy_timeout=0')
        connection.execute('BEGIN EXCLUSIVE')
        fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
        opened = os.fstat(fd)
        need((opened.st_dev, opened.st_ino) == (lock.stat().st_dev, lock.stat().st_ino), 'TARGET_LOCK_REPLACED')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        if fd is not None:
            os.close(fd)
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def file_stamp(info):
    # Windows lstat/fstat expose different historical creation/change times for SQLite files.
    # Native execution is Linux-only and retains the strict ctime comparison.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns if os.name == 'posix' else 0)


def tree(root, limits):
    root = path_checked(str(root), directory=True)
    entries = {}
    total = 0
    def enumeration_failed(error):
        # os.walk otherwise silently omits unreadable subtrees, including repeated EIO.
        # Every preflight/before/after inventory must fail, never certify an omission.
        raise BackupError('TREE_ENUMERATION_FAILED') from None
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=enumeration_failed):
        for name in sorted(dirs + files):
            p = Path(directory) / name
            info = p.lstat()
            relative = p.relative_to(root).as_posix()
            need(not re.search(r'[\x00-\x1f\x7f\\:]', relative) and len(relative.encode()) <= 4096, 'TREE_PATH_INVALID')
            need(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'TREE_LINK_OR_SPECIAL')
            if stat.S_ISREG(info.st_mode):
                need(info.st_size <= limits['max_file_bytes'], 'TREE_FILE_LIMIT')
                total += info.st_size
            entries[relative] = file_stamp(info)
            need(len(entries) <= limits['max_files'] and total <= limits['max_total_bytes'], 'TREE_TOTAL_LIMIT')
    return entries


def archive_tree(root, output, limits):
    root = Path(root)
    before = tree(root, limits)
    ledger = []
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as sink:
        with tarfile.open(fileobj=sink, mode='w|gz', format=tarfile.PAX_FORMAT) as archive:
            for relative, stamp in sorted(before.items()):
                p = root / relative
                current = p.lstat()
                need(file_stamp(current) == stamp, 'SOURCE_CHANGED_DURING_BACKUP')
                info = tarfile.TarInfo(relative)
                info.mode = stat.S_IMODE(current.st_mode)
                info.uid, info.gid, info.mtime = current.st_uid, current.st_gid, current.st_mtime
                row = {'path': relative, 'mode': info.mode, 'uid': info.uid, 'gid': info.gid}
                if stat.S_ISDIR(current.st_mode):
                    info.type = tarfile.DIRTYPE
                    archive.addfile(info)
                    row['type'] = 'directory'
                else:
                    source_fd = os.open(p, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                    with os.fdopen(source_fd, 'rb') as source:
                        need(file_stamp(os.fstat(source.fileno())) == stamp, 'SOURCE_CHANGED_DURING_BACKUP')
                        info.size = current.st_size
                        h = hashlib.sha256()
                        class HashedReader:
                            def read(self, size=-1):
                                body = source.read(size)
                                h.update(body)
                                return body
                        archive.addfile(info, HashedReader())
                        need(file_stamp(os.fstat(source.fileno())) == stamp, 'SOURCE_CHANGED_DURING_BACKUP')
                    row.update(type='file', size=info.size, sha256=h.hexdigest())
                ledger.append(row)
        sink.flush()
        os.fsync(sink.fileno())
    need(tree(root, limits) == before, 'SOURCE_CHANGED_DURING_BACKUP')
    verify_archive(output, ledger)
    return ledger


def verify_archive(path, ledger):
    found = []
    with tarfile.open(path, 'r|gz') as archive:
        for item in archive:
            need(item.isdir() or item.isreg(), 'BACKUP_ARCHIVE_TYPE')
            row = {'path': item.name, 'mode': item.mode, 'uid': item.uid, 'gid': item.gid,
                   'type': 'directory' if item.isdir() else 'file'}
            if item.isreg():
                h = hashlib.sha256()
                source = archive.extractfile(item)
                for body in iter(lambda: source.read(1024 * 1024), b''):
                    h.update(body)
                row.update(size=item.size, sha256=h.hexdigest())
            found.append(row)
    need(found == ledger, 'BACKUP_ARCHIVE_READBACK_MISMATCH')


def validate_sql(path, limit):
    p = path_checked(str(path))
    need(40 <= p.stat().st_size <= limit, 'SQL_SIZE_INVALID')
    with p.open('rb') as source:
        head = source.read(4096)
        source.seek(max(0, p.stat().st_size - 8192))
        tail = source.read()
    need((b'MySQL dump' in head or b'MariaDB dump' in head) and b'Dump completed on' in tail, 'SQL_DUMP_INCOMPLETE')


class Executor:
    def __init__(self, plan, host):
        self.plan, self.p, self.host = plan, plan['profile'], host
        self.destination = Path(self.p['destination'])
        self.intent = None
        self.state = None
        self.saved_state_sha256 = None

    def owned(self):
        p = path_checked(str(self.destination), directory=True, private=True)
        info = p.stat()
        need([info.st_dev, info.st_ino] == self.intent['destination_identity'], 'DESTINATION_REPLACED')
        raw = path_checked(str(p / 'intent.json'), private=True).read_bytes()
        need(raw == canonical(self.intent), 'INTENT_REPLACED')

    def save(self):
        self.owned()
        state_file = self.destination / 'runtime-state.json'
        if self.saved_state_sha256 is not None:
            need(digest(path_checked(str(state_file), private=True)) == self.saved_state_sha256, 'RUNTIME_STATE_CHANGED')
        else:
            need(not state_file.exists(), 'RUNTIME_STATE_EXISTS')
        self.state['intent_sha256'] = sha(canonical(self.intent))
        body = canonical(self.state)
        write_private(state_file, body, replace=True)
        self.saved_state_sha256 = sha(body)

    def claim(self):
        path_checked(str(self.destination), absent=True)
        self.destination.mkdir(mode=0o700)
        fsync_dir(self.destination.parent)
        info = self.destination.stat()
        self.intent = {'schema_version': 1, 'nonce': secrets.token_hex(32), 'plan': self.plan,
                       'plan_sha256': sha(canonical(self.plan)), 'destination_identity': [info.st_dev, info.st_ino]}
        write_private(self.destination / 'intent.json', canonical(self.intent))
        self.state = {'schema_version': 1, 'phase': 'CLAIMED', 'actions': {}, 'runtime_restored': False}
        self.save()

    def load(self, accepted):
        self.intent = load_json(path_checked(str(self.destination / 'intent.json'), private=True).read_bytes())
        need(self.intent.get('plan_sha256') == accepted and sha(canonical(self.intent.get('plan'))) == accepted and
             self.intent.get('plan') == self.plan, 'RESUME_PLAN_MISMATCH')
        self.owned()
        state_bytes = path_checked(str(self.destination / 'runtime-state.json'), private=True).read_bytes()
        self.state = load_json(state_bytes)
        self.saved_state_sha256 = sha(state_bytes)
        need(set(self.state) == {'schema_version', 'phase', 'actions', 'runtime_restored', 'intent_sha256'} and
             self.state['schema_version'] == 1 and self.state['intent_sha256'] == sha(canonical(self.intent)) and
             type(self.state['runtime_restored']) is bool and self.state['phase'] in
             ('CLAIMED', 'QUIESCED', 'SNAPSHOT_VERIFIED', 'RUNTIME_RECOVERY_REQUIRED',
              'BACKUP_FAILED_RUNTIME_RESTORED', 'COMPLETE', 'RECOVERED_RUNTIME_ONLY_BACKUP_NOT_ACCEPTED') and
             isinstance(self.state['actions'], dict) and set(self.state['actions']) <= {'nginx', 'php'}, 'RUNTIME_STATE_INVALID')
        for role, action in self.state['actions'].items():
            need(set(action) == {'id', 'stop', 'start'} and action['id'] == self.p['containers'][role]['id'] and
                 action['stop'] in ('REQUESTED', 'STOPPED', 'UNKNOWN') and action['start'] in (None, 'REQUESTED', 'RUNNING', 'UNKNOWN'), 'RUNTIME_ACTION_INVALID')

    def stop(self, role):
        running = verify_container(self.p, role, self.host.inspect(role), self.p['containers'][role]['running'])
        if not running:
            return
        self.state['actions'][role] = {'id': self.p['containers'][role]['id'], 'stop': 'REQUESTED', 'start': None}
        self.save()
        try:
            self.host.stop(role)
            verify_container(self.p, role, self.host.inspect(role), False)
            self.state['actions'][role]['stop'] = 'STOPPED'
        except Exception:
            self.state['actions'][role]['stop'] = 'UNKNOWN'
            self.save()
            raise
        self.save()

    def restore_runtime(self):
        self.owned()
        self.host.guard()
        verify_network(self.p, self.host.network())
        verify_container(self.p, 'db', self.host.inspect('db'), True)
        for role in ('php', 'nginx'):
            action = self.state['actions'].get(role)
            current = verify_container(self.p, role, self.host.inspect(role))
            if action is None:
                need(current == self.p['containers'][role]['running'], 'UNOWNED_RUNTIME_CHANGE')
                continue
            if action['start'] in ('REQUESTED', 'UNKNOWN'):
                need(current, 'START_OUTCOME_UNKNOWN_NO_RETRY')
                action['start'] = 'RUNNING'
                self.save()
            elif current:
                need(action['stop'] == 'STOPPED' and action['start'] == 'RUNNING', 'STOP_OUTCOME_UNKNOWN_NO_RETRY')
            else:
                need(action['start'] is None, 'RUNTIME_CHANGED_AFTER_RESTORE')
                action['stop'] = 'STOPPED'
                action['start'] = 'REQUESTED'
                self.save()
                try:
                    self.host.start(role)
                    verify_container(self.p, role, self.host.inspect(role), True)
                    action['start'] = 'RUNNING'
                except Exception:
                    action['start'] = 'UNKNOWN'
                    self.save()
                    raise
                self.save()
        for role in ('db', 'php', 'nginx'):
            verify_container(self.p, role, self.host.inspect(role), self.p['containers'][role]['running'])
        self.host.guard()
        self.state['runtime_restored'] = True
        self.save()

    def snapshots(self):
        self.owned()
        for role in ('php', 'nginx'):
            verify_container(self.p, role, self.host.inspect(role), False)
        verify_container(self.p, 'db', self.host.inspect('db'), True)
        active = verify_active(self.p)
        # Refuse oversized source trees before SQL/archive creation, with no silent exclusions.
        inventories = [tree(self.p[key], self.p['limits']) for key in ('cms_root', 'state_root', 'native_journal_dir')]
        preflight_bytes = sum(stamp[3] for inventory in inventories for stamp in inventory.values() if stat.S_ISREG(stamp[2]))
        need(preflight_bytes <= self.p['limits']['max_total_bytes'] and
             sum(len(inventory) for inventory in inventories) <= self.p['limits']['max_files'], 'BACKUP_COMBINED_LIMIT')
        self.host.database_check()
        sql = self.destination / 'database.sql'
        self.host.dump(sql)
        validate_sql(sql, self.p['limits']['max_file_bytes'])
        outputs = {}
        total_bytes = sql.stat().st_size
        total_entries = 0
        for key, filename in [('cms_root', 'site.tar.gz'), ('state_root', 'private-state.tar.gz'), ('native_journal_dir', 'native-journal.tar.gz')]:
            self.owned()
            path = self.destination / filename
            ledger = archive_tree(self.p[key], path, self.p['limits'])
            raw_bytes = sum(row.get('size', 0) for row in ledger)
            total_bytes += raw_bytes
            total_entries += len(ledger)
            need(total_bytes <= self.p['limits']['max_total_bytes'] and total_entries <= self.p['limits']['max_files'], 'BACKUP_COMBINED_LIMIT')
            ledger_name = filename + '.ledger.json'
            root_info = Path(self.p[key]).stat()
            write_private(self.destination / ledger_name, canonical({'schema_version': 1, 'root': self.p[key],
                          'root_metadata': {'mode': stat.S_IMODE(root_info.st_mode), 'uid': root_info.st_uid, 'gid': root_info.st_gid}, 'entries': ledger}))
            outputs[key] = {'file': str(path), 'sha256': digest(path), 'ledger_file': str(self.destination / ledger_name),
                            'ledger_sha256': digest(self.destination / ledger_name), 'entries': len(ledger), 'raw_bytes': raw_bytes,
                            'archive_bytes': path.stat().st_size}
        for role in ('php', 'nginx'):
            verify_container(self.p, role, self.host.inspect(role), False)
        self.host.database_check()
        outputs['database'] = {'file': str(sql), 'sha256': digest(sql)}
        write_private(self.destination / 'snapshot-manifest.json', canonical({'schema_version': 1, 'project_id': self.p['project_id'],
                      'target_id': self.p['target_id'], 'plan_sha256': sha(canonical(self.plan)), 'outputs': outputs,
                      'scope': 'SQL_CMS_ALL_PRIVATE_STATE_ALL_NATIVE_JOURNAL', 'exclusions': [],
                      'active_snapshot': active,
                      'total_raw_bytes_including_sql': total_bytes, 'total_tree_entries': total_entries,
                      'restore_test': 'NOT_RUN', 'historical_recovery_direct': 'NOT_SUPPORTED_EXTERNAL_BACKUP_ROOT'}))
        return outputs

    def execute(self):
        self.claim()
        outputs = None
        failure = None
        try:
            self.host.guard()
            self.stop('nginx')
            self.stop('php')
            self.state['phase'] = 'QUIESCED'
            self.save()
            outputs = self.snapshots()
            self.state['phase'] = 'SNAPSHOT_VERIFIED'
            self.save()
        except Exception as error:
            failure = error
        finally:
            try:
                self.restore_runtime()
            except Exception:
                self.state['phase'] = 'RUNTIME_RECOVERY_REQUIRED'
                self.save()
                raise BackupError('RUNTIME_RECOVERY_REQUIRED') from None
        if failure:
            self.state['phase'] = 'BACKUP_FAILED_RUNTIME_RESTORED'
            self.save()
            raise BackupError(str(failure) if isinstance(failure, BackupError) else 'BACKUP_FAILED') from None
        self.owned()
        receipt = {'schema_version': '1.0', 'project_id': self.p['project_id'], 'target_id': self.p['target_id'],
                   'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': 'INTEGRITY_VERIFIED',
                   'database_file': outputs['database']['file'], 'database_sha256': outputs['database']['sha256'],
                   'files_file': outputs['cms_root']['file'], 'files_sha256': outputs['cms_root']['sha256'],
                   'restore_test': 'NOT_RUN', 'production_recovery': 'NOT_RUN',
                   'snapshot_manifest_file': str(self.destination / 'snapshot-manifest.json'),
                   'snapshot_manifest_sha256': digest(self.destination / 'snapshot-manifest.json'),
                   'plan_sha256': sha(canonical(self.plan)), 'runtime_restored': True}
        write_private(self.destination / 'backup-receipt.json', canonical(receipt))
        self.state['phase'] = 'COMPLETE'
        self.save()
        return receipt

    def resume(self, accepted):
        self.load(accepted)
        if self.state['phase'] == 'COMPLETE':
            raise BackupError('BACKUP_ALREADY_COMPLETE_NO_REEXECUTION')
        self.restore_runtime()
        self.state['phase'] = 'RECOVERED_RUNTIME_ONLY_BACKUP_NOT_ACCEPTED'
        self.save()
        return {'status': self.state['phase'], 'runtime_restored': True, 'backup_retry': 'NEW_DESTINATION_AND_PLAN_REQUIRED'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--profile-sha256', required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--accept-plan-sha256')
    parser.add_argument('--resume-runtime-only', action='store_true')
    args = parser.parse_args(argv)
    profile = validate_profile(args.profile, args.profile_sha256)
    host = Host(profile)
    if args.resume_runtime_only:
        need(args.execute and pin(args.accept_plan_sha256), 'RESUME_REQUIRES_EXECUTION_AND_PLAN')
        intent = load_json(path_checked(str(Path(profile['destination']) / 'intent.json'), private=True).read_bytes())
        plan = intent.get('plan')
        need(isinstance(plan, dict) and plan.get('profile') == profile and plan.get('profile_sha256') == args.profile_sha256 and
             plan.get('runner_sha256') == digest(Path(__file__).resolve()), 'RESUME_INPUT_CHANGED')
    else:
        path_checked(profile['destination'], absent=True)
        plan = make_plan(profile, args.profile_sha256, host)
    plan_sha = sha(canonical(plan))
    if not args.execute:
        need(not args.accept_plan_sha256, 'ACCEPT_ONLY_WITH_EXECUTE')
        print(json.dumps({'mode': 'PLAN_ONLY', 'plan_sha256': plan_sha, 'plan': plan}, ensure_ascii=False))
        return 0
    need(args.accept_plan_sha256 == plan_sha, 'PLAN_ACCEPTANCE_MISMATCH')
    need(os.name == 'posix' and os.geteuid() == 0, 'LINUX_ROOT_EXECUTION_REQUIRED')
    with source_locks(profile):
        executor = Executor(plan, host)
        result = executor.resume(plan_sha) if args.resume_runtime_only else executor.execute()
    print(json.dumps({'status': result['status'], 'plan_sha256': plan_sha, 'destination': profile['destination'],
                      'runtime_restored': result['runtime_restored'], 'restore_test': 'NOT_RUN'}))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (BackupError, OSError, sqlite3.Error, ValueError, tarfile.TarError):
        error = sys.exc_info()[1]
        code = str(error) if isinstance(error, BackupError) else 'BACKUP_INPUT_OR_IO_FAILURE'
        print(json.dumps({'status': 'FAILED', 'reason': code, 'restore_test': 'NOT_RUN'}), file=sys.stderr)
        sys.exit(1)
