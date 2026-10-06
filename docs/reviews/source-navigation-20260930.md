# Source navigation queue correction — 2026-09-30

Task `source-navigation-20260930`, worker `commerce-model`, fence 1, input artifact `art-a7687645-a85b-415d-8efb-58dfb34a5117`. Writes are limited to the planner, its tests, this report, new V4 queue and `var/evidence/source-navigation-20260930/`. No network/browser, server, Store, target DB or Git action was performed.

## Behavior

The previous queue repeatedly offered three requested URLs even though their pinned raw observations recorded reaching other final documents. The new `HTTP_NAVIGATION_UNVERIFIED` classification puts these original identities in `REVIEW_REQUIRED`. It preserves the original and final URLs, exact queries, identity IDs, prior observations, and all witnesses. It does not invent HTTP status, Location chains, a 301/302, an alias route, or DOM observation of the original URL.

A `requested-url` witness must bind to the final document's exact observation using input ID, source/document URL, HTML SHA and timestamp. Merely linking to another page does not satisfy this check. The pre-existing witness structure retains `raw_reference` (the original request), `source_url` (the reached source document), `observed_at`, `html_sha256`, and pinned input ID/SHA; no lossy summary replaces it. Offline resume re-evaluates the retained witnesses, so an older queue's `OUTSTANDING` label is not blindly trusted.

An older direct snapshot remains historical evidence; later navigation still requires review. A later direct DOM observation of the original can clear this queue gate while preserving the navigation history. Timestamp comparisons use actual parsed time, including equivalent ISO forms with/without milliseconds. Protected paths, source actions and other stronger review classifications are not weakened. Source access remains `UNCHANGED_NOT_VERIFIED`; full site denominator remains `UNKNOWN`.

## Explicit capacity decision and failed attempt

The first actual V4 plan **FAILED** with `QUEUE_LIMIT` under the existing 180,000,000-byte witness/provenance ceiling. It wrote no V4 snapshot and did not mutate V3. V3 already accounted for 178,587,654 provenance bytes, leaving only 1,412,346 bytes. Incorporating the eleven newly captured pages while preserving every historical witness required **180,084,371 bytes**, 84,371 above the former cap.

Root explicitly authorized **only** the provenance ceiling increase to **256,000,000 bytes**. The separate resume snapshot cap remains **180,000,000 bytes**, raw-input cap **800,000,000 bytes**, witness count **1,000,000**. Network/time budgets were not reset. The optional `maxWitnessBytes` remains lower-only. Tests exercise exact charged-byte acceptance, one-byte-below rejection, acceptance at the new ceiling and rejection above it; no witness truncation is permitted. The failed and successful attempts are preserved in `var/evidence/source-navigation-20260930/attempts.json`.

## Actual V4 result

Prior queue pin verified from bytes: `d93544dee035bf505ff3b6c51f2dc022d578646499229e82d32d1317c1edc42d`. Input capture remained the accepted v4 registry `de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff`. Root froze both raw directories during planning; raw input count is 976. Root may append later captures only after this completed V4 run; V4 is immutable.

V4: `var/pilots/teplypol-queue-20260930-v4/queue-de20a49e8e5c4eadc0970e87eaa6afae5571bbd355cab3fe1fb0a8dc5f1ec180.json`, SHA equal to its filename. Size **117,755,403 bytes**, below unchanged 180 MB resume-file cap. It retains all **2,878 prior identities and 574,428 prior witnesses exactly**, with **2,883 total entries and 579,250 witnesses** after new evidence. Original capture registry of 847 identities is preserved.

- 943 DOM-observed identities.
- 15 `HTTP_NAVIGATION_UNVERIFIED`, all `NOT_OBSERVED` originals: three paths and twelve exact query variants. All fifteen are absent from `next_batch`.
- 1,935 review-required entries in total; full source scope remains unknown.
- Five ordinary candidates remain, discovered from the new pages; they are listed in the V4 `-next-batch.json`. This is not complete URL closure.

The three original paths now correctly require review:

```text
/nagrevatelnye-maty/thermomat-tvk-210
/s-1-maya-rejim-raboti-2025
/uvelichenie-sroka-garantii-na-regulyatori-grand-meyer
```

Their exact final-document/input/hash/timestamp witnesses, all fifteen navigation entries and no-loss checks are in `var/evidence/source-navigation-20260930/v4-integrity.json`, SHA `98ddd4a1ab0034a8113aed2a297483476a7ba68dbe7f4df8c7a44213c688d196`. The local `check-v4.mjs` rehashes both snapshots and verifies every earlier witness/identity survives. Its output uses exclusive creation and is intentionally not overwritten on repeat.

## Commands and checks

```powershell
node --disable-warning=ExperimentalWarning --test tests/integration/source-queue.test.ts
npm run check
node --disable-warning=ExperimentalWarning scripts/plan-pilot-source.ts --raw-dir var/pilots/teplypol-catalog-20260929 --raw-dir var/pilots/teplypol-catalog-20260930 --capture var/pilots/teplypol-catalog-package-20260929-v4/operator-capture.json --capture-sha256 de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff --previous var/pilots/teplypol-queue-20260930-v3/queue-d93544dee035bf505ff3b6c51f2dc022d578646499229e82d32d1317c1edc42d.json --previous-sha256 d93544dee035bf505ff3b6c51f2dc022d578646499229e82d32d1317c1edc42d --output var/pilots/teplypol-queue-20260930-v4 --batch-size 50
node var/evidence/source-navigation-20260930/check-v4.mjs de20a49e8e5c4eadc0970e87eaa6afae5571bbd355cab3fe1fb0a8dc5f1ec180
```

Tests: **17/17 PASS, 0 SKIP**, 2,273 ms; `npm run check` **PASS**. Real planner retry and integrity checker both exit 0. New behavior covers exact query/order preservation, no invented original DOM/HTTP status, legacy offline resume, later direct evidence versus historical navigation, `?m` versus `?m=`, unchanged action/protected handling, and lower-only capacity boundaries. No source-site HTTP or Bitrix integration was run by this task.

## Freeze

| File | SHA-256 |
| --- | --- |
| `scripts/plan-pilot-source.ts` | `0f6ede5a5a0e7871254b4da9c70ae32180efc3058e103fa29bb6941f282b82e9` |
| `tests/integration/source-queue.test.ts` | `a670bc9320d9536683cedf87af155c5d04d112beb28092ac90272dbc8c87f0a3` |

Next: root reviews/publishes this retained queue, processes the five new ordinary candidates if authorized, and separately resolves navigation semantics with actual source HTTP evidence. No automatic aliases or redirect routes may be created from these browser observations alone.
