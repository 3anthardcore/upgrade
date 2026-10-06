# Independent target evidence review — 2026-09-30

**V1 verdict: REJECT.** Three independent behavioral witnesses reproduce one stale-writer defect and two corruption/replay acceptance defects. No implementation, server, authoritative Store or target database was changed. All fixtures use temporary local projects and simulated native response receipts; none is native Bitrix proof.

Task `target-evidence-review-20260930`, worker `commerce-model`, fence 1; input `art-1474a81e-0000-44de-aba5-bae37d2dd67f`.

## Examined frozen revision

| File | SHA-256 |
| --- | --- |
| `packages/core/target-evidence.ts` | `eaee93a1f94d99b995838bbbeb89c6b5d131b6f65d5070e5dd83f026dc040c42` |
| `packages/reporter/index.ts` | `56eafaa0864123044e76922b41537b005ea734f91bf89591f085c96caf8096da` |
| `packages/cli/index.ts` | `05e3dae485d8a44c32facc45b131aded6402849d725fd564c68f53f7f01f639f` |
| `tests/integration/target-evidence.test.ts` | `6b8a6553b53dea8b50012f1c617ba8eda0afa3f498be99b48e5857f1fefa2abd` |

All four pins independently matched the local files before review/test execution.

## Confirmed findings

### P1 — expired publisher overwrites the current owner's receipt

`ingestTargetEvidence` renews/checks ownership inside `save()`, then publishes immutable bytes. After `save("manifest", bytes)` returns, `store.put("target_evidence", id, record)` runs without a transactionally coupled ownership check. The same pattern occurs after each role; result publication and COMMITTED replay return also lack an immediate final ownership assertion. A synchronous publication can outlast the lease while a different process claims it.

The independent test performs the actual manifest publication, expires the first lease and acquires it through a **second SQLite connection**, then writes `new_owner_marker: "must-survive"` into the same pending receipt. The first caller subsequently detects `Dispatcher ownership lost` at the next save, but its intervening unfenced `store.put` has already erased the new owner's marker. The second owner remains recorded on the run, proving this was not a successful old-owner renewal. A new writer's accepted state could likewise be replaced by the stale receipt.

Required fix: couple every mutable receipt write/commit with an owner-and-unexpired-lease assertion in the same transaction; recheck after operations that can block and before output publication or successful replay return. Preserve the existing no-revival and unknown-publication reconciliation semantics. Merely checking at the next role is too late.

### P2 — damaged accepted capture payload still produces recorded verified evidence

`acceptedBuild()` checks the COMMITTED capture record and its result artifact, but does not verify the result's entire pinned capture payload set. The test changes the actual accepted `page.html` artifact bytes after model/package creation while leaving the package, model, manifest and native receipt pins intact. `ingestTargetEvidence()` nevertheless succeeds and returns `RECORDED_NATIVE_IMPORT` with `committed_build_binding: VERIFIED`.

The reporter independently validates the capture payload and will mark the derived build/evidence invalid, so this does **not** reproduce DEMO_READY. It does reproduce contradictory acceptance: the CLI ingestion result records a verified binding whose required source evidence no longer passes the current integrity checks. Required fix: validate the full immutable accepted capture/provenance chain, or use an equivalently strict shared acceptance validator, before any pending/evidence publication and replay success. Retain the original known denominator even when payload validation fails.

### P2 — deterministic Store key is skipped when persisted body ID is corrupt

Record lookup uses `store.list(...).find(r => r.id === expectedId)`. The independent test first commits valid evidence, then changes only the stored record body's `id` while preserving its actual deterministic Store key. Replay finds no body-ID match, treats the operation as new, and silently replaces that key with a fresh pending/committed record. No error is raised.

Required fix: read the exact deterministic Store key and compare its complete intent/binding before deciding to resume or replay. A missing key and a present corrupt body are different outcomes; corruption must not be disguised as a new operation. This is an integrity/recovery check, not a claim to protect against a malicious trusted operator.

## Actual independent checks

- `node --disable-warning=ExperimentalWarning --test tests/integration/target-evidence.test.ts`: **27/27 PASS, 0 SKIP**, 14322ms. Covers native-receipt/target/package mismatches, UNKNOWN and defective reconcile replies, exact receipt bytes, duplicate JSON keys, unsafe paths/hardlinks, copied-file tampering, CLI restart, lost-publication acknowledgement and honest report gates.
- `node --disable-warning=ExperimentalWarning --test var/evidence/target-evidence-review-20260930/independent.test.ts`: **0/3 PASS, 3 FAIL, 0 SKIP**, 7039ms. These are expected-safety assertions whose failures reproduce the three findings above; not implementation PASS.

The independent fixture prefix is copied from the frozen author's test file to retain the exact accepted model/package/journal setup. Three additional adversarial cases are reviewer-authored. The local copied cleanup helper checks absolute temp-directory parent and prefix before recursive removal. Raw failure output is retained in `var/evidence/target-evidence-review-20260930/independent-v1.log`.

## Correct boundaries observed

The manifest explicitly declares a trusted operator copy of native receipts. It cannot authenticate a dishonest operator and does not claim cryptographic signatures. Receipt hashes, project/target/package IDs, profile and journal request/response identities are checked; only confirmed defect-free `DATABASE_RECONCILED` evidence is accepted. UNKNOWN, foreign receipts and invented HTTP/browser/admin PASS are rejected by the executed author tests.

The reporter retains `NOT_READY`, source access blocking, full-source denominator UNKNOWN, and separate HTTP/browser/admin/restore NOT_RUN gates. It says the target's present state is not rechecked and describes the copied receipt as historical operator evidence. The existing escaping functions cover the added JSON/Markdown report content; no new direct HTML execution path was found. These positive findings do not waive the three integrity/ownership defects.

Next step: root records the rejected attempt and author fixes within its own scope; re-pin the revision and rerun these three preserved independent witnesses plus affected existing tests before acceptance. Native target verification is outside this review and remains separately executed by root.
