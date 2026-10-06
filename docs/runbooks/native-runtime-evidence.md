# Attach copied native runtime evidence

This API records bounded, hash-pinned operator copies of native receipts. It performs no target requests, import, SQL, restore or browser run. The operator must supply an independently obtained SHA-256 for the complete bundle manifest. A valid bundle records an attestation; it does not authenticate the operator's original observations or make the project ready.

The new API is separate from CLI, Pipeline and reporter integration:

```ts
import { ingestNativeRuntimeEvidence, readNativeRuntimeEvidence } from "../../packages/core/native-runtime-evidence.ts";

const result = await ingestNativeRuntimeEvidence(store, {
  buildId: acceptedBuildId,
  directory: copiedBundleDirectory,
  expectedManifestSha256: independentlyPinnedManifestSha256,
  // Optional absolute deadline, at most 20 minutes ahead; default is 10 minutes.
  deadlineMs: Date.now() + 600_000,
});

const evidence = readNativeRuntimeEvidence(store, verifiedBuildIds, currentBuildId);
```

The caller opens the existing project Store. Use a COMMITTED operator build and matching COMMITTED native import evidence. The reader takes the caller's set of verified build IDs; it reports CURRENT or STALE relative to the explicit current build ID. CURRENT means a matching local binding, never a live target check.

## Bundle

The directory contains `native-runtime-evidence.json` and exactly its declared files. Unlisted files/directories, traversal, hard links, symlinks, changed files, invalid UTF-8, duplicate JSON keys and oversized input are rejected. No cookies, password values, CSRF/idempotency tokens, browser checkpoints or session envelopes belong here. Private path/hash references in original restore plans remain private evidence and must not be printed in public reports.

The exported `NativeRuntimeManifest` is the authoritative TypeScript contract in `packages/contracts/native-runtime-evidence.ts`. Its exact top-level keys are:

```json
{
  "schema_version": 1,
  "kind": "native-runtime-evidence",
  "project_id": "project-id",
  "target_id": "target-id",
  "build_record_id": "SHA256",
  "model_record_id": "SHA256",
  "build_artifact": {"artifact_id": "art-ID", "sha256": "SHA256"},
  "model_artifact": {"artifact_id": "art-ID", "sha256": "SHA256"},
  "route_artifact": {"artifact_id": "art-ID", "sha256": "SHA256"},
  "scope_artifact": {"artifact_id": "art-ID", "sha256": "SHA256"},
  "target_evidence": {"record_id": "SHA256", "result_artifact_id": "art-ID", "sha256": "SHA256"},
  "package_manifest_sha256": "SHA256",
  "snapshot": {"id": "SHA256", "sha256": "SHA256"},
  "origin": "https://demo.example",
  "attestation": {"kind": "operator-copied-native-receipts", "recorded_at": "2026-09-30T10:00:00.000Z"},
  "code_pins": {},
  "files": {}
}
```

Replace placeholders with actual accepted values. `files` must contain at least one role; each value is `{relative_path, sha256, size_bytes}` and its path must be unique. `code_pins` admits `browser_verifier`, `transport`, `prepend`, `guard`, `current_restore_executor`, `backup_helper`, `historical_helper`, all lowercase SHA-256 strings. Pins record which code an operator says produced the receipt; they do not independently approve that code.

| Group | Roles | Recorded check |
|---|---|---|
| Reusable browser | `browser` | Exact HTTPS project/snapshot/verifier binding, JavaScript disabled, bounded counters/exchanges, four confirmed own POST operations with subsequent readback, responsive and scenario receipt predicates |
| Before/after data | `facts_before`, `facts_after` | Exact package entity facts/hashes/IDs and unchanged counters; native order/event counts must both remain zero |
| Neutral pre-bootstrap transport | `transport`, `guard`, `runtime_configuration`, `runtime_compose` | Neutral CMS request context, preserved own request, package transport hash, deployment configuration/compose and guard receipts |
| Current private restore | `current_plan`, `current_result`, `current_events`, `current_state_ledger` | Complete current-copy receipt cohort, package/snapshot membership in the pinned state ledger, file/database/private-state readback, guard-before-CMS order, retained synthetic receipt and unchanged session assertion, preserved source runtime |

Absent or incomplete groups remain NOT_RUN. Browser success alone does not prove unchanged native data. Browser screenshots are not visually reviewed by ingestion. This v1 accepts the current reusable verifier's fresh completed cohort; an interrupted/reconciled receipt never becomes a completed browser check.

`runtime_configuration` is an operator-copied deployment/config observation with exactly these keys: `schema_version:1`, `project_id`, `target_id`, `package_manifest_sha256`, `origin`, `prepend_sha256`, `guard_sha256`, `transport_sha256`, `configuration_sha256`. The final hash must equal the retained `runtime_compose` file hash; PHP environment project/target bindings must agree. The transport hash must equal the accepted package entry `code/module/upgrade.core/lib/demotransport.php` and the transport receipt. Do not invent this attestation because other receipts happen to have matching fields.

For restore, copy the original plan, result, JSONL events and backup state ledger unchanged. `current_plan` may be the runner's raw plan or PLAN_ONLY envelope. Its canonical SHA must match the result. The ledger role is pinned by `backup_manifest.outputs.state_root.ledger_sha256`; it must contain the active snapshot path and the sibling release `manifest.json` with the current package SHA. Historical SQL/CMS-only restores do not satisfy this group. A retained receipt is mandatory for a PASS in this v1. The validator checks the producer's recorded session-integrity assertions and response/body hashes; it does not receive or decode private session bytes.

Individual caps are exported as `nativeRuntimeCaps`: browser 2 MB; each facts receipt 8 MB; transport/guard/config 65,536 bytes each; compose 4 MB; plan 32 MB; result 1 MB; events and ledger 16 MB each. The whole bundle is capped at 64 MB. JSON depth, event count, source payload and package checks are bounded separately.

## Persistence and recovery

Ingestion acquires the project's dispatcher and checks ownership plus the absolute deadline around every receipt mutation and artifact publication. It validates exact accepted build/model/routes/scope/native-import/package/snapshot bindings, then rechecks source payloads with bounded yielding reads. It saves a deterministic PENDING intent, immutable VALID artifacts, and finally COMMITTED evidence.

If a publication reply is lost, repeat the identical pinned bundle. Previously published matching bytes are verified and reused before another publication. A changed bundle has a distinct deterministic identity. Corrupt authoritative Store keys, inconsistent pending records and altered artifacts fail closed; ingestion does not reset them or silently accept a new interpretation. No target write occurs in this process.

The summary always preserves source scope and reports `full_source_denominator: UNKNOWN`, `native_target_current_state: NOT_RECHECKED`, `readiness: NOT_READY`. General report integration must retain all other independent blockers.
