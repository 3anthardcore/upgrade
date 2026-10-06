# Ordinary crawl commerce bridge — 2026-09-30

Root-owned scope: `packages/extractor/index.ts`, `tests/integration/standard-commerce.test.ts`, this report. Input was recorded in authoritative Store as `art-d36bf9c5-7c8a-45c0-a0d5-e711ed0bedcb` under the running root task. No source network outside local fixtures, server, CMS or target database was changed.

The ordinary extractor now passes the exact retained HTTP/DOM buffer to the already reviewed commerce normalizer, before removing controls for inert content blocks. It rehashes that actual buffer against the recorded snapshot hash. The normalizer receives the unchanged entity ID, exact source/final URL, observation timestamp and verified image references. `model.commerce` contains one observation per extracted page. The legacy entity IDs/types and legacy top-level `offers`/`prices` remain unchanged: this patch does not claim that the older structured-data parser has acquired the stricter normalizer's identity rules. Consumers needing commercial semantics must use the normalized observations; native catalog projection is a separate unfinished requirement.

The separately owned handoff task adds `commerce: model.value.commerce` to ordinary Pipeline.build. This report's tests independently call the actual package builder with the model and validate its immutable snapshot. They are not evidence of the not-yet-frozen pipeline change or a native Bitrix catalog import.

Actual verification:

```text
node --disable-warning=ExperimentalWarning --test tests/integration/standard-commerce.test.ts tests/integration/discovery.test.ts tests/integration/commerce-observations.test.ts
npm run check
```

**29/29 PASS, 0 SKIP**, 3.685 seconds; TypeScript PASS. Log: `var/evidence/continuation-20260930/standard-commerce-tests-v3.log`. Four new behavior checks use a real bounded localhost HTTP crawl, shut the source down, then extract/build offline: exact repeated/empty query identity; two products with identical SKU and different observed brands remain distinct; old/current prices, observed quantity constraints and pinned images survive into the demo snapshot; absent and foreign-product prices/availability remain unknown; changed source bytes are rejected; a recorded rendered DOM supplies its own changed price and SHA instead of stale HTTP metadata. Existing browser discovery and prior commerce tests also passed. No source code or forms are executed/submitted.

The first new run had 2 PASS/1 FAIL because an assertion expected a particular warning for ignored foreign JSON-LD. It was replaced with direct null SKU/brand/price assertions; production behavior was not relaxed. A subsequent TypeScript-only test error from passing named interfaces into index-signature inputs was corrected by explicitly copying the input objects. The final test set adds the DOM-evidence case and has no failures/skips.

Frozen extractor SHA `4f34a0d935f751de2dfba0d341710a4d7e0d4109eb1785527016fd629560a859`; test SHA `9d28525b19f964502dc70a171228fde5745abbc9dd39def6ab3a39415f012c75`.

Independent review and native deployment: **NOT_RUN**. This closes only the common normalized-observation bridge; it does not close native catalog/SKU/API mapping, all-source coverage, full navigation, or DEMO_READY.

## Revision 2 — independent findings corrected, 09:32 UTC

The preceding section is the frozen V1 author history. Independent V1 review **REJECT** reproduced two P2 defects: the ordinary primary selector could use a header/sidebar heading or an inactive `main`; a FETCHED image without retained bytes could receive a verified SHA. Its original probes remain immutable (3 PASS / 4 FAIL); author tests had not covered those cases.

Root scope now also includes `packages/extractor/primary-dom.ts` and the helper-only refactor of `packages/extractor/operator.ts`. The existing operator primary-content heuristic and inert cleaner were moved into that shared file unchanged and used by both paths. This heuristic is not proof of full-page coverage. Image evidence now requires an actual retained regular file and matching bytes, length and SHA; missing paths remain unverified, conflicting duplicate references fail. Both normalized image observations and ordinary image blocks use the verified-byte map.

Four permanent regression cases exercise header, inactive main, sidebar article and missing image-path evidence. The independent seven-test probe was also repeated in a separate copy with only its expected source pin updated: **7/7 PASS**. The original V1 test and log were not rewritten.

Actual affected regression command:

```text
UPGRADE_PHP_BIN=<local PHP 8.3.35> UPGRADE_PHP_EXT_DIR=<local extensions>
node --disable-warning=ExperimentalWarning --test tests/integration/standard-commerce.test.ts tests/integration/discovery.test.ts tests/integration/commerce-observations.test.ts tests/integration/operator-extraction.test.ts tests/integration/catalog-review.test.ts
npm run check
```

**81/81 PASS, 0 SKIP**, 3.773 seconds; TypeScript PASS. Log: `var/evidence/continuation-20260930/standard-commerce-tests-v5.log`. An earlier broader run had 69 PASS / 1 SKIP because PHP was not configured; it is retained as such, not relabelled. The final run explicitly configured PHP. Independent V2 review and native deployment are still pending at this checkpoint. Source pins are recorded in the separate immutable V2 review-input artifact.
