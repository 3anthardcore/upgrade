# Capture capacity revision — 2026-09-30

Task `capture-capacity-20260930`, worker `commerce-model`, fence 1. This is an offline capacity change and a new immutable pilot capture, not source-access clearance, complete-site coverage, target import, or a performance certification.

## Scope and decision

The previous full v5 packaging attempt hit the 200,000,000-byte aggregate capture limit. The recorded decision raises that single cap to **512,000,000 bytes including the manifest**. Per-file 20,000,000 bytes, manifest 2,000,000 bytes, 1,000 observations, 5,000 assets, and 10,000 inventory identities are unchanged. The packer checks the aggregate budget before each write and again including manifest bytes before publication. It never publishes a truncated capture.

The queue's occurrence cap rises from 500,000 to **1,000,000 witnesses**. Its independent **180,000,000-byte provenance**, **180,000,000-byte resume snapshot**, and **800,000,000-byte raw-input** limits are unchanged. `maxWitnesses` is a lower-only API option used to exercise the real guard at small fixture boundaries; it cannot increase the fixed cap. No network budget, route permissions, source-access gate, or target state changes.

The existing packer's explicit multiple raw directories are retained. New optional `--raw-freeze FILE --raw-freeze-sha256 SHA` verifies the exact raw-file set, hashes and lengths before staging; the same read buffers become packaging inputs. `--registry-manifest FILE --registry-sha256 SHA` unions the previous accepted inventory so unresolved identities are not lost. `--report-dir DIR` directs evidence into the task's owned directory. `--max-total-bytes N` can only reduce the cap. Reports pin every raw export and distinguish requested URLs from observed final URLs with `http_status: null`.

The v4 capture, previous queues, old downloaded PDF/images, raw files and the failed v5 pending output are retained. Capture media files remain individually addressed by source URL with verified bytes; this change does not introduce content deduplication.

## Tests before pilot packaging

`node --disable-warning=ExperimentalWarning --test tests/integration/operator-capture.test.ts tests/integration/source-queue.test.ts`: **43 PASS, 0 FAIL, 0 SKIP**. New tests cover manifest-inclusive exact byte boundary and one-byte rejection; forbidden cap increases; a real pack subprocess reading two raw directories; preservation of earlier PDF bytes, old unresolved inventory, exact query/requested URLs; unknown HTTP status; raw-freeze mismatch; unpublished failed package; and lossless exact witness count / one-less rejection without changing a prior queue snapshot.

`npm run check`: **PASS** after two type-only corrections. This is bounded local regression evidence, not a claim about 10,000 or 50,000 pages. Pilot-specific byte counts, denominator, missing media and queue results are recorded below after the actual run.

## Pinned pilot inputs

- Raw index `var/evidence/continuation-20260930/raw-freeze-v6.json`: `745c8bb4400a6bdbc38fdb1addca4d5423b06140f6ca9b7111143623b6b61aab`; 905 raw exports, 889 distinct final URLs. Root froze collection before packaging.
- Prior accepted registry `var/pilots/teplypol-catalog-package-20260929-v4/operator-capture.json`: `de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff`.
- Prior queue `var/pilots/teplypol-queue-20260930/queue-66b24df0cacba36723b8229e1d89cdda13d80b6d8df68deabde04d55743e6df2.json`: verified `66b24df0cacba36723b8229e1d89cdda13d80b6d8df68deabde04d55743e6df2`.

The next queue uses v4 as the existing registry anchor and the frozen raw directories as new observations, preserving the prior queue's witness provenance. It does not count the same 889 new DOMs again as an additional accepted capture input.

## Pilot result

**PASS, local offline package and queue generation.** Final repeated targeted suite: **43/43 PASS, 0 SKIP**, 2,424 ms. No target import, network request, browser action, Store mutation, or Bitrix acceptance is part of this task.

The new immutable `var/pilots/teplypol-catalog-package-20260930-v6/operator-capture.json` has SHA `2310cb1b9a506c652f32eca1781bf73bf8d9cc22c8771792386fb17d38e200ce`: **889 DOM observations, 2,356 accepted media records, 217,190,376 payload bytes + 1,696,818 manifest bytes = 218,887,194 total bytes**. The 966 explicit inventory URLs include all 847 prior v4 inventory URLs. Validation's expanded union has **2,726 known URLs, 889 observed and 1,837 unobserved; full site total UNKNOWN**. The 17 requested/final URL mismatches are retained without inferred HTTP status or redirect codes.

Queue `var/pilots/teplypol-queue-20260930-v2/queue-3980531cf18f809c09066a91d7fc2df464a05062788f230fc32ed4d453553522.json` has the matching filename SHA; 111,499,263 bytes, **2,867 entries and 547,796 witnesses**. This actual run exceeds the former 500,000 occurrence cap while staying within unchanged byte budgets. There are 889 DOM-observed identities, 46 outstanding candidates, and 1,932 review entries. Every prior 2,346 identity and 421,952 witness is retained exactly; no missing prior identities/witnesses. Prior source access stays `UNCHANGED_NOT_VERIFIED` and full denominator stays `UNKNOWN`.

Actual extraction of the immutable capture produces 889 entities. It identifies **319 missing entity-referenced assets: 299 PDFs, 19 raster images and one unsupported SVG**. The other 1,435 of the validator's 1,754 unverified references are not referenced by extracted `entity.assets` in this model. Missing assets are not suppressed or replaced. Full package import remains blocked by `ENTITY_ASSET_MISSING` until the evidence is supplied or a separate explicit scope decision is made. The SVG `/info/img/close.svg` is outside the current accepted MIME allowlist; downloading it alone will not resolve that boundary.

Exact URLs, observing page URLs, snapshot SHA/evidence, omitted download observations and extractor SHA are in `var/evidence/capture-capacity-20260930/missing-mandatory-assets.json`, SHA `5f00ae560b0613f41860611542901ac1f069efbef80e040d3e188bfba5b08ea8`. Examples include the instruction PDF `/download/arnold-rak-fh-p_phs-ct_instrukciya.pdf` on `/nagrevatelnye-kabeli/arnold-rak-phs-ct`, the photo `/image/cache/catalog/Eastec/eastec-e-30-326x326.jpg` on `/termoregulyatory/eastec-e-30`, and three raster images on `/info/kak-vybrat-pod-plitku.html`.

Pack report: `var/evidence/capture-capacity-20260930/teplypol-catalog-20260930-v6-pack-report.json`, SHA `00817a6ce97c3e4c2c33c2eb8b4976c477083c1ac85fb8896bd4c6f545c40ec3`. No-loss check: `var/evidence/capture-capacity-20260930/pilot-integrity.json`, SHA `a032fd518fb382e07c6fc0b34f60ddee8f94cc858c5e03ac3df7b9ecc1ff41d9`. Check scripts are saved beside these reports; their exclusive output files intentionally reject repeat writes.

## Commands actually run

```powershell
node --disable-warning=ExperimentalWarning scripts/pack-browser-observations.ts var/pilots/teplypol-catalog-20260929 var/pilots/teplypol-catalog-package-20260930-v6 teplypol-catalog-20260930-v6 '' '' var/pilots/teplypol-catalog-20260930 --report-dir var/evidence/capture-capacity-20260930 --raw-freeze var/evidence/continuation-20260930/raw-freeze-v6.json --raw-freeze-sha256 745c8bb4400a6bdbc38fdb1addca4d5423b06140f6ca9b7111143623b6b61aab --registry-manifest var/pilots/teplypol-catalog-package-20260929-v4/operator-capture.json --registry-sha256 de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff
node --disable-warning=ExperimentalWarning scripts/plan-pilot-source.ts --raw-dir var/pilots/teplypol-catalog-20260929 --raw-dir var/pilots/teplypol-catalog-20260930 --capture var/pilots/teplypol-catalog-package-20260929-v4/operator-capture.json --capture-sha256 de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff --previous var/pilots/teplypol-queue-20260930/queue-66b24df0cacba36723b8229e1d89cdda13d80b6d8df68deabde04d55743e6df2.json --previous-sha256 66b24df0cacba36723b8229e1d89cdda13d80b6d8df68deabde04d55743e6df2 --output var/pilots/teplypol-queue-20260930-v2 --batch-size 50
node var/evidence/capture-capacity-20260930/check-pilot-pins.mjs
node --disable-warning=ExperimentalWarning var/evidence/capture-capacity-20260930/analyze-v6.mjs
```

All four commands completed with exit 0. They establish offline byte integrity, extraction and retained scope only. Raw collection was released back to root after both raw-input consumers finished. New raw inputs require another capture; v6 is sealed.

## Source freeze and next step

| File | SHA-256 |
| --- | --- |
| `packages/crawler/operator.ts` | `9b4c747c44e8b56b35664814eeb3546ec5f24870ce4ee8bf6476c2e753cb6c0c` |
| `scripts/pack-browser-observations.ts` | `188ffa5e26406059fc8a62f5959f1d817faf006ac30b58642328e4ff152de16e` |
| `scripts/plan-pilot-source.ts` | `086bba8a3cada33720838099b797f223b69790acbac134129ccaa362f4f51a55` |
| `tests/integration/operator-capture.test.ts` | `8297833c9852fac95461ba85a3aa09894f8b9b3f963f3a6b2b0e44152ed1409b` |
| `tests/integration/source-queue.test.ts` | `18638f240d4ff0931983c504542cd719bcbc2cc65b3d9c95558ea6ad8cda4b16` |

Next: independent review of these bounded changes; root can ingest the pinned capture under its authoritative Store writer. Resolve the 319 entity-required missing assets and the outstanding/review URL queue before asserting broader source or target coverage. Bitrix import and customer-visible functional acceptance for this new capture are **NOT_RUN** here.
