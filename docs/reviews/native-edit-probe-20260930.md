# Native edit probe — implementation and local verification

Task `native-edit-probe-20260930`, worker `commerce-model`, fence 1. Input `art-e8e3cf03-78c2-489b-8f57-76d033794874`: accepted plan `docs/reviews/native-edit-proof-plan-20260930.md`, SHA256 `18cdf1b63248dfddbfc456233e6eeed71fe9c06104315c047393fdbbef9c7b2f`.

**Author scope: local implementation and PHP fixture verification. Native Bitrix edit, Linux uid33/permissions, HTTP H1 and final package reconcile: NOT_RUN by author.** No server, Store, target DB or Git changes were made. Changed only the three assigned files.

## Executable contract

`scripts/verify-native-edit.php` implements separate CLI commands `prepare`, `inspect`, `edit`, `restore`. Every argument uses `--name=value`; unknown, duplicate or missing arguments are rejected. Named argument order does not affect receipt binding.

Common arguments:

```sh
common=(
  --project=teplypol-market
  --target=target-teplypol-20260929
  --document-root=/var/www/html
  --package="$VERIFIED_PACKAGE_DIRECTORY"
  --manifest-sha256=4141b1d86b294520f2a2dc02d668c0153924caa9d76ce6c74941b15e6a9a6a9b
  --route=/termoregulyatory/grand-meyer-hw-500
  --expected-id=1
  --state-dir=/var/lib/upgrade
  --proof-dir=/var/lib/upgrade/native-edit-20260930
  --prepend-file=/opt/upgrade/prepend.php
  --prepend-sha256="$VERIFIED_PREPEND_SHA256"
)
php "$VERIFIED_PROBE_PATH" --command=prepare "${common[@]}"
# Save the returned intent_sha256 in an external durable receipt; retain the proof directory.
php "$VERIFIED_PROBE_PATH" --command=inspect "${common[@]}" --intent-sha256="$INTENT_SHA256"
php "$VERIFIED_PROBE_PATH" --command=edit "${common[@]}" --intent-sha256="$INTENT_SHA256"
# Root now checks exact authenticated HTTP article > h1 and saves the witness.
php "$VERIFIED_PROBE_PATH" --command=restore "${common[@]}" --intent-sha256="$INTENT_SHA256"
php "$VERIFIED_PROBE_PATH" --command=inspect "${common[@]}" --intent-sha256="$INTENT_SHA256"
```

These are commands for the separately authorized native operator, not commands executed by this author. Run inside the existing isolated PHP runtime as real uid33, with its unchanged ini/prepend/network restrictions, `UPGRADE_DEMO=1`, exact project and target environment. The package must already have passed the complete native import/reconcile. Never reuse a prior proof directory or replace its receipts. The script checks canonical paths, pinned manifest/reader/installed own helpers, active pinned prepend, disabled mail/process functions, URL-wrapper restrictions, package/project/target, exact route/stable entity/XML_ID and unique plain single string `UG_H1` with empty description. Unsupported H1 formats fail before mutation.

## Durable proof and mutation boundaries

`prepare` requires a new private proof directory. It reads actual content, the exact `ug_route` and `ug_entity` rows, `MANAGED_HASH`/`PAYLOAD_HASH`, the project's `ug_operation` count and ordered full-row fingerprint, plus `b_user`, `b_sale_order`, `b_event` counts. All SQL is SELECT. Operation fingerprinting has a finite 10,000-row cap. Original route/mapping rows and all managed content are private receipt data, not emitted in stdout.

The baseline must equal the accepted package: full dry-run has no conflicts, blockers or planned writes, all entities skipped; managed and payload hashes are checked. Snapshot is reread after dry-run. `original.json` and `intent.json` are exclusive `xb`, mode0600, fully flushed/fsynced, read back and SHA-bound. Directory mode is0700. Linux also fsyncs containing directories after file creation and the parent after mkdir. A failure during prepare leaves evidence and permits no edit; do not adopt a partial prepare as a fresh proof.

The chosen test value is the original H1 plus `[проверка редактирования <proof-directory-name>]`, bounded to512 UTF-8 bytes. The single allowed mutation is `CIBlockElement::SetPropertyValuesEx(id, iblock, ['UG_H1' => value])`. The return value is not used as success evidence. A live `Gateway` holds the existing project file lock for reads, compare, write and readback. All other managed fields, identity, route/mapping, operation fingerprint and four counts must remain exact before and after mutation and after dry-run. Only scoped `CIBlock::clearIblockTagCache()` is called.

`edit` confirms the exact H1 and exactly one expected `USER_EDIT_CONFLICT:<entity_key>` in dry-run. `restore` compares against the pinned test value, restores only the original H1, then checks all baseline fingerprints and a clean dry-run. A third H1 or any other field/service drift stops without overwriting. Once `restore-intent.json` is durably created, the same intent cannot start another edit cycle. All inspections, requested operations and confirmations create new immutable receipts; original/intent are unchanged.

After a lost response, rerun `inspect` first. Original/test/third value are reconciled from current CMS data. Repeating edit when already edited or restore when already original performs zero API writes. An interrupted process reports UNKNOWN where possible; timeout or absence of stdout never proves that a write failed. Do not rerun prepare over an edited state.

## Actual local checks

Windows PHP8.3.35, with `UPGRADE_PHP_BIN` and `UPGRADE_PHP_EXT_DIR` pointing to the bundled verified runtime:

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/native-edit-probe.test.ts
& $env:UPGRADE_PHP_BIN -n -l scripts/verify-native-edit.php
npm run check
```

Result: **6/6 tests PASS, 0 skipped, 4017.8489ms**; PHP syntax PASS; TypeScript check PASS. Tests spawn actual PHP subprocesses, use actual Package validation and DemoTransport, and double CMS APIs/D7/uid in temporary fixtures. The write double asserts exactly `UG_H1`, matching id/iblock, and durable original+intent before writing. Real fixture file locks and restart/process-loss behavior are exercised. Tests cover edit/restore/replay, lost acknowledgement after both writes, third-party H1 and other content/identity drift, altered intent/original, route/mapping/operation/counter drift, reordered argv, target/project/uid/package guards before bootstrap and unsupported property description. The DB double rejects every non-SELECT query.

Windows fixture-defined `posix_geteuid()` is a guard contract double, **not native uid33 proof**. Unix owner/mode and directory fsync behavior remain native prerequisites. Local fixture success is not Bitrix event-handler/DB/HTTP success.

## Remaining operator checks

Root must separately record native `prepare → edit → exact HTTP H1 → conflict → restore → exact HTTP H1 → full reconcile`, with unchanged counts and hashes. Script stdout always says `native_http: NOT_RUN`; final restore says `full_reconcile: REQUIRED_SEPARATELY`. No readiness is promoted. The Gateway file lock coordinates own importers; arbitrary administrative editors require a quiet operator-controlled window, because a property API does not provide compare-and-set against unrelated admin writes.

## Frozen source pins

- `scripts/verify-native-edit.php`: `65ba3bc0ffbcfcf73d4c45ebbb54e910afe796d6b3f7704beca2acc3bc937343`
- `tests/integration/native-edit-probe.test.ts`: `fcf7d0cb351099f8a56759579da3654eff742989a48a89ffaa7e70b148ef34fa`

The review document's own SHA is supplied in the final handoff, avoiding a self-referential pin.
