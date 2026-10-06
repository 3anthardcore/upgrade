# Astra migration — 2026-10-01

User requested GPT-6 Astra instead of GPT-4.1. Active server: /opt/upgrade/stage1-design, upgrade-studio.service.

Shared model-config.mjs selects gpt-6-astra for Responses analysis and visual review, reasoning low, output limits 6144/4096, store false. Production prompts and source contracts preserved. Image generation remains gpt-image-2.5-flare-2026-09-08. Deterministic HTML mode uses no model. Historical artifacts retain their original provenance; inherited briefs are not regenerated automatically.

Official compatibility: https://developers.openai.com/api/docs/models/gpt-6-astra and https://developers.openai.com/api/docs/guides/latest-model . Astra takes image inputs and produces text; it is not the raster generation model.

Validation: node astra-probe.mjs ran as upgrade using the private server environment. Availability GET passed; two real Responses requests returned HTTP200, actual model gpt-6-astra, status completed, valid analysis/review JSON contracts. Probe 8b062bd1-48f4-45b0-b589-2dceea3080a4 uses existing source screenshot and corrected PNG; no new image generation. Intents and receipts saved under data/astra-probes and mirrored to var/stage1-design/astra. No retries.

node --check app.mjs and node --check model-config.mjs passed. Service restarted after confirming no queued/running jobs. systemctl is-active returned active. Operator HTTP200; six existing jobs retain status and API call counts, zero automatic paid repeats. Initial health request omitted the required operator header and failed; corrected authenticated request passed. Production call evidence now records requested and returned models and reasoning; incomplete Responses fail explicitly.

Backup: data/backups/astra-1790862490/app.mjs. Rollback: restore that app, syntax-check, restart only when no jobs are active. Shared config may remain unused.

Limits: full new PNG job through the UI after model switch NOT_RUN; two real model calls verify compatibility, not every UI path or design quality. Bitrix checks NOT_RUN in this stage. Existing nominal budget reservation is not exact cost accounting. Next: evaluate the next user-requested design with Astra and independent visual review.
