# Native transport probe — 2026-09-30

Task `native-transport-probe-20260930`, worker `commerce-model`, fence 1; input `art-d467cd81-2d88-46c9-9a26-fe8b8c39ca05`. Only `scripts/verify-native-transport.php`, its local integration test and this report were written. No server, Store, target database, vendor code, router or accepted transport helper was modified by this author.

**Author result: implemented and locally checked; native CMS execution NOT_RUN.** The executable returns `CHECKS_PASSED` for the verified contract, not a self-issued native/deployment/readiness verdict. Root must execute it inside the separately attested actual PHP sandbox as uid33 and compare external before/after database counts.

## Executable boundary

The script accepts only CLI and six explicit `--key=value` arguments: `project`, `target`, `document-root`, `transport-sha256`, `prepend-file`, `prepend-sha256`. Unknown, duplicate, positional, malformed and missing arguments fail. Project/target must match `UPGRADE_PROJECT_ID`, `UPGRADE_TARGET_ID` and `UPGRADE_DEMO=1`. Document root must be an existing canonical directory. Helper is always the fixed own path `<document-root>/local/modules/upgrade.core/lib/demotransport.php`; there is no arbitrary helper include argument or production-bypass mode.

Before any CMS include, the script requires the active sandbox constant, exact `realpath(ini.auto_prepend_file)` and pinned prepend bytes, disabled/absent mail and process functions, disabled URL fopen/include, and no already-loaded D7 Application or DemoTransport. Own helper/prepend and prolog must be canonical bounded independent regular files; helper SHA is checked before and after its require. Background-agent/statistic constants must be true. Explicit prepend path/hash lets local fixtures exercise the same guards without weakening the actual command's fixed `/opt/upgrade/prepend.php` binding.

Synthetic inert query (`bx_hit_hash`, repeated/empty/encoded values), POST form (`AUTH_FORM`, `TYPE`, `USER_LOGIN`), cookies, authorization headers and upload metadata pass through the accepted `DemoTransport::capture`/`isolateGlobals` before the actual `prolog_before.php`. Captured GET target and POST target/body are checked for exact preservation; source/private input values never appear in output. Globals must be empty and vendor-facing method/URI/query neutral before bootstrap.

After bootstrap, the script reads the actual D7 request's query/post/cookie dictionaries, method and URI. All three dictionaries must be empty, method `GET`, URI `/local/upgrade-route.php`. A mismatch fails before any count SELECT. Only then the script calls `Application::getConnection()->query()` with three fixed statements:

```sql
SELECT COUNT(*) AS C FROM b_user
SELECT COUNT(*) AS C FROM b_sale_order
SELECT COUNT(*) AS C FROM b_event
```

No authentication API, mutation SQL, request dispatch, DemoEngine operation, real order/message/payment or explicit network request is invoked by this probe. Counts are bounded integers and only reported when all three reads succeed. Context failure yields `counts_status: NOT_RUN`; an incomplete count stage yields `NOT_VERIFIED`; success yields `READ_ONLY_SNAPSHOT`. One post-bootstrap snapshot cannot establish the absence of prior writes: `before_after_comparison` remains `NOT_PERFORMED`. Licensed bootstrap behavior and container network isolation remain independent native checks.

Output is one JSON record with project/target IDs, available effective uid, accepted helper/prepend hashes, observed prolog hash, neutral context, retained-request hashes and counts. CMS stdout is buffered and discarded. PHP diagnostics and arbitrary exception text are replaced by controlled errors; abrupt bootstrap exit emits a failure record through shutdown handling. The CLI caller must still treat timeout, malformed/missing JSON or nonzero exit as failure/unknown, never PASS. `native_deployment_attestation: REQUIRED_SEPARATELY` and `readiness: NOT_EVALUATED` explicitly remain.

## Root native invocation

Use the installed sandbox PHP configuration; do not pass `-n` or relax any PHP/container isolation setting. Upload the pinned script as a root-managed readable own file, for example `/var/lib/upgrade/verify-native-transport.php`. Execute the following PHP argv **inside the existing PHP service as uid33**, with a host-side bounded timeout such as 90 seconds around the container-exec command:

```sh
php /var/lib/upgrade/verify-native-transport.php \
  --project=teplypol-market \
  --target=target-teplypol-20260929 \
  --document-root=/var/www/html \
  --transport-sha256=62f6d1268affb1983ad4b5cf7979c729d207c777f824ccc381545ac909256e5d \
  --prepend-file=/opt/upgrade/prepend.php \
  --prepend-sha256=52d886b9450eba6d6f37f26a1bb82778513309e8782c5bace622bec288dc4760f
```

The prepend SHA above is the last native baseline supplied by root, not re-read by this author; root must verify it against the actual trusted runtime before running. Helper SHA was independently read from the accepted local helper. Record deployed probe/helper/prepend pins, actual image/container/document-root binding, uid33, exit status and JSON. Compare the three counts with separately recorded counts immediately before and after this probe. This is a CLI native-context witness, not a native HTTP/browser POST test or a complete proof of every possible CMS side effect.

## Local actual checks

With `UPGRADE_PHP_BIN` set to the repository's verified `var/tools/php-8.3.35/php.exe`:

- `node --disable-warning=ExperimentalWarning --test tests/integration/native-transport-probe.test.ts tests/integration/demo-transport.test.ts`: **7/7 PASS, 0 SKIP**, 1543ms. Five tests concern the probe; two rerun the accepted transport/router contract.
- `var/tools/php-8.3.35/php.exe -n -l scripts/verify-native-transport.php`: **PASS**.
- `npm run check`: **PASS**.

The probe tests execute actual PHP processes against explicitly synthetic temporary D7 stand-ins. They observe the globals received at bootstrap and exactly three SELECT statements, exercise fourteen pre-bootstrap failures with exact error reasons and no bootstrap marker, five nonneutral request contexts, arbitrary vendor output/exception and abrupt exit redaction, and incomplete-count rejection without partial success data. The PHP fixtures are **not** an installed Bitrix test. All temporary paths are checked before recursive cleanup.

Initial draft tests exposed an argument-tokenizer defect: option names containing digits (`*-sha256`) were rejected. The parser was fixed to allow digits after the first letter, then every negative case was strengthened to assert its specific guard reason. The final positive and negative runs above passed; the initial failed draft is not represented as native evidence.

## Frozen pins

- `scripts/verify-native-transport.php`: `c9c725747a65093f350d45e0da6913e63308940c43a657ad12650ab080349982`.
- `tests/integration/native-transport-probe.test.ts`: `0653633310084731177c587a1b92654ab4a6cb68f3b544e1717e58316e4fd607`.
- Read-only accepted helper: `62f6d1268affb1983ad4b5cf7979c729d207c777f824ccc381545ac909256e5d`.

Primary API references: [D7 HttpRequest](https://docs.1c-bitrix.ru/api/classes/Bitrix-Main-HttpRequest.html) documents the query/post/cookie dictionaries, `getRequestMethod()` and `getRequestUri()`; [Context::getRequest](https://dev.1c-bitrix.ru/api_d7/bitrix/main/context/getrequest.php) documents obtaining that request from the current application context. Actual compatibility with the licensed installed build remains for root's native run.
