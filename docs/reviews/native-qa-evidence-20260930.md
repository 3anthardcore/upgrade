# Native QA copied-receipt ingestion — author handoff

**Latest checkpoint: attempt 2 / fence 2 is frozen for independent review.** Attempt 1 below was rejected by the independent semantic receipt review; its hashes and results remain historical evidence. The correction and current pins are in the appended attempt-2 section.

Task `native-qa-evidence-20260930`, owner `evidence-engine`, fence1, input `art-854b5e4a-9277-4b6d-9c29-d3a5d0d413a9`. **Implementation frozen; independent acceptance pending.** No server, authoritative pilot Store, target DB or network operations were performed. Tests use temporary local projects. No readiness is changed.

## Executable path and trust boundary

```sh
node packages/cli/index.ts native-qa ingest \
  --project PROJECT --build COMMITTED_BUILD_ID \
  --directory COPIED_BUNDLE --manifest-sha256 SHA256 \
  --data-dir PROJECTS_DIRECTORY
```

The directory contains exactly `native-qa.json` and its listed files. External SHA pins the exact manifest bytes. The exported `NativeQaManifest` in `packages/core/native-qa-evidence.ts` is the contract; validation rejects extra manifest/ref/receipt fields, duplicate JSON keys, wrong encoding, traversal, links, unlisted files, missing bytes, size/hash mismatch and over-budget declarations. Snapshot/source HTML are inert data. Nothing invokes PHP, Docker, browser or the target.

Manifest schema1 contains:

- `kind: native-qa-evidence`, exact project/target/build/model IDs and package manifest SHA.
- `build_artifact`, `model_artifact`, `route_artifact`, `scope_artifact`: `{artifact_id, sha256}` from the accepted native-import result.
- `target_evidence: {record_id, result_artifact_id, sha256}`: an existing COMMITTED native-import receipt accepted by target-evidence V2; all target/package/build/model refs must agree. UNKNOWN, PENDING or damaged prerequisites fail closed.
- `snapshot: {id, sha256}`: private demo snapshot identity and exact package file SHA; actual item IDs/routes must equal package membership.
- Canonical HTTPS `origin` and `attestation: {kind: operator-copied-native-receipts, recorded_at: canonical millisecond UTC Z timestamp}`. Existing source receipts retain their own original timestamp bytes, including the supplied Python ISO offset form; the envelope timestamp is not relaxed.
- `files`: optional role-to-`{relative_path,sha256,size_bytes}` map, at least one entry. Omit absent evidence rather than fabricate PASS or alter native receipts to match a schema.

Roles: `facts_before`, `facts_after`, `http_routes`, `activation`, `http_scenarios`, `browser`; optional historical group `historical_plan`, `historical_intent`, `historical_result`, `historical_events`. The historical event role contains original JSONL bytes despite its stored artifact type ending in `.json`. No receipt is executed or rewritten.

Per-role caps: facts8MB each, HTTP routes16MB, activation/result65536 bytes, HTTP scenarios1MB, browser2MB, historical plan/intent1MB each, historical events8MB. Total copied bytes48MB; manifest131072 bytes; derived summary262144 bytes. Accepted source payloads keep their existing20MB per-file and512MB payload plus2MB manifest bounds; the ingestion task does not reset crawl/network budgets.

## Verified bindings and honest result semantics

Before publication, the accepted target-evidence result is revalidated against COMMITTED model/build/capture and pinned source/route/scope artifacts. Source capture payload hashes and the entire Bitrix package are rechecked, yielding between files so the dispatcher heartbeat can run. Facts are independently reserialized with the PHP associative JSON behavior used by the native importer, including empty objects and Unicode line separators, then compared to all exact native entity keys, unique IDs, byte sizes and before/after raw SHA. Counts remain target counts.

HTTP evidence must contain exactly the package route targets and unique media paths/SHA, preserve the original query text, and pass its six explicit auth/source-POST/vendor/installer/missing-path checks. This does not establish the complete privacy-header matrix. The private snapshot and activation are cross-bound; activation alone still does not claim HTTP success.

The supported copied HTTP scenario schema checks13 named outcomes and the29-exchange GET/POST sequence. Only seven successful synthetic POSTs and two forbidden POSTs to `/__upgrade/action` are allowed; exact retry operation route and subsequent checkout/lead receipt hashes must agree. Missing activation keeps scenario verification NOT_RUN. No total, price, order or stock value is invented.

The supported legacy browser receipt records10 named outcomes, JS disabled, safe GET and four own synthetic POST303 responses. It has no native snapshot/target/time/verifier field: linkage is explicitly `OPERATOR_ATTESTED_COHORT_ORIGIN_ONLY` using the pinned envelope and origin, not an invented stronger proof. Activation plus HTTP scenario receipt are required before browser becomes RECORDED_PASS. `requests` in this legacy receipt counts routing callbacks, not all network requests. Screenshots are not visually reviewed by ingestion. The newer generic browser verifier requires a separately reviewed schema adapter; do not coerce its output into this legacy schema.

Missing required pairs/dependencies remain NOT_RUN even when another section is RECORDED_PASS. `facts_before` without `facts_after` cannot confirm facts/counters. An incomplete historical group cannot confirm restore. Admin edit, D7 transport, current package restore and private session restore remain NOT_RUN because this version has no accepted receipt adapter for them.

Historical restore validates its separate canonical plan/intent/result pin, source project/target, clone destination/network/volume projection, backup SQL/files SHA, ordered guard/SQL/pre-CMS-isolation/HTTP/readback events, baseline counts and declared clone-only settings derivation. Its result is `RECORDED_HISTORICAL_RESTORE`, never current-package/private-session/production recovery. Raw backup contents and target isolation are not re-executed by this offline tool.

## Durable publication and reporting

Idempotency is SHA of version/project/target/build/manifest pin. The authoritative record key must match its body. Intent is PENDING before any artifact publication; exact validated Buffers are published rather than rereading mutable input paths. Publication uses Store's guard before filesystem work and inside metadata commit; record/event changes are fenced transactions. Each reused artifact is hash-checked. An unknown last publication is reconciled by deterministic artifact type+SHA. Takeover cannot overwrite a successor's record. No COMMITTED or readiness status is accepted merely because a subprocess exited successfully.

JSON/HTML/Markdown reports expose the same native QA evidence. `CURRENT` means that the bundle is intact and bound to the latest verified operator build in this Store. `STALE` means another verified build is current. Neither means the live target was polled. Invalid or pending evidence gives no current native PASS. Full source scope, active access block and unresolved URLs are preserved; readiness stays NOT_READY. The original native-import record continues to describe historical import/reconcile only.

Exact package link/card membership is separately computed. Successful visits to listed routes do not validate every outgoing link. Missing targets remain distinct (`?m` differs from `?m=`), with total counts and SHA of the complete sorted missing set. The displayed sample is capped at100 targets/24576 bytes and explicitly marks truncation; full source/package artifacts are retained. Click verification remains NOT_RUN.

Reporter performance change is deliberately bounded: one artifact metadata index and one validated byte/DOM cache per report call. Small-byte cache is32MB with8MB maximum item; DOM link cache caps250000 links. Every newly used artifact is still independently size/type/project/hash checked. Caches are discarded even after failure and cannot hide corruption in a later report. The prior redundant read/hash via `validateArtifact` and unused full event-log/artifact scan via `getStatus` were removed; no persistent verification cache or10k/50k performance claim is introduced.

## Actual checks

```sh
npm run check
node --disable-warning=ExperimentalWarning --test tests/unit/native-qa-evidence.test.ts tests/integration/reporter-access.test.ts tests/integration/operator-report.test.ts tests/integration/target-evidence.test.ts
node --disable-warning=ExperimentalWarning tests/native-qa-copied-audit.ts
git diff --check -- packages/core/native-qa-evidence.ts packages/cli/index.ts packages/reporter/index.ts tests/unit/native-qa-evidence.test.ts tests/native-qa-copied-audit.ts
```

Final combined result: **78/78 PASS, 0 skipped, 27759.5576ms**; TypeScript check and diff check PASS. Twelve new test groups include real offline CLI/restart/replay, partial evidence, foreign/corrupt/UNKNOWN bindings, exact route/query/media/facts membership, unknown publication recovery, takeover after publication and inside metadata transaction, input-copy TOCTOU, changed authoritative record ID, source corruption, hardlink/traversal/duplicate-key/budget cases, stale/invalid report behavior, cache reset, exact link gaps and historical/current restore separation. Existing report tests cover inert HTML/Markdown escaping. Intermediate failures were fixture syntax/property mistakes and compatibility assertions for an error message/legacy report shape; these were corrected before the final run. No native test was silently substituted with a fixture PASS.

The read-only copied-audit command uses the supplied `native-0710`, `native-stage389-data`, `native-recovery-v6-details` files and verifies their metadata/receipt consistency. It deliberately reports `store_binding: NOT_EVALUATED` and `native_execution: NOT_RUN`; its placeholder refs cannot publish anything. Actual results match the accepted independent stage389 review:

- package `4141b1d86b294520f2a2dc02d668c0153924caa9d76ce6c74941b15e6a9a6a9b`;
- facts/routes389, media2345; target counts389/389/494/users1/orders0/events0;
- known2742, selected389, unresolved2353, full source UNKNOWN;
- link/card targets6532; uncovered occurrences4299; unique uncovered targets577; PARTIAL;
- historical V6 plan `55ae7f465c988df2240ac20c678b404d1436820b4f1d4a7ea5e04a3833103977`, counts103/103/105, separate from current389.

These remain copies attested by a trusted operator, not a cryptographic remote attestation against a malicious operator. Root must separately run actual pilot Store ingestion and any target verification after deployment. The source access gate, missing PDF/deferred scope and current restore gaps are not closed by this task.

## Frozen pins

| File | SHA256 |
| --- | --- |
| `packages/core/native-qa-evidence.ts` | `eed0769a347e20ee62cd8c4ea9d1e85dc854cd9e7cc4854b416d114611a00b50` |
| `packages/cli/index.ts` | `534bd10b64ab0e35c3fc0ed45f00c0334aa4dd31b91751a50953fd8fd157dccb` |
| `packages/reporter/index.ts` | `3ac7e1487e2dab9862fffcbb1a73cda7444475f460021aaa3cad94ad9f82ec50` |
| `tests/unit/native-qa-evidence.test.ts` | `d60e743b866580b2a5bc078d8572fbae893eef26450791071c753cf3331ef0b4` |
| `tests/native-qa-copied-audit.ts` | `d53d3abf1846fa4a33f1d0df54553cc5e01a511a8128f88d6f1a1153851f094e` |

This document's SHA is supplied separately. Next: independent negative review, root integration/package checks, then native operator bundle ingestion; no direct target mutation is performed by this command.

## Attempt 2 — correction after independent REJECT, 30 September 08:18 UTC

Same durable task, owner `evidence-engine`, attempt 2 / fence 2. Root recorded author attempt 1 as REJECT (`art-e9be20e6-9f67-42fc-a4fb-ba1d8ce50668`); the completed independent review is `art-700eda84-8413-4641-890b-86225f655207`, source `docs/reviews/native-qa-independent-20260930.md`. The original 78 passing tests did not cover the seven contradictory copied-receipt variants in F1–F4. Their acceptance was an implementation defect, not a failure of the genuine native run. Prior pins/results above are retained rather than replaced.

Only the core receipt validator, its unit tests and this report changed in this attempt. CLI, reporter and copied-audit helper retain their attempt-1 hashes. No source receipts, server, target DB or authoritative Store were changed.

- **F1:** required guard/DB-start/SQL-import/pre-CMS-probe/web-start/final-guard commands now require exactly one `STARTED` row followed by exactly one terminal row with exit0 and bounded SHA fields. Missing, duplicate, failed or UNKNOWN transitions reject. Ordering compares successful completion against the dependent start, and binds files/derivation, database readback, isolation, HTTP and final readback. `DB_READY` is a separate bounded polling sequence: nonzero attempts may precede the last successful pair; no attempt follows success. The unchanged V6 log, including its ordinary failed readiness polls, passes.
- **F2:** add, update, remove, second add, checkout and lead require six distinct operation IDs; the intended add replay keeps the first ID. Checkout readbacks and lead readback compare request target, body SHA **and byte count**. Cart page HTML may change because of rendered form state; no equality of cart HTML hashes was added.
- **F3:** the admitted `READ_ONLY_NATIVE_FACTS_AND_COUNTS` receipt is specifically the legacy `verify-pilot-bitrix.php` producer contract. It requires orders0/events0 and the exact HW500 route mapped to native ID1 in the supplied facts/package membership, in addition to complete payload checks. A true `pass` flag cannot override a contradictory field. This does not generalize arbitrary projects to that policy: another producer needs a separately reviewed versioned baseline/policy adapter; unsupported/missing facts are not invented. Fixtures now explicitly model this producer instead of using an unrelated product route.
- **F4:** HTTP `factual_texts_checked` equals the count derived from the pinned route's entity using `verify-pilot-http.py` rules: nonempty text on paragraph/heading/quote/link/card/document, every list/card item and every table cell. Both zeroed and inflated counts reject. A dedicated fixture covers empty text, empty list/table values, card text plus items, and image alt exclusion; it does not equate route visits with outgoing-link verification.

Final commands:

```text
npm run check
node --disable-warning=ExperimentalWarning --test tests/unit/native-qa-evidence.test.ts tests/integration/reporter-access.test.ts tests/integration/operator-report.test.ts tests/integration/target-evidence.test.ts
node --disable-warning=ExperimentalWarning tests/native-qa-copied-audit.ts
node --disable-warning=ExperimentalWarning var/evidence/native-qa-independent-20260930/pure-probes.ts
git diff --check -- packages/core/native-qa-evidence.ts tests/unit/native-qa-evidence.test.ts docs/reviews/native-qa-evidence-20260930.md
```

Final combined result: **80/80 PASS, zero failures/skips, 36459.8534ms**. TypeScript and scoped diff checks PASS. There are now14 native-QA test groups. New persisted regression tables reject ten fact/HTTP contradictions and nine historical transition defects; the separate count fixture rejects zero, undercount and overcount. Positive controls retain varied cart HTML and failed-then-successful DB-ready polls. An intermediate link-gap fixture had added three text blocks without updating its synthetic coverage count; the stricter validator correctly rejected it. The fixture was corrected and the final complete run passed.

The unchanged independent pure-probe script now rejects **all seven inconsistent variants** from F1–F4; both the unchanged genuine baseline and the intentional cart-HTML variation pass. The genuine copied audit retains exactly the package389/media2345/source2742/selected389/unresolved2353/link-gap577 and historical103 results above. It still performs no Store binding check or native execution. No live readiness claim is added.

Attempt-2 frozen pins:

| File | SHA256 |
| --- | --- |
| `packages/core/native-qa-evidence.ts` | `6fceb5071c38cb69abee4b7929df0673cd7c55d7f2dbc626158fe9efb4d896f0` |
| `tests/unit/native-qa-evidence.test.ts` | `382dd2142a492f97d398aec313f189ce91188cc03d5287a6eeb0a7bcdf24672d` |
| `packages/cli/index.ts` — unchanged | `534bd10b64ab0e35c3fc0ed45f00c0334aa4dd31b91751a50953fd8fd157dccb` |
| `packages/reporter/index.ts` — unchanged | `3ac7e1487e2dab9862fffcbb1a73cda7444475f460021aaa3cad94ad9f82ec50` |
| `tests/native-qa-copied-audit.ts` — unchanged | `d53d3abf1846fa4a33f1d0df54553cc5e01a511a8128f88d6f1a1153851f094e` |

Independent review remains required; this author does not accept their own output. Next step is re-review of these exact pins and root-only integration. Current package/private-session restore, admin/transport receipt adapters, live freshness and complete source/navigation coverage remain outside this ingestion version.
