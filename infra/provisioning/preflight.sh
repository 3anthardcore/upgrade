#!/usr/bin/env bash
set -euo pipefail
required=(UPGRADE_PROJECT_ID UPGRADE_TARGET_ID UPGRADE_DOCUMENT_ROOT UPGRADE_STATE_DIR UPGRADE_HTPASSWD_FILE UPGRADE_DB_PASSWORD_FILE UPGRADE_DB_ROOT_PASSWORD_FILE UPGRADE_PHP_IMAGE UPGRADE_NGINX_IMAGE UPGRADE_MYSQL_IMAGE)
for name in "${required[@]}"; do [[ -n "${!name:-}" ]] || { echo "Missing $name" >&2; exit 1; }; done
[[ "$UPGRADE_PROJECT_ID" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || exit 1
for name in UPGRADE_PHP_IMAGE UPGRADE_NGINX_IMAGE UPGRADE_MYSQL_IMAGE; do [[ "${!name}" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "Image must be pinned by actual digest: $name" >&2; exit 1; }; done
root=$(realpath -e -- "$UPGRADE_DOCUMENT_ROOT")
state=$(realpath -e -- "$UPGRADE_STATE_DIR")
[[ "$root" != / && "$state" != "$root" && "$state" != "$root/"* ]] || { echo 'Private state must be outside dedicated web root' >&2; exit 1; }
[[ -f "$root/bitrix/modules/main/include/prolog_before.php" ]] || { echo 'Operator-supplied licensed Bitrix distribution is missing' >&2; exit 1; }
for name in UPGRADE_HTPASSWD_FILE UPGRADE_DB_PASSWORD_FILE UPGRADE_DB_ROOT_PASSWORD_FILE; do [[ -s "${!name}" ]] || { echo "Missing secret file: $name" >&2; exit 1; }; done
docker info >/dev/null
docker compose -f infra/compose/compose.yaml config --quiet
echo 'Preflight configuration passed. License, PHP extensions, outbound isolation and Bitrix compatibility still require target verification.'
