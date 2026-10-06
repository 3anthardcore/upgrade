# Automatic browser fallback — 2026-10-02

Upgrade now performs static source capture followed automatically by one isolated JavaScript browser attempt when source content is short, blocked or unavailable over HTTP. Both HTML and AI PNG jobs use the same source worker. No operator Codex browser/session/API is embedded into the product.

Implementation: source-capture.mjs starts source-worker.mjs as a separate process with an environment allowlist (no OpenAI key), a 150-second deadline and process-group cleanup. source-browser.mjs uses Playwright Chromium with chromiumSandbox enabled, fresh nonpersistent contexts, temporary source-only cookies, disabled service workers/WebSockets/downloads and no form interactions. Only GET requests are forwarded; no POST or CAPTCHA solving. The browser cannot access the network directly: a dead proxy is configured and routes use browser-network.ts with fresh DNS validation and pinned connections. Private/link-local IPs, nonstandard ports, the Upgrade domain/server IP, cross-origin document navigation and excessive requests are rejected. Response/body/time limits remain active. The browser transport is a scoped copy of the existing reviewed crawler transport with ephemeral Cookie/User-Agent forwarding and Set-Cookie delivery; cookie values are not logged or saved.

Evidence: per-job browser-fallback.json, capture-static.json, capture-browser.json, browser-failure.json and blocked screenshots. Successful source.json records javascript-disabled or javascript-isolated. Existing job artifacts remain unchanged. Failure before source acquisition incurs zero AI calls. Historical failed jobs are not silently retried.

Server commands: node --check app.mjs; node --check source-browser.mjs; node --check source-capture.mjs; PLAYWRIGHT_BROWSERS_PATH=/opt/upgrade/shared/browser-cache runuser -u upgrade --preserve-environment -- node --test browser-test.mjs. Five tests PASS: challenge detection, actual private-IP transport rejection, static path without fallback, real JavaScript cookie/reload with blocked writes/private frame, distinct cookie contexts, and persistent challenge evidence. Test suite repeated after final HTTP-status validation: 5 PASS, 0 FAIL. Browser sandbox launch PASS. Restart preserved eight existing jobs and API call counts; operator HTTP200.

Actual source probe: teplypol-market.ru returned KillBot user verification. Isolated browser attempt still ended SOURCE_BROWSER_CHALLENGE (capture 81af8679-5409-407c-8993-13bbb6152d75). This is NOT successful access to that source. No stealth spoofing, CAPTCHA solving, POST challenge submission, proxy rotation or external browser sessions are implemented. Sites requiring these remain blocked. Public documentation: https://playwright.dev/docs/api/class-browsercontext .

Live integration job: 104983a1-1292-4a83-aaad-7d0998594580, HTML mode to validate real queue/capture without paid model calls; final result recorded separately in progress/evidence. Backup before deployment: data/backups/browser-1790957426/app.mjs. Rollback: restore that app after queue becomes idle, syntax-check, restart upgrade-studio.service; new modules may remain unused.

Next: for teplypol-market.ru obtain permission for this server IP at the source or a source export; do not claim that generic browser fallback guarantees access. Full Bitrix transfer is outside this stage.

2026-10-02 browser live queue verification: 104983a1-1292-4a83-aaad-7d0998594580 ended SOURCE_BROWSER_CHALLENGE with explicit Russian explanation and 0 API calls. Automatic browser invocation verified; access to teplypol-market.ru BLOCKED. Next remains source IP permission/export. Not a successful design generation.


Validation 2026-10-02: npm run check PASS. npm run test:e2e: 27 PASS, 1 SKIP, 0 FAIL. npm test: 405 PASS, 178 SKIP, 1 FAIL (existing Codex fixture worker exceeded its 10-second deadline during concurrent suites). Isolated recheck node --disable-warning=ExperimentalWarning --test tests/unit/codex.test.ts: 3 PASS, 0 FAIL. Full suite is not reported as all PASS. Logs: var/stage1-design/browser-{check,regression,e2e,codex-recheck}.log.

