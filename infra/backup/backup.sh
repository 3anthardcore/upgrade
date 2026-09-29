#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${UPGRADE_PROJECT_ID:?}" "${UPGRADE_DOCUMENT_ROOT:?}" "${UPGRADE_BACKUP_ROOT:?}" "${UPGRADE_MYSQL_CNF:?}" "${UPGRADE_TARGET_ID:?}"
[[ "$UPGRADE_PROJECT_ID" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || exit 1
site=$(realpath -e -- "$UPGRADE_DOCUMENT_ROOT")
backup_root=$(realpath -e -- "$UPGRADE_BACKUP_ROOT")
[[ "$site" != / && "$backup_root" != "$site" && "$backup_root" != "$site/"* ]] || { echo 'Backup must be outside site root' >&2; exit 1; }
[[ -f "$UPGRADE_MYSQL_CNF" ]] || { echo 'Private mysqldump defaults file required' >&2; exit 1; }
destination="$backup_root/$UPGRADE_PROJECT_ID-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -- "$destination"
# Credentials are read from a private file, never CLI arguments or logs.
mysqldump --defaults-extra-file="$UPGRADE_MYSQL_CNF" --single-transaction --routines --triggers --events --hex-blob --databases upgrade > "$destination/database.sql.pending"
mv -- "$destination/database.sql.pending" "$destination/database.sql"
tar --create --gzip --file "$destination/site.tar.gz" --directory "$site" .
gzip --test "$destination/site.tar.gz"
tar --list --gzip --file "$destination/site.tar.gz" > "$destination/files.list"
python3 - "$UPGRADE_PROJECT_ID" "$destination" "$UPGRADE_TARGET_ID" <<'PY'
import hashlib,json,pathlib,sys,datetime
project,destination,target_id=sys.argv[1:]
root=pathlib.Path(destination)
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
receipt={'schema_version':'1.0','project_id':project,'target_id':target_id,'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'INTEGRITY_VERIFIED','database_file':str(root/'database.sql'),'database_sha256':digest(root/'database.sql'),'files_file':str(root/'site.tar.gz'),'files_sha256':digest(root/'site.tar.gz'),'restore_test':'NOT_RUN','production_recovery':'NOT_RUN'}
(root/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(root/'receipt.json')
PY
