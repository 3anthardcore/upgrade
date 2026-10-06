# Incremental crawler persistence — 2026-09-30

Task `crawl-persistence-scale-20260930`, owner `crawl-scale-engine`, fence1. Inputs: `art-bdb28713-71fc-4ed9-a758-b9838b1d2618`, scale baseline `art-97c4acd1-b4df-47e0-8b20-900e95f118f8`; legacy-fixture seam explicitly authorized by `art-fa733565-222a-40b4-af1e-8ae51b2fd722`. All work is local code/disposable fixtures. No server, project Store, target database, customer source, pipeline/CLI implementation or Git mutation was performed.

## Implemented

The crawler now persists changes to individual page/resource records and metadata in an ordered SHA256-chained journal, rather than serializing the entire growing state around every fetch. Exact source URL spelling, `CrawlResult` fields, robots/access rules and source registry semantics are retained. URL maps replace repeated array lookup; completeness counts update from changed statuses. Snapshot files are flushed before their references are committed.

A same-directory atomically selected generation contains a checksummed checkpoint and journal. Compaction writes/synchronizes its new checkpoint/journal/head before retiring the previous selected generation. Recovery validates bytes, sequence and chain before source activity. Torn final records, missing middle records, reordered records, corrupt checkpoint, missing authoritative head and budget watermark damage fail closed. Failed compaction retains orphan evidence and never chooses it as authority. Finite file/count/byte bounds are enforced; the writer becomes unusable after an unknown append/commit failure.

Every network request has an exact request/worst-case-byte reservation synchronized before IO. A separate fixed-size, checksummed `reservation.json` is synchronized afterward and binds the authorized journal sequence/hash. This also catches truncation of whole valid journal rows below the latest reservation, which a chain alone cannot detect. This author-found issue was corrected before the final scale run; the earlier code pins remain history. Checkpoints retain the watermark binding when compacting its original prefix.

Observed metadata may append without a separate fsync; the next pre-request flush synchronizes that entire prefix, and a successful crawler return synchronizes all state. An unsettled request group after process death returns PAUSED / `REQUEST_OUTCOME_UNKNOWN` with the charged budget and no automatic GET. Known HTTP robots failures retain their reason and can be explicitly observed later under the unchanged budget. Known access blocks preserve their existing acknowledgement contract. No uncertainty is converted into successful content or a reset budget.

`crawl.json` is the compatible atomic projection on return, including PAUSED returns. An old no-journal snapshot migrates with its counters/start time/policy intact; a modern projection cannot replace journal authority. Relocation verifies immutable payload hashes and checkpoints new derived physical paths. Public return values are ordinary objects, retaining `structuredClone`/extractor compatibility.

## Local verification

Environment: Windows x64, Node **24.20.0**. Exact environment receipt and source/test pins are in `var/evidence/crawl-persistence-scale-20260930/environment.json` and `code-pins-watermark.json`.

```text
npm run check
PASS

node --disable-warning=ExperimentalWarning --test tests/unit/crawl-persistence.test.ts tests/integration/crawl-persistence.test.ts tests/integration/discovery.test.ts tests/integration/access-challenge.test.ts
41/41 PASS, 0 FAIL, 0 SKIP, 15.770 seconds

node --disable-warning=ExperimentalWarning --test tests/e2e/pipeline.test.ts
1/1 PASS, 0 FAIL, 0 SKIP, 8.862 seconds
```

New coverage includes a real child killed during a streamed HTTP response: the parent independently reads the durable reservation before the kill, restarts the crawler, verifies unchanged charged counters/start time and verifies no new source request on repeated resume. Storage tests cover append failure before/after sync, lost watermark acknowledgement, both checkpoint interruption boundaries, mutation during checkpoint IO, whole-tail deletion, complete journal truncation, missing/reordered/torn rows, checkpoint/watermark corruption, missing head, finite mutation limits and bounded delta size against 5,000 unchanged asset records. Existing discovery/access tests cover actual browser challenges, robots, exact URL/facts, relocation, throttling, source byte corruption and limits. The authorized legacy test now creates a genuine separate no-WAL directory rather than overwriting a modern derived projection.

The first development run had four proxy-return/`structuredClone` failures and the expected legacy-fixture mismatch; those are retained in `initial-tests.log`, fixed before the passing runs, and not claimed as acceptance. `final-watermark-tests.log` and `pipeline-e2e.log` contain final test evidence.

## Scale measurements and honest comparison

The root-owned `scripts/measure-crawl-scale.ts` was read/run unchanged, SHA `5a5193aefef7b300c9548ae7fd30fb69b24c6205698e4c54a9cf9712af45e2b5`. Its fixture makes real bounded loopback GETs at a maximum100/s, with unique HTML URLs and unique image URLs containing identical small raster bytes. This is a crawler/discovery/persistence metadata workload, not browser rendering, unique large-media volume or a whole native migration.

| Run | HTML / resources fetched | Requests | Wall seconds | CPU user/system seconds | Peak RSS bytes | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Root original full-JSON baseline | 250 / 1250 | 1502 | 29.464 | 19.219 / 7.031 | 184520704 | PASS, pre-change |
| Development every-save fsync | 250 / 700 | 952 | 120.142 | 4.875 / 2.015 | 129728512 | INCOMPLETE, budget cap; retained |
| Development persistent journal FD | 250 / 1250 | 1502 | 52.151 | 4.672 / 1.406 | 115396608 | PASS, before final watermark |
| Development larger workload | 1000 / 5000 | 6002 | 212.149 | 16.000 / 4.766 | 212930560 | PASS, before final watermark |
| Final code with durable watermark | 250 / 1250 | 1502 | 81.944 | 4.797 / 1.562 | 144359424 | PASS |
| Final code full controlled crawl | 10000 / 50000 | 60002 | 2997.674 | 160.437 / 60.625 | 460800000 | CRAWL_ONLY_PASSED |

The final250 run uses the identical counts/rate/120-second limit to the original. CPU fell from26.250 to6.359 seconds and RSS from184.5 to144.4 MB, but wall time increased from29.464 to81.944 seconds. The old implementation did not fsync its reservations; the new implementation includes real journal and watermark synchronization before every request. **This is a durability/scaling change with a measured Windows latency regression, not a claim that the small crawl became faster.** OS/background-load variation and the small repeated-resource fixture limit extrapolation.

The exact final small run is `scale-250-1250-watermark/{profile.json,crawl-result.json,receipt.json}`. Prior development measurements have separately named immutable directories. No failed/partial run was deleted or relabeled.

At10:19UTC the final pinned code began the actual10,000 HTML /50,000 resource workload, with a finite3300-second budget, in `scale-10000-50000-watermark/`. It completed with process exit0 after2997.674 seconds: exactly10,000 HTML,50,000 resources,60,002 GETs,8,604,452 received bytes; queued0, failed0, rejected0. The result JSON is43,584,771 bytes. The source independently counted10,000 HTML,50,000 assets,one robots request andone sitemap request. This establishes **CRAWL_ONLY_PASSED** for that controlled workload. RSS is sampled every250ms, not a certified instantaneous OS peak.

The final receipt SHA256 is `c4dfc7f040c4e3e87bad06891e19f73dd3d3cef42db7697ae9f979761325d510`; profile SHA256 `836797dbcbd3e359d856d91746072148a1f856310f4827944831b30c89375b8f`; exact result SHA256 `2fab5ba96c57ceba6b2301cf530fc67ce88ac3952615756fddf3a8ef9e111824`.

At11:11UTC, `node --disable-warning=ExperimentalWarning var/evidence/crawl-persistence-scale-20260930/offline-recovery-audit.ts` passed without any network activity. It reconstructed the authoritative journal/checkpoint state and compared it deeply to both the final result and the derived projection; pending request isnull, stateCOMPLETE. Every one of60,000 payload references has a canonical content-addressed path and matching size/hash; all10,001 unique physical payload files were read and SHA256-checked (the fixture shares one small image across its50,000 distinct resource URLs). Final source/test/benchmark pins were rechecked unchanged. `offline-recovery-audit.json` is author evidence, not independent acceptance.

## Boundaries and next step

This is local author evidence, pending independent review. Metadata remains O(known pages/resources) in RAM; the code does not hold all source bodies or images in memory. A single current response remains bounded separately. Checkpoint≤512 MB, journal read≤256 MB, mutation≤16 MB, journal directory≤128 regular files/2 GB; copy the complete quiescent source directory for backup.

The unknown-result stop is deliberately conservative: there is no new CLI to acknowledge or erase an unsettled reservation. Explicit reconciliation/research policy is still required; do not delete WAL state, reuse a stale projection or reset project budgets. These checks do not defend against a malicious filesystem owner rolling back all coordinated files together. POSIX directory fsync is used where available; actual sudden-power-loss certification across Windows storage is NOT_RUN.

Native Bitrix, customer-source throughput, full-pipeline10k/50k behavior, new deployment and readiness are **NOT_RUN / NOT_EVALUATED**. Runbook: `docs/runbooks/crawl-persistence.md`. The next step is independent review of the pinned implementation and receipts, followed by a separately authorized integration/deployment decision.

## Source freeze

| File | SHA256 |
| --- | --- |
| `packages/crawler/index.ts` | `df83f5885a765a4d641087d781325267c32ecc19ac585866c7bc619cb872ba3b` |
| `packages/crawler/persistence.ts` | `f6bdd5e4ad0fc4ef7d4c16a1f00e566182470031cb17f4e62c0dab4852830a73` |
| `tests/unit/crawl-persistence.test.ts` | `4f7bcda5d7e1922500e25bd8d0ca98118aad5ffd8d286f2804cdb2710b06532e` |
| `tests/integration/crawl-persistence.test.ts` | `36f68ecb517c22acea49a992f8937e9a5661f5d97bb3a2fe9fccc00f4af9d84c` |
| `tests/integration/access-challenge.test.ts` | `c361d971b18f76f30db6a45a7e0b9f94b2f0273769ab6e5e9aacd98ba028a4b8` |
