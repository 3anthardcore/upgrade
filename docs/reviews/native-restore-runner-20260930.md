# Native isolated recovery runner — 30.09.2026

Revision history: the following fence-1 author report is retained as historical evidence. **V1 independent review: REJECT** for R1 (regex accepted dynamic/commented settings) and R2 (preflight events could append into another executor's destination). The V2 correction and new frozen pins are appended below; V1's local test PASS did not constitute acceptance.

Task `native-restore-runner-20260930`, worker discovery, fence1. Input artifact `art-5ae550d4-df49-48a0-b387-ceca8fb3fed9`. Author writes only `scripts/recovery-target.py`, `tests/integration/recovery-target.test.ts`, this document. Source target, remote server, Store, DB and Git were not mutated or connected to by this author.

**Implemented a real Linux Python executor, not a simulated restore. Local offline tests: PASS. Actual Docker/MySQL/Bitrix execution: NOT_RUN by this author.** Root must independently accept the frozen script, pin the actual guard/baseline/input bytes and run it on the server. No local result is AT-28, disaster recovery or DEMO_READY acceptance.

Code freeze SHA256: `821dd261da42513a7bc3b3b2902dafc615ae4e0719c76cd824859d902a48d181`.

Test freeze SHA256: `4caeb344a2a0842ab83f0528edd944c56d95eadbeee86682740a16edaeb08163`.

## Actual inputs examined

Read root-provided redacted normalized source Compose JSON and fresh receipt in `var/evidence/continuation-20260930/restore-input/`. Source is `/opt/upgrade/targets/teplypol-market`; normalized Compose services are db/php/nginx; licensed root is `cms-root`; private state is `state`; source external managed network is `upgrade-teplypol-market-isolated`, source Nginx172.30.50.4. Source image references are immutable digests; PHP is the custom local SHA image with prepend.

Fresh backup receipt describes `state/backups/pre-interactive-r13-20260930`, status `INTEGRITY_VERIFIED`, SQL SHA `42e544ed2a7bf213188f505a6781d1eb413afa5515493815972b97c54f8f0fef`, archive SHA `a06afb75cf8954abcbaabadec57a6cfa4ecbf43f27d0aa96325b7ff6151cf157`. These receipt values were read locally; this author did not have or rehash the actual server SQL/archive bytes. The executor does that before plan acceptance and again after copying inputs into the new private destination.

Root supplied a fresh server-side baseline separately:103 entities,103 routes,105 operations,0 orders,0 events,1 user; exact selected entity identity and real HTTP witnesses. These are parent-provided integration inputs, not independent target PASS claims from this task.

## Plan and execution contract

Python3.10+ stdlib, Linux root, existing Docker Engine + Compose v2, available pinned images and required guard dependencies. Default invocation is read-only and prints `{status:"PLAN_ONLY",plan_sha256,plan}`. Plan canonicalization uses sorted JSON keys and no timestamp. It binds executor/receipt/compose/baseline/guard/backup/config bytes, project/target, new resources and archive inventory. The caller must obtain input pins from accepted artifacts, not treat a manifest's own claim as trust.

Execution uses the same arguments plus `--execute --accept-plan-sha256 PIN`. It recomputes the plan and requires the exact accepted hash. A changed script, config, archive, baseline, guard or destination invalidates the plan. Plaintext DB/auth passwords are neither output nor placed in process arguments or intent; secret references are read privately only. Root must ensure those root-owned secret files remain authoritative for the backup. They are deliberately not emitted as password-derived hashes in the public plan; a mismatch with backed-up CMS credentials makes runtime smoke fail.

Required flags:

```text
--project SOURCE_PROJECT
--target-id SOURCE_TARGET_ID
--source-root /opt/upgrade/targets/SOURCE_PROJECT
--source-compose NORMALIZED_COMPOSE_JSON
--source-compose-sha256 TRUSTED_SHA
--receipt HOST_BACKUP_RECEIPT_JSON
--receipt-sha256 TRUSTED_SHA
--baseline BASELINE_JSON
--baseline-sha256 TRUSTED_SHA
--destination /opt/upgrade/recovery/NEW_NAME
--clone-project DISTINCT_DOCKER_PROJECT
--clone-target-id DISTINCT_TARGET_ID
--subnet DISTINCT_PRIVATE_IPV4_24
--bridge br-upgSUFFIX
--guard TRUSTED_ISOLATE_NETWORK_SH
--guard-sha256 TRUSTED_SHA
--auth-password-file PRIVATE_ROOT_ONLY_FILE
--auth-user upgrade                 # optional, default upgrade
```

Example operator argument array; placeholders must be replaced with independently accepted pins before use:

```bash
args=(
  --project teplypol-market --target-id target-teplypol-20260929
  --source-root /opt/upgrade/targets/teplypol-market
  --source-compose /opt/upgrade/targets/teplypol-market/config/compose.cms-installer.json
  --source-compose-sha256 "$ACCEPTED_SOURCE_COMPOSE_SHA"
  --receipt /opt/upgrade/targets/teplypol-market/state/backups/pre-interactive-r13-20260930/receipt-host.json
  --receipt-sha256 "$ACCEPTED_RECEIPT_SHA"
  --baseline /root/upgrade-install-20260929/recovery-baseline-r12-20260930.json
  --baseline-sha256 "$ACCEPTED_BASELINE_SHA"
  --destination /opt/upgrade/recovery/teplypol-market-20260930
  --clone-project teplypol-recovery --clone-target-id recovery-teplypol-20260930
  --subnet 172.30.51.0/24 --bridge br-upgrc30
  --guard "$ACCEPTED_GUARD_PATH" --guard-sha256 "$ACCEPTED_GUARD_SHA"
  --auth-password-file /opt/upgrade/private/bitrix/demo-access-password
)
python3 -B scripts/recovery-target.py "${args[@]}"
# Save/review this exact plan. Only then:
python3 -B scripts/recovery-target.py "${args[@]}" --execute --accept-plan-sha256 "$ACCEPTED_PLAN_SHA"
```

Actual receipt filename must be checked on the server; its filename is not inferred from the local copied evidence filename. The script never discovers or chooses a backup on its own.

Baseline schema:

```json
{
  "schema_version": 1,
  "project_id": "teplypol-market",
  "target_id": "target-teplypol-20260929",
  "trusted_host": "upgrade.help-ai-ru.ru",
  "php_prepend_sha256": "52d886b9450eba6d6f37f26a1b82778513309e8782c5bace622bec288dc4760f",
  "database_counts": {
    "ug_entity": 103, "ug_route": 103, "ug_operation": 105,
    "b_sale_order": 0, "b_event": 0, "b_user": 1
  },
  "http": [
    {"request_target": "/termoregulyatory/grand-meyer-hw-500", "status": 200, "contains": ["EXACT VERIFIED FACTUAL TEXT"]},
    {"request_target": "/", "status": 200, "contains": ["EXACT VERIFIED FACTUAL TEXT"]},
    {"request_target": "/__missing-recovery-check", "status": 404}
  ]
}
```

The placeholder HTTP witness is not a ready-to-run factual assertion. Root's actual baseline must supply observed bytes, or `body_sha256`. Optional `entity:{id:int,xml_id:"upgrade:64hex",name?:string}` verifies the exact `b_iblock_element` ID/XML_ID/optional NAME. An SEO title is not silently treated as NAME. Counts permit only bounded b_/ug_ table identifiers and integer values; HTTP accepts1..20 GET cases, requires a positive200 and negative404, and preserves each exact request target including duplicate/blank query parameters. No baseline supplies arbitrary SQL or executable code.

## Execution order and durable state

1. Validate all pins, source/target bindings, canonical regular files, exact source root and absent destination. Scan the entire archive before destination creation; verify SQL/archive SHA. Build a whitelist Compose projection. New destination must be a direct child of `/opt/upgrade/recovery`; source tree and destination cannot overlap.
2. Acquire a root-only nonblocking OS flock for the distinct clone project. No PID-based lock stealing. Refuse existing clone volume, network or Compose containers. Inspect the three running source containers read-only and retain their ID/image/mount/network snapshot. Check conservative free-space floors in `/opt/upgrade` and Docker storage, retaining at least2GiB beyond estimated clone needs. This is not a guarantee against all database expansion or concurrent host writes.
3. Create only the new private root/subdirectories. Fsync immutable `intent.json`; append fsynced `events.jsonl` before and after commands. Snapshot source runtime metadata. Copy SQL/archive into root-only private inputs and rehash; copy the pinned guard/config and recheck hashes. Copy secrets to new private files; no original files are changed.
4. Extract validated archive entries manually into new `cms-root`, with no tar `extractall`, links, devices, FIFOs, sparse files, traversal, platform aliases, duplicate paths, parent-file conflicts or overwrite. Limits:250000 entries,512MiB/member,8GiB expanded/backup file. Re-read every extracted file and compare its SHA against the bytes read from the archive. Persist `files-readback.jsonl` and its SHA. Preserve source file read/write modes while stripping executable/setuid bits; source directory rwx bits remain. Ownership is intentionally33:33 for the dedicated cloned PHP tree. This is documented clone ownership, not exact historical UID recovery. Private0600 settings stay0600.
5. Validate the restored documented literal `.settings.php` connection format has host `db`, database `upgrade`; do not execute/rewrite it to inspect credentials. Dynamic/ambiguous connection config is refused. Apply and check the separately pinned own network guard before starting any clone DB/PHP container. The guard creates the new internal external-to-Compose network with the distinct bridge/subnet.
6. Start only clone DB with event scheduler and local infile disabled, no published port, loopback DNS, no auto-restart. Attest actual container project/service/image/network/static IP, exact mounts and unique named volume before SQL. Wait bounded readiness. Import the copied SQL through stdin into mysql with a private option-file secret, `--binary-mode` and local infile off; no password appears in argv. The trusted pinned mysqldump is executed only against the newly attested DB. This is not a general arbitrary-SQL security validator.
7. Execute fixed read-only COUNT queries and optional exact entity identity query. A mismatch fails. Before first CMS bootstrap, host TCP positive-control the actual source DB, recheck guard, then run the own probe as UID33:33 from an actual mounted PHP file. It checks active prepend/hash, disabled mail/process functions, URL fopen off, own DB reachable, source DB unreachable, external DNS resolution failed. No `php -r` assumption, no CMS bootstrap in this probe. External packet capture/general egress verification is explicitly NOT_RUN here.
8. Start only the clone's PHP/Nginx and attest all three containers. Run `nginx -t`. HTTP requests target only172.30.51.4:8080 (derived from accepted subnet), with original trusted Host. The copied reviewed Nginx config changes only its exact gateway `IP|https` token to the clone gateway; it does not change source facts, paths or domain. HTTP is internal transport, not a TLS-certificate test.
9. Verify unauthenticated401/Basic, noindex/no-store; authenticated positive factual pages and negative404; protected config/router/admin paths404. Auth comes from a private file, never logged. No redirects are followed or browser/source scripts executed. Repeat DB counts including orders/events; require unchanged values. Compare source container runtime metadata and final network guard. Only all successful checks yield `ISOLATED_COPY_RESTORED_AND_SMOKE_VERIFIED`.

Compose output is rebuilt from explicit fields, never blindly cloned. Only db/php/nginx with pinned images are supported. New bind mounts point under the new recovery root; DB has a unique named volume; config sources are restricted to source `config/` or `/opt/upgrade/private/bitrix`. No original CMS/state/DB volume is mounted in the clone. Unknown volume destinations, nested web overlays, Docker socket, source privilege/ports/host networking/restart/entrypoint changes are rejected. Unrelated environment/healthcheck/labels from the source are not forwarded. PHP uses a new target ID and original content project ID; this preserves content bindings without claiming it is the original destination.

MySQL secret copies are mode0444 under host0700 root-only private parents because local Compose secrets are read-only bind mounts and MySQL drops UID before reading password files. Only the DB container receives them. The generated mysql client option file is0600 and client execution explicitly uses UID0 in the isolated DB container. PHP runtime probe explicitly uses UID33:33; FPM's existing safe master/worker model is retained.

## Failures and scope of proof

On a handled failure after owned intent creation, `result.json` records FAILED, current stage, fixed error code, `recovery_pass:false` and `DO_NOT_REPLAY_INTO_PARTIAL_DESTINATION`. Command timeout is UNKNOWN: terminating the local Docker client does not prove remote SQL stopped. An abrupt kill still leaves the accepted intent and STARTED event; OS flock releases, but existing destination/resources prevent automatic adoption or duplicate import. The executor never stops/deletes the source or automatically cleans up even its failed clone. Root must inspect partial state and authorize any later cleanup separately. A racing executor cannot write a failure receipt into a directory it did not create.

No raw subprocess stdout/stderr is persisted; only code/hash evidence, safe parsed counts and approved HTTP route/body digests. No request auth values, DB passwords, source HTML bodies or arbitrary exception messages are printed. Existing source runtime inspection is read-only. Its before/after equality proves the inspected container IDs/images/mount/network configuration remained stable, not a comprehensive audit of every possible concurrent source filesystem/DB write by another actor.

This recovery scope is r12 SQL + CMS files. Private Upgrade package/state/session directories are **not** in that backup and are not silently copied from a newer live source. Future r13 interactive state needs a separately pinned state-backup contract. Root must not label a successful r12 copy as recovery of later sessions/config. License activation, admin editing, live customer workflows, full URL closure, production switchover, DNS/TLS publishing, full data comparisons beyond selected witnesses, and disaster recovery after power loss are separate NOT_RUN acceptance boundaries.

The existing network guard's old unique-first-jump rule conflicted with multiple projects. Root is independently fixing/reviewing that helper; this executor does not alter it and requires its accepted SHA. An incompatible guard will fail closed. No native restore should be claimed before its actual apply/check passes alongside the preserved source rules.

## Actual local verification

```text
node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts
  Node wrapper 1/1 PASS, 0 SKIP; real Python unittest 21/21 PASS.
  Latest run: Python 0.400s; wrapper total635.0772ms.
npm run check
  PASS
git diff --check -- scripts/recovery-target.py tests/integration/recovery-target.test.ts
  PASS
```

The same embedded Python harness was separately piped to actual local WSL Ubuntu `python3 -B - /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-target.py`:21/21 PASS,0 skip,0.194s. It did not call Docker, SSH, firewall commands or remote DB. The harness is stored in the repository test file; it uses OS temporary directories and real gzip/tar extraction/hash/readback, local child stdin/timeout and private diagnostic logs. Docker inspection tests use explicitly synthetic inspection dictionaries; they are not native-container proof.

Local read-only projection of the actual root-provided normalized source Compose JSON also passed: new project `teplypol-recovery`, network `upgrade-teplypol-recovery-isolated`, Nginx172.30.51.4, exactly php/db/nginx, no mutation of input. First test draft had two incorrect harness expectations (25-byte fixture expected24; timeout error code expected the event-status string); correcting those assertions yielded the reported results. No implementation defect or failed native restore was relabeled PASS.

```json
[
  {"id":"recovery-offline-python","status":"PASS","details":"21 real Python contract tests on Windows and WSL Ubuntu, zero skip; archive/hash/path/plan/mount/input/timeout behavior."},
  {"id":"recovery-actual-compose-projection","status":"PASS","details":"Read-only projection of locally saved actual source Compose JSON to a distinct clone resource plan."},
  {"id":"recovery-typescript","status":"PASS","details":"npm run check and scoped diff whitespace check."},
  {"id":"recovery-native-docker-sql-http","status":"NOT_RUN","details":"Author made no server connections. Root must execute pinned plan and inspect durable result plus raw checks."},
  {"id":"recovery-independent-acceptance","status":"NOT_RUN","details":"Implementation awaits independent review; local author cannot accept own work."},
  {"id":"production-disaster-recovery","status":"NOT_RUN","details":"No source switchover, cleanup, later private state recovery or production modification."}
]
```

Next step: independent code review; root pins its actual baseline/receipt/compose and accepted revised network guard, reviews plan, executes into the absent recovery destination, then saves the real result/events/readback ledger in authoritative Store. A failure preserves its partial copy and remains a failure until investigated.

## V2 — fence 2 correction, 30.09.2026

Worker `commerce-model`; input artifacts `art-5ae550d4-df49-48a0-b387-ceca8fb3fed9` and `art-9f60d80b-a70f-4024-97d6-4d05bdf30fd3`; input hash `260860b96bc296a90e46fd10ed18be53ac2b304a94249a506523766fc54cc689`. Only this report, `scripts/recovery-target.py`, and `tests/integration/recovery-target.test.ts` changed. No server, Store, target database, credentials, or Git access occurred in this revision.

R1's exact rejected witnesses are now regression tests:

```php
<?php return ['host'=>'db'.'.foreign','database'=>'upgrade'];
<?php /* 'host'=>'db','database'=>'upgrade' */ return require '/unrelated/private/config.php';
```

`LiteralPhpSettings` reads bounded UTF-8 bytes and accepts only an opening PHP tag, `return`, a literal `[]`/`array()` tree, semicolon, and optional closing tag. It skips comments as tokens rather than treating their strings as values. It supports literal strings with the documented conservative escape subset, decimal integers, true/false/null and nested arrays. It rejects calls/includes, variables/interpolation, concatenation/operators, spread, constants, duplicate keys (including canonical numeric-string collisions), trailing code/output, depth above 64 or more than 50,000 value nodes. Unsupported valid PHP syntax is refused, never executed to discover its result.

The connection check requires the real Bitrix shape `connections.value.default`, exactly one default connection, host `db`, database `upgrade`. A flat pair of decoy keys or an additional connection cannot satisfy it. The historical fixture's flat toy shape was replaced with nested Bitrix settings. No real settings/password file was read by the V2 author. Root must apply the inert check to the actual restored settings before first bootstrap; uncommon dynamic or unsupported settings fail closed and need a separately reviewed decision.

R2 now keeps every preflight event in memory, including after another process creates the intended destination. Atomic `mkdir` establishes the sole destination owner even when callers hold different clone-project locks. `claim_destination` creates an exclusive fsynced intent containing the accepted plan and a fresh ownership nonce; it remembers the directory device/inode and exact intent bytes. It never adopts an existing path or intent. A crash between directory creation and durable intent leaves an unadoptable partial directory, not permission to replay.

Before event or success/failure result writes, the executor verifies the same canonical directory inode and exact intent. The first event file uses exclusive creation; subsequent appends require the same single-link regular inode and do not follow symlinks. In-memory preflight events flush only after ownership is proven. Both successful and handled-failure results use the ownership guard and exclusive `result.json` creation. If ownership changed, stdout still reports failure, while the foreign destination is untouched. The OS project lock and all existing no-replay semantics remain in place; no destination cleanup or lock stealing was added.

Nine new actual Python regression groups include both review witnesses, nested literal arrays/escapes/comments, dynamic/duplicate/trailing expressions, flat/foreign connection bindings, a deterministic preflight race with foreign intent/log sentinels, two concurrent different-project claimants sharing one destination, tampered intent and replaced event file, and deferred event flushing. Only one threaded claimant succeeds; the losing executor writes neither log nor result. Existing archive/readback, target projection, isolation, SQL stdin, timeout and redaction tests remain.

### V2 actual checks and frozen pins

- `node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts`: **1/1 Node wrapper PASS; 30/30 real Python tests PASS; 0 SKIP**, Python 0.591 s, wrapper 815.95 ms.
- The same checked-in harness piped through `wsl.exe --exec python3 -B - /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-target.py`: **30/30 PASS**, Python 0.302 s. It uses temporary local fixtures; Docker, remote DB, SSH and firewall commands were not run.
- `npm run check`: **PASS**.
- `scripts/recovery-target.py`: `c33a8f4777e2c623cc843bbc5b77e6b08863bc3b4ae1dbf201b01aae7d3112e1`.
- `tests/integration/recovery-target.test.ts`: `0b839c800bef0f36888857582edf7531994848d9f76a134b2b6748bc2d3fab49`.

V2 author status: **ready for independent review**, not self-accepted. Native Docker/MySQL/Bitrix recovery remains **NOT_RUN** by this author. Root is the sole native executor. Next step: independently retest the two rejected witnesses and the destination race against these pins, then derive a new accepted plan hash before any actual restoration; a V1 plan pin is invalid because the script changed.

## V3 — explicit clone settings derivation for a pinned static source DB

Separate task `native-restore-static-db-20260930`, worker `commerce-model`, fence 1; input artifact `art-68e57e7e-987d-4673-a1e3-9ae26cea1bb5`. This revision changes only the recovery runner, its tests and this report. Navigation changes were separately frozen before it began.

**Native V2 was reported FAILED by root**, with `RESTORED_SETTINGS_DB_BINDING_UNSUPPORTED` after successful files copy/readback and before firewall/SQL. The actual restored literal connection used `host=172.30.50.2`, `database=upgrade`; the source database has that static container IP. This is an integration compatibility failure, not a successful restore. It does not invalidate V2's local negative parser/race tests. The author did not inspect a real password/settings file or connect to the server. The failed destination remains intact and cannot be retried, adopted or deleted by this runner.

### Accepted-plan and runtime boundary

The pinned Compose projection now requires an explicit source DB IPv4 address on its sole isolated network. It must be in the source subnet and cannot equal the gateway, Nginx address, network or broadcast address. The execute path inspects the running source `db` container and the local Docker image named by the immutable Compose pin. Container service/ID, resolved image ID, sole network, and **exact source DB IP** must match. A different address in the same subnet is insufficient. No slot number such as `.2` is assumed by the implementation.

The new accepted plan explicitly includes:

```json
{
  "mode": "CLONE_ONLY_LITERAL_DB_HOST",
  "path": "bitrix/.settings.php",
  "database": "upgrade",
  "allowed_original_hosts": ["db", "<pinned-source-db-ip>"],
  "derived_host": "db",
  "required_source_binding": "PINNED_COMPOSE_STATIC_IP_AND_RUNNING_DB_IMAGE_NETWORK_IDENTITY",
  "backup_and_files_readback": "PRESERVE_ORIGINAL_BYTES_AND_LEDGER",
  "on_partial_destination": "REFUSE_REUSE"
}
```

The placeholder is replaced deterministically from the pinned Compose, and thus participates in `plan_sha256`. The changed executor SHA also changes the plan. V2 plan acceptance is not reusable. CLI flags are unchanged, but root must choose a new absent destination and fresh distinct clone resources, generate/review a new plan, and execute that exact pin.

### Exact clone-only transformation

The strict V2 literal grammar remains; the parser additionally records value-token positions. After extraction, the settings bytes must match the original file's exact SHA/length in the unchanged, hashed `files-readback.jsonl`. The only permitted original hosts are `db` or the exact attested source DB IP, and database must remain `upgrade`. Dynamic values, duplicate keys, unrelated hostnames/IPs and alternate databases still fail before mutation.

If the original host is already `db`, all settings bytes remain unchanged. Otherwise only the parsed `connections.value.default.host` literal is replaced by `'db'`; comments, strings elsewhere, credentials, formatting, Unicode and CRLF remain byte-for-byte identical. A synthetic regression repeats the source IP in a password and comments to prove they are not replaced. This is a documented configuration change inside the newly created clone, not a vendor PHP code patch or a source-target modification.

Before replacement, `private/settings-derivation-intent.json` is written exclusively and fsynced. It contains the host-only change, before/after settings SHA, source DB container/image/network binding, pinned source Compose SHA, original archive SHA, readback-ledger SHA and accepted plan SHA. It contains no settings body or credentials. Derived bytes are staged privately in the clone with the original file mode/ownership, then the owned directory, original settings inode and SHA are rechecked before atomic replacement. Linux directory metadata is fsynced. The resulting bytes are re-parsed and rehashed; the unchanged ledger is rehashed as well.

Only then is `private/settings-derivation.json` saved exclusively with `DERIVED_AND_READBACK_VERIFIED`, and a private event records receipt SHA and host/SHA metadata. Both files are mode0600 under the owned private destination. No extra plaintext copy of settings is introduced; the original bytes remain in the pinned copied archive. An interruption leaves intent and partial copy for inspection, never automatic replay.

The original archive and its per-file readback ledger are preserved. `FILES_READBACK` is explicitly recorded before the declared configuration derivation. Final successful results, if the remaining native SQL/HTTP/isolation checks pass, include `files_readback_scope: BACKUP_BYTES_BEFORE_DECLARED_CLONE_CONFIGURATION_DERIVATION` and the separate derivation receipt SHA. This avoids describing the post-derivation tree as identical to every original archive byte. Network guard, source-access isolation, one new DB volume, HTTP checks and no-real-order/mail boundaries are unchanged.

### V3 tests and frozen pins

Six added Python groups cover exact immutable-Compose/static-IP/runtime binding; rejection of a different address in the same subnet, foreign network and image; token-only Unicode/CRLF transformation; unchanged already-`db` bytes; foreign/dynamic/duplicate/database rejection; real temporary archive extraction followed by clone derivation with archive/ledger/other-file/mode preservation; missing plan policy/changed ledger/settings rejection before write; private hash-only receipts; and refusal to adopt the prior derived copy. The first test draft expected repeat derivation to reach exclusive intent creation; the implementation correctly refused earlier because derived bytes no longer match the original ledger. The assertion now requires that stronger `RESTORED_SETTINGS_READBACK_MISMATCH` refusal.

- `node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts`: **36/36 real Python tests PASS, 1/1 Node wrapper PASS, 0 SKIP**; Python0.829s, wrapper1067ms.
- Same checked-in harness through `wsl.exe --exec python3 -B - /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-target.py`: **36/36 PASS, 0 SKIP**, Python0.278s, actual Linux temporary files/atomic replacement/directory fsync. No Docker/server command was run.
- `npm run check`: **PASS**.
- `scripts/recovery-target.py`: `1bf1c8f84ecbe7548b676b81b5fbec633e0ebeacd8d40f57b6b72fb15bdbac5e`.
- `tests/integration/recovery-target.test.ts`: `90e4557f8674345ee0ed326c690e31e83b940b1b712e1a90bb6a49709b070f16`.

V3 native Docker/MySQL/Bitrix execution is **NOT_RUN by this author**. Root alone performs the new restore after independent review. The V1 rejection and actual V2 native failure remain historical facts; neither is relabeled PASS.

## V4 — pinned runtime database identity for dynamic source Compose

Separate task `native-restore-runtime-db-20260930`, worker `commerce-model`, fence 1; input `art-42ad773a-9f65-46f4-8ca7-6fc24fe3ba1f`. Only the same runner, test harness and report were changed. The author did not connect to Docker, a server, Store or target database, read real credentials, alter the source Compose, or reuse a failed restoration directory.

**Native V3 PLAN failed** with `SOURCE_FIXED_DB_IP_REQUIRED`, before destination writes. V3's description of the source address as statically configured was an incorrect assumption from its input, not an observed Compose property. The locally saved actual pinned Compose has `services.db.networks = {"isolated": null}`: `172.30.50.2` is the runtime allocation. The failed V3 plan remains failed; its earlier local tests exercised a synthetic static configuration and did not establish compatibility with the actual dynamic source. No Compose edit is used to conceal this difference.

### Explicit new baseline contract

Baseline `schema_version: 1` now requires `source_database` with **exactly** these five fields:

```json
{
  "container_id": "<full 64 lowercase hexadecimal Docker container ID>",
  "image_id": "sha256:<64 lowercase hexadecimal Docker image ID>",
  "network_id": "<full 64 lowercase hexadecimal Docker NetworkID>",
  "network_name": "upgrade-<source-project>-isolated",
  "ip_address": "<canonical private IPv4 from that container on that network>"
}
```

These are root-collected read-only Docker observations, not values to infer from service names, a presumed address slot or the installer configuration. Missing/extra fields, short/uppercase IDs, a repository digest masquerading as `image_id`, a foreign network name, noncanonical/nonprivate/loopback/link-local/multicast addresses are rejected. The baseline bytes remain subject to the existing explicit SHA pin and participate in the accepted plan hash.

`compose_plan` requires the baseline binding as an explicit argument. It retains the source Compose unchanged and places the exact five fields in `projection.source_database_binding`; `source_db_ip` is derived solely from this binding for the existing clone settings derivation. Dynamic `isolated: null` or an object without a fixed address is accepted. Any explicitly configured DB `ipv4_address` must agree with the baseline. The address must lie in the source /24 derived from the already-required fixed Nginx address and cannot equal the network, broadcast, gateway, Nginx, or another explicitly fixed PHP address. A bare Compose `sha256:` image ID must equal the baseline image ID at plan time. A repository/manifest digest is a different identity namespace; its corresponding Docker image ID is verified by actual `docker image inspect` during execute, never equated by string substitution.

Before `claim_destination` or any destination/resource mutation, execute obtains running source containers through the existing read-only inspection and resolves the immutable Compose DB image through `docker image inspect`. `attest_source_db` now compares the full container ID, actual container image ID, resolved image ID, sole network name, network ID and IP **exactly** with the pinned baseline. A recreated container with the same name/IP, a recreated network with the same name, another address in the same subnet, or a different image all fail. No new runtime value is written back into the baseline or accepted plan. Any legitimate change requires root to collect and pin a new baseline and accept a new plan for a fresh absent destination.

The clone-only configuration policy now records `required_source_binding: PINNED_BASELINE_EXACT_RUNNING_DB_ID_IMAGE_NETWORK_IP`. Its original/derived host rules, strict literal parser, token-only replacement, original archive/readback ledger, private hash-only receipts, ownership/race guards and failed-copy nonadoption are preserved. Derivation additionally checks the complete five-field attestation, not merely its IP/name aliases, before any settings write.

### V4 actual checks

- `node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts`: **41/41 real Python tests PASS, 1/1 Node wrapper PASS, 0 SKIP**; Python2.798s, wrapper2942ms.
- Same checked-in Python harness through `wsl.exe --exec python3 -B - /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-target.py`: **41/41 PASS, 0 SKIP**, Python0.275s. No Docker/firewall/network/SQL command ran.
- `npm run check`: **PASS**.
- Read-only `compose_plan` invocation against `var/evidence/continuation-20260930/restore-input/source-compose.json`, actual SHA `feca7f0b43284e5eae8f88bd63c563eb11cf83b39e2a06cd024054a5afa593ba`: **PASS** with `db.isolated=null`; exact source bytes unchanged and no destination created. This compatibility-only projection deliberately used synthetic full runtime IDs and is **not** a native attestation or accepted deployment plan.

Five added Python groups and the revised former static-only group cover the actual null-network shape without source mutation, required baseline schema, excluded/out-of-subnet addresses, disagreement with explicit Compose IP/image, every exact runtime identity drift (including changed network ID with the same name), plan-byte changes after baseline changes, and rejection of derivation-attestation tampering before private intent/settings writes. All previous parser, archive, readback, race, no-adoption, timeout and private-receipt checks remain passing.

Frozen V4 code/test pins:

- `scripts/recovery-target.py`: `4a9370663ca3112a30feb1702a18e6b53889f223415db98a84cfe768101947fd`.
- `tests/integration/recovery-target.test.ts`: `669b2bc085750ccf19b9e451d4b535f162db3984dfa280b0e0e617088cc30a57`.

V4 author status: **ready for independent review**. Native Docker/MySQL/Bitrix recovery remains **NOT_RUN by this author**. Root must supply freshly read exact runtime baseline fields, review the new plan hash, then execute into a new absent destination after independent acceptance. V3's failed plan and V2's failed copy are preserved.
