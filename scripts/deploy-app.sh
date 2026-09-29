#!/usr/bin/env bash
# Upgrade application only. No CMS, public listener, disk resize or system Node changes.
set -Eeuo pipefail
umask 027
BASE=/opt/upgrade
NODE_VERSION=24.20.0
NODE_NAME=node-v24.20.0-linux-x64
NODE_SHA256=2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2
MIN_FREE_BYTES=5000000000
ARCHIVE= EXPECTED_SHA= RELEASE= ROLLBACK= CHECK_ONLY=0 INSTALL_BROWSER=0
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\n' 'deploy-app.sh --check' 'deploy-app.sh --archive /absolute/app.tar.gz --sha256 HEX --release ID [--install-browser]' 'deploy-app.sh --rollback RELEASE_ID'; }
while (($#)); do
  case "$1" in
    --archive|--sha256|--release|--rollback) (($# >= 2)) || die "Missing value for $1"; case "$1" in --archive) ARCHIVE=$2;; --sha256) EXPECTED_SHA=$2;; --release) RELEASE=$2;; --rollback) ROLLBACK=$2;; esac; shift 2;;
    --check) CHECK_ONLY=1; shift;;
    --install-browser) INSTALL_BROWSER=1; shift;;
    --help|-h) usage; exit 0;;
    *) usage; die "Unknown argument $1";;
  esac
done
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die 'Linux x86_64 is required'
for cmd in tar curl xz sha256sum timeout flock runuser install readlink realpath awk df getent useradd groupadd id find chmod chown mv ln stat du cut cat rm mktemp head; do command -v "$cmd" >/dev/null || die "Required tool missing: $cmd"; done
[[ ! -L /opt && ! -L "$BASE" ]] || die 'Deployment root may not be a symlink'
[[ $(realpath -m -- "$BASE") == "$BASE" ]] || die 'Unexpected deployment root'
available=$(df -PB1 -- /opt | awk 'NR==2 {print $4}')
[[ "$available" =~ ^[0-9]+$ ]] || die 'Cannot determine finite available disk space'
if ((CHECK_ONLY)); then
  printf 'platform=linux-x64 free_bytes=%s required_bytes=%s node=%s node_sha256=%s\n' "$available" "$MIN_FREE_BYTES" "$NODE_VERSION" "$NODE_SHA256"
  ((available >= MIN_FREE_BYTES)) || die 'Insufficient free disk space; deployment has not changed the host'
  exit 0
fi
((EUID == 0)) || die 'Deployment setup requires root; application execution uses the dedicated upgrade account'
if [[ -z "$ROLLBACK" ]]; then
  ((available >= MIN_FREE_BYTES)) || die 'At least 5 GB free on /opt is required before any deployment change'
  [[ "$ARCHIVE" == /* && -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || die 'An absolute regular archive path is required'
  [[ "$EXPECTED_SHA" =~ ^[a-f0-9]{64}$ ]] || die 'Explicit trusted archive SHA-256 required'
  [[ "$RELEASE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]] || die 'Invalid release ID'
  [[ $(stat -c %s -- "$ARCHIVE") -le 209715200 ]] || die 'Archive exceeds 200 MiB limit'
  [[ $(sha256sum -- "$ARCHIVE" | awk '{print $1}') == "$EXPECTED_SHA" ]] || die 'Archive checksum mismatch'
else
  [[ -z "$ARCHIVE$EXPECTED_SHA$RELEASE" && $INSTALL_BROWSER -eq 0 ]] || die 'Rollback cannot be combined with installation'
  [[ "$ROLLBACK" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]] || die 'Invalid rollback release ID'
fi
if [[ -e "$BASE" && ! -f "$BASE/.upgrade-managed" ]]; then die 'Existing /opt/upgrade is not owned by this deployment; inspect it manually'; fi
if getent passwd upgrade >/dev/null; then
  [[ $(getent passwd upgrade | cut -d: -f6) == "$BASE/shared/home" ]] || die 'Existing upgrade account has a different home; refusing to modify it'
  [[ $(id -u upgrade) -ne 0 ]] || die 'upgrade account must not be root'
else
  [[ -z "$ROLLBACK" ]] || die 'No installed Upgrade account'
  getent group upgrade >/dev/null || groupadd --system upgrade
  useradd --system --gid upgrade --home-dir "$BASE/shared/home" --no-create-home --shell /usr/sbin/nologin upgrade
fi
install -d -m 0750 -o root -g upgrade "$BASE"
[[ -f "$BASE/.upgrade-managed" ]] || printf 'upgrade-application-v1\n' > "$BASE/.upgrade-managed"
exec 9>"$BASE/.deploy.lock"; flock -n 9 || die 'Another Upgrade deployment is active'
for path in releases runtime downloads bin shared; do [[ ! -L "$BASE/$path" ]] || die "Unexpected symlink: $path"; install -d -m 0750 -o root -g upgrade "$BASE/$path"; done
for path in home projects cache browser-cache codex logs; do [[ ! -L "$BASE/shared/$path" ]] || die "Unexpected shared symlink: $path"; install -d -m 0700 -o upgrade -g upgrade "$BASE/shared/$path"; done
root_directory() {
  local path=$1
  [[ ! -L "$path" ]] || die 'Root control directory may not be a symlink'
  if [[ -e "$path" ]]; then [[ -d "$path" && $(stat -c %u -- "$path") == 0 ]] || die 'Root control directory has unexpected owner/type'; fi
  install -d -m 0700 -o root -g root "$path"
}
CONTROL="$BASE/deployment-control"
root_directory "$CONTROL"
root_directory "$BASE/deploy-logs"
LOG_DIRECTORY=$(mktemp -d "$BASE/deploy-logs/${RELEASE:-rollback-$ROLLBACK}.XXXXXXXX")
printf 'Installer diagnostics (root only): %s\n' "$LOG_DIRECTORY"
if [[ -z "$ROLLBACK" ]]; then
  # Snapshot once into root-only storage; a caller-writable archive can change later.
  timeout 60 head -c 209715201 -- "$ARCHIVE" > "$LOG_DIRECTORY/source.tar.gz"
  [[ $(stat -c %s -- "$LOG_DIRECTORY/source.tar.gz") -le 209715200 ]] || die 'Archive snapshot exceeds 200 MiB limit'
  [[ $(sha256sum -- "$LOG_DIRECTORY/source.tar.gz" | awk '{print $1}') == "$EXPECTED_SHA" ]] || die 'Archive snapshot checksum mismatch'
  ARCHIVE="$LOG_DIRECTORY/source.tar.gz"
fi
[[ ! -e "$BASE/current" || -L "$BASE/current" ]] || die 'current exists and is not a managed symlink'
PREVIOUS= SWITCHED=0
if [[ -L "$BASE/current" ]]; then PREVIOUS=$(readlink -f -- "$BASE/current"); [[ "$PREVIOUS" == "$BASE/releases/"* && -f "$PREVIOUS/deployment.json" ]] || die 'Current release is outside managed releases'; fi
switch_to() { local target=$1 link="$BASE/.current-link-$$"; [[ ! -e "$link" && ! -L "$link" ]] || die 'Temporary link already exists'; ln -s -- "$target" "$link"; mv -Tf -- "$link" "$BASE/current"; SWITCHED=1; }
on_exit() { local code=$?; if ((code != 0 && SWITCHED)); then if [[ -n "$PREVIOUS" ]]; then switch_to "$PREVIOUS"; else [[ -L "$BASE/current" ]] && rm -- "$BASE/current"; fi; printf 'Activation failed; previous current selection restored. No shared data was reverted.\n' >&2; fi; }
trap on_exit EXIT
RUNTIME="$BASE/runtime/$NODE_NAME"
run_app() { runuser -u upgrade -- env -i HOME="$BASE/shared/home" CODEX_HOME="$BASE/shared/codex" PATH="$RUNTIME/bin:$BASE/bin:/usr/bin:/bin" UPGRADE_DATA_DIR="$BASE/shared/projects" PLAYWRIGHT_BROWSERS_PATH="$BASE/shared/browser-cache" NPM_CONFIG_CACHE="$BASE/shared/cache" "$@"; }
verify_help() {
  "$RUNTIME/bin/node" --input-type=commonjs - "$1" "$2/package.json" <<'HELP_CHECK'
const fs=require('node:fs');const [file,packageFile]=process.argv.slice(2);
if(fs.statSync(file).size===0||fs.statSync(file).size>65536)throw Error('CLI help is empty or oversized');
const help=JSON.parse(fs.readFileSync(file,'utf8')),pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
if(help.tool!=='Upgrade'||typeof help.version!=='string'||help.version!==pkg.version||!Array.isArray(help.commands)||!help.commands.every(x=>typeof x==='string'))throw Error('Invalid CLI help identity/version/commands');
const commands=new Set(help.commands.map(x=>x.split(/\s+/)[0]));
if(!['doctor','init','run','status'].every(x=>commands.has(x)))throw Error('CLI help misses required commands');
HELP_CHECK
}
verify_source() {
  local pin="$CONTROL/$2.manifest.sha256"
  [[ -f "$pin" && ! -L "$pin" && $(stat -c %u -- "$pin") == 0 && $(stat -c %h -- "$pin") == 1 ]] || die 'Root-owned accepted manifest pin is missing or unsafe'
  [[ $(sha256sum -- "$1/upgrade-app-manifest.json" | awk '{print $1}') == "$(cat -- "$pin")" ]] || die 'Application manifest differs from the trusted archive'
  "$RUNTIME/bin/node" --input-type=commonjs - "$1" "$2" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [root,id]=process.argv.slice(2),manifest=JSON.parse(fs.readFileSync(path.join(root,'upgrade-app-manifest.json'),'utf8'));
if(manifest.kind!=='upgrade-application-source'||manifest.schema_version!==1||manifest.release_id!==id||manifest.runtime.node!=='24.20.0'||manifest.runtime.platform!=='linux-x64'||!Array.isArray(manifest.files))throw Error('Invalid application manifest');
let size=0;const names=new Set();for(const f of manifest.files){if(!/^[a-zA-Z0-9_./-]+$/.test(f.path)||f.path.startsWith('/')||f.path.split('/').some(x=>!x||x==='.'||x==='..')||names.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>20*1024*1024)throw Error('Invalid manifest file');names.add(f.path);const p=path.join(root,f.path);if(!fs.lstatSync(p).isFile()||fs.realpathSync(p)!==p)throw Error('Non-regular application input');const b=fs.readFileSync(p);size+=b.length;if(size>200*1024*1024||b.length!==f.bytes||crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Application content mismatch');}
if(names.size!==manifest.file_count||size!==manifest.source_bytes||!names.has('packages/cli/index.ts')||!names.has('package-lock.json')||crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')!==manifest.source_sha256)throw Error('Application manifest mismatch');
const walk=(dir,rel='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=rel?rel+'/'+e.name:e.name;if(name==='node_modules')continue;if(e.isSymbolicLink())throw Error('Unexpected application symlink');if(e.isDirectory())walk(path.join(dir,e.name),name);else if(!names.has(name)&&!['upgrade-app-manifest.json','.archive.sha256','deployment.json'].includes(name))throw Error('Unexpected application file: '+name);}};walk(root);
NODE
}
if [[ -n "$ROLLBACK" ]]; then
  target="$BASE/releases/$ROLLBACK"
  [[ -d "$target" && ! -L "$target" && -f "$target/deployment.json" && -x "$RUNTIME/bin/node" ]] || die 'Rollback release/runtime unavailable'
  verify_source "$target" "$ROLLBACK"
  run_app timeout 30 "$RUNTIME/bin/node" --disable-warning=ExperimentalWarning "$target/packages/cli/index.ts" help > "$LOG_DIRECTORY/help.json"
  verify_help "$LOG_DIRECTORY/help.json" "$target"
  switch_to "$target"
  runuser -u upgrade -- timeout 30 "$BASE/bin/upgrade" help > "$LOG_DIRECTORY/help-active.json"
  verify_help "$LOG_DIRECTORY/help-active.json" "$target"
  printf 'Selected rollback release %s. Shared projects, budgets and data were not rolled back.\n' "$ROLLBACK"
  exit 0
fi
if [[ ! -d "$RUNTIME" ]]; then
  archive="$BASE/downloads/$NODE_NAME.tar.xz"
  if [[ ! -f "$archive" || $(sha256sum -- "$archive" | awk '{print $1}') != "$NODE_SHA256" ]]; then
    timeout 330 curl --proto '=https' --tlsv1.2 --fail --location --connect-timeout 15 --max-time 300 --retry 1 --retry-delay 2 --output "$archive.partial" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_NAME.tar.xz"
    [[ $(sha256sum -- "$archive.partial" | awk '{print $1}') == "$NODE_SHA256" ]] || die 'Official Node archive checksum mismatch'
    mv -- "$archive.partial" "$archive"
  fi
  runtime_stage="$BASE/runtime/.node-$NODE_VERSION-staging"
  [[ ! -L "$runtime_stage" ]] || die 'Runtime staging path is a symlink'; install -d -m 0750 -o root -g upgrade "$runtime_stage"
  timeout 120 tar -xJf "$archive" -C "$runtime_stage" --no-same-owner
  [[ $("$runtime_stage/$NODE_NAME/bin/node" --version) == "v$NODE_VERSION" ]] || die 'Node runtime self-check failed'
  printf '%s\n' "$NODE_SHA256" > "$runtime_stage/$NODE_NAME/.archive.sha256"
  chown -R root:upgrade "$runtime_stage/$NODE_NAME"; chmod -R go-w "$runtime_stage/$NODE_NAME"
  mv -- "$runtime_stage/$NODE_NAME" "$RUNTIME"
fi
[[ ! -L "$RUNTIME" && $(cat "$RUNTIME/.archive.sha256") == "$NODE_SHA256" && $("$RUNTIME/bin/node" --version) == "v$NODE_VERSION" ]] || die 'Existing private Node runtime does not match pinned release'
# Bound expanded bytes and entry count before extraction, not after disk space is consumed.
timeout 30 tar -tzf "$ARCHIVE" > "$LOG_DIRECTORY/archive-members.txt"
awk '/^\// || /(^|\/)\.\.(\/|$)/ || /[^a-zA-Z0-9_.\/-]/ {bad=1} END {exit bad}' "$LOG_DIRECTORY/archive-members.txt" || die 'Archive contains unsafe names'
timeout 30 tar --numeric-owner --full-time -tvzf "$ARCHIVE" | awk '
  {kind=substr($0,1,1); count++; if((kind!="-" && kind!="d") || $3!~/^[0-9]+$/ || $3>20971520) bad=1; total+=$3; if(total>209715200 || count>20000) bad=1}
  END {exit bad}' || die 'Archive contains links/special entries or exceeds expanded size/count limits'
timeout 30 tar -xOzf "$ARCHIVE" ./upgrade-app-manifest.json > "$LOG_DIRECTORY/accepted-manifest.json"
accepted_manifest_sha=$(sha256sum -- "$LOG_DIRECTORY/accepted-manifest.json" | awk '{print $1}')
pin="$CONTROL/$RELEASE.manifest.sha256"
if [[ -e "$pin" || -L "$pin" ]]; then
  [[ -f "$pin" && ! -L "$pin" && $(stat -c %u -- "$pin") == 0 && $(stat -c %h -- "$pin") == 1 && $(cat -- "$pin") == "$accepted_manifest_sha" ]] || die 'Release ID has a different or unsafe accepted manifest pin'
else
  (set -o noclobber; printf '%s\n' "$accepted_manifest_sha" > "$pin")
fi
target="$BASE/releases/$RELEASE"
if [[ -d "$target" ]]; then
  [[ ! -L "$target" && -f "$target/.archive.sha256" && $(cat "$target/.archive.sha256") == "$EXPECTED_SHA" ]] || die 'Existing release has no matching installation marker'
  verify_source "$target" "$RELEASE"
  if [[ -f "$target/deployment.json" ]]; then recorded=$("$RUNTIME/bin/node" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).archive_sha256' "$target/deployment.json"); [[ "$recorded" == "$EXPECTED_SHA" ]] || die 'Release ID already belongs to another archive'; fi
else
  stage="$BASE/releases/.staging-$RELEASE"
  [[ ! -L "$stage" ]] || die 'Staging path is a symlink'
  [[ ! -e "$stage" ]] || die 'Interrupted staging is not reused: inspect and quarantine it explicitly before retry; current and shared data are unchanged'
  install -d -m 0750 -o root -g upgrade "$stage"; printf '%s\n' "$EXPECTED_SHA" > "$stage/.archive.sha256"
  [[ -z $(find "$stage" -path "$stage/node_modules" -prune -o -type l -print -quit) ]] || die 'Staging contains unexpected source symlink'
  timeout 120 tar -xzf "$ARCHIVE" -C "$stage" --no-same-owner --no-same-permissions
  verify_source "$stage" "$RELEASE"
  chown -hRP upgrade:upgrade "$stage"
  # Dependency lifecycle scripts never run; lockfile integrity is checked by npm.
  (cd "$stage"; run_app timeout 600 "$RUNTIME/bin/npm" ci --omit=dev --ignore-scripts --no-audit --no-fund > "$LOG_DIRECTORY/npm.log" 2>&1)
  chown -hRP root:upgrade "$stage"; chmod -R go-w "$stage"; find "$stage" -type d -exec chmod 0750 {} +; find "$stage" -type f -exec chmod g+r {} +
  verify_source "$stage" "$RELEASE"
  mv -- "$stage" "$target"
fi
if ((INSTALL_BROWSER)); then
  available=$(df -PB1 -- /opt | awk 'NR==2 {print $4}'); [[ "$available" =~ ^[0-9]+$ ]] && ((available >= MIN_FREE_BYTES)) || die 'Browser installation requires 5 GB free after baseline install'
  run_app timeout 600 "$RUNTIME/bin/node" "$target/node_modules/playwright/cli.js" install chromium > "$LOG_DIRECTORY/browser.log" 2>&1
  run_app timeout 60 "$RUNTIME/bin/node" --input-type=module - "$target" >> "$LOG_DIRECTORY/browser.log" 2>&1 <<'NODE'
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';const {chromium}=await import(pathToFileURL(resolve(process.argv[2],'node_modules/playwright/index.mjs')).href);const browser=await chromium.launch({headless:true});console.log(JSON.stringify({browser_launch:'PASS',version:browser.version()}));await browser.close();
NODE
fi
run_app timeout 30 "$RUNTIME/bin/node" --disable-warning=ExperimentalWarning "$target/packages/cli/index.ts" help > "$LOG_DIRECTORY/help.json"
verify_help "$LOG_DIRECTORY/help.json" "$target"
run_app timeout 60 "$RUNTIME/bin/node" --disable-warning=ExperimentalWarning "$target/packages/cli/index.ts" doctor > "$LOG_DIRECTORY/doctor.json"
"$RUNTIME/bin/node" --input-type=commonjs - "$target" "$EXPECTED_SHA" "$NODE_SHA256" "$INSTALL_BROWSER" "$LOG_DIRECTORY" <<'NODE'
const fs=require('node:fs'),cp=require('node:child_process');const [root,archive,node,browser,logs]=process.argv.slice(2);
const bytes=p=>Number(cp.execFileSync('du',['-sb',p],{encoding:'utf8'}).split(/\s/)[0]);
fs.writeFileSync(root+'/deployment.json',JSON.stringify({schema_version:1,status:'CLI_BASELINE_VERIFIED',activated_at:new Date().toISOString(),archive_sha256:archive,node_version:process.version,node_archive_sha256:node,installer_log_directory:logs,release_bytes:bytes(root),runtime_bytes:bytes('/opt/upgrade/runtime'),shared_bytes:bytes('/opt/upgrade/shared'),browser_install_requested:browser==='1',public_listener:false,bitrix:'NOT_RUN',codex_auth:'See doctor result; never copied'},null,2)+'\n',{mode:0o640});
NODE
cat > "$BASE/bin/upgrade" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $(id -un) == upgrade ]] || { echo 'Run this CLI as OS user upgrade (for example: sudo -u upgrade /opt/upgrade/bin/upgrade help)' >&2; exit 1; }
cd /opt/upgrade/current
exec env -i HOME=/opt/upgrade/shared/home CODEX_HOME=/opt/upgrade/shared/codex PATH=/opt/upgrade/runtime/node-v24.20.0-linux-x64/bin:/opt/upgrade/bin:/usr/bin:/bin UPGRADE_DATA_DIR=/opt/upgrade/shared/projects PLAYWRIGHT_BROWSERS_PATH=/opt/upgrade/shared/browser-cache NPM_CONFIG_CACHE=/opt/upgrade/shared/cache /opt/upgrade/runtime/node-v24.20.0-linux-x64/bin/node --disable-warning=ExperimentalWarning /opt/upgrade/current/packages/cli/index.ts "$@"
SH
chown root:upgrade "$BASE/bin/upgrade"; chmod 0750 "$BASE/bin/upgrade"
switch_to "$target"
runuser -u upgrade -- timeout 30 "$BASE/bin/upgrade" help > "$LOG_DIRECTORY/help-active.json"
verify_help "$LOG_DIRECTORY/help-active.json" "$target"
printf 'Upgrade CLI release %s active. Receipt: %s/deployment.json\n' "$RELEASE" "$target"
printf 'No public listener started. Bitrix and server Codex execution remain separately verified.\n'
