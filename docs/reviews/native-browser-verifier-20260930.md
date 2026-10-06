# Reusable browser verifier, 2026-09-30

Implemented a bounded CLI verifier for the **authorized target demo**, with an externally pinned `data/demo-snapshot.json`. It launches a fresh, ephemeral Chromium context with JavaScript and service workers disabled; it never attaches to the operator's source browser, copies source cookies or invokes Codex desktop APIs. Native Bitrix execution is **NOT_RUN by this author**. Root performs independent review and the subsequent authorized native run.

## Invocation and evidence

Run from a POSIX host with Node 24, this project's dependencies and the installed Playwright Chromium. A Windows run is accepted only for the explicit HTTP loopback fixture mode: POSIX owner/mode checks cannot establish private Windows ACLs, so remote HTTPS execution there fails closed.

```bash
node --disable-warning=ExperimentalWarning scripts/verify-native-browser.mjs \
  --snapshot /absolute/accepted-package/data/demo-snapshot.json \
  --snapshot-sha256 EXPECTED_FILE_SHA256 \
  --origin https://AUTHORIZED-DEMO-HOST \
  --user upgrade \
  --password-file /absolute/private/demo-access-password \
  --product-route /EXACT-OBSERVED-PRODUCT-PATH \
  --output /absolute/private/NEW-browser-run
```

The output directory must not exist; its parent must exist. Existing ancestors and input files cannot be symlinks. The snapshot file SHA and the snapshot's content-derived ID are verified before launching Chromium. Exact request targets, including significant query order, repeated keys, empty values and percent escapes, are retained. A URL which the URL parser would normalize is rejected instead of silently substituted. An explicit product must be an observed product in the pinned snapshot; default selection chooses an observed non-variant product. No product, page kind, price or source fact is invented.

Output files are private (directory 0700, checkpoint/intent/receipt/screenshot files 0600). A separate SQLite transaction protects the output's sole writer and is released by the OS on process death; it is unrelated to Upgrade's content Store. The binding includes verifier SHA, snapshot file SHA/ID, project, target origin, username, selected product route and local-test mode. Passwords are read from a private file, never passed as command-line values or serialized.

Every screenshot has an immutable sidecar with its SHA and viewport assertions. `receipt.json` is created once; failures create separate immutable `failure-*.json` files. The private checkpoint contains the one own session cookie and form values needed for readback; these files must not be published. Public-form receipt data excludes passwords, cookie values, CSRF and idempotency keys. Do not put secrets in snapshot request targets: those paths are intentionally evidence.

## Write boundary and interrupted execution

The verifier only reads pinned snapshot document routes, exact own `/__upgrade/{search,cart,lead,receipt}` routes, own stylesheet and hash-named project media. The only permitted write endpoint is the exact `/__upgrade/action` POST. Before submitting a native form, it validates action, duplicate/unknown fields, snapshot ID, product/variant identity, CSRF shape, quantity bounds and fixed synthetic identity/consent. It saves an immutable intent and an **UNKNOWN** checkpoint before the request can leave the browser. The emitted body must hash exactly to the intent, and the browser-generated Origin must be the exact target origin. A second POST under the same dispatch allowance is rejected.

All document/resource requests, **including each redirect hop**, are intercepted using the documented Playwright CDP session and Chromium `Fetch.requestPaused` protocol. A separate bounded Node HTTP(S) transport performs the one approved request with explicit Basic authorization and only the own cookie. It has no cookie jar, proxy, automatic authentication retry, automatic redirect or request retry. TLS verification remains enabled. A POST may return only 303 to its exact operation-derived cart/receipt URL; any GET redirect is rejected before its Location reaches the browser. Unsolicited response transport directives (Link/Refresh/NEL/Report-To/Alt-Svc), vendor cookies, executable/embedded document markup and speculative-link hints are not forwarded. CSP reporting directives are rejected. Browser JS is disabled independently of these checks.

Boundaries: snapshot 16 MiB / 10,000 items; 220 intercepted requests; 12 MiB per response; 100 MiB total response bodies; 10-second absolute socket-request deadline, with the socket destroyed on expiry. Navigation/form/screenshot waits are bounded. The 240-second run budget is checked at operation boundaries; a currently admitted bounded Playwright operation can finish before the next budget check. The output is not a network-packet capture and does not prove OS egress isolation. No third-party source URL is deliberately requested.

After a lost response or other uncertain POST, a full rerun against the same directory is rejected. Explicit reconciliation uses the same pinned arguments plus `--reconcile`:

```bash
# Reuse the exact original arguments and output, then append:
--reconcile
```

It reloads the private session in a **new browser/process**, verifies each saved intent and reads only its operation-bound cart or synthetic receipt. It never resends the POST. A 404/unavailable response leaves UNKNOWN; a valid readback marks `CONFIRMED_BY_READBACK`. The run remains `INCOMPLETE_RECONCILED`, with a new immutable reconciliation receipt and zero repeated POSTs. This proves stored operation presence, not completion of the interrupted scenario. It does not resume later scenario steps, erase the earlier failure, or mark the old run PASS. A new complete test needs a new output/session. Already saved screenshots and operation receipts remain unchanged.

## Actual scenario and limits

Representative HOME, CONTENT, CATEGORY and PRODUCT pages are selected from the snapshot. Absent non-product kinds are explicitly NOT_APPLICABLE. The verifier also exercises native add/update cart, reload persistence, synthetic checkout/receipt, emptied cart, synthetic lead/receipt, empty search and category-filter/title-sort behavior. Search checks exact first-page target membership/order against the snapshot; title order uses Unicode lowercase UTF-8 bytes with ID tie-breaking and fails closed on unusual runtime Unicode differences. Fixed quantity policies can produce a same-value update, which is explicitly recorded. Source variants are accepted only when their observed ID is present in the selected form.

Nine rendered states are inspected at 360, 390, 768, 1024 and 1440 pixels (45 screenshot/sidecar pairs when all page kinds exist). Checks cover one nonempty H1/main, duplicate element IDs, control labels, button names, horizontal document overflow and native Tab/Enter navigation through the skip link. Screenshots show the first 1000 pixels of each state; this is not full-page visual acceptance or a complete WCAG audit. There is no claim to inspect every product/variant, all breakpoint content, native admin editing, orders/mail/payment tables, source closure or recovery. Cart removal and exact POST replay are covered by separate HTTP/engine tools, not duplicated here.

Counters are separate: `cdp_request_intercepts`, `browser_requests`, `browser_responses`, `mediated_fetches`, response bytes and blocked requests. The actual fixture asserts equality of request/interception/transport/response counts for its completed run; no counter is labeled an exact packet count. Four native form POSTs receive 303. All follow-up GETs remain intercepted.

Successful HTTPS receipt status is `BROWSER_SCENARIOS_VERIFIED`; loopback fixture status is `LOCAL_BROWSER_SCENARIOS_VERIFIED`. Merely selecting HTTPS does not prove Bitrix: `native_bitrix=CALLER_ATTESTATION_REQUIRED`, database effects remain a separate readback, `full_source=UNKNOWN`, `full_readiness=NOT_READY`. These fields do not alter Upgrade readiness or its Store.

## Verification and draft history

The initial local draft used Playwright `context.route()`/`route.fetch()`. The actual PHP test found vendor-cookie replay on four GETs in native 303 chains: standard route interception did not cover those redirect requests. That draft was rejected locally (9/10 cases), replaced with per-hop CDP interception and a transport without a shared cookie jar. A dedicated second-hop redirect regression now commits a synthetic operation, rejects a foreign Location at the following GET and retains UNKNOWN. No original native proof or published receipt was changed.

Commands:

```powershell
node --disable-warning=ExperimentalWarning --test tests/unit/native-browser-verifier.test.ts
npm run check
node --disable-warning=ExperimentalWarning scripts/verify-native-browser.mjs --help
Get-FileHash scripts/verify-native-browser.mjs,tests/unit/native-browser-verifier.test.ts -Algorithm SHA256
```

The suite uses actual PHP (`UPGRADE_PHP_BIN`, otherwise the project's local `var/tools/php-8.3.35/php.exe`) with mbstring and actual installed Chromium, never a fake engine response. A missing PHP binary fails rather than becoming SKIP. Other hosts should set `UPGRADE_PHP_BIN` and `UPGRADE_PHP_EXT_DIR`. Cases include input pins, exact query identities, form boundaries, vendor/duplicate cookies, response transport directives, exclusive durable journal, symlinked CLI entrypoint, full 45-screenshot scenario, committed-but-unacknowledged POST and **new Node process** reconciliation, foreign image/redirect, post-303 foreign redirect, actual slow response and size-limit enforcement.

Final run: **15/15 PASS, 0 SKIP**, 59.47 seconds. `npm run check` passed. CLI `--help` passed both directly and through a `current` directory symlink. A separate read-only `readInputs` invocation accepted the actual copied 389-item pilot snapshot, file SHA `907289cdf817e5b9141d22d595ebb136c4c794c93dc6f8ec5d600d1086f6d955`, snapshot ID `aadf871e2e4ab20a8d1e67603e4629db6740ee0d74b24223e2980b34308c2cd2`, explicit HW-500 source entity `operator_entity_f26b5a8a233ed1d9fdcc22e4`. No network request was made by that input check.

Code/test freeze:

- `scripts/verify-native-browser.mjs`: `fe526f3bcc89169059b3ae7e6875eaff08abdaf7d7e60f78df0daa62f9c6e1b7`.
- `tests/unit/native-browser-verifier.test.ts`: `d8c116abb2d2f64f786d00d05bb0f7ba103c9af85a41263e5f231edefbe9bd81`.

Author's check results, awaiting independent acceptance:

```json
[
  {"id":"browser-verifier-input-and-network-boundaries","status":"PASS","details":"Pinned input, exact paths, private output, own-origin per-hop CDP gate, independent bounded transport, immutable intents, cookie/directive filters, foreign resource/redirect and slow-stream regressions pass locally."},
  {"id":"browser-verifier-durable-scenarios","status":"PASS","details":"Actual PHP engine/web/view plus actual JS-disabled Chromium: 45 screenshots, four synthetic native form POSTs, search/filter/sort, cart/reload/receipts, 15 total tests; separate Node process reconciles committed unknown operation with zero repeated POSTs. Native Bitrix NOT_RUN by author."}
]
```

Full project suites, independent review and native target execution belong to root's next acceptance step. No existing source snapshot, target receipt, native database or Store record was modified by the author.
