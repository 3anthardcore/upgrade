# Native demo performance diagnosis, 2026-09-30

The global admission lock is a **measured serialization point**, but the local evidence does **not** attribute the entire native p95 of 1,861 ms to it. The safest first optimization is to keep quota admission around writes/session creation while moving proven read-only work outside that exclusive lock. Preserve every snapshot hash check, per-session lock, quota and stored receipt. No production code was changed in this task.

## Inputs and measurement boundary

Root supplied an already completed native warm/no-store GET observation: 10 clients, 120 timed samples, median 1,210.786 ms, p95 1,861.134 ms. The native PHP-FPM pool has five workers on a six-core host. Root's additional read-only statistics at 08:15 UTC: 226 files / 113 JSON session files / 61,723 bytes; worker RSS 43,068–47,408 KiB, master 29,404 KiB. These are operator-provided native observations, not live checks performed by this reviewer. The private session state is far below the 1,000-session / 128 MiB quotas.

Local profiling used actual PHP 8.3.35 CLI with mbstring on Windows, the unchanged own `DemoRuntime`, `DemoEngine`, `DemoWeb`, `DemoView` classes and exact copied pilot snapshot bytes: 2,735,241 bytes / 389 items / SHA `907289cdf817e5b9141d22d595ebb136c4c794c93dc6f8ec5d600d1086f6d955`. Synthetic session files live solely below `var/evidence/native-performance-diagnosis-20260930/`; they are not native sessions or recovery backups. No Bitrix bootstrap, DB, HTTP, source browser, server, production code, Store or network call was performed. No source content was executed.

Windows filesystem timing, CPU, PHP SAPI and opcache differ from native Linux FPM. CLI loops warm the loaded PHP code, but do not model CMS bootstrap, SQL, network latency, FPM queueing or the full page template. Timings below diagnose the own-code path; they are not a server capacity claim.

## What the code actually serializes

`upgrade-route.php` performs CMS bootstrap, route/content SQL/API reads, `DemoRuntime::snapshot()` and `new DemoEngine()` **before** acquiring the admission lock. The snapshot file read/hash/JSON decode and constructor validation therefore cost CPU on every request but are not themselves serialized by this lock.

`DemoRuntime::handle()` then takes one exclusive `admission.lock`, scans every private session file for quotas, and retains that lock throughout **all** of `DemoWeb::handle()`. That includes search/facets, read-only receipt/session reads and even normal non-product pages which return `view=null`. Per-session `DemoEngine::locked()` is nested inside the global lock. Thus a busy individual session can delay an unrelated content page.

An actual local dependency probe held one synthetic session lock for 1,500 ms, observed that a product request acquired the global admission lock and waited on that session, then requested unrelated content. The product call took **1,393.34 ms**, and the unrelated content call took **1,282.65 ms**, both status 200. This establishes the lock dependency causally; it does not establish how often that condition occurs on the native site.

## Measurements

Sequential stages, 50 measured repetitions after three warmups, 100 synthetic sessions / 200 files:

| Stage | Median ms | p95 ms |
|---|---:|---:|
| Pinned snapshot file/hash/decode | 18.23 | 20.10 |
| DemoEngine constructor validation | 22.53 | 26.40 |
| Content DemoWeb directly | 0.19 | 0.24 |
| Content through admission gate | 3.82 | 4.47 |
| Product directly / through gate | 0.49 / 4.04 | 0.64 / 4.64 |
| Search directly / through gate | 22.70 / 26.41 | 26.36 / 27.76 |
| Search DemoView rendering | 0.70 | 0.83 |

The content gate median increases with file count: **0.78 ms at 10 sessions**, **3.82 ms at 100**, **30.97 ms at 900**. The measured native 113 sessions are close to the 100-session fixture, not the 900-session stress case. Source pages themselves have not become large private session states.

Separate 100-iteration microprofile of the same bytes:

| Operation | Median ms |
|---|---:|
| File read | 0.63 |
| SHA-256 | 8.88 |
| JSON decode | 8.12 |
| Full JSON re-encode used for constructor size check | 16.88 |
| DemoWeb facet construction | 2.20 |
| Engine empty-query search | 20.40 |
| Engine `Grand` search | 13.74 |

The constructor's unconditional `strlen(json_encode(snapshot))` builds a 2,526,299-byte normalized JSON string on every request solely for its size limit; it accounts for most of the measured 22.53 ms constructor cost. This is a candidate for a **verified-loader contract**, not permission to skip validation. Peak PHP allocation for the microprofile was 23,068,672 bytes; this is not process RSS or native FPM memory.

The final concurrent experiment reloads, hashes and validates the snapshot and reconstructs the engine **on every synthetic request**, with an independent existing cookie for each worker. Each worker executes ten rounds of search/product/content; 100 seeded sessions are present:

| Concurrent workers | Path | Requests | Median ms | p95 ms | Batch wall ms |
|---|---|---:|---:|---:|---:|
| 5 | Direct DemoWeb control | 150/150 OK | 47.32 | 78.86 | 1,886.09 |
| 5 | Actual admission wrapper | 150/150 OK | 74.20 | 174.13 | 2,741.25 |
| 10 | Direct control | 300/300 OK | 47.96 | 76.59 | 1,683.27 |
| 10 | Actual admission wrapper | 300/300 OK | 106.28 | 399.44 | 4,879.90 |

The direct control calls the **unchanged** DemoWeb method; it deliberately omits the admission wrapper for diagnosis only and is **not a proposed deployable bypass**. Both paths retain their own per-session locks. These tests confirm additional queueing from the global lock; they do not remove or modify it in application code.

A separate saturation experiment reused already constructed engines, shared one fixture session and made 20 search/product/content rounds per worker. Direct 10-worker control completed 600/600 requests in 546.85 ms. Gated execution took 7,276.53 ms: 598 requests succeeded and two search requests raised `DEMO_ADMISSION_BUSY` after approximately 3,003–3,006 ms. Its continuously hot loop exaggerates gate occupancy compared with a full HTTP request. Keep this failure as a fairness/head-of-line stress result, **not** as the native error rate. The more realistic fresh-engine/independent-session experiment above had no such failures.

## Other concrete costs and unproven causes

- `Router::navigation()` performs one own SQL query and up to 12 `CIBlockElement::GetByID` calls on every response. The builder can replace the header's dynamic navigation block with observed static links, yet the route entrypoint still computes this unused fallback. The native header bytes and SQL timings were not loaded by this profiler; confirm the deployed static-navigation branch before removing its query work.
- `Router::content()` fetches four properties including `UG_FACTS`; the page template does not render `UG_FACTS`, but `FactsProperty::decode()` decompresses, hashes and parses it anyway. Exact package data contains 23,094,345 raw fact bytes across 389 entities; homepage facts alone are 371,049 bytes. The codec's integrity checks must remain wherever facts are used. A separate presentation-only property projection could avoid an unnecessary facts fetch/decode; its actual SQL/decode contribution is not measured here.
- Ten HTTP clients competing for five FPM workers necessarily permit queueing. The local own-code stages do not account for the complete native ~1.2 s median/~1.86 s p95. CMS bootstrap, repeated API queries, database latency and FPM admission remain plausible contributors requiring native stage measurements. Low current RSS does not prove safe peak memory or spare CPU on the shared host.

## Recommended narrow next change and acceptance

1. First separate **proven read-only work** from global quota admission. Search, non-product GET/HEAD and receipt readback have no reason to hold the exclusive session-creation/writing gate. Retain admission around **all POST mutations and every actual new-session creation**, including quota scan/reservation and the complete atomic write. Keep the existing per-session lock and the original retained idempotency/receipt data. Do not use a naked `known cookie` precheck: if `resumeSession()` later returns null, the fallback must not create a new session outside admission. Prefer routing based on actual validated effect, or a fail-closed read-only mode which cannot silently fall back to creation.
2. Preserve byte hashing on every accepted snapshot read. Do not cache by filename, size or mtime alone; do not introduce a caller-provided `verified=true` bypass. If the constructor re-encode is optimized later, make the verified raw-byte/size/schema contract explicit and keep strict validation for ordinary array callers. Validate tampering, wrong project/target, pointer switches, same-size/same-mtime replacement, oversized/invalid JSON and source text handling. A parsed cache would need a digest/project/target/version binding and still verify current bytes; this task did not implement or benchmark such a cache.
3. After the lock change, measure native stages separately: CMS bootstrap, route/content reads, snapshot read/hash/decode, constructor, admission wait/hold, DemoWeb, navigation and rendering. Emit only numeric durations and opaque pinned identities to a private diagnostic artifact; no cookie/token/credentials or raw source content. Repeat the **same accepted GET plan** sequentially, preserving privacy headers and no-store behavior. Keep before/after receipts and compare per-path distributions, errors and live facts/session retention.
4. Treat pool tuning as a separate controlled change, not the first fix. A trial from five to six workers may be reasonable only after confirming host/container memory and CPU headroom and neighboring-service protection; the six-core count and ~43–47 MiB warmed RSS alone do not justify ten workers or guarantee lower latency. Do not touch vendor files or remove isolation/opcache timestamp safeguards.

Required behavioral regressions for the proposed admission change: simultaneous unknown-session creation at the 1,000-session limit; aggregate-byte quota with concurrent POSTs; corrupt/symlink state fails closed; missing known session cannot become an ungated new session; existing receipts survive quota exhaustion and restart; unknown-result reconciliation remains read-only; a held session lock does not block unrelated search/content; concurrent writes to the same session remain serialized; snapshot/body tampering is still rejected. Run existing engine/web/runtime tests and repeat the bounded local profile before requesting native acceptance.

## Reproduction, evidence and status

All helpers and raw results are below `var/evidence/native-performance-diagnosis-20260930/`. Existing fixture directories are intentionally never overwritten; rerun in a new isolated evidence directory with the same helpers and source modules. Core commands:

```powershell
node var/evidence/native-performance-diagnosis-20260930/run.mjs
node var/evidence/native-performance-diagnosis-20260930/concurrency-run.mjs
node var/evidence/native-performance-diagnosis-20260930/fresh-run.mjs
node var/evidence/native-performance-diagnosis-20260930/fresh-run.mjs --independent-sessions
```

`run.mjs` saved all three successful sequential profiles, then its first concurrency harness exited on a real admission timeout. V2 retains every worker's stdout/stderr, including errors, and completes. The first micro harness omitted its fixture DOCUMENT_ROOT and correctly hit `STATE_INSIDE_WEBROOT`; only the harness was corrected. That failure text and the successful `micro-result-v2.json` are retained. These failed initial runs are not labeled PASS. `initial-run-status.json` records this history.

Final evidence: `sequential-{10,100,900}.json`, `micro-result-v2.json`, `concurrency-result-v2.json` plus per-worker raw files, `fresh-result-v3.json`, `fresh-result-v4-independent-sessions.json`, `facts-sizes.json` and `native-observation-context.json`. `pins.json` records source/helper/result hashes.

**Diagnosis complete; production optimization NOT_IMPLEMENTED; native attribution/after-change speedup NOT_RUN.** Root can use the measured lock dependency to scope the next change without claiming that the native latency target or readiness has already improved.
