# Current private runtime restore — 2026-09-30

**Current attempt: 2, fence 2. Attempt 1 was independently REJECTED for rejecting a harmless vendor PHPSESSID on the retained-receipt GET.** Original pins and verification below remain attempt-1 history. The attempt-2 correction, current pins and test results are appended at the end. Native current restore remains NOT_RUN by this author.

Task `current-state-recovery-20260930`, owner `recovery-engine`, fence 1; accepted task input `art-dcc17d87-8a08-4d2f-9936-0d49f3706c6f`. Scope: new runner, its unit-test wrapper, this report and ignored local evidence. The author did not access the server, target database or authoritative Store and did not modify the accepted backup/historical restore runners.

**Author verdict: implementation frozen for independent review. Native current-state restoration: NOT_RUN.** Local tests use real Python files, archives, hashes, subprocess timeouts and a local HTTP listener; Docker, SQL and CMS execution in the orchestration test are explicit fakes. Historical isolated recovery of r12/103 pages does not establish recovery of the present 389-page interactive snapshot.

## Pins

| File | SHA256 |
| --- | --- |
| `scripts/recovery-current-runtime.py` | `78ef9223d31decb135732702d725f2755bb00c9ef490c708e1b582314cc07944` |
| `tests/unit/current-runtime-recovery.test.ts` | `f7e4da685bc4e49ce7b23f6ec50ad2a1952b7f897417ecdb18fc67126a1c57e7` |
| Required existing `scripts/recovery-target.py` | `b1c95c5150d668417b268b708c7f49e81c7fe4d346b6c346d5dc386dc7a2ade6` |
| Required existing `scripts/current-runtime-backup.py` | `38f46b290f1cd2c64585e613c2fae35d8e150e99c859322e51517f6941915389` |

Both existing Python helpers must be present beside the new runner at exactly these hashes. Import checks their bytes before loading; Python bytecode creation is disabled. The historical runner's restriction to `state/backups` is unchanged. External current backups are admitted only by this separately reviewed entrypoint.

## Invocation and acceptance

Default command is read-only planning:

```text
python3 scripts/recovery-current-runtime.py 
  --project PROJECT --target-id SOURCE_TARGET 
  --source-root /opt/upgrade/targets/PROJECT 
  --source-compose ABSOLUTE_CONFIG_JSON --source-compose-sha256 COMPOSE_SHA 
  --receipt ABSOLUTE_EXTERNAL_BACKUP/backup-receipt.json --receipt-sha256 RECEIPT_SHA 
  --snapshot-manifest-sha256 MANIFEST_SHA 
  --baseline ABSOLUTE_PRIVATE_BASELINE_JSON --baseline-sha256 BASELINE_SHA 
  --destination /opt/upgrade/recovery/NEW_COPY 
  --clone-project DISTINCT_DOCKER_PROJECT --subnet FREE_PRIVATE_24 --bridge DISTINCT_BR_UPG 
  --guard EXACT_BACKUP_PROFILE_GUARD_PATH --guard-sha256 GUARD_SHA 
  --auth-password-file ROOT_PRIVATE_AUTH_FILE --auth-user upgrade
```

This is an argument contract; shell continuation characters are intentionally omitted. Root should construct argv from verified JSON fields and file hashes. Do not hand-copy example hashes. The accepted plan includes the runner/helper hashes, input pins, complete backup profile, new infrastructure projection, configuration pins, baseline, authentication-file hash and derivation policy. Add `--execute --accept-plan-sha256 EXACT_REVIEWED_PLAN_SHA` for execution. The runner requires Linux/root and the historical exclusive project lock, then atomically claims a **nonexistent** destination. Existing destinations, including failed or incomplete attempts, cannot be reused or adopted.

Only the original target root `/opt/upgrade/targets/PROJECT` and a new direct child of `/opt/upgrade/recovery` are supported. Destination, source roots, external backup and optional cookie file must be disjoint. Source PHP/nginx/DB must be the original three running containers. A source originally stopped at backup time is currently unsupported and rejected. No source container stop/start, source SQL command, importer invocation or external content Store mutation is dispatched.

## External backup admission

The external directory and all backup artifacts are root-private regular files without links. The receipt and snapshot manifest require independent SHA pins. Their project/target, completed integrity status, restored source runtime, accepted backup-plan SHA and manifest references must agree. `intent.json` must contain the accepted current-backup runner pin; its plan/profile must match the receipt. `runtime-state.json` must be `COMPLETE`, `runtime_restored: true`, and bind that exact intent. Unknown/failed/pending backups are refused.

The only accepted outputs are `database.sql`, `site.tar.gz`, `private-state.tar.gz`, `native-journal.tar.gz` and each archive's `.ledger.json`. Every filename must be the exact file under the external backup root. The manifest must declare the full SQL/CMS/private-state/journal scope and no exclusions. SQL has a pinned hash and complete dump marker. Every archive and ledger hash, entry count, raw/archive byte count and combined total are checked. The original backup's explicit limits remain in force: at most 500,000 entries, 64 GiB aggregate uncompressed bytes and 16 GiB per file; root may have chosen lower limits. JSON ledgers have a separate 256 MiB cap.

Planning streams the archives without extraction. Execute revalidates the bundle and then makes private, hash-checked input copies. Extraction accepts only exact regular files/directories from the ledger; traversal, path aliases, duplicates, missing/extra members, file-as-parent collisions, sparse/link/special entries, setuid-style modes and invalid UID/GID are rejected. Files use exclusive creation, bounded streaming, fsync and SHA readback. Every restored tree is enumerated through the accepted fail-closed helper, including its nested-scandir error handler. Modes/UID/GID are restored on Linux, including directory/root metadata. Parent directories are fsynced. A partial extraction is retained privately on failure, never promoted to success.

CMS goes to `cms-root`; **all** private state, including old backups/packages/intents and current session files, goes to `state`. No private JSON path, lease, budget, operation, UNKNOWN state or journal binding is rewritten/reset. Absolute historical paths within audit data remain historical. Native journal goes to `source-journal-audit`, retains exact bytes/source bindings, is not mounted into any container, and is not supplied to an importer/native transport. Its filesystem bytes are rechecked after HTTP verification.

## Isolated execution and source preservation

The accepted historical Compose whitelist is reused. The Docker project, volume, network, bridge and subnet are new. All container bind mounts point inside the new destination; no journal mount, host socket or source mount is added. No host port is published, restart policy is disabled, DNS is local-only, images are pinned and pulled with `never`. Secrets/configuration are copied under protected clone parents; the only nginx change is the declared exact trusted-gateway token.

PHP application `UPGRADE_PROJECT_ID` **and** `UPGRADE_TARGET_ID` deliberately retain the source application identity so the restored `demo-active.json` and sessions remain valid. This does not reuse Docker resource identity or activate the archived native transport. The target's actual DB container/image/network/IP must match both the accepted backup profile and the baseline. Full source container `Config`, `HostConfig`, mounts, image and identity are checked against backup profile hashes before/after; mount enumeration order is normalized. Source networking is checked against its exact internal network ID/labels/subnet/bridge.

The only CMS-byte derivation is the already-reviewed inert PHP literal parser replacing the original attested DB host token with literal `db`, inside the fresh clone's `bitrix/.settings.php`. Dynamic PHP expressions, foreign hosts or a changed original settings readback are rejected before guard/database/PHP dispatch. Original SQL/archive/ledger and source settings remain unchanged. A private derivation intent/receipt records original/derived SHA and source DB attestation. This declared configuration derivation is not a claim that all post-bootstrap CMS bytes stay equal to the backup.

Order: exact source attestation → new private destination → verified inputs and all trees → pointer/session checks → declared settings derivation → managed network guard apply/check → new clone DB → one SQL import → table/entity readback → source DB positive socket control → guard check → own pre-CMS PHP isolation probe → clone PHP/nginx → HTTP GET checks → final counts, active pointer, audit journal, source identity and guard checks. No CMS bootstraps before the own PHP isolation probe. Guard failure prevents subsequent starts; unknown SQL/process outcomes never trigger an automatic second import or adoption. Source services are never quiesced by this restore runner.

Free-space admission reserves all expanded/copy bytes, SQL expansion and an additional 2 GiB on host/Docker storage. This is a floor, not proof against future disk exhaustion. Root remains responsible for sole-writer policy while creating the source backup and for a free reviewed clone subnet. There is no automatic resource cleanup or automatic recovery into an already used destination. Failed copies remain isolated evidence for root reconciliation; a new attempt requires a new destination/project/network and reviewed plan.

## Current snapshot and retained synthetic receipt

The baseline retains the historical schema (`source_database`, table counts, optional stable entity identity, trusted Host, prepend hash, positive factual HTTP page plus missing-page case). Add:

```json
{
  "current_state": {
    "active_snapshot": {
      "relative_path": "EXACT_RELEASE/data/demo-snapshot.json",
      "sha256": "EXACT_MANIFEST_VALUE",
      "snapshot_id": "EXACT_MANIFEST_VALUE"
    },
    "retained_receipt": null
  }
}
```

`active_snapshot` must equal the backup manifest. After extraction and again after HTTP, the actual pointer SHA/project/target/relative path and snapshot bytes/project/ID are validated. The excerpt contains placeholders and is not a usable baseline.

For actual retained-receipt verification, replace null with an object containing exactly `cookie_file`, `cookie_sha256`, `operation_id`, `response_sha256`, `http_body_sha256`. Cookie file is root-private, bounded and pinned; its value is a 64-hex existing session token, never argv/log output. `operation_id` is the saved SHA256 idempotency-key identifier. `response_sha256` is SHA256 of the saved operation's exact PHP JSON representation (`JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`, original property order). `http_body_sha256` is the existing authenticated receipt page body SHA from GET with that same session.

The session filename is derived from SHA256(project + NUL + cookie). The restored envelope checksum, project/session binding, operation and response SHA must match. Only an existing `RECORDED_LOCALLY_SYNTHETIC` response with `native_order_created`, `message_sent` and `payment_attempted` all false is accepted. The runner sends only authenticated **GET** `/__upgrade/receipt?operation=…`; it requires HTTP 200, exact body SHA, private headers, no replacement cookie and unchanged session-file bytes. No cart mutation, checkout, lead, payment, native-order write or receipt replay is performed. If no retained receipt baseline is supplied, all archived session bytes are still restored but `retained_receipt_http` is explicitly `NOT_RUN`.

## Executed local verification

```text
node --test tests/unit/current-runtime-recovery.test.ts
npm run check
git diff --check -- scripts/recovery-current-runtime.py tests/unit/current-runtime-recovery.test.ts
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-state-recovery-20260930/contract.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-current-runtime.py
```

Final Windows run: **41/41 actual Python checks PASS**, one Node wrapper PASS, zero failures/skips, 45.726 seconds Python / 45922.6419 ms wrapper. WSL/root Python repeat: **41/41 PASS**, zero failures/skips, 3.341 seconds. TypeScript check and scoped whitespace check PASS. The ignored `contract.py` is the exact extracted test harness, not another implementation.

The first local run had 32 passes and four failures: fixture serialization sorted nested session keys after computing the PHP-order checksum. The fixture was corrected to preserve exact PHP JSON order; the production checksum guard was not weakened. Five additional checks cover pinned ledger absence, projection/app identity, unsafe projection refusal, plan-only CLI dispatch and invalid HTTP receipt responses. Final counts are 41, not the earlier 36.

Checks include real accepted-backup archives through extraction; unchanged source bytes; retained old state and UNKNOWN journal; corruption/traversal/link/collision/UID/mode/bounds; nested EIO; exact declared settings rewrite and foreign-host refusal; guard-before-PHP/DB sequencing; unknown SQL single-dispatch/no replay; foreign intent/destination refusal; subprocess timeout; private retained receipt hashes and project binding; actual local HTTP GET/cookie/no session change; wrong body/replacement-cookie rejection. Full-flow fake Docker checks do not establish native Docker attestation, SQL restoration, Bitrix bootstrap or firewall behavior.

**Remaining execution gates:** independent frozen-code acceptance; root's actual current backup/manifest/baseline pins; root-reviewed new plan; native exact container/network/image checks; real restore/readback and optional retained HTTP receipt; native source runtime/HTTP preservation. External packet capture and production recovery remain NOT_RUN. A current isolated restore PASS would cover its pinned snapshot only and would not resolve partial source coverage, missing source media, commercial semantics or project-wide DEMO_READY.

## Attempt 2 — narrowly discard a vendor PHP session cookie

Root renewed `current-state-recovery-20260930` as attempt 2, `recovery-engine`, fence 2, adding independent review `art-bdb6d15f-568a-48b1-84cc-ae77ef56d9b4`. V1 REJECT remains recorded in `docs/reviews/current-recovery-independent-20260930.md`. The independent original localhost witness had an exact successful body and unchanged own session, but returned one `PHPSESSID=fixture_vendor_value; path=/; HttpOnly; SameSite=Lax`; V1 wrongly failed the entire receipt. Root separately observed the same native vendor-cookie behavior with an alphanumeric 32-character value, two stable 11907-byte receipt responses and unchanged own session. Those are root-supplied observations, not native calls by this author.

The only production delta is the receipt-response cookie boundary. `discarded_vendor_cookie` examines **all raw** `Set-Cookie` header tuples before the remaining private-header dictionary is built. Zero cookies is still valid. At most one cookie is supported, with:

- Exact case-sensitive name `PHPSESSID`.
- Header length at most 256 ASCII bytes; value length 1–128 valid cookie octets. Underscores in the original independent fixture remain valid. Controls, whitespace inside the value, quotes, comma, semicolon, backslash and non-ASCII are refused.
- Exactly one each of `Path=/`, `HttpOnly` without a value, and `SameSite=Lax`; attribute names and the SameSite value are case-insensitive and attribute order may vary. Duplicate attributes, additional attributes, wrong paths or alternative SameSite policies are outside this deliberately narrow contract.

Any replacement of `upgrade_demo_session`, unknown cookie name, duplicate header (including duplicate vendor headers), combined cookie header, malformed header or repeated attribute is rejected. Both header orders are checked: an earlier own/malformed cookie cannot be hidden by a later valid vendor header. The vendor value is never logged, returned in a result, saved to a cookie jar or supplied to another request. Successful evidence records only the fixed name `PHPSESSID` as ignored. The request continues to send exactly the pinned own cookie; there is no automatic cookie handling or redirect following.

GET-only behavior, actual body SHA, unchanged saved-session SHA, private headers, source-preservation checks, archive/extraction/ownership, database/network controls and no-replay behavior are unchanged. No CMS, source, Nginx, database or server changes were made. Other future vendor-cookie formats require an explicit reviewed contract update; they are not silently admitted.

Current frozen pins:

| File | SHA256 |
| --- | --- |
| `scripts/recovery-current-runtime.py` | `83439149bf74bd1c9563cea166d657636ca38658f88dd550b95b010aa0a17d62` |
| `tests/unit/current-runtime-recovery.test.ts` | `ca1d38a303d584c9e187f6292816a933fb732f4ce32c80c2866d649bb1b7f70f` |

Both required helper pins remain unchanged. Four new test groups add 18 accepted value/attribute-order combinations, 23 rejected value/attribute variants, raw duplicate/both-order refusals, real localhost HTTP responses with the harmless vendor cookie, two successive requests proving no vendor replay, unchanged own session bytes, absence of vendor value in events and real HTTP duplicate-header refusals. Original body-tamper, own-cookie replacement and session-mutation failures remain required.

Commands actually executed for attempt 2:

```text
node --test tests/unit/current-runtime-recovery.test.ts
C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -I var/evidence/current-state-recovery-20260930/independent-v2-pinned.py scripts/recovery-current-runtime.py
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-state-recovery-20260930/contract-v2.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-current-runtime.py
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-state-recovery-20260930/independent-v2-pinned.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-current-runtime.py
npm run check
git diff --check -- scripts/recovery-current-runtime.py tests/unit/current-runtime-recovery.test.ts
```

Results: **45/45 author Python checks PASS** on Windows (65.439 seconds; Node wrapper 65646.6104 ms) and WSL (4.189 seconds), zero failures/skips. The independent reviewer's **original 11 assertions all PASS** on Windows (2.560 seconds) and WSL (1.785 seconds). The original review file is unchanged; the owned `independent-v2-pinned.py` is a copy with only its literal expected runner SHA replaced by the new frozen SHA. A first direct run of the unchanged original fixture correctly stopped at `REVIEW_PIN_CHANGED`; that input-pin refusal is preserved in `independent-original-v2.log` and is not called a behavioral test result.

Scoped whitespace check passed. The latest global TypeScript invocation reported two errors in the concurrently edited, out-of-scope `tests/integration/standard-commerce.test.ts:70` (`ContentEntity[]`/`PlannedRoute[]` versus Bitrix input index signatures). The error was sent to root and its owner; this author did not change their files or claim that invocation passed. Current recovery's Node/Python suite itself passed. Root must rerun the shared check after its parallel edit settles.

All attempt-2 outputs/logs are separate under `var/evidence/current-state-recovery-20260930/`; earlier evidence is retained. This is author regression evidence awaiting independent V2 acceptance. **Native current-state restoration, actual restored Bitrix receipt, packet capture and production recovery remain NOT_RUN by this author.** Root alone may execute a reviewed new plan against the actual backup after independent acceptance.
