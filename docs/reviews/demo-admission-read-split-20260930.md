# Demo admission: read-only split, author evidence

Date: 2026-09-30. Task: `demo-admission-read-split-20260930`, owner `runtime-engine`, fence 1. Input: `art-ad740d8b-9fa5-4dd7-9be9-8c84d4eb3d65`. This is an implementation report awaiting independent acceptance. No server, source network, CMS, target database, Store, FPM or cache configuration was changed.

## Change and safety boundary

`DemoRuntime::handle` first executes GET/HEAD with an engine copy that cannot write. `DemoEngine::readOnlyCopy()` preserves the validated snapshot and paths but irreversibly sets a private flag on the copy. Every potentially creating session API is stopped at `locked()` before opening or chmodding a file. `save()` has a second guard. Only existing-only session/receipt calls and in-memory search can finish on that copy. Their existing per-session lock, envelope integrity, session binding and receipt checks remain in place.

When that restricted attempt requires a write, it throws the dedicated internal `DemoAdmissionRequired` class. `DemoWeb` rethrows only that class; corruption, missing locks and all ordinary errors retain their normal fixed HTTP errors. `DemoRuntime` catches the internal signal, obtains the original exclusive admission gate, scans quotas, and then runs the original write-capable handler. It does not return any tentative headers or cookie from a failed attempt. All POST requests take the original gate immediately, including invalid requests and idempotent replays. Other methods also retain the original gated path.

This is an effect guard, not a route allowlist or cookie-existence authorization. A GET with an unknown, deleted or invalid cookie cannot fall through to an ungated session creation. A restricted attempt that required a write always reserves new-session capacity during the retry. Even if the old cookie's file reappears while waiting, that file cannot waive this reservation. The rare reappearance case can conservatively reject at quota rather than resume; it never exceeds the quota.

Pure search, non-product content, fixed GET errors, non-creating HEAD responses, existing product/cart/lead sessions and existing receipts do not take the global exclusive gate. Existing session reads still take their exact session lock and can still return a bounded busy error. They do not rewrite state. An unrelated malformed file or exhausted global quota no longer blocks a read that does not write; every admission for mutation or creation still scans retained files and enforces the original limits. There is no eviction or pruning.

The snapshot loader, exact pinned byte hashing, engine snapshot validation, session file format, atomic rename/commit, operation retention, CSRF, Origin, source facts, money rules, quotas and real-effect restrictions are unchanged. The normal engine remains an internal write-capable API; this change does not make arbitrary PHP callers a security sandbox. The application HTTP entry point must continue to call `DemoRuntime::handle`.

## Actual local verification

PHP 8.3.35 on Windows, real separate PHP processes, real filesystem files and `flock`; network/process execution functions disabled in the PHP harness. The harness's namespaced `flock` observer delegates to the real OS call and only emits a marker after an actual lock attempt fails. It does not simulate contention or skip locking. No native Bitrix bootstrap was run.

Commands:

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-runtime-admission.test.ts tests/integration/demo-engine.test.ts tests/integration/demo-web.test.ts tests/integration/demo-snapshot.test.ts
npm run check
& var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demoengine.php
& var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demoweb.php
& var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demoruntime.php
```

Final result: **69/69 PASS, 0 FAIL, 0 SKIP**, 16.874 seconds. This includes 14 new admission cases and 55 existing Engine/Web/Snapshot cases. TypeScript check and all three PHP syntax checks passed.

The new cases prove:

- A read-only engine copy, including a copy of that copy, rejects `openSession`, legacy potentially creating `cart`, and `mutate` before JSON or lock-file creation. Unknown existing-only reads return null with no files.
- Pure reads, malformed GET inputs, unsupported GET actions, unknown receipts, and unknown-cookie HEAD finish while another process still holds the global gate. No cookie is emitted or state created.
- Known product/cart/lead/receipt and HEAD reads finish under a held global gate; the committed state bytes remain identical. The synthetic lead receipt is the actual committed record. Cart operation receipts remain accessible through their cart route.
- Unknown-cookie product GET waits for admission and then creates a fresh server-chosen token. It never adopts the supplied token.
- POST, invalid-cookie POST and exact replay all wait for the global gate. Exact replay leaves revision and stored bytes unchanged.
- A proven blocked session reader holds no admission gate. A blocked session writer does hold it. Unrelated content and search finish in both situations while the blocked request remains pending.
- Two concurrent unknown GETs racing from 999 retained JSON files admit exactly one new session, retain all prior files and reject the other at 1000. The prefilled files are inert quota fixtures, not 999 fabricated valid receipts; the quota intentionally counts every retained `.json` without decoding unrelated sessions.
- A session deleted during an existing-only read cannot resurrect at the exhausted quota. A cookie file restored during admission wait cannot waive the required capacity reservation.
- An existing-session mutation remains possible at exactly the session-count quota; another new session is rejected.
- Retained 140 MiB crash residue blocks new sessions and mutations under the original byte quota. Existing receipt reads stay readable without changing those bytes or removing the residue.
- More than 5000 retained files blocks all writes; nothing is deleted.
- Corrupt or missing-lock session state returns the fixed 500 error with no reset, no new cookie, and no fallback admission attempt.

During authoring, two initial assertions incorrectly requested a cart operation through the synthetic-record receipt endpoint and correctly received 404. The fixtures were corrected to create an actual synthetic lead first; application behavior was not relaxed. An initial TypeScript union-property assertion was also corrected in the test. The final commands above were rerun after all code and test changes.

## Local performance observation, not a native benchmark

The previously accepted diagnosis's `fresh-run.mjs`, `concurrency.php` and `profile.php` were copied unchanged into this task's own evidence directory and rerun against the frozen implementation. No old evidence was overwritten. The fixture uses the same pinned 389-item snapshot, 100 existing sessions, separate cookie per worker, fresh snapshot load/hash/decode and engine construction on every synthetic request, with ten rounds of search/product/content per worker.

```powershell
node var/evidence/demo-admission-read-split-20260930/fresh-run.mjs --independent-sessions
```

All **900/900** local synthetic requests returned status 200. `gated-fresh` is the historical harness mode name for calling Runtime; after this change its pure reads use the restricted path and do not acquire the global gate.

| Runtime fixture | Prior diagnosis median / p95 ms | New median / p95 ms | New requests |
|---|---:|---:|---:|
| 5 workers | 74.205 / 174.126 | 46.387 / 72.440 | 150 |
| 10 workers | 106.276 / 399.436 | 47.166 / 77.815 | 300 |

The new direct-Web control measured 48.204 / 79.032 ms with 5 workers and 51.677 / 87.453 ms with 10 workers. These are separate local runs, affected by scheduling; Runtime measuring slightly faster than its direct control does not imply a faster intrinsic algorithm. The lock-boundary tests are the causal evidence. This profiler omits HTTP, TLS, Bitrix bootstrap, SQL, Nginx and FPM. It proves neither the native p95 nor native throughput after deployment. Existing native measurements remain historical and unchanged.

## Frozen pins and evidence

| File | SHA-256 |
|---|---|
| `bitrix/module/upgrade.core/lib/demoruntime.php` | `0e017408dec178ae5238afcb8c5f7dae63c6f72869294289fd3c0e59115efee0` |
| `bitrix/module/upgrade.core/lib/demoweb.php` | `2dd119124a437e4ce5bddf787930c8be632b86b5aa83fdcc2fb7b8af3834521c` |
| `bitrix/module/upgrade.core/lib/demoengine.php` | `d90d6ecc8858ca0305064304227b345e70479b3dd38a4b1afa00e6ca362eb905` |
| `tests/integration/demo-runtime-admission.test.ts` | `3cfd35d9e4877f8e758b7be1679162925b551ef4db27b8748208e7caf43f8a98` |
| `var/evidence/demo-admission-read-split-20260930/targeted-tests.log` | `7fa00113af9a77aaeba6d57992ad03dd1824286234692792fca66142e83b1236` |
| `var/evidence/demo-admission-read-split-20260930/typecheck.log` | `52047e4e2fd4dc882cff78211cb1676d757caf9d13a5d278d05f40582bf43314` |
| `var/evidence/demo-admission-read-split-20260930/fresh-result-v4-independent-sessions.json` | `fd8ce6d5e82f988ae4242855b4109072cef93a3bb3ec6264df5e8efffc02d0b8` |

Raw worker results, per-batch summaries and the runnable profiler are preserved in the same evidence directory. `pins.json` binds source, tests, report, command logs, profiler inputs and results. The old performance evidence and old sealed releases remain untouched.

Checks for an independent reviewer:

```json
[
  {"id":"demo-admission-read-only-effect-boundary","status":"PASS","details":"Actual PHP restricted-copy and held-gate tests; readonly execution cannot create or save; ordinary failures do not authorize fallback."},
  {"id":"demo-admission-atomic-quota-and-retention","status":"PASS","details":"Actual concurrent last-slot admission, disappearing/reappearing session, byte/file quotas, exact retained receipts and POST replay."},
  {"id":"demo-admission-native-runtime","status":"NOT_RUN","details":"No server/CMS/FPM/DB changes or native HTTP measurement in this author task."}
]
```

Next: independent code/test review, root's full suite and staged release acceptance, then root-controlled native HTTP/browser/replay checks and a comparable sequentially scheduled native measurement. This change alone does not change source coverage, resolve missing documents or promote readiness.

## V2 — file-slot reservation after independent rejection

2026-09-30, author retry attempt 2, fence 2; new input independent review `art-499197b9-d4a1-415e-bf96-a33f1855b93d`. The preceding sections and their V1 pins/results are retained as history. **V1 was independently REJECTED for F1**: the inherited scan rejected only an already observed count greater than 5000, so a new session admitted at 4999 files could leave 5001. The earlier 69 passing cases did not cover this boundary and did not establish the hard file ceiling. The independent report and its failing V1 log were not changed.

V2 adds one pre-dispatch check inside the existing exclusive admission gate: `files + (known ? 1 : 2) <= 5000`. A new session reserves its lock plus pending/committed JSON; atomic rename turns the pending file into the committed name without adding another entry. An existing-session POST reserves one pending file beside the old JSON and lock. Exact POST replay reserves conservatively as well. The failed-read attempt still cannot use a reappearing cookie to waive the creation reservation. Ordinary read-only requests do not enter this path.

The ceiling covers the transient write peak and failed-write residue, not just the final successful state. No old file, session, pending evidence or receipt is evicted or reset. `DemoEngine` and `DemoWeb` are byte-for-byte unchanged from V1; the only production V2 change is the Runtime check and its explanatory comments.

Nine additional actual-PHP cases cover:

- New-session creation at 4998/4999/5000 entries: 4998 succeeds with an observed peak/final count of 5000; the other two refuse without creating files.
- Existing-session writes at 4998/4999/5000 entries: the first two succeed with peaks 4999/5000 and unchanged final membership; 5000 refuses with exact old state bytes preserved. Existing reads still succeed.
- Three separate PHP creators compete for the last two file slots. Exactly one succeeds, two receive `DEMO_STATE_FILE_QUOTA`, and final/peak membership is 5000.
- A failed new-session rename leaves exactly the new lock and actual pending JSON within 5000, emits no session cookie, and blocks another creation. Search remains readable.
- A failed existing-session rename retains its actual pending file at 5000, leaves the committed session and synthetic receipt exact, and rejects both the next mutation and a conservative POST replay. GET receipt readback still succeeds.

The test harness observes the real directory entry count after the actual pending write/fsync and immediately before the real native rename. Its opt-in failure raises at that boundary, leaving the actual pending file on disk. This is a controlled local commit-failure injection, not a claim that an actual disk-full condition or native CMS failure was exercised. Production code contains no test hook.

Commands:

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-runtime-admission.test.ts tests/integration/demo-engine.test.ts tests/integration/demo-web.test.ts tests/integration/demo-snapshot.test.ts var/evidence/demo-admission-independent-20260930/probes.test.ts
npm run check
& var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demoruntime.php
```

Result: **86/86 PASS, 0 FAIL, 0 SKIP**, 29.668 seconds. This is the previous 69 author checks plus nine new boundary/failure checks plus the eight **unchanged** independent assertions. F1's former 4999→5001 witness now passes with no admitted creation. TypeScript check and Runtime PHP syntax check pass.

| V2 file | SHA-256 |
|---|---|
| `bitrix/module/upgrade.core/lib/demoruntime.php` | `4b6ccd70cd6f5b716720492dbe4517781421d4959de256c548ec8cff5d6fed26` |
| `tests/integration/demo-runtime-admission.test.ts` | `4c340a62d9ec12cc55d575a749efccd53f90b2933fa34c4743ac62b36dfd2996` |
| Unchanged `bitrix/module/upgrade.core/lib/demoweb.php` | `2dd119124a437e4ce5bddf787930c8be632b86b5aa83fdcc2fb7b8af3834521c` |
| Unchanged `bitrix/module/upgrade.core/lib/demoengine.php` | `d90d6ecc8858ca0305064304227b345e70479b3dd38a4b1afa00e6ca362eb905` |
| Unchanged independent `var/evidence/demo-admission-independent-20260930/probes.test.ts` | `8ab650997b12eadc441ac60658d029464c259d45c5bb3574f891fa16e01bc142` |

New raw output and pins are under `var/evidence/demo-admission-read-split-20260930/v2/`; the V1 logs, profiler result and original `pins.json` remain untouched. The prior local benchmark was not rerun for this write-admission-only correction and remains explicitly V1 evidence. No native performance result is inferred from it.

```json
[
  {"id":"demo-admission-file-ceiling-reserves-write-effects","status":"PASS","details":"4998/4999/5000 creation and existing-write boundaries, real pre-rename peak <=5000, concurrent final slots and failed pending retention; unchanged independent F1 witness now passes."},
  {"id":"demo-admission-read-only-and-receipt-regressions","status":"PASS","details":"All prior 69 checks plus independent eight pass; pure reads remain ungated and exact stored receipts survive write-failure residue."},
  {"id":"demo-admission-native-runtime","status":"NOT_RUN","details":"Author retry changes only own Runtime/tests/report; no server/CMS/DB/Store/native deployment or measurement."}
]
```

V2 is frozen for independent re-review; this author result does not accept itself or change project readiness.
