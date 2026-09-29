#!/usr/bin/env python3
"""Prepare documented Bitrix short-install config; never display credentials.

Operator provisioning helper, not a Codex desktop API or a general installer API.
Official reference: https://docs.1c-bitrix.ru/pages/get-started/install-distr.html
Only creates an absent configuration in the explicitly named isolated target.
"""
import argparse
import json
import os
from pathlib import Path
import stat


def php_string(value):
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"


def prepare_legacy_bridge(root):
    """This distribution's documented short mode also requires dbconn.php."""
    root = Path(root)
    if root != Path('/opt/upgrade/targets/teplypol-market/cms-root') or root.resolve() != root or not root.is_dir():
        raise ValueError('Unexpected or redirected target root')
    settings = root / 'bitrix/.settings.php'
    info = settings.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 33 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('Expected private prepared settings')
    target = root / 'bitrix/php_interface/dbconn.php'
    if target.parent.resolve() != root / 'bitrix/php_interface' or target.exists() or target.is_symlink():
        raise ValueError('Refusing existing or redirected legacy configuration')
    if not target.parent.exists():
        target.parent.mkdir(mode=0o755)
        os.chown(target.parent, 33, 33)
    content = """<?php
// Documented installation configuration; no vendor implementation modified.
if (!defined('SHORT_INSTALL')) define('SHORT_INSTALL', true);
if (!defined('MYSQL_TABLE_TYPE')) define('MYSQL_TABLE_TYPE', 'INNODB');
if (!defined('BX_UTF')) define('BX_UTF', true);
if (!defined('DBPersistent')) define('DBPersistent', false);
if (!defined('BX_USE_MYSQLI')) define('BX_USE_MYSQLI', true);
if (!defined('DELAY_DB_CONNECT')) define('DELAY_DB_CONNECT', true);
if (!defined('BX_FILE_PERMISSIONS')) define('BX_FILE_PERMISSIONS', 0644);
if (!defined('BX_DIR_PERMISSIONS')) define('BX_DIR_PERMISSIONS', 0755);
$upgradeConnection = (require dirname(__DIR__) . '/.settings.php')['connections']['value']['default'];
$DBType = 'mysql';
$DBHost = $upgradeConnection['host'];
$DBName = $upgradeConnection['database'];
$DBLogin = $upgradeConnection['login'];
$DBPassword = $upgradeConnection['password'];
$DBDebug = false;
$DBDebugToFile = false;
unset($upgradeConnection);
@umask(~BX_DIR_PERMISSIONS);
"""
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchown(fd, 33, 33)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', closefd=False) as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)
    return {'status': 'PREPARED', 'scope': 'BITRIX_LEGACY_SHORT_INSTALL_BRIDGE',
            'target': str(target), 'secret_printed': False, 'installation': 'NOT_RUN_BY_THIS_HELPER'}


def prepare(root, password_file):
    root = Path(root)
    password_file = Path(password_file)
    if root != Path('/opt/upgrade/targets/teplypol-market/cms-root'):
        raise ValueError('Unexpected target root')
    if root.is_symlink() or root.resolve() != root or not root.is_dir():
        raise ValueError('Target root identity mismatch')
    if password_file != Path('/opt/upgrade/private/bitrix/db-password'):
        raise ValueError('Unexpected secret reference')
    info = password_file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('Expected root-owned private regular secret file')
    password = password_file.read_text().strip()
    if not 20 <= len(password) <= 512 or any(c in password for c in '\r\n\x00'):
        raise ValueError('Invalid private secret format')
    target = root / 'bitrix/.settings.php'
    if target.parent.resolve() != root / 'bitrix' or target.exists() or target.is_symlink():
        raise ValueError('Refusing existing or redirected settings file')
    content = """<?php
return [
  'utf_mode' => ['value' => true, 'readonly' => true],
  'cache_flags' => ['value' => ['config_options' => 3600, 'site_domain' => 3600], 'readonly' => false],
  'cookies' => ['value' => ['secure' => false, 'http_only' => true], 'readonly' => false],
  'exception_handling' => ['value' => ['debug' => false, 'handled_errors_types' => 4437, 'exception_errors_types' => 4437, 'ignore_silence' => false], 'readonly' => false],
  'connections' => ['value' => ['default' => [
    'className' => '\\\\Bitrix\\\\Main\\\\DB\\\\MysqliConnection',
    'host' => '172.30.50.2', 'database' => 'upgrade', 'login' => 'upgrade',
    'password' => PASSWORD_LITERAL, 'options' => 2,
  ]], 'readonly' => true],
];
""".replace('PASSWORD_LITERAL', php_string(password))
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchown(fd, 33, 33)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', closefd=False) as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)
    return {'status': 'PREPARED', 'scope': 'BITRIX_SHORT_INSTALL_CONFIG_ONLY',
            'target': str(root), 'secret_printed': False, 'database': 'upgrade',
            'host': '172.30.50.2', 'owner': '33:33', 'mode': '0600',
            'installation': 'NOT_RUN_BY_THIS_HELPER'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--password-file')
    parser.add_argument('--legacy-bridge', action='store_true')
    args = parser.parse_args()
    if args.legacy_bridge:
        print(json.dumps(prepare_legacy_bridge(args.root)))
    else:
        if not args.password_file:
            parser.error('--password-file is required for settings preparation')
        print(json.dumps(prepare(args.root, args.password_file)))
