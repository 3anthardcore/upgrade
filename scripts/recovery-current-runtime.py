#!/usr/bin/env python3
"""Restore a pinned CURRENT private backup into a new isolated copy. Plan only by default.

Never stops/changes the source, adopts a failed destination, activates its native journal,
replays an importer or submits HTTP forms. Execute requires the exact reviewed plan SHA.
"""
import argparse
import base64
import hashlib
import http.client
import importlib.util
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import sys
import tarfile
import time

sys.dont_write_bytecode = True
HELPER_SHA = 'b1c95c5150d668417b268b708c7f49e81c7fe4d346b6c346d5dc386dc7a2ade6'
BACKUP_SHA = '38f46b290f1cd2c64585e613c2fae35d8e150e99c859322e51517f6941915389'


def load_helper(filename, expected):
    path = Path(__file__).resolve().parent / filename
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError('PINNED_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location(filename.replace('.', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


h = load_helper('recovery-target.py', HELPER_SHA)
b = load_helper('current-runtime-backup.py', BACKUP_SHA)
RecoveryError, need, canonical, digest, pin = h.RecoveryError, h.need, h.canonical, h.digest, h.pin
sha = h.digest_bytes
TREE_FILES = {'cms_root': ('site.tar.gz', 'cms-root'),
              'state_root': ('private-state.tar.gz', 'state'),
              'native_journal_dir': ('native-journal.tar.gz', 'source-journal-audit')}


def checked(path, directory=False, private=False, absent=False):
    try:
        return b.path_checked(str(path), directory=directory, private=private, absent=absent)
    except b.BackupError as error:
        raise RecoveryError(str(error)) from None


def json_file(path, expected=None, private=True, limit=256 * 1024 * 1024):
    file = checked(path, private=private)
    need(file.stat().st_size <= limit, 'JSON_LIMIT')
    raw = file.read_bytes()
    need(expected is None or pin(expected) and sha(raw) == expected, 'JSON_PIN_MISMATCH')
    try:
        return b.load_json(raw, limit)
    except b.BackupError as error:
        raise RecoveryError(str(error)) from None


def safe_relative(value):
    need(isinstance(value, str) and 0 < len(value.encode()) <= 4096 and
         not re.search(r'[\x00-\x1f\x7f\\:]', value), 'ARCHIVE_PATH_INVALID')
    path = PurePosixPath(value)
    need(not path.is_absolute() and '..' not in path.parts and str(path) == value and value != '.', 'ARCHIVE_PATH_INVALID')
    return value


def metadata(value):
    need(isinstance(value, dict) and all(type(value.get(key)) is int for key in ('mode', 'uid', 'gid')) and
         0 <= value['mode'] <= 0o777 and 0 <= value['uid'] <= 2147483647 and 0 <= value['gid'] <= 2147483647,
         'ARCHIVE_METADATA_INVALID')


def limits_valid(limits):
    need(isinstance(limits, dict), 'BACKUP_LIMITS_REQUIRED')
    for key, maximum in [('max_files', 500000), ('max_total_bytes', 64 * 1024**3), ('max_file_bytes', 16 * 1024**3)]:
        need(type(limits.get(key)) is int and 1 <= limits[key] <= maximum, 'BACKUP_LIMIT_INVALID')


def ledger_valid(ledger, source_root, limits):
    need(ledger.get('schema_version') == 1 and ledger.get('root') == source_root and
         isinstance(ledger.get('entries'), list), 'LEDGER_BINDING')
    metadata(ledger.get('root_metadata'))
    need(len(ledger['entries']) <= limits['max_files'], 'ARCHIVE_ENTRY_LIMIT')
    seen = {}
    total = 0
    for row in ledger['entries']:
        need(isinstance(row, dict), 'LEDGER_ROW_INVALID')
        name = safe_relative(row.get('path'))
        need(name not in seen, 'ARCHIVE_DUPLICATE')
        metadata(row)
        need(row.get('type') in ('directory', 'file'), 'ARCHIVE_LINK_OR_SPECIAL')
        fields = {'path', 'mode', 'uid', 'gid', 'type'} | ({'size', 'sha256'} if row['type'] == 'file' else set())
        need(set(row) == fields, 'LEDGER_FIELDS_INVALID')
        if row['type'] == 'file':
            need(type(row['size']) is int and 0 <= row['size'] <= limits['max_file_bytes'] and pin(row['sha256']), 'ARCHIVE_FILE_LIMIT_OR_HASH')
            total += row['size']
        seen[name] = row
    for name in seen:
        for parent in PurePosixPath(name).parents:
            if str(parent) != '.':
                need(str(parent) in seen and seen[str(parent)]['type'] == 'directory', 'ARCHIVE_PARENT_NOT_DIRECTORY')
    need(total <= limits['max_total_bytes'], 'ARCHIVE_TOTAL_LIMIT')
    return seen, total


def archive_check(archive_path, expected_sha, ledger, source_root, limits, destination=None, readback_path=None):
    """Stream every byte, compare the exact ledger, optionally extract only to a new owned root."""
    path = checked(archive_path, private=True)
    need(pin(expected_sha) and digest(path) == expected_sha, 'ARCHIVE_PIN_MISMATCH')
    rows, total = ledger_valid(ledger, source_root, limits)
    root = Path(destination) if destination is not None else None
    if root is not None:
        need(not root.exists() and not root.is_symlink(), 'NEW_EXTRACTION_ROOT_REQUIRED')
        root.mkdir(mode=0o700)
    found = set()
    readbacks = []
    with tarfile.open(path, 'r|gz') as archive:
        for item in archive:
            name = safe_relative(item.name)
            need(name not in found and name in rows, 'ARCHIVE_EXTRA_OR_DUPLICATE')
            need((item.isdir() or item.isreg()) and not getattr(item, 'sparse', None), 'ARCHIVE_LINK_OR_SPECIAL')
            row = rows[name]
            header = {'path': name, 'type': 'directory' if item.isdir() else 'file', 'mode': item.mode, 'uid': item.uid, 'gid': item.gid}
            need(all(row[key] == value for key, value in header.items()) and
                 (item.size == row['size'] if item.isreg() else item.size == 0), 'ARCHIVE_LEDGER_MISMATCH')
            target = root / name if root is not None else None
            if target is not None:
                # Parents are explicitly present in the ledger, never implicit omissions.
                for parent in reversed(PurePosixPath(name).parents):
                    if str(parent) != '.':
                        (root / str(parent)).mkdir(mode=0o700, exist_ok=True)
                need(target.resolve().is_relative_to(root.resolve()) and not target.is_symlink(), 'EXTRACTION_PATH_CHANGED')
            if item.isdir():
                if target is not None:
                    target.mkdir(mode=0o700, exist_ok=True)
            else:
                source = archive.extractfile(item)
                hasher = hashlib.sha256()
                size = 0
                out = None
                try:
                    if target is not None:
                        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
                        out = os.fdopen(fd, 'wb')
                    for part in iter(lambda: source.read(1024 * 1024), b''):
                        size += len(part)
                        need(size <= row['size'], 'ARCHIVE_FILE_SIZE_MISMATCH')
                        hasher.update(part)
                        if out is not None:
                            out.write(part)
                    if out is not None:
                        out.flush()
                        os.fsync(out.fileno())
                finally:
                    if out is not None:
                        out.close()
                    source.close()
                need(size == row['size'] and hasher.hexdigest() == row['sha256'], 'ARCHIVE_FILE_HASH_MISMATCH')
                if target is not None:
                    need(digest(checked(target)) == row['sha256'], 'EXTRACTED_FILE_READBACK_MISMATCH')
                readbacks.append({'path': name, 'size': size, 'sha256': row['sha256']})
            found.add(name)
    need(found == set(rows), 'ARCHIVE_MISSING_ENTRIES')
    need(digest(path) == expected_sha, 'ARCHIVE_CHANGED_DURING_READ')
    if root is not None:
        # Apply directory modes last so restrictive source modes cannot interfere with extraction.
        for name in sorted(rows, key=lambda name: (-len(PurePosixPath(name).parts), name)):
            target, row = root / name, rows[name]
            if os.name == 'posix':
                os.chown(target, row['uid'], row['gid'])
            os.chmod(target, row['mode'])
            if row['type'] == 'directory':
                b.fsync_dir(target)
        info = ledger['root_metadata']
        if os.name == 'posix':
            os.chown(root, info['uid'], info['gid'])
        os.chmod(root, info['mode'])
        verify_tree(root, ledger, limits)
        b.fsync_dir(root)
    result = {'entries': len(rows), 'expanded_bytes': total, 'archive_sha256': expected_sha, 'ledger_sha256': sha(canonical(ledger))}
    if readback_path is not None:
        b.write_private(readback_path, b''.join(canonical(row) + b'\n' for row in readbacks))
        result['file_readback_ledger_sha256'] = digest(readback_path)
    return result


def verify_tree(root, ledger, limits):
    rows, _ = ledger_valid(ledger, ledger['root'], limits)
    try:
        observed = b.tree(root, limits)  # accepted helper fails on every scandir error
    except b.BackupError as error:
        raise RecoveryError(str(error)) from None
    need(set(observed) == set(rows), 'EXTRACTED_TREE_MEMBERSHIP')
    for name, row in rows.items():
        path = Path(root) / name
        info = path.lstat()
        need((stat.S_ISDIR(info.st_mode) if row['type'] == 'directory' else stat.S_ISREG(info.st_mode) and info.st_nlink == 1), 'EXTRACTED_TREE_TYPE')
        if os.name == 'posix':
            need(stat.S_IMODE(info.st_mode) == row['mode'] and info.st_uid == row['uid'] and info.st_gid == row['gid'], 'EXTRACTED_TREE_METADATA')
        if row['type'] == 'file':
            need(info.st_size == row['size'] and digest(path) == row['sha256'], 'EXTRACTED_TREE_BYTES')
    info = Path(root).stat()
    if os.name == 'posix':
        need({key: value for key, value in [('mode', stat.S_IMODE(info.st_mode)), ('uid', info.st_uid), ('gid', info.st_gid)]} == ledger['root_metadata'], 'EXTRACTED_ROOT_METADATA')


def backup_bundle(args):
    receipt_path = checked(args.receipt, private=True)
    directory = checked(receipt_path.parent, directory=True, private=True)
    need(receipt_path.name == 'backup-receipt.json', 'BACKUP_RECEIPT_NAME')
    receipt = json_file(receipt_path, args.receipt_sha256, limit=1024 * 1024)
    need(receipt.get('schema_version') == '1.0' and receipt.get('project_id') == args.project and
         receipt.get('target_id') == args.target_id and receipt.get('status') == 'INTEGRITY_VERIFIED' and
         receipt.get('runtime_restored') is True, 'BACKUP_BINDING')
    need(receipt.get('snapshot_manifest_file') == str(directory / 'snapshot-manifest.json') and
         receipt.get('snapshot_manifest_sha256') == args.snapshot_manifest_sha256, 'MANIFEST_BINDING')
    manifest = json_file(directory / 'snapshot-manifest.json', args.snapshot_manifest_sha256)
    intent = json_file(directory / 'intent.json', limit=4 * 1024 * 1024)
    original = intent.get('plan')
    need(isinstance(original, dict) and sha(canonical(original)) == receipt.get('plan_sha256') == intent.get('plan_sha256') == manifest.get('plan_sha256') and
         original.get('kind') == 'CURRENT_RUNTIME_BACKUP' and original.get('runner_sha256') == BACKUP_SHA, 'BACKUP_PLAN_BINDING')
    profile = original.get('profile')
    need(isinstance(profile, dict) and profile.get('project_id') == args.project and profile.get('target_id') == args.target_id and
         profile.get('destination') == str(directory), 'BACKUP_PROFILE_BINDING')
    need(profile.get('cms_root') == str(Path(args.source_root) / 'cms-root') and
         profile.get('state_root') == str(Path(args.source_root) / 'state') and
         Path(profile.get('native_journal_dir', '')).name == args.target_id, 'BACKUP_SOURCE_ROOT_BINDING')
    state = json_file(directory / 'runtime-state.json', limit=1024 * 1024)
    need(state.get('phase') == 'COMPLETE' and state.get('runtime_restored') is True and
         state.get('intent_sha256') == sha(canonical(intent)), 'BACKUP_NOT_COMPLETED')
    need(manifest.get('schema_version') == 1 and manifest.get('project_id') == args.project and manifest.get('target_id') == args.target_id and
         manifest.get('scope') == 'SQL_CMS_ALL_PRIVATE_STATE_ALL_NATIVE_JOURNAL' and manifest.get('exclusions') == [], 'MANIFEST_SCOPE_BINDING')
    outputs = manifest.get('outputs')
    need(isinstance(outputs, dict) and set(outputs) == {*TREE_FILES, 'database'}, 'MANIFEST_OUTPUTS_INVALID')
    limits = profile.get('limits')
    limits_valid(limits)
    need(set(profile.get('containers', {})) == {'db', 'php', 'nginx'} and
         all(profile['containers'][role].get('running') is True for role in ('db', 'php', 'nginx')),
         'CURRENT_RESTORE_REQUIRES_RUNNING_SOURCE_BASELINE')
    need(outputs['database'] == {'file': str(directory / 'database.sql'), 'sha256': receipt.get('database_sha256')} and
         receipt.get('database_file') == str(directory / 'database.sql'), 'SQL_BINDING')
    sql = checked(directory / 'database.sql', private=True)
    need(pin(receipt.get('database_sha256')) and digest(sql) == receipt['database_sha256'], 'SQL_PIN_MISMATCH')
    b.validate_sql(sql, limits['max_file_bytes'])
    total = sql.stat().st_size
    entries = 0
    inventories = {}
    for key, (filename, _) in TREE_FILES.items():
        entry = outputs[key]
        need(isinstance(entry, dict) and entry.get('file') == str(directory / filename) and
             entry.get('ledger_file') == str(directory / (filename + '.ledger.json')) and
             pin(entry.get('ledger_sha256')), 'BACKUP_OUTPUT_PATH_OR_LEDGER_PIN')
        ledger = json_file(entry['ledger_file'], entry.get('ledger_sha256'))
        inventory = archive_check(entry['file'], entry.get('sha256'), ledger, profile[key], limits)
        need(entry.get('entries') == inventory['entries'] and entry.get('raw_bytes') == inventory['expanded_bytes'] and
             entry.get('archive_bytes') == Path(entry['file']).stat().st_size, 'MANIFEST_INVENTORY_MISMATCH')
        entries += inventory['entries']
        total += inventory['expanded_bytes']
        inventories[key] = inventory
    need(receipt.get('files_file') == outputs['cms_root']['file'] and receipt.get('files_sha256') == outputs['cms_root']['sha256'], 'CMS_RECEIPT_BINDING')
    need(total == manifest.get('total_raw_bytes_including_sql') and entries == manifest.get('total_tree_entries') and
         total <= limits['max_total_bytes'] and entries <= limits['max_files'], 'MANIFEST_TOTAL_MISMATCH')
    return {'receipt': receipt, 'manifest': manifest, 'profile': profile, 'inventories': inventories,
            'backup_intent_sha256': digest(directory / 'intent.json'), 'backup_state_sha256': digest(directory / 'runtime-state.json')}


def project_compose(source, args, baseline):
    # The temporary distinct target is only needed for the historical projection's admission.
    # Application identity is intentionally retained; infrastructure and data volume are new.
    projection = h.compose_plan(source, args.source_root, args.destination, args.project, args.clone_project,
                               'restore-' + args.clone_project, args.subnet, args.bridge, baseline['source_database'])
    need(source['services']['php']['environment'].get('UPGRADE_TARGET_ID') == args.target_id, 'SOURCE_TARGET_BINDING')
    projection['compose']['services']['php']['environment']['UPGRADE_TARGET_ID'] = args.target_id
    return projection


def disjoint(destination, paths):
    for path in paths:
        value = Path(path)
        need(value.is_absolute() and value.resolve() == value and not destination.is_relative_to(value) and
             not value.is_relative_to(destination), 'DESTINATION_SOURCE_OVERLAP')


def make_plan(args):
    need(re.fullmatch('[a-z0-9][a-z0-9-]{0,40}', args.project) is not None and
         re.fullmatch('[a-z0-9][a-z0-9-]{0,80}', args.target_id) is not None, 'PROJECT_TARGET_INVALID')
    root = checked(args.source_root, directory=True)
    need(root == Path('/opt/upgrade/targets') / args.project, 'SOURCE_ROOT_INVALID')
    destination = Path(args.destination)
    need(destination.parent == Path('/opt/upgrade/recovery'), 'RECOVERY_ROOT_INVALID')
    checked(destination, absent=True)
    bundle = backup_bundle(args)
    profile, manifest = bundle['profile'], bundle['manifest']
    disjoint(destination, [root, profile['cms_root'], profile['state_root'], profile['native_journal_dir'], Path(args.receipt).parent])
    source = json_file(args.source_compose, args.source_compose_sha256, private=False, limit=4 * 1024 * 1024)
    need(checked(args.source_compose).is_relative_to(root / 'config'), 'SOURCE_COMPOSE_PATH_INVALID')
    baseline = json_file(args.baseline, args.baseline_sha256, limit=4 * 1024 * 1024)
    h.validate_baseline(baseline, args.project, args.target_id)
    expected_db = {'container_id': profile['containers']['db']['id'], 'image_id': profile['containers']['db']['image_id'],
                   'network_id': profile['network']['id'], 'network_name': profile['network']['name'], 'ip_address': profile['containers']['db']['ip']}
    need(baseline['source_database'] == expected_db, 'BACKUP_BASELINE_DATABASE_IDENTITY')
    projection = project_compose(source, args, baseline)
    need(profile['network']['name'] == projection['source_network'] and profile['network']['subnet'] != args.subnet and
         profile['network']['bridge'] != args.bridge, 'SOURCE_NETWORK_CLONE_CONFLICT')
    for key in ('docker', 'guard'):
        need(pin(profile[key]['sha256']) and digest(checked(profile[key]['path'])) == profile[key]['sha256'], 'PINNED_TOOL_CHANGED')
    need(args.guard == profile['guard']['path'] and args.guard_sha256 == profile['guard']['sha256'], 'BACKUP_GUARD_CHANGED')
    config_pins = {}
    for name, path in projection['copies'].items():
        file = checked(path, private=name.startswith('db_'))
        need(file.stat().st_size <= 1024 * 1024, 'CONFIG_SIZE_LIMIT')
        config_pins[name] = digest(file)
    auth = checked(args.auth_password_file, private=True)
    need(1 <= auth.stat().st_size <= 1024 and re.fullmatch('[A-Za-z0-9_-]{1,64}', args.auth_user), 'AUTH_INPUT_INVALID')
    current = baseline.get('current_state')
    need(isinstance(current, dict) and current.get('active_snapshot') == manifest.get('active_snapshot'), 'CURRENT_SNAPSHOT_BASELINE_REQUIRED')
    retained = current.get('retained_receipt')
    if retained is not None:
        need(isinstance(retained, dict) and set(retained) == {'cookie_file', 'cookie_sha256', 'operation_id', 'response_sha256', 'http_body_sha256'} and
             all(pin(retained.get(key)) for key in ('cookie_sha256', 'operation_id', 'response_sha256', 'http_body_sha256')), 'RETAINED_RECEIPT_BASELINE_INVALID')
        cookie_file = checked(retained['cookie_file'], private=True)
        need(cookie_file.stat().st_size <= 128 and digest(cookie_file) == retained['cookie_sha256'], 'RETAINED_COOKIE_PIN')
        need(re.fullmatch('[a-f0-9]{64}', cookie_file.read_text().strip()), 'RETAINED_COOKIE_FORMAT')
        disjoint(destination, [cookie_file])
    plan = {'schema_version': 1, 'mode': 'NEW_ISOLATED_CURRENT_RUNTIME_COPY', 'source_project': args.project, 'source_target': args.target_id,
            'source_root': str(root), 'destination': str(destination), 'clone_project': args.clone_project, 'clone_target': args.target_id,
            'application_identity_policy': 'RETAIN_SOURCE_PROJECT_TARGET_FOR_PRIVATE_STATE_ONLY', 'native_journal_policy': 'AUDIT_ONLY_NOT_MOUNTED_OR_ACTIVATED',
            'subnet': args.subnet, 'bridge': args.bridge, 'receipt_sha256': args.receipt_sha256, 'snapshot_manifest_sha256': args.snapshot_manifest_sha256,
            'source_compose_sha256': args.source_compose_sha256, 'baseline_sha256': args.baseline_sha256, 'guard_sha256': args.guard_sha256,
            'executor_sha256': digest(Path(__file__).resolve()), 'historical_helper_sha256': HELPER_SHA, 'backup_helper_sha256': BACKUP_SHA,
            'database_sha256': bundle['receipt']['database_sha256'], 'files_sha256': bundle['receipt']['files_sha256'],
            'backup_plan_sha256': bundle['receipt']['plan_sha256'], 'backup_intent_sha256': bundle['backup_intent_sha256'], 'backup_state_sha256': bundle['backup_state_sha256'],
            'backup_profile': profile, 'backup_manifest': manifest, 'inventories': bundle['inventories'], 'config_pins': config_pins,
            'auth_password_file': str(auth), 'auth_password_sha256': digest(auth), 'auth_user': args.auth_user,
            'projection': projection, 'baseline': baseline, 'configuration_derivation': h.settings_derivation_policy(projection),
            'source_actions': 'READ_ONLY_NO_STOP_NO_SQL', 'http_actions': 'GET_ONLY_NO_REPLAY', 'production_recovery': 'NOT_RUN', 'automatic_cleanup': False}
    return plan, bundle['receipt']


def php_json(value):
    # PHP JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES still escapes line separators.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029').encode()


def verify_current(root, plan):
    profile = dict(plan['backup_profile'], state_root=str(Path(root) / 'state'))
    try:
        active = b.verify_active(profile)
    except b.BackupError as error:
        raise RecoveryError(str(error)) from None
    need(active == plan['backup_manifest']['active_snapshot'], 'RESTORED_ACTIVE_SNAPSHOT_MISMATCH')
    binding = json_file(Path(root) / 'source-journal-audit' / 'binding.json', private=False, limit=1024 * 1024)
    need(binding.get('project_id') == plan['source_project'] and binding.get('target_id') == plan['source_target'] and
         binding.get('document_root') == '/var/www/html' and binding.get('state_dir') == '/var/lib/upgrade', 'RESTORED_JOURNAL_BINDING')
    return active


def retained_receipt(root, plan):
    expected = plan['baseline']['current_state'].get('retained_receipt')
    if expected is None:
        return None
    file = checked(expected['cookie_file'], private=True)
    need(digest(file) == expected['cookie_sha256'], 'RETAINED_COOKIE_PIN')
    session = file.read_text().strip()
    need(re.fullmatch('[a-f0-9]{64}', session), 'RETAINED_COOKIE_FORMAT')
    session_hash = sha((plan['source_project'] + '\0' + session).encode())
    state_path = Path(root) / 'state' / 'demo-private' / ('demo-' + plan['source_project']) / (session_hash + '.json')
    envelope = json_file(state_path, private=False, limit=8 * 1024 * 1024)
    body = envelope.get('body')
    need(envelope.get('schema_version') == 1 and isinstance(body, dict) and sha(php_json(body)) == envelope.get('sha256'), 'RETAINED_SESSION_CHECKSUM')
    need(body.get('project_id') == plan['source_project'] and body.get('session_hash') == session_hash, 'RETAINED_SESSION_BINDING')
    operation = body.get('operations', {}).get(expected['operation_id'])
    need(isinstance(operation, dict) and pin(operation.get('request_sha256')), 'RETAINED_OPERATION_MISSING')
    response = operation.get('response')
    need(isinstance(response, dict) and response.get('operation_id') == expected['operation_id'] and
         response.get('status') == 'RECORDED_LOCALLY_SYNTHETIC' and response.get('replayed') is False and
         sha(php_json(response)) == expected['response_sha256'], 'RETAINED_RESPONSE_BINDING')
    record = response.get('record')
    need(isinstance(record, dict) and record.get('status') == 'RECORDED_LOCALLY_SYNTHETIC' and
         record.get('native_order_created') is False and record.get('message_sent') is False and record.get('payment_attempted') is False,
         'RETAINED_SYNTHETIC_BOUNDARY')
    return {'session': session, 'path': str(state_path), 'file_sha256': digest(state_path), 'operation_id': expected['operation_id'],
            'response_sha256': expected['response_sha256'], 'http_body_sha256': expected['http_body_sha256']}


def discarded_vendor_cookie(headers):
    """Inspect ALL raw headers; one narrow vendor cookie may be ignored, never adopted.

    The own cookie is the pinned request input. No response cookie participates in
    subsequent requests or gets written to a cookie jar, log, plan or receipt.
    """
    values = [value for name, value in headers if name.lower() == 'set-cookie']
    need(len(values) <= 1, 'RETAINED_RECEIPT_HTTP_BOUNDARY')
    if not values:
        return False
    value = values[0]
    need(isinstance(value, str) and 1 <= len(value) <= 256 and
         all(0x20 <= ord(character) <= 0x7e for character in value), 'RETAINED_RECEIPT_HTTP_BOUNDARY')
    parts = [part.strip() for part in value.split(';')]
    # RFC cookie-octets exclude controls, whitespace, quotes, comma, semicolon and
    # backslash. In particular, do not mistake a combined header for one cookie.
    need(len(parts) == 4 and re.fullmatch(r'PHPSESSID=[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,128}', parts[0]),
         'RETAINED_RECEIPT_HTTP_BOUNDARY')
    attributes = {}
    for part in parts[1:]:
        pair = part.split('=', 1)
        name = pair[0].lower()
        need(name not in attributes, 'RETAINED_RECEIPT_HTTP_BOUNDARY')
        attributes[name] = pair[1] if len(pair) == 2 else None
    need(set(attributes) == {'path', 'httponly', 'samesite'} and attributes['path'] == '/' and
         attributes['httponly'] is None and isinstance(attributes['samesite'], str) and
         attributes['samesite'].lower() == 'lax', 'RETAINED_RECEIPT_HTTP_BOUNDARY')
    return True


class Executor(h.Executor):
    def write_result(self, result):
        self.assert_ownership()
        b.write_private(self.root / 'result.json', canonical(result))

    def run(self, label, command, **kwargs):
        if command[0] == 'docker':
            tool = self.plan['backup_profile']['docker']
            need(digest(checked(tool['path'])) == tool['sha256'], 'DOCKER_EXECUTABLE_CHANGED')
            command = [tool['path'], *command[1:]]
        return super().run(label, command, **kwargs)

    def source_inspect(self):
        before = super().source_inspect()
        profile = self.plan['backup_profile']
        full = json.loads(self.run('SOURCE_FULL_IDENTITY', ['docker', 'inspect', *[profile['containers'][key]['id'] for key in ('db', 'php', 'nginx')]]).stdout)
        need(len(full) == 3, 'SOURCE_FULL_IDENTITY_MISSING')
        for role in ('db', 'php', 'nginx'):
            item = next((item for item in full if item.get('Id') == profile['containers'][role]['id']), None)
            need(item is not None, 'SOURCE_CONTAINER_CHANGED')
            b.verify_container(profile, role, item, profile['containers'][role]['running'])
        network = json.loads(self.run('SOURCE_NETWORK_IDENTITY', ['docker', 'network', 'inspect', profile['network']['id']]).stdout)
        need(len(network) == 1, 'SOURCE_NETWORK_IDENTITY_MISSING')
        b.verify_network(profile, network[0])
        return before

    def copy_file(self, source, destination, expected):
        source = checked(source, private=True)
        need(digest(source) == expected, 'INPUT_CHANGED')
        size = source.stat().st_size
        self.assert_ownership()
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with source.open('rb') as inp, os.fdopen(fd, 'wb') as out:
            copied = 0
            for part in iter(lambda: inp.read(1024 * 1024), b''):
                copied += len(part)
                need(copied <= size, 'COPY_SIZE_CHANGED')
                out.write(part)
            need(copied == size, 'COPY_SIZE_CHANGED')
            out.flush()
            os.fsync(out.fileno())
        need(digest(destination) == expected and digest(source) == expected, 'COPY_PIN_MISMATCH')
        b.fsync_dir(Path(destination).parent)

    def prepare_files(self, source_before, source_attestation):
        for name in ('private', 'inputs', 'config'):
            (self.root / name).mkdir(mode=0o700)
        b.write_private(self.root / 'source-runtime-before.json', canonical(source_before))
        outputs = self.plan['backup_manifest']['outputs']
        self.copy_file(outputs['database']['file'], self.root / 'inputs' / 'database.sql', outputs['database']['sha256'])
        for key, (filename, _) in TREE_FILES.items():
            entry = outputs[key]
            self.copy_file(entry['file'], self.root / 'inputs' / filename, entry['sha256'])
            self.copy_file(entry['ledger_file'], self.root / 'inputs' / (filename + '.ledger.json'), entry['ledger_sha256'])
        guard = self.root / 'config' / 'isolate-network.sh'
        b.write_private(guard, checked(self.args.guard).read_bytes())
        need(digest(guard) == self.plan['guard_sha256'], 'COPIED_GUARD_PIN')
        projection = self.plan['projection']
        for name, path in projection['copies'].items():
            raw = checked(path, private=name.startswith('db_')).read_bytes()
            need(sha(raw) == self.plan['config_pins'][name], 'CONFIG_CHANGED')
            if name == 'nginx.conf':
                raw = h.projected_nginx(raw, projection['source_gateway'], projection['gateway'])
            dest = self.root / ('private' if name.startswith('db_') else 'config') / name
            b.write_private(dest, raw)
            os.chmod(dest, 0o444 if name.startswith('db_') else 0o644)
        password = (self.root / 'private' / 'db_root_password').read_text().rstrip('\r\n')
        b.write_private(self.root / 'private' / 'recovery_mysql', h.mysql_defaults(password))
        password = None
        b.write_private(self.root / 'config' / 'recovery-probe.php', h.PROBE.encode())
        os.chmod(self.root / 'config' / 'recovery-probe.php', 0o644)
        b.write_private(self.compose_file, canonical(projection['compose']))
        self.stage = 'CURRENT_FILES_RESTORE'
        readbacks = {}
        for key, (filename, dirname) in TREE_FILES.items():
            entry = outputs[key]
            ledger = json_file(self.root / 'inputs' / (filename + '.ledger.json'), entry['ledger_sha256'])
            readbacks[key] = archive_check(self.root / 'inputs' / filename, entry['sha256'], ledger, self.plan['backup_profile'][key],
                                          self.plan['backup_profile']['limits'], self.root / dirname,
                                          self.root / ('files-readback.jsonl' if key == 'cms_root' else dirname + '-readback.jsonl'))
            self.record('CURRENT_TREE_READBACK', status='PASS', tree=key, **readbacks[key])
        need((self.root / 'cms-root/bitrix/modules/main/include/prolog_before.php').is_file() and
             (self.root / 'cms-root/local/upgrade-route.php').is_file(), 'RESTORED_CMS_AND_OWN_ROUTER_REQUIRED')
        active = verify_current(self.root, self.plan)
        receipt = retained_receipt(self.root, self.plan)
        self.record('PRIVATE_STATE_READBACK', status='PASS', active_snapshot=active, retained_receipt='VERIFIED_BYTES' if receipt else 'NOT_RUN')
        derivation = self.derive_clone_settings(source_attestation, readbacks['cms_root'])
        return readbacks, active, receipt, derivation

    def http_receipt(self, auth, receipt):
        connection = http.client.HTTPConnection(self.plan['projection']['nginx_ip'], 8080, timeout=45)
        target = '/__upgrade/receipt?operation=' + receipt['operation_id']
        try:
            connection.request('GET', target, headers={'Host': self.plan['baseline']['trusted_host'], 'X-Forwarded-Proto': 'https',
                                                       'Authorization': auth, 'Cookie': 'upgrade_demo_session=' + receipt['session']})
            response = connection.getresponse()
            body = response.read(4 * 1024 * 1024 + 1)
            raw_headers = response.getheaders()
            ignored_vendor_cookie = discarded_vendor_cookie(raw_headers)
            headers = {key.lower(): value for key, value in raw_headers}
            need(response.status == 200 and len(body) <= 4 * 1024 * 1024 and 'noindex' in headers.get('x-robots-tag', '') and
                 'no-store' in headers.get('cache-control', ''), 'RETAINED_RECEIPT_HTTP_BOUNDARY')
            need(sha(body) == receipt['http_body_sha256'], 'RETAINED_RECEIPT_HTTP_BYTES')
            need(digest(checked(receipt['path'])) == receipt['file_sha256'], 'RETAINED_RECEIPT_MUTATED_SESSION')
            self.record('RETAINED_RECEIPT_HTTP', status='PASS', operation_id=receipt['operation_id'], response_sha256=receipt['response_sha256'],
                        http_body_sha256=sha(body), bytes=len(body), method='GET', session_unchanged=True,
                        ignored_vendor_cookie_names=['PHPSESSID'] if ignored_vendor_cookie else [])
        finally:
            connection.close()

    def execute(self):
        need(sys.platform.startswith('linux') and os.geteuid() == 0, 'LINUX_ROOT_EXECUTION_REQUIRED')
        accepted = sha(canonical(self.plan))
        need(self.args.accept_plan_sha256 == accepted, 'ACCEPTED_PLAN_PIN_MISMATCH')
        checked(self.root, absent=True)
        # Revalidate all pinned backup bytes and metadata immediately before dispatch.
        bundle = backup_bundle(self.args)
        need(bundle['manifest'] == self.plan['backup_manifest'] and bundle['profile'] == self.plan['backup_profile'] and
             bundle['backup_intent_sha256'] == self.plan['backup_intent_sha256'] and bundle['backup_state_sha256'] == self.plan['backup_state_sha256'], 'BACKUP_INPUT_CHANGED')
        outputs = bundle['manifest']['outputs']
        sql_size = Path(outputs['database']['file']).stat().st_size
        archive_bytes = sum(Path(outputs[key]['file']).stat().st_size for key in TREE_FILES)
        required = bundle['manifest']['total_raw_bytes_including_sql'] + archive_bytes + sql_size * 3 + 2 * 1024**3
        need(shutil.disk_usage(self.root.parent).free >= required, 'HOST_DISK_RESERVE_REQUIRED')
        docker_root = json.loads(self.run('DOCKER_STORAGE_LOCATION', ['docker', 'info', '--format', '{{json .DockerRootDir}}']).stdout)
        checked(docker_root, directory=True)
        need(shutil.disk_usage(docker_root).free >= sql_size * 3 + 2 * 1024**3, 'DOCKER_DISK_RESERVE_REQUIRED')
        projection = self.plan['projection']
        need(self.run('NEW_VOLUME_CHECK', ['docker', 'volume', 'inspect', self.args.clone_project + '-database'], allow_fail=True).returncode != 0, 'CLONE_VOLUME_EXISTS')
        need(self.run('NEW_NETWORK_CHECK', ['docker', 'network', 'inspect', projection['network']], allow_fail=True).returncode != 0, 'CLONE_NETWORK_EXISTS')
        need(not self.run('NEW_PROJECT_CHECK', ['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + self.args.clone_project]).stdout.strip(), 'CLONE_PROJECT_EXISTS')
        source_before = self.source_inspect()
        source_db = next(row for row in source_before if row['service'] == 'db')
        image = json.loads(self.run('SOURCE_DB_IMAGE', ['docker', 'image', 'inspect', projection['compose']['services']['db']['image']]).stdout)
        need(len(image) == 1, 'SOURCE_DB_IMAGE_MISSING')
        attestation = h.attest_source_db(source_db, projection, image[0]['Id'])
        self.claim_destination(accepted)
        b.fsync_dir(self.root)
        b.fsync_dir(self.root.parent)
        self.record('INTENT_SAVED', status='RUNNING', plan_sha256=accepted)
        readbacks, active, receipt, derivation = self.prepare_files(source_before, attestation)
        guard = str(self.root / 'config' / 'isolate-network.sh')
        guard_args = [self.args.clone_project, projection['network'], self.args.bridge, self.args.subnet, '/opt/upgrade/private/network-guards']
        self.stage = 'NETWORK_GUARD'
        self.run('GUARD_APPLY', ['bash', guard, 'apply', *guard_args], timeout=120)
        self.run('GUARD_CHECK_BEFORE_DB', ['bash', guard, 'check', *guard_args], timeout=120)
        self.compose('COMPOSE_VALIDATE', ['config', '--quiet'])
        self.stage = 'DATABASE_RESTORE'
        self.compose('DB_START', ['up', '-d', '--no-deps', '--pull', 'never', 'db'], timeout=180)
        self.attest(['db'])
        ready = False
        for _ in range(60):
            if self.compose('DB_READY', ['exec', '-T', '--user', '0:0', 'db', 'mysqladmin', '--defaults-extra-file=/run/secrets/recovery_mysql', 'ping', '--silent'], timeout=10, allow_fail=True).returncode == 0:
                ready = True
                break
            time.sleep(2)
        need(ready, 'DATABASE_START_TIMEOUT')
        with (self.root / 'inputs' / 'database.sql').open('rb') as stream:
            self.sql(file=stream, label='SQL_IMPORT', timeout=1800)
        counts = self.counts()
        self.record('DATABASE_READBACK', status='PASS', counts=counts)
        self.stage = 'PRE_CMS_ISOLATION'
        with socket.create_connection((attestation['source_db_ip'], 3306), timeout=5):
            pass
        self.run('GUARD_CHECK_BEFORE_PHP', ['bash', guard, 'check', *guard_args], timeout=120)
        probe = json.loads(self.compose('PRE_CMS_RUNTIME_PROBE', ['run', '--rm', '--no-deps', '-T', '--user', '33:33', '--entrypoint', 'php', 'php', '/opt/upgrade/recovery-probe.php', attestation['source_db_ip']], timeout=45).stdout)
        need(probe.get('prepend_active') is True and probe.get('prepend_file') == '/opt/upgrade/prepend.php' and
             probe.get('prepend_sha256') == self.plan['baseline']['php_prepend_sha256'] and probe.get('allow_url_fopen') is False and
             probe.get('own_db_connected') is True and probe.get('source_db_connected') is False and probe.get('external_dns_failed') is True and
             all(probe.get('disabled', {}).get(key) is True for key in ['mail', 'exec', 'passthru', 'shell_exec', 'system', 'popen', 'proc_open']), 'PRE_CMS_ISOLATION_FAILED')
        self.record('PRE_CMS_ISOLATION', status='PASS', source_db_host_positive=True, evidence=probe, external_packet_capture='NOT_RUN')
        self.stage = 'HTTP_SMOKE'
        self.compose('WEB_START', ['up', '-d', '--no-deps', '--pull', 'never', 'php', 'nginx'], timeout=180)
        self.attest(['db', 'php', 'nginx'])
        self.compose('NGINX_CONFIG', ['exec', '-T', 'nginx', 'nginx', '-t'])
        need(digest(checked(self.args.auth_password_file, private=True)) == self.plan['auth_password_sha256'], 'AUTH_SECRET_CHANGED')
        password = Path(self.args.auth_password_file).read_text().rstrip('\r\n')
        need(1 <= len(password) <= 512 and not re.search(r'[\x00-\x1f\x7f]', password), 'AUTH_SECRET_INVALID')
        auth = 'Basic ' + base64.b64encode((self.args.auth_user + ':' + password).encode()).decode()
        password = None
        status_code, headers, _ = self.http('/')
        need(status_code == 401 and 'basic' in headers.get('www-authenticate', '').lower(), 'AUTHENTICATION_NOT_ENFORCED')
        self.record('UNAUTHENTICATED_HTTP', status='PASS', http_status=401)
        for case in self.plan['baseline']['http']:
            status_code, _, body = self.http(case['request_target'], auth)
            need(status_code == case['status'] and ('body_sha256' not in case or sha(body) == case['body_sha256']), 'HTTP_WITNESS_MISMATCH')
            need(all(value in body.decode('utf-8', 'strict') for value in case.get('contains', [])), 'HTTP_FACT_WITNESS_MISSING')
            self.record('AUTHENTICATED_HTTP', status='PASS', request_target=case['request_target'], http_status=status_code, body_sha256=sha(body), bytes=len(body))
        for target in ('/bitrix/.settings.php', '/local/upgrade-route.php', '/bitrix/admin/index.php', '/state/demo-active.json', '/source-journal-audit/binding.json'):
            need(self.http(target, auth)[0] == 404, 'PRIVATE_PATH_EXPOSED')
        if receipt is not None:
            self.http_receipt(auth, receipt)
        auth = None
        need(verify_current(self.root, self.plan) == active, 'ACTIVE_STATE_CHANGED')
        # Journal remains an exact host-side audit copy; it is never mounted into a service.
        journal_ledger = json_file(self.root / 'inputs/native-journal.tar.gz.ledger.json', outputs['native_journal_dir']['ledger_sha256'])
        verify_tree(self.root / 'source-journal-audit', journal_ledger, self.plan['backup_profile']['limits'])
        need(self.counts() == counts, 'HTTP_CHANGED_DATABASE_COUNTS')
        need(self.source_inspect() == source_before, 'SOURCE_RUNTIME_CHANGED')
        self.run('GUARD_CHECK_FINAL', ['bash', guard, 'check', *guard_args], timeout=120)
        self.record('FINAL_READBACK', status='PASS', counts=counts, active_snapshot=active, source_runtime_unchanged=True)
        return {'status': 'ISOLATED_CURRENT_COPY_RESTORED_AND_SMOKE_VERIFIED', 'plan_sha256': accepted,
                'database_import': 'PASS', 'database_readback': 'PASS', 'cms_restore': 'PASS', 'private_state_restore': 'PASS',
                'all_trees_before_bootstrap': readbacks, 'configuration_derivation': derivation, 'active_snapshot_readback': 'PASS',
                'native_journal_restore': 'AUDIT_ONLY_BYTES_VERIFIED_NOT_ACTIVATED', 'retained_receipt_http': 'PASS' if receipt else 'NOT_RUN',
                'http_smoke': 'PASS', 'source_runtime_unchanged': 'PASS', 'source_stop_or_sql': False,
                'external_packet_capture': 'NOT_RUN', 'production_recovery': 'NOT_RUN', 'automatic_cleanup': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project', 'target-id', 'source-root', 'source-compose', 'source-compose-sha256', 'receipt', 'receipt-sha256',
                 'snapshot-manifest-sha256', 'baseline', 'baseline-sha256', 'destination', 'clone-project', 'subnet', 'bridge',
                 'guard', 'guard-sha256', 'auth-password-file'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--auth-user', default='upgrade')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--accept-plan-sha256')
    args = parser.parse_args(argv)
    executor = None
    try:
        plan, receipt = make_plan(args)
        if not args.execute:
            need(args.accept_plan_sha256 is None, 'ACCEPT_ONLY_WITH_EXECUTE')
            print(json.dumps({'status': 'PLAN_ONLY', 'plan_sha256': sha(canonical(plan)), 'plan': plan}, ensure_ascii=False, sort_keys=True))
            return 0
        executor = Executor(args, plan, receipt)
        with h.execution_lock(args, plan):
            result = executor.execute()
            executor.write_result(result)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, (RecoveryError, b.BackupError)) else 'RESTORE_INPUT_OR_IO_FAILURE'
        result = {'status': 'FAILED', 'code': code, 'stage': executor.stage if executor else 'PLAN_VALIDATION',
                  'recovery_pass': False, 'production_recovery': 'NOT_RUN', 'automatic_cleanup': False,
                  'retry_policy': 'NO_REPLAY_NO_ADOPTION_NEW_PLAN_AND_DESTINATION_REQUIRED'}
        if executor is not None and executor.created:
            try:
                executor.write_result(result)
            except Exception:
                result['failure_receipt'] = 'NOT_WRITTEN_OWNERSHIP_OR_EXCLUSIVE_WRITE_FAILED'
        print(json.dumps(result, sort_keys=True))
        return 1


if __name__ == '__main__':
    sys.exit(main())
