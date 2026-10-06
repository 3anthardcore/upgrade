# Current isolated runtime backup — implementation, 2026-09-30

**Current status: attempt 2, fence 2, fixed code frozen for independent re-review. Attempt 1 was REJECTED for silent nested directory enumeration failure.** Original implementation/pins/results below are retained as attempt-1 history; the attempt-2 delta and current pins are appended at the end.

Task `current-runtime-backup-20260930`, input `art-30e7d950-e777-4196-a8c2-07ad43076c29`; author `backup-engine`, fence 1. This author changed only the runner, its unit-test wrapper and this document. No server, target database, content Store or Git mutation was performed.

Local implementation verdict: ready for independent review. **Native current-state backup and private-state restore: NOT_RUN by this author.** Historical r12 recovery does not establish recovery of the current 389-page interactive target, its active pointer or HTTP sessions.

## Frozen implementation

| File | SHA256 |
| --- | --- |
| `scripts/current-runtime-backup.py` | `ecdda8d74d2f70312b5c6780a79b75011181b652b6d80c2e17ebd798de102708` |
| `tests/unit/current-runtime-backup.test.ts` | `42f334af3c77f6a38bcb67f0087f6862441fba3ab85d11e782b566a68f1327d3` |

The runner uses Python's standard library. Execution requires Linux/root. Planning reads the private profile, pins, active pointer/snapshot, Docker container/network inspections and a fixed read-only database query; it creates no destination, stops no container and performs no database writes. Root must review the resulting plan before authorizing its hash.

## Scope and command contract

```text
python3 scripts/current-runtime-backup.py --profile ABSOLUTE_PRIVATE_PROFILE --profile-sha256 PROFILE_SHA
python3 scripts/current-runtime-backup.py --profile ABSOLUTE_PRIVATE_PROFILE --profile-sha256 PROFILE_SHA --execute --accept-plan-sha256 ACCEPTED_PLAN_SHA
python3 scripts/current-runtime-backup.py --profile ABSOLUTE_PRIVATE_PROFILE --profile-sha256 PROFILE_SHA --execute --accept-plan-sha256 ACCEPTED_PLAN_SHA --resume-runtime-only
```

Placeholders above must come from verified files/JSON fields, not hand-transcribed example hashes. The profile is a canonical absolute regular file, single link, root-owned and inaccessible to group/other. Its externally accepted SHA binds the entire profile. The exact key set is:

- `schema_version: 1`, `project_id`, `target_id`.
- Absolute canonical, disjoint `cms_root`, `state_root`, `native_journal_dir`, `destination`. The journal directory's leaf is `target_id`. A new destination must not exist and its parent must be root-private. Destination cannot contain or be contained by any source root. No existing failed destination is adopted for another backup.
- `docker: {path, sha256}` and `guard: {path, sha256}`: pinned regular local executables/scripts. Guard invokes only `check`, with fixed marker root `/opt/upgrade/private/network-guards`; no firewall apply or network creation.
- `network: {name, id, bridge, subnet}`: exact full Docker network ID, `upgrade-PROJECT-isolated`, approved `br-upg…` bridge and private IPv4 `/24`. It must be an internal bridge, no IPv6, with exact subnet/bridge/project label. Each of the three source containers has exactly this network.
- `containers: {db, php, nginx}`. Each role is `{id, image_id, static_sha256, ip, running}`. IDs are full lower-case SHA-shaped Docker IDs; images use `sha256:…`. `static_sha256` hashes canonical JSON of `Id, Name, Image, Config, HostConfig, Mounts`, sorting `Mounts` by `Destination`. This normalizes enumeration order while preserving every mount/config field. Compose project/service labels, no automatic restart/privileged mode, expected CMS/state mounts and nginx CMS read-only flag are checked. The database must initially run. Source PHP/nginx may initially be stopped and are then never started by backup.
- `database: {name, cnf_path, cnf_sha256, dump_executable, query_executable}`. Name is exactly `upgrade`; approved tool paths are explicit mysql/mysqldump or mariadb/mariadb-dump paths. The CNF is root-private, outside the source/destination trees, at most 16 KiB, pinned. Its bytes are passed only via stdin. Fixed `--host=127.0.0.1 --port=3306 --protocol=TCP` constrain both clients to the pinned DB container. Credentials are never argv/stdout. Database existence and `event_scheduler OFF|DISABLED` are checked before downtime and during the snapshot.
- `active_pointer_sha256`: exact `state_root/demo-active.json`. Pointer project/target/schema/relative path, referenced snapshot SHA/project/schema/snapshot ID are verified against the actual DemoRuntime contract. Snapshot must be inside state, regular and at most 64 MiB.
- `limits: {max_files, max_total_bytes, max_file_bytes, command_timeout_seconds, stop_timeout_seconds}`. Limits are positive bounded integers; maxima are 500,000 entries, 64 GiB aggregate raw bytes, 16 GiB per file, 1,800-second command timeout and 300-second graceful stop timeout. Root should set materially smaller task-specific limits where possible. Files/directories are counted; all three trees are preflighted before SQL/archive creation. Aggregate totals include SQL. SQL stdout is drained with bounded memory and rejected before writing beyond its file budget.

`static_sha256` is computed from the complete **private** inspect response; the runner outputs only its digest and the supplied nonsecret profile, never inspect `Config` values. The source journal's existing `binding.json` must match project/target/container and `/var/www/html` plus `/var/lib/upgrade`. A wrong profile, pointer, network, mount, credential pin or acceptance hash fails before any stop.

Root independently reported that its actual 2026-09-30 read-only DB preflight succeeded with `/usr/bin/mysql`, `/usr/bin/mysqldump`, stdin CNF, event scheduler OFF and one `upgrade` schema. That is root-provided target evidence, not native execution by this author. The runner still repeats its own preflight during plan creation.

## Consistency and recovery behavior

Execution acquires the existing `native_journal_dir/transport-lock.sqlite` with `PRAGMA busy_timeout=0; BEGIN EXCLUSIVE`, matching `packages/bitrix-adapter/native.ts`. It also acquires the existing `state_root/upgrade-PROJECT.lock` via nonblocking flock, matching Gateway. It does not alter content Store SQLite, target fencing counters or native operation receipts. Both locks are held through snapshot and runtime recovery. A busy lock refuses admission before downtime.

The destination is exclusively created, parent and private receipts fsynced, and intent bound to a random nonce, directory device/inode, exact profile/plan/runner SHA. Later writes verify ownership and previous runtime-state bytes. Stop/start intent is persisted **before** dispatch. Only pinned full IDs for nginx then PHP are stopped; DB and foreign containers are never stopped. PHP then nginx restart only if originally running, still the same pinned container/config and only after guard/network checks. Existing stopped roles remain stopped. Identity or running-state changes outside the owned transition fail closed.

Once both frontends are confirmed stopped, SQL uses single-transaction/routines/triggers/events/hex-blob for the one DB. Archives contain every CMS file, **all private state**, and the full target-specific native journal, including pending/UNKNOWN records. There are no implicit exclusions. Historical `state/backups`, release packages and old intents may make this large; observed entry counts, raw/archive bytes and aggregate totals are included in the manifest. Directories and files retain mode/uid/gid metadata. Symlinks, hardlinks and special files are rejected. File descriptors, pre/post tree metadata and readback SHA ledgers detect source changes/truncation. On Linux, inode/device/ctime checks remain strict; the Windows-only local-test branch omits inconsistent lstat/fstat ctime semantics and cannot execute native backup.

The consistent-cut prerequisite is the existing sole-writer policy: all Upgrade native writers use the two locks, PHP is quiesced, DB scheduled events are off, and the privileged operator admits no foreign DB/filesystem writer. The runner is not a host-wide DB firewall or global SQL read-lock service. It does not establish exclusion of an unrelated privileged process that ignores these controls.

Normal failures restore original runtime in `finally`. Unknown stop is reconciled from the exact container: if actually stopped, one owned restart may restore it; if still running with an unresolved stop request, no duplicate stop/start is dispatched. Unknown start observed running is reconciled without a second start; unknown start still stopped requires operator reconciliation. Changed container IDs/config are never restarted. Explicit resume verifies the same original intent and only recovers runtime; it never retries copying, SQL or archive publication. Partial files/receipts remain private and are not promoted to success. A new backup requires a new destination and accepted plan. Even a completed backup is not re-executed.

## Outputs and boundaries

`database.sql`, `site.tar.gz`, `private-state.tar.gz`, `native-journal.tar.gz`, per-tree byte/hash ledgers, `snapshot-manifest.json`, `intent.json` and `runtime-state.json` remain root-private. A final `backup-receipt.json` is published only after every readback check and restoration of original runtime. It uses the historical SQL/CMS field format (`schema_version: "1.0"`, `INTEGRITY_VERIFIED`, absolute SQL/CMS paths and SHA), with manifest/plan references. `restore_test` and `production_recovery` remain `NOT_RUN`.

**Format compatibility is not direct recovery compatibility.** Current `scripts/recovery-target.py` requires receipt SQL/CMS paths under the original target `state/backups`; this runner intentionally stores its destination outside all source roots. Direct use by that historical recovery runner is therefore **NOT_SUPPORTED** and will fail its containment check. A separately reviewed bridge/new restore input policy plus private-state binding/remapping/session recovery is still required. This task does not weaken containment or modify the recovery runner. No destructive restore, session replay, lease reset, CMS install or activation is implemented here.

## Verification

Commands executed locally:

```text
node --test tests/unit/current-runtime-backup.test.ts
npm run check
git diff --check -- scripts/current-runtime-backup.py tests/unit/current-runtime-backup.test.ts
```

The Node wrapper executes the embedded Python unittest harness using the bundled Python, with a real temporary filesystem and child processes. Final Windows result: **39/39 Python checks PASS**, one Node wrapper PASS, zero failures/skips; `npm run check` and scoped diff check PASS. It covers real tar+SHA roundtrip/private-session+journal preservation, source mutation, hardlinks/corruption/bounds, private streaming SQL child, actual process timeout/error redaction, exact stop/start sequences, unknown outcomes, changed identity, corrupt/replaced intent/state, duplicate/refused destination, pointer/snapshot mismatch, default CLI planning and wrong accepted hash.

The same extracted harness was run with local `wsl -u root python3 -I TEMP_HARNESS /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/current-runtime-backup.py`; final result: **39/39 PASS, zero skips, 2.570 seconds**. This includes actual POSIX flock and SQLite lock-conflict branches. Windows keeps these two POSIX-only branches inapplicable rather than claiming Windows proved native flock. No test uses the actual target DB, Docker runtime or server credentials.

Native current backup consistency/downtime/actual dump, current private-state isolated restore, restored session/receipt behavior and true server crash/power-loss recovery remain **NOT_RUN**. Next step: independent frozen-code review, root constructs actual private profile/accepted plan, root-only execution with before/after runtime and HTTP evidence, then a separately scoped current-state restore implementation/test.

## Attempt 2 — fail-closed directory enumeration

Root persisted attempt-1 REJECT and renewed the same task as `backup-engine`, fence 2. Historical author artifact: `art-47754e09-e2ab-4e0f-a16c-02b6f416d6ee`; independent review input: `art-3f70d45c-ed1c-4bd0-919b-97497a952740`. The prior review is not relabeled PASS.

The independent witness creates a real nested file, then makes `os.scandir(nested)` raise `OSError(EIO)`. Python `os.walk` without `onerror` silently skipped the subtree in every inventory. Consequently, the original runner could archive an empty nested directory and publish `INTEGRITY_VERIFIED` with `exclusions: []`. This was a real completeness defect despite passing the original 39 tests.

The production delta is limited to `tree()`: every `os.walk` receives an `onerror` callback that raises the fixed, redacted `TREE_ENUMERATION_FAILED` error. All global preflight, pre-archive and final inventories share this path. There is no retry, omission, new exclusion or success fallback. Existing failure handling restores only the originally running pinned containers and retains a failed private attempt. No source locks, identity checks, UNKNOWN reconciliation rules, native profile contract or restore boundaries were weakened.

Three new regressions use a real `nested/private-important.php` and actual filesystem archiving with an injected scandir EIO:

1. Persistent EIO on every enumeration (exact omitted-subtree witness).
2. EIO only on the second nested enumeration, before archiving.
3. EIO only on the third nested enumeration, during the final inventory.

All three require `TREE_ENUMERATION_FAILED`, unchanged original file SHA, all originally running fixture containers restored, `BACKUP_FAILED_RUNTIME_RESTORED`, and **no** `backup-receipt.json` or `snapshot-manifest.json`. Before the fix, the persistent case failed because no error was raised and an incomplete backup was accepted. The two transient cases were already stopped by a later tree mismatch, but failed the precise enumeration-error assertion. That distinction is preserved rather than claiming three false-success cases.

Current pins:

| File | SHA256 |
| --- | --- |
| `scripts/current-runtime-backup.py` | `38f46b290f1cd2c64585e613c2fae35d8e150e99c859322e51517f6941915389` |
| `tests/unit/current-runtime-backup.test.ts` | `6f49d3863efb6379ca83666d76b329427a8f94a1faeb8567e2cd6cf3e7e3a5cc` |

Repeated `node --test tests/unit/current-runtime-backup.test.ts`: **42/42 actual Python checks PASS on Windows**, one Node wrapper PASS, zero skips/failures, 11768.8944 ms. The same final harness under local WSL/root Python: **42/42 PASS, zero skips, 2.603 seconds**, including actual POSIX flock/SQLite conflict paths. `npm run check` and scoped diff check PASS. Native target execution and current private-state restore remain NOT_RUN by this author. Root will repeat the unchanged independent witness against the new pin before any native execution.
