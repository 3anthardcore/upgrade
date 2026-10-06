# Native catalog core — 2026-09-30

Task: `native-catalog-core-20260930`, owner `catalog-engine`, fence 1; input `art-2c33b1dd-258e-41c6-a7d8-5a74bc5aed05`. Author implementation, awaiting independent acceptance. **Local contracts PASS; licensed Bitrix catalog execution NOT_RUN.** No server, authoritative Store, target DB, vendor files or existing pipeline files were changed by this task.

## Implemented boundary

`packages/bitrix-adapter/catalog.ts::projectNativeCatalog()` produces a separate `native-catalog-overlay` JSON projection. It is always `PARTIAL`, with `runtime_verification: NOT_RUN`. `writeCatalogProjection()` writes an exclusive new file and returns its exact byte count/SHA-256; publication/acceptance belongs to the durable core.

Inputs are project/target IDs, accepted content manifest and model hashes, existing page references, `CommerceModel`, and optional explicit observed category membership. A page reference carries `source_id`, the **existing** `stable_key`, `payload_sha256`, `source_url`, and title. The payload hash must come from the accepted content import/readback using the existing Gateway serialization. It is not a new Product-derived key or a hash of reformatted source prose. The native adapter checks `ug_entity` project/source/key/payload, the exact content-package operation in `ug_operation`, the live element ID/XML_ID, and all existing Gateway-managed fields including decoded `UG_FACTS`. Parent Page contents and URL mappings are never rewritten.

Only observed PRODUCT entries become overlays. An offer key hashes `[project, "offer", parent source_id, observed variant id]` using JSON UTF-8 serialization. Four observed combinations from two selections with 2×3 possible options remain four offers; SKU equality across parents does not merge them. Selected controls do not generate combinations. Offer attributes/SKU are retained in a dedicated own string property; native offer names are deterministic factual attribute labels. `CML2_LINK` and native `TYPE_OFFER` establish real parent linkage. Categories are explicit mapped roots, not inferred from global links or constructed as a guessed hierarchy.

Exact CURRENT prices require an observed, unconditional amount/currency, matching integer minor units, an explicit unit and observed valid quantity min/step. Amounts are passed as decimal strings; three two-decimal currencies (RUB/USD/EUR) are admitted. An explicitly observed zero amount is distinct from an unknown price. Old/from/range/ambiguous or incomplete prices remain observations with blockers and create no native price. Evidence must belong to the corresponding source page. Native prices are attached to offer IDs for variant products. Price and ratio rows are read before add/update; updates retain existing IDs. Min/max quantity are preserved as metadata, **not claimed as native checkout enforcement**.

Source stock/availability is not imported. No `QUANTITY`, `QUANTITY_RESERVED`, or `AVAILABLE` value is sent to Product APIs. `QUANTITY_TRACE=Y`, `CAN_BUY_ZERO=N`, `SUBSCRIBE=N` are explicit demo sale-safety configuration, not source facts. Native product default quantity/measure/availability may still exist because of CMS behavior; they must not be presented as observed source values. Metadata labels stock UNKNOWN. There are no sale/order/payment/mail calls.

## Native seam and exact prerequisites

`bitrix/importer/catalog.php` is a standalone private CLI in the application checkout. It does not replace `upgrade import`, the content importer, or DemoEngine. Its sibling relative include expects the application `bitrix/importer/` + `bitrix/module/upgrade.core/lib/` layout, not a publicly copied importer endpoint. Code deployment/autoload registration and a durable native-dispatch adapter remain separate integration work.

The pinned `CatalogTargetProfile` contains positive dynamic IDs:

| Field | Verified native object |
|---|---|
| `product_iblock_id` | Existing own content iblock, XML_ID `upgrade:PROJECT` |
| `offers_iblock_id` | Dedicated own offers iblock, XML_ID `upgrade:offers:PROJECT` |
| `sku_property_id` | Nonmultiple E property `CML2_LINK`, linked to the product iblock |
| `product_metadata_property_id` / `offer_metadata_property_id` | Own nonmultiple S properties named `UG_CATALOG_DATA` in their respective iblocks |
| `price_group_id` | Existing price group verified via catalog API |
| `measures` | Explicit source-unit → `{id, code}` assertions, both verified |

The profile additionally binds schema 1, project, target and `sale_policy: isolated-demo-no-orders`. Preparing the offers iblock/properties and selecting verified dictionary IDs is an explicit prerequisite through documented CIBlock/CIBlockProperty/catalog APIs. **This version does not automatically provision those prerequisites.** No sample numeric IDs should be copied from tests. The `setup` command only registers the verified existing iblock pair through `CCatalog::Add`; repeat reads and validates the registration first. It refuses an already registered parent that is itself an offer iblock. A new profile requires explicit reconciliation/migration; old private checkpoints cannot silently change profile binding.

Example sequence, with every variable obtained from accepted artifacts/private target configuration:

```sh
php bitrix/importer/catalog.php --command=validate \
  --catalog-file="$CATALOG" --catalog-sha256="$CATALOG_SHA" \
  --profile-file="$PROFILE" --profile-sha256="$PROFILE_SHA" \
  --project="$PROJECT" --target-id="$TARGET"
```

The same four file/pin arguments and project/target binding are required for every command. Inside the previously verified isolated PHP CLI add `--document-root="$CMS_ROOT" --state-dir="$PRIVATE_STATE"`. Run `claim --owner="$OWNER"`; use the returned fence for `setup` and `apply` with `--owner`/`--fence`. `setup` and `apply` additionally require `--backup-receipt` and externally accepted `--backup-receipt-sha256`; receipt project/target/age and actual SQL hash are checked before CMS bootstrap. Then run `dry-run`, review all conflicts/withheld prices, `apply`, `reconcile`, and a second `apply` to prove skipped replay. Root must publish real API/HTTP/admin evidence separately. This is not a self-authorizing production deployment recipe.

`validate` never bootstraps Bitrix. All native commands require the project/target demo environment, exact `/opt/upgrade/prepend.php` sentinel/configuration, disabled mail/process functions and private state outside document root; Linux state must be owner-private. Bitrix request globals are neutralized for CLI bootstrap. Network isolation, pinned runtime and source-preserving backup are external prerequisites, not inferred from those PHP checks. Vendor exceptions are redacted to a fixed error; own validation reasons are bounded codes.

## Writes, recovery and conflict protection

The adapter acquires the exact existing `state/upgrade-PROJECT.lock`; its `claim` and per-entity transaction checks use the existing `ug_project` owner/fence/expiry. Catalog/iblock writes use APIs; SQL in this file addresses only own Upgrade tables. No catalog/system-table SQL writes are present.

Before a native transaction mutates an entity, the gateway durably publishes `state/catalog-PROJECT/KEY.json` in PENDING state with input hash, target/profile binding and exact before-state. File fsync, atomic rename and Linux directory fsync are required. The native transaction is read back and committed before the journal becomes COMMITTED. A lost commit acknowledgment leaves PENDING. Replay first compares destination state: exact desired state with unchanged native identity/stock is reconciled without duplicate API calls; exact before-state may retry; a third value fails closed. Unknown updates also protect existing price/ratio/offer IDs, not only their matching values. No automatic cleanup or rollback of another value occurs.

COMMITTED readback fingerprints protect subsequent manual changes, including prices, stock, metadata, sections and offers. A separately accepted content import can change original prose while retaining page identity: the new page payload/operation/live managed hash is verified first, then catalog data must still match its last readback. Corrupt checkpoints, changed profiles, missing mappings, stale fences and foreign preexisting native records are refused. Deleting offers/prices requires separate reviewed work; this version never silently deletes them. Pending checkpoint records omitted from a new projection block writes. Retained completed records outside the selected projection and incomplete temp files remain visible in `scope`.

The lease/flock serializes Upgrade writers. Uncoordinated native admin/third-party writers must be quiesced during import; this implementation does not claim to lock arbitrary vendor writers. Vendor event/cache side effects and actual transactional storage behavior require native evidence.

## Actual verification

Windows PHP 8.3.35 executed production `CatalogGateway` and `NativeCatalogPort` code against explicitly labeled documented-API/transaction doubles in independent temporary directories. The subprocesses restart between apply/reconcile/replay. They are **not Bitrix integration PASS**.

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path 'var/tools/php-8.3.35/php.exe').Path
node --disable-warning=ExperimentalWarning --test tests/unit/catalog-projection.test.ts tests/integration/catalog-gateway.test.ts
npm run check
& 'var/tools/php-8.3.35/php.exe' -l bitrix/module/upgrade.core/lib/cataloggateway.php
& 'var/tools/php-8.3.35/php.exe' -l bitrix/importer/catalog.php
```

Targeted tests: **25/25 PASS, 0 FAIL, 0 SKIP** (6 TypeScript projection groups + 19 actual PHP groups). They verify Page ID 1 preservation, exact decimal/ratio, four observed combinations per parent, distinct same-SKU offers, withheld prices, zero-price distinction, category mapping, setup replay, price update IDs, source/content/package drift, cross-page price evidence, native XML_ID collision, unknown commit/process restart, before-write rollback, third-value stock and price identity, stale fencing, actual competing flock, corrupt journal, omitted PENDING records, retained scope, and standalone validation before bootstrap. Exact final command output and file hashes are stored under `var/evidence/native-catalog-core-20260930/`.

Local WSL inspection returned `php: command not found` (Node v22.22.1). Linux/PHP directory-fsync behavior was therefore **NOT_RUN by this author**. No software or service was installed to change that environment. Windows file fsync and atomic replay were exercised; Linux native operator testing remains necessary.

## Remaining acceptance gates

1. Independent review of these exact file pins and adversarial tests.
2. Accepted dynamic target profile; explicit own offers/property preparation; compatible exact catalog API/module versions on the installed target.
3. Native setup/dry-run/apply/reconcile/replay, interrupted-write recovery and editable native product/offer readback under existing isolation. Native catalog scenarios, Linux durability and real vendor events remain NOT_RUN.
4. Durable core/CLI/native-journal integration, executable catalog deployment pinning and a verified public UI/provider bridge. Existing content and synthetic demo remain separate until that work is accepted.
5. Native indexed attribute filters, nested category hierarchy, real inventory, sale/checkout/payment, tax/discount/tier price rules, removals and full source coverage are not implemented here. Original source URL denominator is not cleared; this seam cannot set DEMO_READY.

Official API references checked 2026-09-30: the [catalog API selection guide](https://docs.1c-bitrix.ru/pages/modules/catalog/choose-catalog-api.html) distinguishes ORM reads from Product/Price model writes, offer pricing and catalog registration. [CCatalog::Add](https://dev.1c-bitrix.ru/api_help/catalog/classes/ccatalog/ccatalog__add.cee81079.php) documents registration and SKU linkage. [CIBlockElement::SetElementSection](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblockelement/setelementsection.php) documents section membership. The implementation uses these documented responsibilities; native compatibility still needs execution evidence.
