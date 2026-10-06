# Stage 1: design image service

Active scope: docs/stage1/UPGRADE_STAGE1_DESIGN_SPEC.md (2026-10-01). Prior Bitrix migration and HTML storefront remain preserved; neither is proof of this service.

1. Real developer probe: source screenshot + sourced facts + brief + server image API + verified full-page PNG >=1440px. Gate: actual image and visual review, not HTTP200 alone.
2. Only after image quality proof: one web application, authenticated creation form, durable background job, original/result viewers and download.
3. Edits with retained versions, idempotent submission, bounded calls, unknown-outcome recovery without automatic paid retry.
4. Three Russian-language business examples, each with source screenshot, independently reviewed output, and explicit limitations.

API key is not present in this process; no local .env with credentials found. No paid probe has run. Current status: API_CONFIGURATION_REQUIRED. Do not substitute chat imagegen or old generated files.

Provider documentation checked 2026-10-01: https://developers.openai.com/api/docs/guides/image-generation . Model availability remains account-specific; no default selected until API preflight. Images edits endpoint supports reference images; a source screenshot must be supplied. First probe should use a bounded portrait resolution >=1440px wide; inspect actual PNG dimensions and decoded image before acceptance. Native logo/text composition is allowed only after evaluating real output.

Run `node stage1-design/preflight.mjs`. It never prints secrets, makes no paid generation, does not automatically retry, and persists only configuration availability and sanitized status. Output under var/stage1-design/preflight/.
