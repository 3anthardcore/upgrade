# Independent catalog extractor review

Task `catalog-extractor-review-v1`; reviewer `codex-review`, fence 1. This reviewer did not author the inspected extractor changes. Scope: `packages/extractor/operator.ts`, additive `ContentBlock` types in `packages/extractor/index.ts`, implementer tests and `docs/reviews/source-dom-refinement.md`. Only this report and `tests/integration/catalog-extractor-review.test.ts` were written. Source files, browser, server, Store and target database were not changed or accessed for mutation.

Input SHA-256 was independently confirmed:

- `operator.ts`: `a67eebd0e640864fd64ed88dbec152a9f42848e5bf88ddc545f7782f8ab85ee6`
- `index.ts`: `af41334d939e8df71b64c734e1cfe1d19c04a818e44b9b0ac30ec66c8a02ec06`

## Findings on the frozen input

**P2 — a landmark containing only inactive content hides the real content.** In `primaryDom` (`operator.ts:153`), usability counts all descendant text before removing scripts, hidden nodes and navigation. `<main><script>bootstrap()</script></main><div id="content"><h1>Real catalog</h1><p>Real factual description</p></div>` selects `main`, then emits no real blocks and loses the `#content` description. The same issue occurs with descendants carrying `hidden` or `style="display:none"`. The independent first regression expects selection of `#content` and preservation of the factual paragraph. Use the same inert/hidden-content rules for candidate usability before selection; retain original nodes for evidence locators.

**P2 — link/card deduplication discards distinct factual content.** At `operator.ts:1193–1282`, plain links and cards share a Set keyed only by request target and trimmed label. A plain `/one` link labelled `One` preceding a repeated `/one` product card suppresses the entire card, including its observed price and availability. Two cards with the same target/label but different items also lose the second set of facts. `dom:cards` retains raw evidence, but the rendered block model omits these facts. Independent regressions cover both manifestations. Give cards a distinct deduplication domain and include their factual items/media in identity; only equal rendered observations should collapse.

These findings were reported immediately to root and the extractor author with executable repro paths. They are extraction correctness failures, not confirmed execution or secret-disclosure vulnerabilities.

## Checks that passed on the frozen input

Independent tests confirm encoded ordinary action paths/parameters are rejected as navigation, exact meaningful query order/duplicates/blanks survive a same-origin base, foreign base relative links stay external, and explicit same-origin links remain eligible. This is a conservative endpoint filter, not proof that every unrecognised source path is side-effect-free; the target own router, private GET-only profile and scenario gates remain necessary.

Ambiguous `og:site_name` values and an unrelated header image do not manufacture brand facts. Repeated sibling card structure preserves observed text, empty normalized `prices`/`offers`, UNKNOWN price/availability, source block and the unresolved inventory. Missing media has no fabricated SHA or source hotlink. Stable `Page` identity remains unchanged for the same input.

The local real-DOM diagnostic reads only saved JSON/HTML, checks exact equality of paired payloads, validates a temporary portable capture, and extracts it without media assets, network or Store. It covers the latest saved version of three named pages at the diagnostic snapshot, not all appended captures:

| Source path                            | HTML SHA-256                                                       | Blocks / cards | Result                                  |
| -------------------------------------- | ------------------------------------------------------------------ | -------------- | --------------------------------------- |
| `/katalog`                             | `4855b95753e1fcc978b9e0cb3964556f09e237b8a40e5b790a7534045b402b3b` | 108 / 12       | `#content`, Page, empty commerce arrays |
| `/`                                    | `bf390a67869c5181a895433bc3e944c304d09fcd2b809e20a2c74239b0fa6ea1` | 89 / 84        | `#content`, Page, empty commerce arrays |
| `/termoregulyatory/grand-meyer-hw-500` | `f6bd6e4d0ec64e1094ed5a87ec550278d48bbdab8800e690efa73ec51dc19455` | 45 / 0         | `#content`, Page, HW-500 title retained |

Observed timestamps: 2026-09-29T16:47:23.259Z, 16:47:21.514Z and 16:47:26.280Z respectively. Missing media counts 71/92/63 are expected because this diagnostic supplies no assets; they are not claims that the accepted pilot bundle lacks those files. The local diagnostic is explicitly skipped if the private saved directory is absent elsewhere.

## Validation and disposition

```powershell
npm run check
node --disable-warning=ExperimentalWarning --test tests/integration/catalog-extractor-review.test.ts
```

TypeScript PASS. Final independent run: **4 PASS, 3 FAIL, 0 SKIP** (7 tests; 1168.9 ms). The three failures reproduce the two P2 findings: inactive-only landmark, plain-link suppression of a card, and differing factual items sharing a card target/label. **Disposition: REJECT for the frozen input pending the author's fixes and independent retest.** Root accepted both findings and retains the review task for retest. The reviewer did not fix or modify the extractor.

Full repository suite, actual target import, browser/mobile parity, computed visibility, full catalog completeness and Bitrix behavior were not checked by this review (**NOT_RUN**). Root owns final acceptance and subsequent target checks.

## Independent retest after author fixes

The author supplied revised `operator.ts` SHA-256 `b67f4407d8d6091f2652a308e6ff8b99990df7447d820b01e97b9831d0f0a0d2`; `index.ts` remained `af41334d939e8df71b64c734e1cfe1d19c04a818e44b9b0ac30ec66c8a02ec06`. Both hashes were independently checked before retest. The reviewer still changed only the independent tests and this report.

The primary-content fix inspects a clone using the same `cleanPrimaryDom` function as extraction, preserving the original evidence nodes. Script-only, hidden-only and inline-hidden-only landmark regressions now retain the real `#content`. Card deduplication now has its own Set keyed by the whole emitted block, including factual items and verified image SHA. A preceding plain link no longer suppresses the card, and differing price text survives in separate cards. Both original P2 findings are **RESOLVED** on the revised hash; the initial failed evidence above is retained as history.

The additive `dom:primary_navigation` fact was reviewed and independently tested. It is emitted only for the exact home document request target `/`; an inner page or `/?view=all` does not become authoritative homepage navigation. It selects observed header/banner navigation text, keeps original label spacing and literal decoded text, and preserves exact path/query ordering. Inline handlers, action/button markers, hidden ancestors/styles, encoded known action URLs, unsupported schemes and foreign origins are excluded. Foreign HTML base behavior is explicitly tested. Labels such as `<Catalog>` remain untrusted text inside a Fact; this review does not claim downstream HTML escaping or rendering beyond the extractor.

Repeated commands listed above produced **TypeScript PASS; 9/9 independent tests PASS, 0 SKIP, 1292.7 ms**. The same three saved real source payloads were revalidated and re-extracted; the table's hashes, counts and Page typing remain unchanged. No source HTTP, browser, server, Store or target database operation was performed.

**Final disposition: ACCEPT for this bounded extractor change and the independently tested behavior.** This supersedes the initial REJECT only for the revised input hash. It does not imply complete catalog coverage, visual parity, working commerce, validated target routes or DEMO_READY.

Root can record these checks through the authoritative task lifecycle:

```json
[
  {
    "id": "extractor-input-sha",
    "status": "PASS",
    "details": "operator.ts b67f4407d8d6091f2652a308e6ff8b99990df7447d820b01e97b9831d0f0a0d2 and unchanged index.ts hash independently confirmed"
  },
  {
    "id": "landmark-data-retention",
    "status": "PASS",
    "details": "All three inactive-only landmark variants preserve real content; original P2 resolved"
  },
  {
    "id": "card-factual-deduplication",
    "status": "PASS",
    "details": "Plain-link collision and different factual items both retain full card blocks; original P2 resolved"
  },
  {
    "id": "homepage-navigation-safety",
    "status": "PASS",
    "details": "Exact home scope, hidden/control/action/external rejection, base behavior and literal label/query preservation independently tested"
  },
  {
    "id": "saved-source-content",
    "status": "PASS",
    "details": "Three pinned saved DOMs validate offline; catalog cards and HW-500 Page identity preserved; commerce stays UNKNOWN"
  },
  {
    "id": "target-runtime",
    "status": "NOT_RUN",
    "details": "No Bitrix, target HTTP, browser/mobile or database validation performed by this reviewer"
  }
]
```

## Narrow empty-source follow-up

Author's subsequent extractor SHA-256 `b8805440b5b6577d49a0f529508653d68d90fe3d25edd9aae142e81b6b8c8d4a` was independently confirmed. Direct `mediaFor` now rejects missing/blank addresses before URL resolution and records `dom:missing_image_sources` with raw source, alt, original locator and snapshot evidence; it does not infer an image from base URL. The exact real `/aksessuary/adapter-welrok-bk` snapshot SHA-256 `57d9feace5b4234e0b819027667dd3d990541e0d795f7fb59a72773c5f90605a` passes offline validation/extraction and does not create a homepage asset.

The first expanded independent run returned **10 PASS, 1 FAIL, 0 SKIP** (11 tests). A whitespace-only `src="   "` still entered capture `unverified_asset_urls` as the document URL: shared `packages/crawler/index.ts` `inspectHtml.resolveUrl` rejected an empty string before trimming but then resolved whitespace after trimming it to empty. The final extractor loop reintroduced that document URL as an unverified asset. Literal empty/absent strings were already excluded by this earlier inspector; the failing boundary is whitespace-only input. This was reported immediately with the precise shared helper and regression; the reviewer did not edit the source.

The prior P2 fixes and homepage navigation remain independently PASS. Acceptance of the expanded empty-source behavior is pending the inspector boundary fix and retest; the previous ACCEPT applies only to its recorded earlier scope and hash.

### Final boundary retest — ACCEPT

The author fixed the shared inspector before URL resolution. Independently verified final inputs:

- `packages/crawler/index.ts`: `2b99d2d3a84f7165421dca49ac1581477b73a98cb454bd2cd76d924c988724cb`
- `packages/extractor/operator.ts`: `b8805440b5b6577d49a0f529508653d68d90fe3d25edd9aae142e81b6b8c8d4a`
- Additive content types `packages/extractor/index.ts` remain `af41334d939e8df71b64c734e1cfe1d19c04a818e44b9b0ac30ec66c8a02ec06`.

Read-only inspection confirms the shared `resolveUrl` now rejects `!value?.trim()` before calling `identifyUrl` and checks unsupported schemes on the trimmed value. No pathname blacklist or substitution was introduced to hide legitimate media. The independent regression executes the complete temporary manifest validation → extraction path and verifies that absent, empty and whitespace-only source addresses produce neither document/homepage assets nor replacement images. Original missing source/alt/locator and exact snapshot SHA remain in the observed fact and limitation. The pinned real adapter DOM test passes as well.

Final independent commands: `npm run check` — **PASS**; `node --disable-warning=ExperimentalWarning --test tests/integration/catalog-extractor-review.test.ts` — **11/11 PASS, 0 SKIP, 1342.5 ms**. The previous landmark, factual-card, navigation, brand and saved source regressions all still pass. The reviewer changed no source files and performed no server/Store/target operations.

**Final disposition: ACCEPT for the final hash pair above, including the empty-source boundary.** This supersedes the preceding pending verdict; failed runs remain recorded as evidence of the fixed defects. Existing immutable captures/models are not silently repaired by this review, and the tests do not claim migration of historical malformed evidence. Actual Bitrix import, HTTP, browser/mobile behavior, full catalog completeness and DEMO_READY remain outside this independent review (**NOT_RUN**).

Additional check for root's authoritative lifecycle: `{ "id": "blank-image-source-boundary", "status": "PASS", "details": "Independent full validator-to-extractor test rejects absent/empty/whitespace src as URL inputs; exact adapter DOM SHA57d9feac… retains missing-source evidence without a homepage asset; final paired source hashes verified" }`.
