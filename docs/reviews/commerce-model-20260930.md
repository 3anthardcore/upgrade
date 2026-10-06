# Evidence-backed commerce observations — 2026-09-30

Task `commerce-model-20260930`, owner `commerce-model`, current attempt/fence3; original attempt deadline 04:01:51 UTC. Root owns the authoritative retry receipts and deadlines. Writes are limited to the new commerce contract/extractor, additive operator/model types, focused tests and this handoff. Root owns model/build integration, authoritative Store and target writes; the Bitrix agent owns the demo engine. No server, Store, target database, browser, source network request or Git mutation was performed here.

## Review history and corrected attempt

**Attempt 1: REJECT after independent review**, despite its 53 passing local tests. The first frozen extractor SHA was `b0f7cc90aa2e482712ff2214b35062f17e2158e486696cef6260b577637079d9`. Four confirmed failures could promote unsupported current prices: nested foreign/unrelated Offer identities; a FROM marker in a separate sibling element; Offer.lowPrice without an exact price; and metadata overriding contradictory visible amount/currency or erasing a visible condition. Those earlier passing tests did not cover these cases and are not acceptance evidence for them.

**Attempt 2: REJECT after independent re-review.** Its extractor SHA was `453093b7832ae91c0d69c27e2ad3470d8b896360d4541ff786d6e3d9900b52bb`; all original8 review witnesses and57 tests passed independently. However a bare visible number still lost to conflicting metadata: visible200 with content100 and metadata RUB/piece gave an eligible100. The four earlier fixes remain: nested identities/availability/quantities bind to their owner; original source array indices survive filtering; sibling FROM and lowPrice-only remain non-exact; visible suffix-currency conflicts and conditions are retained.

**Attempt 3: independent amount parsing; awaiting re-review.** Visible amount and metadata now have separate canonical parses. A visible number always supplies the observed amount; content may agree but cannot replace or repair it. Unparseable visible text cannot acquire an amount from content. Explicit currency may fill missing currency; contradictory currencies/units, invalid content and unknown neighboring text block eligibility. Metadata-only microdata remains a metadata observation when no visible text exists, without pretending a hidden child was visible. Hidden descendants do not donate price text. FROM before/inside/after the node and OLD/current contradictions remain nonchargeable. Unsupported explicit price-role values are UNKNOWN. More than one visible unit is a conflict.

The added table-driven matrix covers36 combinations of visible numeric/currency-suffixed/invalid text, absent/equal/different/invalid content, and absent/RUB/USD currency metadata. A second group covers17 surrounding-currency/FROM/role/unit/conditional cases and hidden descendants. Ambiguous structures intentionally lose eligibility; additional source-layout support should use a separately reviewed typed price grammar or source profile, not progressively assume unsupported patterns. No universal price parser claim is made.

## Executable contract

`packages/contracts/commerce.ts` defines serializable `CommerceModel { schema_version: 1, entries: CommerceObservation[] }`. `ContentModel.commerce` is optional for backwards-compatible readers and fixtures. The operator extractor now produces it from accepted DOM bytes before generic cleanup removes controls. Each entry is bound to the unchanged `entity_source_id`, exact source URL/request target and snapshot evidence. The exported pure function `extractCommerceObservation(html, options)` also permits bounded offline diagnostics; its caller must supply the accepted immutable byte identity, as the operator path does after its existing byte/SHA validation.

Existing `ContentEntity.source_id`, `type`, `page_type`, generic blocks, sanitized HTML and raw facts are not rewritten by the commerce code. The legacy top-level `prices`/`offers` arrays remain unchanged. The pilot's previously imported Page identities remain Page; `page_kind` is a separate presentation observation, never a migration of a Bitrix element's stable type key. DOM controls, source scripts and text cannot grant execution permissions or clear the source access block.

Each nullable `CommerceFact` has OBSERVED/UNKNOWN/REQUIRES_REVIEW status, nullable evidence and reason. Evidence includes source URL, observed timestamp, original positional locator, snapshot SHA-256 and `untrusted-source-data`. Key fields agreed with the demo-engine author:

| Field                            | Meaning                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_kind`                      | HOME/PRODUCT/CATEGORY/ARTICLE/SERVICE/CONTENT/UNKNOWN; explicit structure/JSON-LD or documented DOM heuristic, separate from entity type      |
| `product`                        | Observed name, brand, SKU, availability **label**, attributes; no invented stock count                                                        |
| `prices[]`                       | ID, CURRENT/OLD/FROM/RANGE/UNKNOWN role, original text, exact money, optional maximum, explicit unit, conditions, eligibility, evidence       |
| `purchase`                       | Selected unambiguous price ID; observed min/step/max/default quantity; quantity evidence; blockers                                            |
| `variants[]`                     | Explicit observed Product.hasVariant or Offer.itemOffered rows, with stable observed identity, attributes, their own prices/purchase/evidence |
| `selections[]`                   | Observed select names/labels/options/required state; these dimensions are **not** expanded into variants                                      |
| `breadcrumbs`, `links`, `images` | Observed labels/exact safe same-origin routes and image source/alt; image SHA only from the trusted verified-byte resolver                    |

Root must filter `commerce.entries` alongside selected entities when building a subset, and add the new contract/extractor files to the model implementation fingerprint. The target adapter should project `entity_source_id` and exact routes, not derive a new identity from page classification. API field names were coordinated directly with the demo-engine author before implementation.

## Price and quantity boundaries

Money uses canonical decimal strings and a safe integer minor amount only when currency scale and magnitude are established. RUB/USD/EUR/GBP use scale 2; JPY uses scale 0. Other explicit ISO codes retain decimal/currency but `minor: null`. Decimal parsing rejects exponent notation, negative amounts, ambiguous punctuation/grouping, unsupported fractional precision and long numeric tokens. BigInt arithmetic is used before testing safe-integer limits; no binary floating-point price multiplication occurs here. Bare `$` does not establish a currency.

DOM role evidence includes explicit price-role attributes, conventional price-new/price-old markers and struck-out old prices. Contradictory old/new markers are UNKNOWN. A single unlabelled amount does not automatically become a current price. Structured prices require a page-bound Product in recognized schema.org JSON-LD. AggregateOffer keeps FROM/RANGE behavior. A price amount's existence does not establish an exact current total: FROM/RANGE/OLD, missing/ambiguous amounts/currency/units, conflicting current candidates and conditions block totals. Uninterpreted residual price text is retained as a condition and also blocks eligibility.

Observed quantity constraints come from the source quantity control attributes or an explicit single Offer.eligibleQuantity. Values remain exact positive decimals, bounded by the local technical maximum 1,000,000 with six fractional digits; this cap is not a source-stock claim. Missing min/step/max remain null. A default value of 1 does not imply a minimum or step of 1. Missing/invalid constraints and contradictory ranges remain blockers. Consumers must evaluate both `price.totals_eligible` **and** `purchase.blockers`/selection state; a price row alone never authorizes an order or payment. This module creates neither.

Variant rows are materialized only from explicit structured observations; option controls alone do not imply any Cartesian combinations. Duplicate observed variant identities fail for review. Rows, prices, selects/options, links and media have finite caps from `COMMERCE_LIMITS`. Additional unsupported source structures remain raw generic content and require further reviewed extraction rules. The implementation does not claim a universal commercial interpretation of every CMS or source layout.

## Inert DOM and provenance

The sidecar uses a separate parsed DOM and cannot change the generic extractor's nodes. It respects the selected primary landmark, the observed HTML base, explicitly hidden descendants and safe same-origin path/query identity. Invalid base URLs fail; foreign relative references do not become local routes/assets. Known action endpoints/parameters, handlers/button/action anchors and unsupported schemes never become navigation. Input emails/names, source script execution and submissions are not copied into commerce state. Missing/empty images get no URL or synthetic SHA; accepted image hashes are attached only through the caller's resolver.

Semantic classification is a heuristic where the source does not declare a page-bound type. A unique quantity control with explicit price structure supports PRODUCT presentation; repeated linked headings/images support CATEGORY. HOME is the exact root request target. Article/service classification currently requires unambiguous page-bound structured data. This evidence is not proof of complete page coverage, source HTTP access, current stock or verified target functionality.

## Local saved-source diagnostic

The original pre-review bounded diagnostic selected the latest saved observation per exact URL from `var/pilots/teplypol-catalog-20260929/*.raw.json`, computed SHA-256 from its inert HTML and invoked only the pure commerce extractor. It did not publish or accept any Store artifacts. These historical counts are not a rerun of the full pilot after attempt3 or current source coverage. At that snapshot:

- 131 DOMs processed, no extraction exceptions; about 2.6 seconds.
- Presentation: 66 PRODUCT, 48 CATEGORY, 16 CONTENT, 1 HOME.
- Price roles: 6 CURRENT and 6 OLD on explicitly paired pages; 60 UNKNOWN on contradictory `price_old old_new_price` markup. No variant rows were manufactured.
- 0 prices were eligible for totals: the captured pilot data did not establish all required units/quantity constraints. This is an honest data boundary, not permission to infer defaults.

The saved HW-500 regression confirms CURRENT 2178 RUB and OLD 3350 RUB as separate observations, Page identity unchanged, default quantity 1 retained, unit/minimum/step unknown. A dedicated fixture verifies exact 2178.50 RUB per m² plus observed 0.5 minimum/step, and a separate fixture proves four explicit variants from a 2×3 option control set. Source scope/UNKNOWN full-site denominator and access gates remain separate.

## Validation and handoff

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path var/tools/php-8.3.35/php.exe).Path
npm run check
node --disable-warning=ExperimentalWarning --test tests/integration/commerce-observations.test.ts tests/integration/operator-extraction.test.ts tests/integration/operator-heartbeat.test.ts tests/integration/catalog-extractor-review.test.ts
```

Attempt3 local result: **TypeScript PASS; 59/59 targeted tests PASS, 0 SKIP**, duration1670.3002ms (17 commerce, 30 established operator, 11 independent catalog regressions and 1 heartbeat regression). Historical attempt2's first source-index run had a TypeScript inference error while57 tests passed; an explicit map return type fixed that, and subsequent checks passed. Current focused tests cover the independent-review failures and expanded matrix above, current/old/from/range/conditional and ambiguous prices, exact decimal/minor bounds, explicit variants vs missing combinations, quantity unknowns, safe URL/base behavior, injection remaining text, exact source evidence, sidecar integration before control removal, unchanged legacy entity identity/generic behavior, heartbeat fairness and actual saved pilot DOM. The PHP formatter regression uses real local PHP; it is not a CMS integration test. Final code hashes are attached to the task handoff.

Independent review, model/build projection, target engine behavior, real import, route/browser/mobile checks and acceptance are root's next steps. No DEMO_READY claim is made, and no unperformed Bitrix or source-network check is marked PASS.
