#!/usr/bin/env bash
set -euo pipefail
: "${UPGRADE_DOCUMENT_ROOT:?}" "${UPGRADE_PROJECT_ID:?}" "${UPGRADE_DEMO:?}" "${UPGRADE_PACKAGE:?}" "${UPGRADE_MANIFEST_SHA256:?}" "${UPGRADE_BACKUP_RECEIPT:?}" "${UPGRADE_BACKUP_RECEIPT_SHA256:?}" "${UPGRADE_TARGET_ID:?}" "${UPGRADE_STATE_DIR:?}"
[[ "$UPGRADE_DEMO" == 1 ]] || { echo 'Demo-only operation' >&2; exit 1; }
root=$(realpath -e -- "$UPGRADE_DOCUMENT_ROOT")
package=$(realpath -e -- "$UPGRADE_PACKAGE")
[[ "$root" != / && -f "$root/bitrix/modules/main/include/prolog_before.php" ]] || { echo 'Dedicated Bitrix root required' >&2; exit 1; }
state=$(realpath -e -- "$UPGRADE_STATE_DIR")
[[ "$state" != "$root" && "$state" != "$root/"* ]] || { echo 'Private state outside web root required' >&2; exit 1; }
exec 9>"$state/upgrade-$UPGRADE_PROJECT_ID.lock"
flock -n 9 || { echo 'Target writer busy' >&2; exit 1; }
php bitrix/importer/cli.php --command=validate --package="$package" --project="$UPGRADE_PROJECT_ID" --manifest-sha256="$UPGRADE_MANIFEST_SHA256"
python3 - "$UPGRADE_BACKUP_RECEIPT" "$UPGRADE_PROJECT_ID" "$UPGRADE_BACKUP_RECEIPT_SHA256" "$UPGRADE_TARGET_ID" <<'PY'
import hashlib,json,pathlib,sys,datetime
raw=pathlib.Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(raw).hexdigest()==sys.argv[3],'Accepted backup receipt hash mismatch'
receipt=json.loads(raw)
assert receipt['project_id']==sys.argv[2] and receipt['status']=='INTEGRITY_VERIFIED','Wrong backup project or status'
assert receipt['target_id']==sys.argv[4],'Wrong target instance'
age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(receipt['created_at'])).total_seconds()
assert 0<=age<=86400,'Backup receipt must be from the previous 24 hours'
for item in ['database','files']:
    h=hashlib.sha256()
    with pathlib.Path(receipt[item+'_file']).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    assert h.hexdigest()==receipt[item+'_sha256'],'Backup hash mismatch'
PY
# Copy only namespaces owned by Upgrade. Never copy into /bitrix, alter dbconn.php or third-party modules.
for destination in "$root/local" "$root/local/modules" "$root/local/modules/upgrade.core" "$root/local/components" "$root/local/components/upgrade" "$root/local/templates" "$root/local/templates/upgrade"; do
  [[ ! -L "$destination" ]] || { echo 'Symlink destination refused' >&2; exit 1; }
  mkdir -p -- "$destination"
  [[ "$(realpath -e -- "$destination")" == "$root/"* ]] || { echo 'Destination escapes root' >&2; exit 1; }
done
for subtree in "$root/local/modules/upgrade.core" "$root/local/components/upgrade" "$root/local/templates/upgrade"; do
  [[ -z "$(find "$subtree" -type l -print -quit)" ]] || { echo 'Existing own-code tree contains symlink; deployment refused' >&2; exit 1; }
done
[[ ! -L "$root/local/upgrade-route.php" ]] || { echo 'Router destination symlink refused' >&2; exit 1; }
python3 - "$package" "$root" "$UPGRADE_MANIFEST_SHA256" <<'PY'
import hashlib,json,pathlib,sys,os,secrets
package,root=map(pathlib.Path,sys.argv[1:3])
raw=(package/'manifest.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()==sys.argv[3],'Accepted manifest changed after validation'
manifest=json.loads(raw)
prefixes={'code/module/upgrade.core/':'local/modules/upgrade.core/','code/local/components/upgrade/':'local/components/upgrade/','code/local/templates/upgrade/':'local/templates/upgrade/'}
for name,expected in manifest['files'].items():
    destination_name='local/upgrade-route.php' if name=='code/local/upgrade-route.php' else next((target+name[len(prefix):] for prefix,target in prefixes.items() if name.startswith(prefix)),None)
    if destination_name is None:continue
    source=package/name
    assert source.resolve().is_relative_to(package.resolve()) and not source.is_symlink(),'Source path escape'
    data=source.read_bytes()
    assert hashlib.sha256(data).hexdigest()==expected,'Source bytes changed after validation'
    destination=root/destination_name
    assert destination.resolve().is_relative_to(root),'Destination path escape'
    for parent in [destination,*destination.parents]:
        if parent==root:break
        assert not parent.is_symlink(),'Destination symlink'
    destination.parent.mkdir(parents=True,exist_ok=True)
    temp=destination.with_name(destination.name+'.pending-'+secrets.token_hex(8))
    with temp.open('xb') as stream:stream.write(data)
    temp.chmod(0o644)
    os.replace(temp,destination)
PY
echo 'Own code copied. Execute migration and import inside the isolated PHP service; target verification is still NOT_RUN.'
