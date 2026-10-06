# HTML design demo

Open index.html directly, or run `node demos/design-v1/serve.mjs` and open http://127.0.0.1:18440.

Separate static design preview; no Bitrix changes and no real checkout. 81 source products with locally available catalog image bytes verified against their SHA-256. Original source snapshots are historical; current prices and inventory are not claimed. Catalog grouping is a presentation heuristic, not accepted migration mapping.

Generated illustrative interior: assets/interior.png, built-in ImageGen. Prompt: Photorealistic premium underfloor-heating website hero; sunlit contemporary living room, warm oak floor, cream sofa, linen curtains, wood table, olive tree; uncluttered left space for text; no text or logos.

Verification: `node demos/design-v1/verify.mjs` — PASS: category filter, empty search, product route, add/remove demo cart, no JS errors/broken homepage images/horizontal overflow at390px. Screenshots desktop.png and mobile.png. Static preview is not DEMO_READY for the full Upgrade project.

