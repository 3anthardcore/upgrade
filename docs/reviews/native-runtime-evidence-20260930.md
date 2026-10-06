# Native runtime evidence implementation — 2026-09-30

Author task `native-runtime-evidence-20260930`, owner `runtime-evidence-engine`, input `art-f74fd41a-9cbd-4f87-937f-2a1177086087`. This implements separate pure receipt contracts and durable Store ingestion. It does not change CLI, Pipeline, reporter, existing native QA, production source, server or target database. Author acceptance is not independent review.

Implemented:

- `packages/contracts/native-runtime-evidence.ts`: bounded UTF-8/JSON and exact manifest validation; four independently reported groups covering reusable browser receipts, before/after native facts, neutral pre-bootstrap transport/configuration, and current private-copy restore. Local-only browser results, unknown operations, counter/exchange contradictions, wrong origins/snapshots/code pins, changed facts, equal nonzero order/event counters, historical restores, missing state ledger, changed retained receipt, late guard and source drift fail closed. Missing groups remain NOT_RUN.
- `packages/core/native-runtime-evidence.ts`: exact COMMITTED import/build/model/routes/scope/package/snapshot binding; bounded retained-file checks, capture revalidation with yields, dispatcher renewal and an absolute deadline; guarded Store mutations and artifact publication; deterministic PENDING/COMMITTED state; immutable reuse after unknown publication outcome; stored evidence revalidation and explicit CURRENT/STALE binding. It uses existing Store APIs and guarded publication, with no target connection.
- Unit tests, actual local Store integration tests, copied native receipt audit, and [runbook](../runbooks/native-runtime-evidence.md). No native or simulated target writer is installed by this change. The integration setup uses the real capture/model/package/import-evidence path with a clearly modeled reconcile response, never a live CMS claim.

Verification checkpoint before final freeze:

```text
node --disable-warning=ExperimentalWarning --test tests/unit/native-runtime-evidence.test.ts tests/integration/native-runtime-evidence.test.ts
node --disable-warning=ExperimentalWarning var/evidence/native-runtime-evidence-20260930/copied-audit.ts
npm run check
```

Initial pure tests: 28/28 PASS. Initial Store tests: 7 PASS / 1 FAIL because the metadata-race harness tried to make a competing write after SQLite had already acquired its transaction lock, receiving `database is locked`. The injection was moved to the actual gap before metadata transaction acquisition; the same stale-publication safety requirement then passed. The subsequent eight Store tests passed, including cold restart, unknown publication reuse, real second-connection takeover before metadata publication and after publication, corrupt accepted capture, corrupt record key and deadline/held-dispatcher rejection. Additional committed-receipt tamper and pending-fileset corruption tests are included in the final set. No production guard was relaxed to satisfy tests.

An early whole-workspace TypeScript run encountered another task's in-progress `packages/crawler/persistence.ts` errors; this task did not edit that file. A later `npm run check` passed. Final exact counts, hashes and logs are appended below at freeze.

Copied native audit uses the existing 389-entity package, the reusable 205-response browser receipt, and the exact before/after facts receipts. The pure validator accepts those two groups while retaining 2742 known / 389 selected / 2353 unresolved URLs and UNKNOWN full source. Actual transport, guard, compose, current restore plan and state ledger are also parsed as supplied. The copied audit currently lacks the runtime configuration attestation and completed current result/events, so transport/current restore remain NOT_RUN. No new native call is made and no missing receipt is synthesized.

Limits: these are operator-copied attestations, not live state authentication or code review approval. Source observations remain untrusted. Browser receipt predicates are bounded and do not constitute a full accessibility/visual audit; screenshot pixels are not ingested or assessed. Current restore validation does not receive secret session envelopes; it verifies the pinned producer's recorded unchanged-session and retained-response assertions plus ledger/package bindings. Native catalog mapping, current deployment of this code, full-source closure, end-user production recovery and DEMO_READY are outside this implementation.

## Freeze — 10:03 UTC

Final targeted set: **40/40 PASS, 0 SKIP**, 19,759.471 ms (30 pure contract cases, 10 actual local Store integration cases). TypeScript check: **PASS**. The final two boundaries additionally reject secret fields in copied receipts and a transport count cohort inconsistent with supplied native facts. All tests ran locally; the current native restore group was not relabelled PASS.

| Owned file | SHA-256 |
|---|---|
| `packages/contracts/native-runtime-evidence.ts` | `3385f0f1233657c1fbb77ddb5a4a030fe8c454236cef7b1dae5d8df5cf5bafad` |
| `packages/core/native-runtime-evidence.ts` | `863259277ed11ae624d017b2eeabc49c8f18849fce08b7f5cade2e189886d8f3` |
| `tests/unit/native-runtime-evidence.test.ts` | `54c4d983f26eebc9e8183ead353c93a334cb43c34460b8d2372b25ff14ba9c35` |
| `tests/integration/native-runtime-evidence.test.ts` | `af92ef3292ff54ada4e880a6570662524654e34a5a3373cee5601e6a85ea3045` |
| `docs/runbooks/native-runtime-evidence.md` | `56d6e48e5215ad641bf8eed7c7d34a0894211f3bc4d3b1b8197aa17d1325a135` |

Logs in `var/evidence/native-runtime-evidence-20260930/`: `targeted-freeze.log` SHA `3c1f7f52863e50f2dc4e7586669c0f230fc8344facfa3f2c959d7f7e111c89b4`; `check-final.log` SHA `52047e4e2fd4dc882cff78211cb1676d757caf9d13a5d278d05f40582bf43314`; copied audit result SHA `9b5a677cdd8f7e2ce331e23b6b782e2298a835d58561fd992fb5b70f5936c079`.

Next step: independent review of these frozen inputs, then root-owned CLI/reporter integration and ingestion of complete native cohorts. Missing copied native inputs at freeze are `runtime_configuration`, `current_result`, `current_events`. The raw current plan's canonical SHA independently computes as `8a5b3eddce190f6eb0e52933fc7c4e3fa065db23bf316e8b9ca5f9329b0f6330`, agreeing with root's pin; this isolated check is not a completed restore.
