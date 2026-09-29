# Operator extraction heartbeat fairness

Task `operator-heartbeat-fix-v1`, worker `heartbeat-fix`, fence 1. Root reported an actual r10 server failure while creating a model from 103 DOM observations: the model intent reached PENDING, then `reuseJson` rejected lost dispatcher ownership. Root retains that original PENDING record. This implementation task did not access or modify the server, pilot Store, target database or Git.

## Cause and bounded change

The immutable-artifact resolver can return a Buffer synchronously. Awaiting that value, and then awaiting `readVerified`, only schedules promise microtasks. Long successive asset/DOM processing can therefore prevent the Pipeline's timer-based heartbeat from running, despite the async function signature. The dispatcher expires after its existing lease duration and correctly rejects subsequent writes.

`packages/extractor/operator.ts` now awaits `setImmediate` from `node:timers/promises` before every asset and every observation. This yields a macrotask turn between bounded source units, allowing due timers and cancellation/lease observers to run. There is no fixed sleep or network access. The input limits, byte/hash checks, output order, evidence, identity, semantic facts and missing-media behavior are unchanged. Pipeline heartbeat frequency, lease TTL, absolute deadlines, ownership checks and fencing were not edited or weakened.

One file read/hash and one DOM transformation are still synchronous within a unit. This fix prevents starvation across a sequence of units; it does not claim hard preemption of a single exceptionally slow DOM operation. Existing payload/depth/block limits remain enforced. Worker-thread isolation or an intra-DOM budget would be a separate change if a single bounded observation itself exceeds a lease period.

## Behavioral evidence

`tests/integration/operator-heartbeat.test.ts` validates a temporary portable capture with 8 assets, 12 DOM observations and an unobserved inventory URL, then supplies immutable Buffers through a strictly synchronous resolver. A bounded 3 ms synchronous work interval per read ensures a 1 ms heartbeat timer is due without external I/O. Assertions require timer turns during both the asset phase and the observation phase. The complete model is compared with extraction through an asynchronous resolver, including facts, ordering, hashes, source block and full-size UNKNOWN status.

The test was run against the unmodified extractor first: **FAIL**, `No heartbeat during assets: []`. No timer tick occurred throughout the synchronous extraction. This directly reproduces event-loop starvation at a small test timescale; it does not pretend to reproduce the server's 60-second lease expiration with a shortened production TTL.

Commands:

```powershell
npm run check
node --disable-warning=ExperimentalWarning --test tests/integration/operator-heartbeat.test.ts tests/integration/catalog-extractor-review.test.ts tests/unit/core.test.ts tests/unit/core-review.test.ts tests/e2e/operator-model.test.ts
```

Final results: **TypeScript PASS; 37/37 tests PASS, 0 SKIP, 41651.9 ms**. The new heartbeat test passed in 179.7 ms and deep-equal output was preserved between synchronous and asynchronous byte resolvers. The existing core suites exercise exclusive dispatcher ownership, lease/fencing, cancellation and absolute task budgets; operator-model E2E covers unknown-write reconciliation, immutable replay and backup/restore. Those checks use temporary test projects only. An intermediate run passed the scheduling/output assertions but exposed a test expectation typo (13 known URLs instead of 14, because capture validation also includes the entry root); only that assertion was corrected before the final complete run.

Frozen implementation SHA-256: `e6a47d09fa27468eda4f061f8ae4f484e6bd1d5fc8456b30fce4cc0f000f8865`. The source diff is one standard-library import and one yield at each of the two loop boundaries.

The changed implementation fingerprint intentionally creates a new derived model identity. It does not rewrite an old PENDING intent or sealed artifact, extend an expired lease or accept an old writer. Root performs server retest and independent acceptance. Actual r10/r11 server model completion, Bitrix import and target HTTP checks are **NOT_RUN by this implementation task**.
