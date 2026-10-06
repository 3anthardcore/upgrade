# Native QA receipts — root independent attempt 2 review

2026-09-30. ACCEPT for copied-receipt consistency and immutable Store/report binding. No fresh remote attestation is inferred.

Frozen core SHA256 `6fceb5071c38cb69abee4b7929df0673cd7c55d7f2dbc626158fe9efb4d896f0`, test SHA256 `382dd2142a492f97d398aec313f189ce91188cc03d5287a6eeb0a7bcdf24672d`. CLI and reporter are unchanged from reviewed attempt 1. Root inspected the producer-success predicates and repeated the unchanged seven malformed copied-receipt witnesses from the independent review. All seven now reject; the genuine copied baseline and allowed cart-body variation still pass. Output: ignored `var/evidence/continuation-20260930/native-qa-root-v2-pure.json`.

Root ran the full native-QA unit file: **14/14 PASS**. The same process also ran three old independent cache/lease tests: their outdated fabricated baseline failed before reaching their intended assertions, because it lacked the now-required legacy product route. This initial **14 PASS / 3 FAIL** log is retained at `native-qa-root-v2-tests.log` and is not presented as a passing run.

A new independent fixture file uses the corrected producer-compatible fixture setup (legacy route, exact factual counts and distinct operation identities), while retaining the three independent test bodies unchanged. This rerun **3/3 PASS, 0 SKIP**: same Store instance detects modified QA bytes and source bytes across reports, and expired dispatcher prevents result publication. Evidence: `var/evidence/native-qa-independent-20260930/fixture-probes-v2.test.ts`, `var/evidence/continuation-20260930/native-qa-root-v2-fixture.log`. No production validation was weakened to accommodate a fixture.

The admitted legacy facts receipt is intentionally the pilot producer contract from `verify-pilot-bitrix.php`, including HW-500 ID1 and zero orders/events. Historical SQL/CMS recovery remains separate from current private-session restore. Source denominator and exact query link closure remain independent readiness gates. Browser/admin/current restore and other absent receipts are not converted to PASS; copied evidence does not prove the current remote runtime is unchanged.
