# Source continuation queue, 2026-09-30

Persisted task: `source-queue-20260930`, owner `discovery`, fence 1; run `4df3e448-3120-4827-9035-17203a7deff4`; input `art-03d5d5d7-0032-40a8-804c-8fad9925ed3c`. Root owns authoritative Store, live source browser, target server and acceptance. This document is an implementation handoff, not independent acceptance or source completeness certification.

Write scope used: `scripts/plan-pilot-source.ts`, `tests/integration/source-queue.test.ts`, this document, and `var/pilots/teplypol-queue-20260930/`. Source captures were only read. No source HTTP/browser operation, target/Store write or Git mutation was performed. Root independently continued IAB capture while this task ran.

## Result

`planPilotSource(options)` is an executable offline planner. It combines the caller-pinned portable capture inventory, hash-verified capture observations, inert raw exports and their paired HTML bytes, and optionally a pinned previous queue. All supplied raw directories contribute. A newly discovered URL adds to the known lower bound; it does not establish the full denominator. `full_source_denominator` remains `UNKNOWN`; server access remains `UNCHANGED_NOT_VERIFIED`; `selection_is_not_completion` is always true.

The local v4 manifest contains **847 literal inventory identities and 103 observations**. Root's earlier 943 known count included discoveries outside that literal manifest list. The planner reads the observed HTML as well, so it preserves those additional links and later raw discoveries. Its same-origin HTTP identity count also contains witnessed document/media resources; this count must not be relabeled as a complete page denominator or target coverage.

Each identity retains its exact request target. Case, slash, percent-escape spelling, bare trailing `?`, parameter order, duplicate keys and blank values remain distinct. Hash fragments remain in raw witnesses, not a fabricated HTTP request target. No sitemap, product URL, price, stock or route is guessed. Link labels, HTML, raw fields and instructions embedded in source data are inert evidence.

Two axes describe each entry:

- Observation status: `NOT_OBSERVED`, `DOM_OBSERVED`, `SELECTED_FIELDS_ONLY`, `ACCESS_CHALLENGE` or `DOCUMENT_MISMATCH`. `DOM_OBSERVED` only means a supplied source-bound snapshot was verified/read. It does not mean imported, HTTP 200, visually accepted, truthful or ready.
- Classification: ordinary content candidate, query variant, source action, protected path, foreign origin, media, document, fragment, invalid reference or inventory identity without a raw-link witness. Review categories remain explicit records; they are not silently removed from the registry.

`queue_status` is `ALREADY_OBSERVED`, `OUTSTANDING` or `REVIEW_REQUIRED`. A DOM-observed query/protected identity can still have a review classification. Summary classification counts retain that distinction. Only ordinary unobserved witnessed content candidates enter the default next batch. Exact query variants remain for explicit review of their meaning and eventual capture; they are never silently merged with queryless paths. Review classification is a conservative heuristic, not authorization to trigger source behavior. No GET, form, cart or payment action is performed by this utility.

Priority uses observed navigation placement, heading links and then generic information/nested-path heuristics. It does not declare Product typing. A known access challenge contributes only its blocked source observation, never challenge links. Selected-field bytes stay partial. Source/document mismatches require redirect review. Source and paired HTML changes, foreign observation binding, path traversal, symlinks and wrong caller pins fail closed.

## Durable format and limits

The API returns full self-contained witnesses with the input SHA, HTML SHA when applicable, observed source URL/time, exact raw reference, position, label, base and control flags. Raw HTML remains in its original snapshot. A disk snapshot uses lossless `witness_encoding: contexts-v1`: common page/hash/time metadata is stored once in `witness_contexts`, and each occurrence references its numeric context. `decodeSourceQueue()` restores the full API structure. Legacy full-witness queue files remain readable. The next-batch file keeps standalone full witnesses for direct operator inspection.

The snapshot filename contains the SHA-256 of its exact JSON bytes. Existing output is compared and reused only if byte-identical; different bytes are never overwritten. Files are created exclusively and synced. An interrupted/incomplete file fails the next integrity comparison, requiring explicit recovery; it is not treated as an accepted queue. A snapshot exceeding the bounded resume-reader size is rejected before output. This is a filesystem artifact utility, not a replacement for root's authoritative Store artifact acceptance and leases.

Resume uses the previous queue's trusted caller pin and unions unresolved identities, witnesses and observations, even when an old raw directory is no longer provided. Merely selecting a URL does not mark it complete or remove it. Only a later supplied observation changes its observation status. Input listings are finite snapshots: files added by root during/after a run enter the following run. No automatic permanent retry, fetch or readiness transition exists.

Fixed bounds are 2,000 raw exports, 30 MB per read file, 800 MB cumulative read bytes, 50,000 identities, 500,000 witness occurrences, 40 MB of identity data, 180 MB of normalized provenance payload plus per-reference accounting, and 180 MB per stored resume snapshot. The provenance limit can only be reduced with `--max-witness-bytes`. Exceeding a bound produces `QUEUE_LIMIT`, preserving the previous queue instead of truncating. SHA-only dedup/order keys avoid keeping a second full copy of each witness as a Map key. These are explicit data bounds, not a proof of a constant RSS or a 50,000-URL capacity benchmark.

## Commands

Initial or full-directory recalculation, using the pinned v4 manifest:

```powershell
node --disable-warning=ExperimentalWarning scripts/plan-pilot-source.ts `
  --raw-dir var/pilots/teplypol-catalog-20260929 `
  --raw-dir var/pilots/teplypol-catalog-20260930 `
  --capture var/pilots/teplypol-catalog-package-20260929-v4/operator-capture.json `
  --capture-sha256 de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff `
  --output var/pilots/teplypol-queue-20260930 `
  --batch-size 250
```

Stdout is a compact JSON receipt with `queuePath`, `sha256`, `batchPath`, `reportPath` and counts. Read `entries[].url` from the **batch** file. The full queue can contain much larger evidence arrays; do not print it into chat. Preserve the receipt/hash through root's artifact registry. For incremental resume, append `--previous <queuePath> --previous-sha256 <accepted SHA>` and supply the directory/directories containing new raw observations. The exact prior input URLs are retained even if absent from current inputs.

Reproduce the real pinned no-new-input resume check:

```powershell
node --max-old-space-size=768 --disable-warning=ExperimentalWarning scripts/plan-pilot-source.ts `
  --raw-dir var/pilots/teplypol-queue-20260930/verification-empty-raw `
  --capture var/pilots/teplypol-catalog-package-20260929-v4/operator-capture.json `
  --capture-sha256 de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff `
  --previous var/pilots/teplypol-queue-20260930/queue-f72f220e94e943bd2325bb058efbe43401abff98ed5a4ce0a72f6bd7e63a1ecb.json `
  --previous-sha256 f72f220e94e943bd2325bb058efbe43401abff98ed5a4ce0a72f6bd7e63a1ecb `
  --output var/pilots/teplypol-queue-20260930 `
  --batch-size 250
```

The empty verification directory was created within the task's allowed output area. The expected output hash remains `f72f220e…`; the previous queue alone preserves all outstanding identities. Root may already have later snapshots; do not present this fixed test input as the latest source state.

## Checks and artifacts

Final source verification:

```powershell
npx --no-install prettier --write scripts/plan-pilot-source.ts tests/integration/source-queue.test.ts
node --disable-warning=ExperimentalWarning --test tests/integration/source-queue.test.ts
npm run check
git diff --check -- scripts/plan-pilot-source.ts tests/integration/source-queue.test.ts docs/reviews/source-queue-20260930.md
```

**12/12 PASS, zero fail/cancel/skip, 2080.8415 ms. TypeScript check PASS.** Tests exercise the actual CLI subprocess, exact significant query distinctions, duplicate occurrences, deterministic directory-order replay, pinned resume with old inputs omitted, selected-but-unprocessed retention, newly discovered URLs, raw HTML hash binding, malformed/foreign/action references, challenge isolation, selected-field boundaries, traversal, immutable output and lower byte caps. Lossless context encoding/decoding and byte-identical resumed artifact hashes are checked. Local full suite and Bitrix/source network checks are root's responsibility; not claimed here.

Concrete local artifacts in `var/pilots/teplypol-queue-20260930/`:

| Artifact / queue SHA | Evidence at that fixed observation point |
|---|---|
| `bootstrap-batch-50.json`, SHA `142b9abfdf50cc01649f686d10a16f66c9c5d8e4d4aed020e612ac9ed7ac3558` | Early handoff of 50 exact witnessed links; 142 raw files / 131 distinct observed source URLs. Provisional priority, no completion claim. |
| Queue `4949403b7c0a26146f313bd670e6035eebec711618de97f1773f2df98cdef397` | First full old-directory snapshot: 959 entries; 131 DOM observed; 694 outstanding; 134 review. Historical uncompressed provenance layout, 80,598,232 bytes. |
| Queue `a58608a2e97b3811406ec2f94e23d13d3480d3549e19d9752cda8c97919836dc` | Both directories: 1,052 entries; 206 DOM observed; 648 outstanding; 198 review; 144,904 witnesses; 90,089,149 bytes before normalization. |
| Queue `f72f220e94e943bd2325bb058efbe43401abff98ed5a4ce0a72f6bd7e63a1ecb` | Normalized snapshot: 1,069 entries; 1,054 same-origin HTTP identities including resources; 847 literal capture inventory identities; 270 DOM observed; 586 outstanding; 213 review; 190,591 witnesses in 1,293 shared contexts. 39,691,250 bytes. Declared newest observation `2026-09-30T03:40:12.062Z`. Batch contains 250 witnessed candidates. |
| `real-resume-check.json`, SHA `30e026cd01c1dd93292a262f34ea874719f40711ad57acbcf7706cbc2bf9a0c1` | Real pinned `f72f…` queue resumed with an empty raw directory and unchanged exact queue hash: PASS, 7,774 ms, Node heap cap 768 MiB, reported maximum RSS 767,816 KiB (about 750 MiB). All 1,069 entries / 190,591 witnesses retained. |

The memory measurement is a real local sample, not a synthetic 50,000-URL scalability claim. It includes inert Cheerio parsing and JSON reconstruction. No server or browser request was involved. The script's final additional output-size guard does not change queue bytes; targeted tests cover final frozen source. Snapshot counts grew as root continued independent collection, so these rows must not overwrite later accepted counts.

## Handoff

Root can continue the supplied batch, accept a reviewed queue artifact, then recompute from both raw directories or a pinned prior queue plus new exports. Review deferred query variants, documents and protected/action classifications explicitly; known ordinary pages alone are not full source closure. Import/extraction/route tests remain independent stages. HTTP challenge state, source gaps and Bitrix readiness remain unchanged by this planner.

Root should update the authoritative stage journal/requirements matrix after independent acceptance; those files are outside this task's write scope. This task does not claim DEMO_READY, completed pilot migration, working commerce, or verification of the real target.

Frozen source SHA-256:

- `scripts/plan-pilot-source.ts`: `04c566adbe7f2507c8f61f014f89ed2ec794fc2b26d3313dfd60d8f342c9a4d0`
- `tests/integration/source-queue.test.ts`: `bd89951f414920f6fbecd03c75de5fc1b09d94c56fa952c33fd2cabe11a29e57`
