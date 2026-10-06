# Ordinary commerce bridge V2 — independent review, 2026-09-30

**ACCEPT for the bounded V2 extractor change.** Both P2 findings from V1 are closed by independently repeated behavioral probes. No further blocking issue was found in this review scope. This is not native catalog, deployment, source-completeness or DEMO_READY acceptance.

Task `review-standard-commerce-v2-20260930`, owner `commerce-independent-v2`, fence 1. Inputs: `art-b28ed296-eb05-4639-84f2-66986e3df0d6`, author `art-6acc526d-df68-4f96-a71d-9f2c48d94b20`, V1 review `art-e2361a97-89eb-4690-9d20-656eefab9135`. Only this report and `var/evidence/standard-commerce-independent-v2-20260930/` were written. No server, Store, database, production source or prior evidence was modified. The root agent performs authoritative task acceptance.

## Verified frozen inputs

| File | SHA-256 |
|---|---|
| `packages/extractor/index.ts` | `39da27dcb08043ce328aa46226c023dccfe2e1e3cdea3b6ec631e2735bcb02b5` |
| `packages/extractor/primary-dom.ts` | `04c30c8f69d46d17616bac6b88c91011174f7f4f7884cf0d025c55a481bbf689` |
| `packages/extractor/operator.ts` | `3c7219513d35ab2f0722e27b4e6ab4c4cb63ddaa0d7dbaf6755d3f7c8af8e341` |
| `tests/integration/standard-commerce.test.ts` | `417fa57e239a871ecac4e192c23ca59b013bac815ed503f0dcbb6c069fa3200a` |
| `docs/reviews/standard-commerce-20260930.md` | `3e5fb0e3fc10f835c338e30b72dc9f37d20db6f8482b4bea0790d3e7866d1427` |

These hashes were checked before and after the local executions. The original seven-test probe was copied to a new file; the sole change is its expected extractor SHA. A separate equality assertion verifies that constraint. Original V1 probes and failures remain unchanged.

## Findings closed and extra boundaries

F1: the ordinary path now uses the shared operator primary-content heuristic and passes the selected node's actual index to the independently parsed commerce document. The three original failures now pass: site-header H1 is not used instead of `#content`; a script-only `main` does not hide usable primary content; a sidebar article does not provide the primary product name or price. An additional test with a hidden first `main` and visible second `main` confirms the correct index, product name, price and inert generic heading.

The extracted `primaryDom` and `cleanPrimaryDom` function signatures and bodies match their prior operator versions after whitespace normalization; the two supporting constant initializers match exactly. This bounded textual comparison is accompanied by the actual operator regression tests. It does not claim AST equivalence for arbitrary TypeScript or validate unrelated changes against Git HEAD.

F2: the ordinary extractor builds its verified-asset map from retained regular files after reading and checking the actual bytes, recorded length and SHA. A FETCHED asset without `body_path` supplies no verified SHA to normalized commerce or ordinary image blocks. The original tampered-image and failed-status tests still pass. Additional actual probes verify rejection of an incorrect byte count, conflicting independently hash-valid files for the same source URL, and conflicting MIME values in both input orders. Identical repeated references preserve the normalized observations unchanged.

The original probes also confirm exact repeated/empty query identity, distinct entities for a shared SKU with different observed brands, absent commercial values remaining unknown, selected DOM facts bound to the DOM SHA rather than stale HTTP values, and rejection of changed DOM bytes. Their HTTP fixture is shut down before extraction; only GET requests are admitted and no source script/form is executed or submitted.

## Commands and actual results

```text
node --disable-warning=ExperimentalWarning --test var/evidence/standard-commerce-independent-v2-20260930/probes-v2.test.ts
node --disable-warning=ExperimentalWarning --test var/evidence/standard-commerce-independent-v2-20260930/extra-boundaries.test.ts

UPGRADE_PHP_BIN=<workspace>/var/tools/php-8.3.35/php.exe
UPGRADE_PHP_EXT_DIR=<workspace>/var/tools/php-8.3.35/ext
node --disable-warning=ExperimentalWarning --test tests/integration/standard-commerce.test.ts tests/integration/discovery.test.ts tests/integration/commerce-observations.test.ts tests/integration/operator-extraction.test.ts tests/integration/catalog-review.test.ts

node var/evidence/standard-commerce-independent-v2-20260930/helper-parity.mjs
npm run check
```

- Original independent assertions: **7/7 PASS, 0 SKIP**, 2283.676 ms.
- Additional independent boundary tests: **5/5 PASS, 0 SKIP**, 1197.173 ms.
- Affected author/operator/discovery set independently repeated with actual local PHP configured: **81/81 PASS, 0 SKIP**, 4912.039 ms. The set includes local mediated Chromium discovery; it is not a native Bitrix test.
- Helper parity / pin-only-copy assertions: **PASS**. First parity-harness draft tried an unavailable TypeScript 7 legacy parser API and stopped before checking helpers. Its error is retained in `helper-parity-initial.log`; the final bounded textual comparison is described above and passes. No implementation change was made to obtain a pass.
- TypeScript check: **PASS**.

All evidence is under `var/evidence/standard-commerce-independent-v2-20260930/`; `pins.json` records hashes for inputs, probes and logs. Key evidence:

| File | SHA-256 |
|---|---|
| `probes-v2.test.ts` | `4d6ab3652576ca54c01dfff51d3a0e5f5f7496f4721beb35906f38c1c6b2b224` |
| `original-probes-v2.log` | `e27f97a8ddef22db0629327f1c7672a87565435c7c9f761e35ba3f9a5fc275bf` |
| `extra-boundaries.test.ts` | `ab693745988448e4cc24ad02b338a28fa489701e41861bd69586e9c0b63e4e0e` |
| `extra-boundaries.log` | `d095ea30eba65ea99bf554d95fde10e03d0be56c53159ccf6b5a4d9bf595a476` |
| `affected-tests-v2.log` | `d44b8dea34d64b8d18d55778b0fe706a862793ef04e7a1cece3574cadf8500ef` |
| `helper-parity.json` | `f7610f5d15d2a1e62c41af1f61945fb935d919c22339f57b92f792d854d52171` |

## Limits

Primary selection remains an explicitly documented DOM heuristic; it does not compute source CSS visibility or prove full-page coverage on arbitrary sites. An observed image without verifiable retained bytes remains unknown and still needs downstream content/media acceptance. Legacy entity identity/type and top-level offer/price handling are intentionally not upgraded by this review; normalized commerce is the new sidecar. Tests do not establish that every source's commercial semantics are recognized.

The separately owned Pipeline handoff, native catalog/SKU APIs, live site editing, server deployment, source closure and general readiness are outside this acceptance. Native execution of this change is **NOT_RUN** here. The source registry and missing/unresolved URLs must remain in the denominator. No readiness status is promoted.
