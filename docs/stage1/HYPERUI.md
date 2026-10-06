# HyperUI integration — 2026-10-01

Scope: extend the running Stage1 Studio with an HTML/PNG composition mode. Preserve AI PNG generation and previous artifacts. This is an experimental renderer, not a complete site migration or Bitrix release.

Implementation is authored on /opt/upgrade/stage1-design. HyperUI source is pinned to 2b5aebbc50d2c9ac89650f51b554f53895b4803c (verify against vendor manifest), MIT license preserved. Adapted components: marketing headers/1, sections/1, cards/1, footers/1. Tailwind CSS and @tailwindcss/cli4.3.3 are build-only dependencies in html-kit/build with package-lock; no CDN/runtime CSS loader.

Decisions:
- Offer HTML + PNG alongside existing AI PNG. HTML uses deterministic source selection and bounded style choices; arbitrary textual edits remain exclusive to AI PNG and are rejected in HTML mode rather than ignored.
- Use literal normalized source fragments and original raster images when available. Preserve source timestamps, hashes and provenance in concept.model.json. Main identity falls back to the source hostname. Never copy template example testimonials, authors, dates or Unsplash imagery.
- Store every generated HTML/PNG as a new job/version. Preview and downloads are owner-scoped behind existing Basic Auth. HTML response uses CSP sandbox; exported HTML has no scripts, forms or external assets. Navigation and native disclosure remain functional.
- Compile Tailwind once, inline CSS and approved images in the export, then render it in a fresh Chromium context with no API key and network requests blocked. Layout check at1536px and390px; no paid model calls in this mode.
- Recovery runs only after binding the singleton listening port, avoiding stale-job changes by a second process that cannot start.
- Fix hash navigation in Studio so links between saved projects update the selected view.

Initial visual review rejected poor source-fragment placement (address in hero, category heading attached to general copy). Updated paragraph selection excludes addresses/product labels and uses available DOM paragraph context. Historical first draft remains available for audit; corrected version is a new job.

Boundaries: only four style choices and a small block set; not automatic arbitrary-business art direction. Statements are copied from source, not independently certified. Sparse/JS-only/protected sources may fail. No forms/orders/payments or Bitrix publication. Full quality/security acceptance gates from LAUNCH.md remain open.

Build: cd html-kit/build && npm ci --ignore-scripts && ./node_modules/.bin/tailwindcss -i input.css -o ../design.css --minify. Runtime root needs existing Playwright/Cheerio and Node24 dependencies. Restore uses the pre-change backup data/backups/hyperui-1790860769, preserving newer state and artifacts; do not overwrite a live database.

Verification completed:
- Server: node --check app.next.mjs / app.mjs and UI script parse PASS; Tailwind4.3.3 build PASS.
- Server: node --test html-kit/render-test.mjs —4PASS/0FAIL: literal/source-injection safety, sparse-source rejection, bounded styles, actual offline browser render/mobile/no-network and immutable output.
- html-kit/live-test.mjs — real authenticated UI→fresh source→HTML/PNG, initial job1dbdf9c2-c72d-4bde-a90d-fe0eb03fb720. Visually rejected content placement, then corrected without overwriting artifacts.
- html-kit/version-test.mjs — actual UI created corrected versionb85d93a2-4020-434c-99cb-2951914cded1. Root inspected desktop/mobile PNG1536x2511; literal text and original photograph retained.
- html-kit/final-test.mjs — real HTML opens; anchor works; source details open by keyboard under reduced motion; download matches SHA0a1e90f7aa1713bcc695f34b3ac2b5aa7a832b3353aa501fbe9269125c088891; CSP sandbox; anonymous401; other-owner404; mobile no overflow;0JS errors; old PNG editor still available. Initial pointer/disclosure attempt timed out with smooth scrolling; no broad mouse/a11y certification claimed. Hash-only navigation bug found and fixed, then full test passed.
- html-kit/acceptance-setup.mjs — same idempotency key returns one HTML job; first draft rejected through owner API. Fresh capture testa0e93d88-f307-4aa1-946e-27bf0ed5df09 succeeded with10DOM paragraphs,8original raster images,0paid calls.
- html-kit/restart-test.py — actual restart preserves HTML/PNG IDs, statuses and call counts; no automatic paid repeat.
- Local: npm run check PASS; npm test406PASS/178SKIP/0FAIL; npm run test:e2e27PASS/1SKIP/0FAIL. Legacy suite results are not HTML or Bitrix readiness certification.

Evidence: server data/html-*.json and screenshots; local var/stage1-design/hyperui/. Corrected user-visible example: https://upgrade.help-ai-ru.ru/studio/files/b85d93a2-4020-434c-99cb-2951914cded1/concept.html . Same authentication as Studio. All new HTML jobs used0paid API calls.

Next: broader component/content mapping, more business examples and fuller visual/accessibility acceptance. Existing unknown-paid-call recovery and monetary-accounting gaps remain as documented in LAUNCH.md. No daisyUI/Lucide/React installation in this increment.
