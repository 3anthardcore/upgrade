# Stage 1: URL → design image

The active specification is `../docs/stage1/UPGRADE_STAGE1_DESIGN_SPEC.md`. Preserve the old migration project; do not expand Bitrix work in this stage.

For UI/UX work read `../.agents/skills/ui-ux-pro-max/SKILL.md`. Resolve its scripts relative to that skill directory (upstream examples use a Claude-specific environment variable). A local UX query is available through `node stage1-design/design-guidance.mjs "background task progress feedback"` from the repository root.

Treat guidance as recommendations. Source facts, user preferences and this project's specification override generic patterns. No invented testimonials, prices, business claims, or generated site facts. Keep the service interface distinct from each customer's generated design.

Primary screens: URL form, actual job stages, independent source/result image viewers, download and versioned text edits. No fabricated percentages, unsolicited signup/payments, or landing-page sections replacing the working tool. Validate keyboard, errors, narrow screens and readable Russian text.

2026-10-01 user-authorized extension: HyperUI HTML + PNG mode alongside AI PNG. Details and limits in ../docs/stage1/HYPERUI.md. Preserve immutable versions, source-text/media provenance and sandboxed exports. HTML mode has bounded style selection, no paid image API and no free-form textual edit interpretation. Never label an HTML concept as a complete functional site or Bitrix deployment.
