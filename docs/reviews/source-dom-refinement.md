# Portable DOM extraction: content and catalog refinement

Task `source-dom-refinement-v1`, authoritative run `run-3dc0ebd4-5200-4ae8-9e91-3be4f6ace3ca`, input `art-bcc1e5c0-3336-4baa-b0b1-c255728b7e4a`, initial HEAD `75aaae8`. This is the implementer's handoff, **not independent acceptance**. Root owns Store, browser capture, target imports and final review. No browser, network fetch, server/DB or Store operation was performed by this implementation task. No commit was made.

## Result and contract

The pure `extractOperatorContent(capture, options)` API is unchanged. It still rechecks accepted bytes and hashes, returns `PARTIAL` / `NOT_VERIFIED` / full-source `UNKNOWN`, preserves the entire accepted source inventory and access block, and does not create a fake complete crawl. Existing selected-field extraction and immutable historical models are not rewritten.

Primary content is selected from a unique usable `main`, `[role=main]`, `#content`, `#main`, or `#main-content`; a single appropriate article or body is the fallback. Usability is checked on an inert clone using the same cleanup as final extraction; script-only or hidden-only landmarks cannot hide a later real content landmark. Original nodes remain available for positional evidence. Empty/explicitly hidden landmarks and landmarks inside navigation/page chrome are excluded. The chosen selector is recorded as `facts['dom:primary_content']` with snapshot evidence and an explicit heuristic limitation. A page without H1 keeps its observed document title. Article headers inside primary content are preserved; global chrome is excluded. Source classes and styles do not transfer.

DOM traversal preserves order and emits one atomic paragraph/list/table/quote instead of duplicating nested text. Loose div/span text, including displayed prices and availability labels, is retained as plain content. Form wrappers are unwrapped after controls/scripts are removed, so factual copy inside a product form survives without actions or entered values. Explicit hidden attributes/styles are removed; stylesheet/computed visibility remains unknown. Original positional locators and source SHA/time accompany evidence. Depth above 200 or more than 10,000 emitted content blocks fails instead of silently truncating. Media must have verified accepted local bytes; absent images/documents retain missing status and never get a fake hash or remote fallback.

The common `ContentBlock` type is in `packages/extractor/index.ts`; no `packages/contracts/content.ts` change was needed. Root approved these additive blocks before implementation:

```ts
{ type: 'link', text: string, request_target: string,
  asset_sha256?: string, alt?: string }
{ type: 'card', text: string, request_target: string,
  asset_sha256?: string, alt?: string, items: string[] }
```

`request_target` contains the exact same-origin path/query, preserving encoded slash case, parameter order, duplicates and blanks. Link/card media is identified only by verified SHA; source URLs are not image fallbacks. Root owns package/PHP validation, rendering and CSS for these new types; that target work is outside these files.

Anchor-only fragments, known account/cart/checkout/payment/action routes and queries, event/button/action anchors, external URLs, tel and mail links do not become target navigation. Their observable inert text may remain. Same-origin ordinary legacy `index.php?route=product/product&product_id=…` stays valid data. The observed HTML base URL is respected for relative links, media, canonical and structured-data bindings; a foreign base does not turn relative references into local content. Invalid/unsupported base URLs require review. This navigation policy is conservative, not a general proof of every source endpoint's behavior. The own target router and GET-only isolated deployment remain mandatory.

`facts['dom:links']` preserves all eligible observed links in DOM order, including duplicates and empty image-only labels: `{label, raw_href, request_target, locator, image_source_url?, image_asset_sha256?}`. A textual block can use image alt only when it is the observed label of that image link. Rendering deduplicates navigation by exact target plus trimmed display label; raw facts retain the original labels/href.

Cards require repeated sibling containers with matching structural shape, exactly one heading link and an image linked to that same target. No hostname, CMS name or source CSS class identifies a card. Ambiguous or isolated structures stay ordinary blocks. Card items retain exact observed paragraph/loose text, including NBSP prices, stock text, reviews and promotional labels; no current/old price, discount, stock or commerce meaning is inferred. Consumed card interiors are not duplicated as separate blocks. Card dedup is independent of ordinary links and compares the entire emitted payload, including items and verified media hash. Only identical card payloads collapse; the same title/target with differing observed prices, availability or media remains separate. `dom:links`, `dom:cards` and source snapshot retain all original observations.

Brand-related facts have narrow provenance: one unambiguous `og:site_name` creates `dom:site_name`. On the exact homepage only, a header/banner home-link image whose source matches the unique same-origin `og:image` can create `dom:home_logo_alt`. This records the exact alt text; it is not a general brand inference from arbitrary logos or titles. Root requested this fallback for a reviewed visible home link label.

On the homepage, `dom:primary_navigation` records observed `header nav a[href]` / `[role=banner] nav a[href]` as `{label, request_target}`. The label is exact retained inert text, including source whitespace; only nonempty labels and safe same-origin targets survive. Dedup preserves first DOM occurrence of each exact pair. Explicitly hidden links/ancestors, event/action anchors, foreign links and contact/action endpoints are excluded. The fact carries the source URL, snapshot hash and observation time through standard evidence. It supplies a reviewed navigation candidate list, not proof of route availability: root's builder must include only routes present in the package. No metadata or source access policy is promoted by this fact.

Entity type policy was deliberately **not changed**. Existing unambiguous page-bound JSON-LD type detection remains; a general Page→Product migration is not authorized here. The real HW-500 DOM has no JSON-LD and still yields `Page`, preserving the pilot's previous type component of its stable key. Price/availability remain UNKNOWN and normalized offers/prices remain empty for this pilot.

## Verification performed

```powershell
npx --no-install prettier --write packages/extractor/operator.ts packages/extractor/index.ts tests/integration/operator-extraction.test.ts
$env:UPGRADE_PHP_BIN = (Resolve-Path -LiteralPath 'var/tools/php-8.3.35/php.exe').Path
node --disable-warning=ExperimentalWarning --test tests/integration/operator-extraction.test.ts tests/integration/operator-capture.test.ts tests/unit/discovery.test.ts tests/integration/discovery.test.ts
npm run check
```

Pre-review run: **67/67 PASS**, 0 FAIL/CANCEL/SKIP, 8480.8057 ms; TypeScript check exit 0. This included 27 operator extraction tests, 28 portable capture tests and 12 discovery tests, including the existing mediated Chromium fixture. No live source was fetched. The optional PHP formatter test ran against own pure formatter code with local PHP, not the CMS or target database.

New behavior checks cover primary landmarks/chrome removal, no-H1 title fallback, loose text and inert form copy, nonduplicated nested content, card structure and ambiguity, missing/verified media, exact query identity and action rejection, unambiguous metadata/home-logo provenance, nesting limits and same-/foreign-origin HTML base. Existing deterministic replay, capture immutability, hash tamper, challenge, malicious markup, wrong project and UNKNOWN commerce tests still pass.

### Independent rejection and bounded correction

Independent review in `docs/reviews/catalog-extractor-independent.md` rejected the first freeze for two P2 findings represented by three behavioral regressions: inactive-only `main` hid real `#content`; an earlier plain link suppressed a card's facts; equal card target/title suppressed differing source prices. Root authorized correction inside the existing task and separately requested the narrow homepage navigation fact above. The reviewer's tests and document were not edited by this implementer.

Final correction commands:

```powershell
npx --no-install prettier --write packages/extractor/operator.ts tests/integration/operator-extraction.test.ts
$env:UPGRADE_PHP_BIN = (Resolve-Path -LiteralPath 'var/tools/php-8.3.35/php.exe').Path
node --disable-warning=ExperimentalWarning --test tests/integration/operator-extraction.test.ts tests/integration/catalog-extractor-review.test.ts
npm run check
git diff --check -- packages/extractor/operator.ts packages/extractor/index.ts tests/integration/operator-extraction.test.ts docs/reviews/source-dom-refinement.md
```

Result: **36/36 PASS**, 0 FAIL/CANCEL/SKIP, 1245.4617 ms; TypeScript and whitespace checks exit 0. These are 29 own extraction tests and seven independent review tests, including all three previously failing regressions. Additional own tests verify that only identical full card payloads collapse, all three raw card observations remain, different verified/missing media produces separate blocks, and homepage navigation has exact URL/query/label/evidence and is absent on non-home pages. Own PHP formatter test ran locally; no CMS/DB operation occurred. No source HTTP request or browser execution was used. Independent reviewer must issue their own acceptance of the fresh hashes; this handoff does not self-approve the patch.

## Local diagnostic on saved real DOM

Root supplied untrusted `var/pilots/teplypol-catalog-20260929/*.raw.json` and corresponding `.html`. The diagnostic selected the newest `observed_at` per exact URL, checked that each raw JSON HTML equals the corresponding HTML file, then built and validated a temporary portable manifest. Only local accepted bytes were read. No media bytes were substituted or downloaded and no result was accepted into Store.

At that observation point: **27 saved URLs → 27 Page entities**, all selecting `#content`, extraction 2408 ms. Examples:

| Source request target | Blocks | Cards | Navigation links | Notes |
|---|---:|---:|---:|---|
| `/` | 89 | 84 | 3 | No H1; observed document title fallback; home-logo alt `Теплый Пол Маркет` established by the constrained rule. |
| `/katalog` | 108 | 12 | 29 | Category headings and exact source promotions retained. |
| `/termoregulyatory` | 81 | 49 | 18 | Product cards remain content snapshots, not implemented commerce. |
| `/termoregulyatory/grand-meyer-hw-500` | 45 | 0 | 8 | Page type unchanged; actual title/H1 and loose price text retained. |
| `/kontakty` | 14 | 0 | 2 | Contact text preserved; external contact actions are inert. |
| `/dostavka-oplata` | 59 | 0 | 2 | Content page, no fabricated card classification. |
| `/novosti` | 18 | 10 | 4 | Same structural rule groups linked news cards without Product typing. |

The temporary diagnostic had 789 known URL identities and **619 missing media URLs** because it deliberately supplied no media assets. All entities retained price/availability UNKNOWN; offers/prices were both zero, source state PARTIAL and denominator UNKNOWN. These are local extraction observations, not target coverage or accepted completeness. Root continues collecting inputs; the counts above describe this fixed diagnostic point, not every later file added to the directory. The subsequent HTML-base change and final bytes were covered by the targeted regression; the real-DOM table is not a claim that this exact final version was separately rerun on all later captures.

The final correction run did re-extract the three saved real pages in the reviewer's fixture, without supplied assets or network access:

| URL | Captured at (UTC) | HTML SHA-256 | Final local result |
|---|---|---|---|
| `/katalog` | `2026-09-29T16:47:23.259Z` | `4855b95753e1fcc978b9e0cb3964556f09e237b8a40e5b790a7534045b402b3b` | Page; 108 blocks; 12 cards; 71 missing assets |
| `/` | `2026-09-29T16:47:21.514Z` | `bf390a67869c5181a895433bc3e944c304d09fcd2b809e20a2c74239b0fa6ea1` | Page; 89 blocks; 84 cards; 92 missing assets |
| `/termoregulyatory/grand-meyer-hw-500` | `2026-09-29T16:47:26.280Z` | `f6bd6e4d0ec64e1094ed5a87ec550278d48bbdab8800e690efa73ec51dc19455` | Page; 45 blocks; zero cards; 63 missing assets |

## Handoff and limits

Source scripts remain inert raw evidence. No source styling, forms, submissions, cart operations, payments or review submission are implemented. Primary-content/card inference does not prove visual fidelity, computed visibility, full pagination, catalog completeness or source truth. Safe target links can resolve to 404 until the corresponding exact source URL is captured/imported; they do not fall back to the live source. All unresolved source identities stay in the accepted denominator.

Root should independently review additive block validation/escaping and the renderer, run full tests/E2E, and then verify actual multi-page target routes, images and small-screen layout against the accepted source scope. Existing target mapping must be reconciled before import; source access status and readiness must not be promoted by this presentation change. This implementation does not claim Bitrix integration PASS or DEMO_READY.

### Follow-up: blank source thumbnail reference

Root's media review reported `/aksessuary/adapter-welrok-bk` with an explicit homepage HTML base and a thumbnail anchor/image whose `href`/`src` were empty. The old media resolver treated the empty string as the base URL, inventing a homepage asset blocker. Root authorized this narrow follow-up under the same task; previous review remains historical evidence.

The media resolver now rejects absent/blank addresses before URL resolution. Blank navigation href is also inert. No homepage asset, missing-URL entry, replacement image or target link is manufactured from an empty attribute. `dom:missing_image_sources` preserves each retained DOM image's exact `raw_src` (null if absent), `alt` and original positional locator, with standard source URL/time/snapshot-hash evidence. Explicit limitations state that no image URL/content is established. This fact records an observed source omission, not successful image coverage or permission to fetch a fallback.

The new behavioral fixture includes homepage `<base>`, empty and whitespace-only image/anchor addresses and a missing `src` attribute. It verifies absent invented resources/navigation, exact omission evidence, retained description and unchanged PARTIAL status. Source snapshots were not modified, and no network request, browser operation or Store/target mutation occurred. The precise real adapter file was not independently re-extracted in this narrow run; root owns the real capture and fresh model acceptance.

Final command on frozen bytes: `node --disable-warning=ExperimentalWarning --test tests/integration/operator-extraction.test.ts tests/integration/catalog-extractor-review.test.ts` with the same local PHP environment above: **39/39 PASS**, 0 FAIL/CANCEL/SKIP, 1637.5266 ms (30 own + nine current independent review tests). `npm run check` and scoped `git diff --check` exit 0. Existing saved home/catalog/HW-500 review cases also reran successfully with unchanged counts from the three-page table. Reviewer source files remain untouched. Independent acceptance, full suite and target import remain root/reviewer steps.

### Follow-up: capture inspection also rejects whitespace-only addresses

The next independent fixture exposed an earlier boundary: `inspectHtml` accepted a truthy whitespace-only address, trimmed it to empty and resolved it to the document URL. The validator's `unverified_asset_urls` consequently contained a fabricated page asset before extraction began. The extractor-only correction above was insufficient for this case; its 39-test result remains historical. Root persisted permission to change `packages/crawler/index.ts` and `packages/crawler/operator.ts` in the task before this correction.

Only the `inspectHtml.resolveUrl` guard in `packages/crawler/index.ts` changed: absent/blank strings return before `identifyUrl`, and the existing excluded-scheme check uses the trimmed value. No page-path suppression, validator rewrite or filtering of legitimate declared assets was introduced. `packages/crawler/operator.ts` and the already frozen extractor files remain unchanged. Reviewer tests were not edited.

Final verification: `node --disable-warning=ExperimentalWarning --test tests/integration/operator-extraction.test.ts tests/integration/catalog-extractor-review.test.ts tests/unit/discovery.test.ts tests/integration/discovery.test.ts`, with the same local PHP environment: **53/53 PASS**, 0 FAIL/CANCEL/SKIP, 4821.3834 ms (30 own extraction, 11 independent review and 12 discovery checks). This includes the newly failing whitespace fixture, pinned real adapter DOM and mediated local Chromium fixture. `npm run check` and scoped `git diff --check` both exit 0. Source snapshots/server/Store remain untouched; browser fixture activity was limited to the existing synthetic local discovery test, not the pilot source. Actual target acceptance remains outside this run.

Latest frozen code SHA-256 (supersedes the prior `b67f4407…` source freeze):

| File | SHA-256 |
|---|---|
| `packages/extractor/operator.ts` | `b8805440b5b6577d49a0f529508653d68d90fe3d25edd9aae142e81b6b8c8d4a` |
| `packages/extractor/index.ts` | `af41334d939e8df71b64c734e1cfe1d19c04a818e44b9b0ac30ec66c8a02ec06` |
| `packages/crawler/index.ts` | `2b99d2d3a84f7165421dca49ac1581477b73a98cb454bd2cd76d924c988724cb` |
| `tests/integration/operator-extraction.test.ts` | `5bda60ba334de6d8624b0b2e149bd79ae92ab812cfdd499830ee6126bf3ac229` |
