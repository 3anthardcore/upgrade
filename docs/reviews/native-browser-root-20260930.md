# Native browser verifier — independent root review

2026-09-30. Bounded implementation ACCEPT; native Bitrix execution remains a separate step.

Reviewed frozen `scripts/verify-native-browser.mjs` SHA256 `fe526f3bcc89169059b3ae7e6875eaff08abdaf7d7e60f78df0daa62f9c6e1b7` and tests SHA256 `d8c116abb2d2f64f786d00d05bb0f7ba103c9af85a41263e5f231edefbe9bd81`. Root read the input, journal, form, CDP transport, redirect, reconciliation and final receipt paths independently of the author.

Root repeated `node --disable-warning=ExperimentalWarning --test tests/unit/native-browser-verifier.test.ts` with actual PHP 8.3.35 and Chromium: **15/15 PASS, 0 SKIP**, 55.133 seconds. Log: ignored `var/evidence/continuation-20260930/browser-root-tests-v1.log`. This includes actual second-hop interception after a committed POST and a new Node process performing GET-only reconciliation after a lost acknowledgement. Original intents and UNKNOWN history are retained; reconciliation does not turn the interrupted scenario into a completed test.

The request boundary checks the exact origin, approved snapshot/own routes and asset paths; only a validated synthetic form can authorize one POST, after durable intent. A transport with no redirect/retry/cookie jar performs each intercepted hop. The separately pinned target snapshot is not source-agent instruction data. Credentials and session/form data stay in private output; redacted result receipts cannot establish database side effects or current deployment identity by themselves.

Limits accepted: nine first-viewport states at five widths, bounded labels/headings/keyboard checks, no complete WCAG claim; selected product only; no admin or native catalog proof; own source isolation still requires the target network guard and before/after database readback. Browser counters are not a packet capture. Native run must use a new private output directory, exact accepted snapshot and actual isolated target, sequentially with backup operations.

Root found no blocking defect in this bounded review. General readiness remains NOT_READY until the other project acceptance criteria pass.
