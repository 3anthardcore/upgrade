# Demo admission — independent review, 2026-09-30

Task `review-demo-admission-20260930`, reviewer `admission-independent`, fence 1. Input `art-dffa7330-452c-4b2f-b038-92af1082176a`; author artifact `art-672c6ca5-8bf7-4f81-8d14-62d588c86984`. This review only writes this document and its ignored local evidence. No production/server, target DB, authoritative Store, implementation or deployment change was made.

**Verdict: REJECT the complete admission/quota acceptance for this frozen attempt.** The read-only effect boundary and tested concurrency/replay behavior passed; one concrete, bounded file-count quota defect remains. Native deployment and native performance: **NOT_RUN** by this reviewer. The finding appears inherited from the earlier quota scan, rather than introduced by the new read-only split; it must not be presented as an optimization-specific regression.

## Verified input pins

| Input | SHA256 |
| --- | --- |
| `bitrix/module/upgrade.core/lib/demoruntime.php` | `0e017408dec178ae5238afcb8c5f7dae63c6f72869294289fd3c0e59115efee0` |
| `bitrix/module/upgrade.core/lib/demoweb.php` | `2dd119124a437e4ce5bddf787930c8be632b86b5aa83fdcc2fb7b8af3834521c` |
| `bitrix/module/upgrade.core/lib/demoengine.php` | `d90d6ecc8858ca0305064304227b345e70479b3dd38a4b1afa00e6ca362eb905` |
| `tests/integration/demo-runtime-admission.test.ts` | `3cfd35d9e4877f8e758b7be1679162925b551ef4db27b8748208e7caf43f8a98` |
| Author report `docs/reviews/demo-admission-read-split-20260930.md` | `a773615a5376f0a9c467df642d2b829e8c195973916e562ba75315c8bfaa22e4` |

## F1 — P2: admission does not reserve file slots for its own write

`DemoRuntime::handle`, quota scan at lines 26–35, rejects an already observed count greater than 5000. It then reserves byte/session capacity, but no file-count capacity for the write it is about to admit.

Independent real-PHP reproduction:

1. Create a private project directory containing exactly **4,999** retained, regular, non-JSON crash-residue files. No session exists and no source/native system is contacted.
2. Send a normal GET to `/__upgrade/cart` through the actual `DemoRuntime`, `DemoWeb` and `DemoEngine` in a separate PHP 8.3.35 process.
3. Actual result: HTTP-equivalent response **200** and a new server-chosen `upgrade_demo_session`; retained count becomes **5,001** (the 4,999 original files plus session JSON and lock).
4. Expected under a hard 5000-file admission ceiling: refuse creation with `DEMO_STATE_FILE_QUOTA`, retain the original 4,999 files, emit no new session.

This is bounded over-admission, not evidence of arbitrary unbounded filesystem writes or loss of retained receipts. Existing old remnants were not deleted. It nevertheless makes the apparent 5000-file ceiling a precondition on the old state rather than a ceiling on admitted effects. Atomic session writes also have a temporary `.pending-*` file; a failed write can retain it, so the reservation must account for the actual maximum additional entries.

Suggested narrow correction: under the already held admission gate, reserve the maximum new entries before dispatch. A new session needs its lock plus pending/committed JSON (two additional entries); an existing-session write may need one additional pending entry. Conservative reservation for POST replay is consistent with the existing byte policy. Preserve read-only access and all retained evidence; do not fix the limit by deleting or resetting sessions. Add boundary regressions at 4998/4999/5000 and for a pending-file write failure. Root/author must explicitly scope and re-freeze that correction.

Exact witness: `var/evidence/demo-admission-independent-20260930/probes.test.ts`, test **“independent: application session file quota must reserve new JSON plus lock files”**. The unchanged expected assertion fails on the frozen input; `probes-final.log` retains the actual 200 response and `files: 5001`. Tokens in that log are generated local fixture values, not real user sessions.

## Checks that passed

The complete author-targeted suite was independently rerun with the three exact PHP pins: **69/69 PASS, zero failures/skips, 18125.2175 ms**. These are real PHP processes/files/flock and local snapshot contracts; no fake CMS result is treated as native Bitrix evidence.

Eight additional reviewer assertions reuse only the author's process/fixture helpers and define independent cases. Final result: **7 PASS, 1 FAIL, zero skips, 4992.4117 ms**. The one failure is F1. Passing cases:

- Five receipt corruption variants with a recomputed envelope checksum—scalar operation, wrong operation ID, wrong snapshot, excessive revision, stored `replayed: true`—return fixed 500 while another process holds the global admission lock. They emit no cookie, preserve bytes and never fall back to reset/creation.
- Unknown, missing, malformed and non-string cookies plus missing/malformed/encoded operation IDs return bounded 400/404 without JSON or lock-file creation under a held gate.
- A read-only copy of a copy rejects all potentially creating APIs for an already existing session. File membership and committed bytes remain unchanged. No fallback can elevate that copy through its public API.
- Six simultaneous unknown-cookie GETs competing for two remaining session slots produce exactly two server-chosen sessions and four quota refusals, preserve 998 previous JSON entries and never adopt caller-supplied cookie IDs.
- Six simultaneous identical POSTs produce six PRG responses but exactly one persisted operation, revision 1 and cart quantity 1.
- At exactly 128 MiB minus the 8 MiB reservation, one creation succeeds; the next is refused by the byte quota. Residue and first session remain intact.
- Wrong body/query/HTTPS/cookie types in GET/HEAD return the applicable bounded 200/400/413 responses with no new session under a held global gate.

The initial reviewer run had one additional **test assertion error**: it expected only 200/400 for a non-string body, although the existing Web contract correctly returns 413 `INPUT_LIMIT`. The assertion was corrected to include 413; implementation was not changed. Final 7/1 results above supersede that 6/2 diagnostic run. No mtime preservation is claimed; the reviewer checked file membership and bytes.

Static review confirms that `readOnlyCopy()` only narrows the private flag; `locked()` rejects potentially creating APIs before opening/chmodding a lock, and `save()` has an independent guard. `DemoWeb` rethrows only the dedicated internal exception class. Ordinary parse/state errors remain ordinary errors. Every POST still takes admission before Web dispatch. Existing-only reads retain their session flock/checksum/binding checks. The retry reserves new-session capacity even when a formerly missing cookie file reappears. The author tests for deletion/reappearance, real blocked readers/writers, missing locks, byte quota, original UNKNOWN state and replay all passed on repetition.

The engine constructor may create the single project directory before `handle`; the reviewed guarantee concerns session/receipt files and writes inside the HTTP handler. An internal PHP caller that bypasses `DemoRuntime` still has a write-capable engine. Reflection, unserialization or arbitrary trusted PHP code is not sandboxed by this flag; no public request path exposes those operations. Read-only operations acquire existing lock descriptors and read bytes; no claim about filesystem atime or all kernel metadata is made.

## Commands and evidence

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-runtime-admission.test.ts tests/integration/demo-engine.test.ts tests/integration/demo-web.test.ts tests/integration/demo-snapshot.test.ts
node --disable-warning=ExperimentalWarning --test var/evidence/demo-admission-independent-20260930/probes.test.ts
npm run check
```

TypeScript check passed. `probes-final.log` is the final independent test output; `pins.json` records frozen code/test/report/evidence hashes. Full original suite output was observed in the tool result, with 69 PASS; it was not invented as a saved transcript. The local performance profiler's 900 requests were read from the author report but were **not rerun** or independently accepted as a benchmark here. Native HTTP/FPM/Bitrix deployment and native p95 remain NOT_RUN. This review does not alter source coverage, commercial readiness or DEMO_READY.
