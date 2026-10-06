# Native QA ingestion/report — independent review, 2026-09-30

Task `native-qa-independent-20260930`, input `art-f6bef024-5750-4c24-83f8-0bbd018507fc`, reviewer `qa-independent`, fence 1.

**Verdict: REJECT frozen attempt 1 for semantic receipt validation.** The original copied native evidence passes the offline consistency check. Seven deliberately inconsistent, re-pinned variants also pass, however, and produce `RECORDED_PASS`/`RECORDED_HISTORICAL_RESTORE`. These are bounded parser defects, not evidence of a failed actual target operation. Native runtime/authoritative pilot Store were not queried or changed by this reviewer.

Reporter cache lifetime, source/build/hash binding and lease fencing passed the checked cases; no implementation edits were made. Writes are restricted to this document and `var/evidence/native-qa-independent-20260930`.

## Reviewed pins

| File | SHA256 |
| --- | --- |
| `packages/core/native-qa-evidence.ts` | `eed0769a347e20ee62cd8c4ea9d1e85dc854cd9e7cc4854b416d114611a00b50` |
| `packages/cli/index.ts` | `534bd10b64ab0e35c3fc0ed45f00c0334aa4dd31b91751a50953fd8fd157dccb` |
| `packages/reporter/index.ts` | `3ac7e1487e2dab9862fffcbb1a73cda7444475f460021aaa3cad94ad9f82ec50` |
| `tests/unit/native-qa-evidence.test.ts` | `d60e743b866580b2a5bc078d8572fbae893eef26450791071c753cf3331ef0b4` |
| `tests/native-qa-copied-audit.ts` | `d53d3abf1846fa4a33f1d0df54553cc5e01a511a8128f88d6f1a1153851f094e` |
| Author report `docs/reviews/native-qa-evidence-20260930.md` | `76a7cd27695fd3ee28df349274983b206ea32cd8fd2b585784255df56a0d7ba7` |

Files matched the assigned freeze. The review treats receipts and source content as inert data; tests create only disposable local Store fixtures, never the authoritative pilot Store or target database.

## Blocking findings

### F1 — P1: historical safety gate order and failed command completion accepted

Location: `packages/core/native-qa-evidence.ts`, historical event validation near `HISTORICAL_STAGE_ORDER` and `HISTORICAL_GUARD_MISSING`.

Starting from the exact supplied V6 copied receipts:

1. Move both `GUARD_CHECK_BEFORE_PHP` rows after the successful `WEB_START` completion, keeping timestamps monotonic. Validation still returns `RECORDED_HISTORICAL_RESTORE`.
2. Independently change the terminal `DB_START.exit_code` from `0` to `1`. Validation still returns the same accepted restore state.

The current code requires presence of successful guard rows somewhere, but does not require the successful pre-PHP guard **before** the PHP probe/web start. Its order check uses the first stage occurrence (normally STARTED), not an unambiguous successful completion before the dependent stage. An internally contradictory or mixed execution log can therefore confirm the documented ordered safety checks.

Required correction: validate the specific successful command transitions and their order, including guard-before-DB, successful DB start/SQL import, successful guard-before-PHP, pre-CMS probe/isolation before web start, successful web start, and final guard before final readback. Refuse failure/unknown/missing or contradictory completion for stages claimed to establish success. Ordinary bounded DB-ready polling failures must remain distinguishable from failure of the required one-time transition. Preserve the actual V6 log unchanged as a positive regression.

### F2 — P2: distinct synthetic operations and immutable receipt lengths are not bound

Location: same module, `SCENARIO_REPLAY_OR_READBACK_MISMATCH`.

Two independent mutations are accepted as `checks.http_scenarios = RECORDED_PASS`:

- Replace lead receipt exchanges 26/27 (zero-based indexes) with checkout exchange 21's `request_target`, `body_sha256`, and `body_bytes`. Both named synthetic scenarios now attest the **same operation**, with no separate lead receipt.
- Keep checkout readback exchange 22's SHA identical to exchange 21 but increment its `body_bytes`. It asserts different byte lengths for the same immutable response SHA and is accepted.

Required correction: ensure distinct operation identities for distinct commands, while preserving the intentional exact replay identity. Compare both SHA and byte count for the immutable checkout/lead readback pairs already claimed byte-equal. The original actual copied receipts satisfy these conditions.

Do **not** require equality of the entire cart HTML on repeated GET: actual exchanges 10 and 12 have different body SHA due to rendered form state, despite the same replay operation and byte length. The `cart_replay_changed_response_sha` probe is retained as an intentional non-finding/control, not a failed requirement.

### F3 — P1: `pass:true` accepted when pilot producer's native side-effect/identity predicate is false

Location: `FACTS_HEADER_INVALID`, facts counter validation.

In both before/after copied native facts documents, either of the following independent changes is accepted as facts/counters `RECORDED_PASS`:

- `legacy_hw500_id = 999999`, absent from the 389 recorded native entity IDs;
- `counts.b_sale_order = 7`, `counts.b_event = 4`.

This is not a request to authenticate a remote operator cryptographically. The supported receipt's producer, `scripts/verify-pilot-bitrix.php`, explicitly computes `pass` from **HW500 ID equal to 1** and **orders/events equal to zero**, as well as the payload comparisons. The ingestion accepts `pass:true` while the supplied fields contradict that same receipt schema's success predicate.

Required correction: enforce the admitted producer's success invariant and legacy identity binding. If generalizing beyond this pilot, introduce a separately reviewed schema with an explicit trusted baseline/policy rather than treating arbitrary positive legacy IDs/nonzero effects as this producer's PASS. No need to rewrite genuine existing receipts.

### F4 — P2: HTTP factual coverage count can be reduced to zero without losing PASS

Location: `HTTP_ROUTE_FAILED` validates `factual_texts_checked` only as a nonnegative integer.

Change all 389 route rows to `factual_texts_checked: 0`, retaining copied `checks.facts: true` and `pass: true`. Every route is still accepted. The pinned package has factual text blocks, so this contradicts the known producer `scripts/verify-pilot-http.py`: it always records the exact length of `factual_texts(entity)`, covering supported paragraph/heading/quote/link/card/document text, list/card items and table cells.

Required correction: derive the expected count from the pinned entity/route mapping using that supported producer contract, or explicitly reject the unsupported producer/schema. This needs no target HTTP call and does not require recovering response bodies that were never supplied.

## Executed evidence

```text
node --disable-warning=ExperimentalWarning --test tests/unit/native-qa-evidence.test.ts
node --disable-warning=ExperimentalWarning tests/native-qa-copied-audit.ts
node --disable-warning=ExperimentalWarning --test var/evidence/native-qa-independent-20260930/fixture-probes.test.ts
node --disable-warning=ExperimentalWarning var/evidence/native-qa-independent-20260930/pure-probes.ts
```

- Author's 12 test groups independently rerun: **12/12 PASS, zero skips, 27858.4083 ms**. This includes foreign target/build/scope, source corruption, PENDING/UNKNOWN prerequisites, wrong media/facts/query/body SHA, duplicate IDs/keys, hardlinks/traversal/unlisted files, omitted receipt NOT_RUN, lost acknowledgement/restart, takeover and publication fencing, source-byte corruption, exact link membership and historical/current restore separation. These fixtures are local, not native Bitrix.
- Additional independent fixture checks: **3/3 PASS, zero skips, 7912.9641 ms**. (1) QA body replacement after a successful report invalidates the next report on the same Store object; source denominator stays unchanged. (2) Source HTML corruption after QA COMMITTED invalidates current QA and preserves known URL count/full-size UNKNOWN. (3) Dispatcher expiry just before publication prevents COMMITTED/result-artifact publication. An initial reviewer assertion used a nonexistent report field; corrected to the actual `source.total_site_urls_status`, then all three passed. No implementation failure is attributed to that reviewer typo.
- Pure copied-receipt matrix: baseline accepted, **seven inconsistent variants accepted unexpectedly** (F1 two, F2 two, F3 two, F4 one). One additional cart-HTML hash probe is an intentional allowed variation, as explained above. Each mutation rehashes only its local copied receipt and envelope reference, exercising semantic checks after integrity checks. Original evidence files are never modified.
- Raw logs/scripts/results are retained in the owned evidence directory: `author-tests.txt`, `copied-audit.json`, `fixture-probes.test.ts`, `fixture-probes-results.txt`, `pure-probes.ts`, `pure-probes.json`. The additional fixture file copies the author's frozen fixture-building prefix and adds reviewer assertions; it does not alter the implementation or author test.

## Verified boundaries retained

The supplied 0710/data/V6 positive audit reports package `4141b1d86b294520f2a2dc02d668c0153924caa9d76ce6c74941b15e6a9a6a9b`, 389 facts/routes, 2345 media, target counts 389 entities/389 routes/494 operations/users1/orders0/events0. Known URL denominator remains 2742, selected389, unresolved2353, whole-source UNKNOWN. Internal package links/cards remain PARTIAL: 6532 occurrences, 4299 uncovered occurrences, 577 distinct missing exact targets; the bounded sample/truncation flag/full missing-set SHA are retained. HTTP click verification stays NOT_RUN.

Historical V6 restore remains separately attached to plan `55ae7f465c988df2240ac20c678b404d1436820b4f1d4a7ea5e04a3833103977` and 103/103/105 counts. Neither this historical receipt nor `CURRENT` establishes restored current389/private sessions. `CURRENT` is Store/build binding only. Browser proof is explicitly legacy operator-attested cohort/origin, with no invented snapshot/time/verifier binding; screenshots are not visually reviewed by ingestion. Missing facts pair/dependencies remain NOT_RUN. Readiness remains NOT_READY, source access restrictions remain present, and native admin/transport/current restore are not promoted by this adapter.

Next step: author fixes the four bounded semantic groups under a persisted retry, retains original native receipts and positive tests, freezes new pins, then independent re-review reruns the exact witnesses and report/cache/lease checks. This review does not authorize deployment or target mutation.
