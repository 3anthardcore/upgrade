# Studio launch — 2026-10-01

Status: RUNNING_INTERNAL_EXPERIMENTAL, not full Stage 1 acceptance.
URL: https://upgrade.help-ai-ru.ru/studio/ . Existing demo at / retained. Same operator Basic Auth; anonymous requests including a forged identity header return401.

Authoritative source: /opt/upgrade/stage1-design/app.mjs and index.html. systemd upgrade-studio runs as upgrade, binds127.0.0.1:18441. Nginx authenticated proxy replaces identity header. API key root0600 EnvironmentFile; omitted from source Chromium environment. SQLite WAL and immutable job images under private data/. Model calls persist intent and usage; no automatic retry after uncertain completion. Initial pipeline3calls; edited version2calls.

Implemented: URL/preferences/direction form, actual source screenshot and text, vision brief, real image edits API, visual review, durable single-process queue, scoped image downloads, history and text edits, rejected draft display, operator rejection through service API. JS-disabled source browser routes HTTP through DNS/IP-pinned public-only transport. No source cookies/form submissions. Image output1536x2304. Logo text fallback explicitly disclosed.

Actual commands and evidence (data/):
- node --check app.mjs; nginx -t; systemctl enable --now upgrade-studio: PASS.
- node smoke.mjs: actual HTTPS authenticated browser submission snabblock.ru; reload retains selected job;390px no overflow;0JS errors. ui-smoke.json.
- node behavior-test.mjs: concurrent same idempotency key returns same job; anonymous401,CSRF403,other-owner file404. Private127.0.0.1 source failed with0API calls. behavior-test.json + restart-smoke.json.
- First job b8b573d5-2ea9-40d5-9926-e0a76aac1054:3real API calls, PNG generated. Automated QA false-positive; root visual rejected garbled line. Original automatic review retained; operator rejection persisted through API, not direct SQLite edits.
- node edit-smoke.mjs: actual browser text edit created90e31868-f718-4f7e-aea8-66dfc0cbefe8;2real API calls. Automatic review passed; root inspected PNG and confirmed defective line removed. Version lineage retained.
- node final-smoke.mjs: PNG download matches saved SHA fd8ea88413a41f24e0570b67bf35fbd2d887e249d8aab13ba8b5ef30d2bca275;1536x2304; desktop/mobile result;0JS errors,0mobile overflow. final-smoke.json and screenshots.
- Actual systemctl restart: completed jobs/statuses/call counts unchanged; no paid repeat; key absent from HTML. restart-smoke.json.
- Local repository npm run check PASS; npm test406PASS/178SKIP/0FAIL; npm run test:e2e27PASS/1SKIP/0FAIL. These legacy tests do not establish Studio or Bitrix integration readiness. Studio verified separately above.

Open acceptance gates: three distinct business examples NOT_RUN; full SSRF/adversarial matrix NOT_RUN (only private-address behavior verified here); kill-during-paid-call recovery NOT_RUN; automatic quality corrections not implemented; actual monetary cost accounting not implemented (fixed5calls and nominal10USD reservation are NOT a verified monetary ceiling); JS-only/protected sources unsupported; teplypol current server pipeline NOT_RUN. Automatic reviewer demonstrably misses defects, so operator review remains necessary. Source capture currently homepage only. No claim of complete arbitrary-URL coverage, production readiness or Bitrix delivery.

Next: strict sourced-text/claim validation and quality correction loop, actual pricing-based reservations, paid-call interruption tests, three business examples. Keep authenticated access limited to operator.

Operations: systemctl status/restart upgrade-studio; journalctl -u upgrade-studio. Preserve data/, API secrets outside repo. Before rollback copy SQLite via backup API and retain job files; do not delete or restore over live state. Nginx pre-change backup is in /etc/nginx/sites-available/upgrade.help-ai-ru.ru.stage1-backup-* . Removing only /studio locations and stopping service reverts exposure without changing old demo. Runtime deps pinned through r18 release node_modules; Node24.20.0, existing browser cache.
