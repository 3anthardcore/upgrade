#!/usr/bin/env python3
"""Verify a per-site backup and extract to an empty NEW root. Never opens the database."""
import argparse,hashlib,json,pathlib,tarfile
parser=argparse.ArgumentParser()
parser.add_argument('--receipt',required=True)
parser.add_argument('--project',required=True)
parser.add_argument('--new-root',required=True)
args=parser.parse_args()
receipt=json.loads(pathlib.Path(args.receipt).read_text())
if receipt.get('project_id')!=args.project or receipt.get('status')!='INTEGRITY_VERIFIED': raise SystemExit('Wrong backup project or integrity status')
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
for field in ['database','files']:
    path=pathlib.Path(receipt[field+'_file']).resolve(strict=True)
    if digest(path)!=receipt[field+'_sha256']:raise SystemExit('Backup checksum mismatch: '+field)
target=pathlib.Path(args.new_root).resolve()
if target.exists():raise SystemExit('Restore target must be a new, absent directory')
target.mkdir(parents=True)
with tarfile.open(receipt['files_file'],'r:gz') as archive:
    for member in archive.getmembers():
        candidate=(target/member.name).resolve()
        if not candidate.is_relative_to(target) or member.issym() or member.islnk() or member.isdev():raise SystemExit('Unsafe archive member: '+member.name)
    archive.extractall(target,filter='data')
print(json.dumps({'status':'FILES_EXTRACTED','new_root':str(target),'database_import':'NOT_RUN','smoke':'NOT_RUN','production_recovery':'NOT_RUN'}))
