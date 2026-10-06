# Ordinary commerce bridge: independent review, 2026-09-30

**V1 verdict: REJECT — two P2 findings.** This is an independent review of extractor SHA `4f34a0d935f751de2dfba0d341710a4d7e0d4109eb1785527016fd629560a859`, standard-commerce test SHA `9d28525b19f964502dc70a171228fde5745abbc9dd39def6ab3a39415f012c75`, and author report SHA `3c1f1a1567ed48d21490db149e65d85806234503aa136b8dc560969498b06eea`. Task: `review-standard-commerce-20260930`; inputs: `art-67390377-d7b7-4393-9574-fdad45af16ca`, `art-d36bf9c5-7c8a-45c0-a0d5-e711ed0bedcb`.

The review changed only this report and its evidence directory. It used actual localhost HTTP crawls, closed the fixture source before extraction, and then called the real extractor offline. Each independent fixture checked the exact frozen extractor SHA before crawling. No server, source website, Store, target database or source code was changed. Root has accepted both findings for a subsequent revision; that revision is outside this V1 verdict.

## Findings

**F1 — P2: the supplied primary selector can normalize site chrome as the product or omit the actual product.** The new bridge passes `main`, otherwise the first `article`, otherwise `body`, with index zero. It overrides the normalizer's `#content` fallback and does not test whether the landmark contains usable visible content. Three independent behavioral failures:

- A header H1 plus `#content` product yields `product.name = "Site shell headline"`, instead of the observed primary heading `"Exact primary item"`.
- A script-only `main` before a real `#content` yields a null name instead of `"Visible primary item"`.
- A sidebar `article` before a real `#content` yields `"Sidebar promotion"` instead of `"Actual product"`.

The assertions fail on the names before subsequent price assertions; these logs prove the named failures directly. The source script is inert data and is not executed. Some generic-content selection behavior predates this patch, but the new explicit selector carries it into normalized commerce facts. Use a usable primary landmark and exclude inactive/sidebar candidates. Preserve legacy entity identifiers and avoid guessing omitted commercial facts.

**F2 — P2: FETCHED metadata without retained bytes becomes verified commerce media.** The new `verifiedAsset` callback checks `status === FETCHED` and image MIME, then returns its SHA. Existing `verifyCrawlSnapshots` skips records with no file path. Deleting only `body_path` from a fetched fixture asset therefore allows commerce `images[0].asset_sha256` to contain `f6d6acb2dcf66d4e1b6419962726cf72cb16371556bc7dbdfd4e66e2caee2b8c` despite there being no referenced retained file to verify. Expected behavior is an unknown image SHA or fail-closed rejection. This is a malformed-metadata boundary probe, not a claim that the normal crawler currently emits this shape. A verified-media callback must be backed by actual checked retained bytes, not the status label alone.

## Actual checks

```text
node --disable-warning=ExperimentalWarning --test tests/integration/standard-commerce.test.ts tests/integration/discovery.test.ts tests/integration/commerce-observations.test.ts
node --disable-warning=ExperimentalWarning --test var/evidence/standard-commerce-independent-20260930/probes.test.ts
```

- Author/regression set independently repeated: **29/29 PASS, 0 SKIP**, 5656.637 ms. This includes the local mediated browser test; it is not native Bitrix validation.
- Independent probes: **3 PASS, 4 FAIL, 0 SKIP**, 1739 ms. The four failures are the three F1 cases and F2.
- Passing independent boundaries: exact repeated/empty query values and their order retain separate identities; duplicate SKU across different observed brands does not collapse entities; unknown commercial values remain unknown; source extraction after HTTP shutdown makes no new source requests; the selected DOM buffer and its own SHA supply the observed price; changed DOM/image bytes are rejected; failed image status does not produce a verified commerce image.
- The initial probe draft set fixture rate 200, above the crawler's accepted maximum, and all seven cases stopped at option validation. `probes-v1.log` retains that harness configuration error. Only the fixture rate was corrected to 100 before the reported implementation findings. Those initial seven failures are not implementation findings.

## Frozen evidence

Under `var/evidence/standard-commerce-independent-20260930/`:

| File | SHA-256 |
|---|---|
| `probes.test.ts` | `486584d55501311699d093ec62f2fb6eb6638c7b1860d9fe8db53fb37e83b49a` |
| `probes-v1-final.log` | `729fcffa8af5aeb8fb7cf43037a9772ec909102f93e17c3731ba2aea9cdd788a` |
| `author-tests-v1.log` | `c084cd6e937b8630fd7aa182d0b1ea9c7ea4b395b2f0c7e929e6963f1147b9be` |

The live extractor SHA changed after these pinned executions while root prepared its fix. The probe retains the V1 pin and will reject a changed source. A V2 rerun must use a separate pin-updated copy and retain these V1 files/results.

No verdict is made here on the separately owned Pipeline handoff, native catalog/SKU mappings, server deployment, full-source completeness, or DEMO_READY. These local passes do not close those independent requirements.
