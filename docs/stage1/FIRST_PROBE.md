# First real API probe — 2026-10-01

Preflight HTTP200; key value never emitted. Real source https://snabblock.ru/ captured 2026-10-01T00:14:25.965Z in fresh Playwright context,1440px viewport. Pilot teplypol source returned user verification page, recorded SOURCE_ACCESS_BLOCKED; no bypass.

Two real API calls: responses/gpt-4.1 analysis with screenshot+DOM, then images/edits/gpt-image-2.5-flare-2026-09-08 with same source screenshot and generated brief. Both HTTP200; request IDs and usage retained under var/stage1-design/probe-snabblock-20261001. No automatic retries. PNG1536x2304,3320414bytes. All results persisted. This is a developer probe, not a browser service.

Visual root review: REJECT / DRAFT. Full homepage and footer present, main Cyrillic mostly readable. Unacceptable additions: stock claim 'В наличии', unsupported special business terms and delivery schedule, synthetic SNABBLOCK branded delivery truck implying actual fleet. Building/product illustrations not sourced individually. Original high-quality logo not extracted; textual name fallback documented, stylized logo spelling needs exact text-layer verification. Tiny footer text requires full-scale review. Output is not quality-approved or ready.

Next implementation decision: strict allowlist of source-backed text, original logo extraction when possible, image-generation regions without text plus individually composed exact typography. Composition must be model-planned per business, not one shared page template. Compare against this retained rejected attempt. No full React interface before acceptable first output.

Spending: actual token usage saved; monetary amount NOT_CALCULATED. Probe bounded at2calls/1image/0retries, but lacks validated USD reservation. Enforce conservative finite monetary reservation before further paid generation or tester access.

Security limit: probe uses operator-selected fixed public URLs only. It is not an arbitrary-URL service or SSRF-safe reusable crawler; public input cannot be exposed yet.
