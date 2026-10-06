# Native target adapter: independent review, 2026-09-30

Persisted task `native-adapter-review-20260930`, owner/reviewer `discovery`, fence 1; input `art-70118d18-7e4c-470e-a2c6-b5e11071dc8d`. Root owns implementation, Store, real target and acceptance. Reviewer write scope is this document only. Local tests created and removed isolated temporary package/journal fixtures; no SSH, source browser, target/Store/production DB or Git operation occurred.

## Version 1 verdict: REJECT

Reviewed frozen inputs, verified from disk before tests:

| File | SHA-256 |
|---|---|
| `packages/bitrix-adapter/native.ts` | `0e2d0f00428e45e1fb41a21752a0751cb5091422dd1e99b5b2539137e23e12bf` |
| `scripts/native-target.ts` | `0e9596703f26a684e3d95a31a87fa790584f91958e8b9f22f8d5aec7edebea10` |
| `tests/integration/native-target.test.ts` | `48b5d80f24835b00380ec0fd43deb25108bb51e61e4c3e7d95216dc8a9b12ccf` |

The `target` branch of `packages/cli/index.ts` was read: it requires explicit `--environment demo`, supported action and pinned profile/package arguments, dynamically loads the adapter before opening the content Store, and returns a verification exit code for `RECONCILED_INCOMPLETE`. This branch was not changed by the reviewer. Own importer/Gateway source was read only to trace the target's independent `flock`, fence/lease and backup-receipt checks. No vendor source was changed or executed in the review.

### P2 — malformed target receipts can confirm a write

At v1 `native.ts:142`, `claim.lease_until * 1000 <= Date.now()` does not reject an absent/non-finite lease: multiplication yields NaN and the comparison is false. At v1 lines 144 and 146, `defects?.length === 0` accepts an empty string instead of an array. The explicit standalone reconcile branch checks `Array.isArray`, but the post-apply branch does not apply the same invariant.

Independent local runner reproductions against a valid built package and pinned profile:

```json
{"case":"malformed-reconcile","unexpected_status":"TARGET_CONFIRMED","calls":["dry-run","claim","apply","reconcile"]}
{"case":"missing-lease","unexpected_status":"TARGET_CONFIRMED","calls":["dry-run","claim","apply","reconcile"]}
```

The first reproduction supplied valid dry-run/claim/apply receipts, then `{status:"DATABASE_RECONCILED", defects:""}` for final reconcile. The second omitted `lease_until` from `{fence:1, owner:"upgrade-cli-test-project"}` and supplied normal apply/reconcile receipts. Both should reject before marking confirmation; the missing lease must prevent apply dispatch. These are adapter contract doubles, not evidence of a real database write. The own PHP normally emits the expected shapes, but the adapter's responsibility is to fail closed on malformed/unknown transport results.

Required correction: one strict validation path for every command receipt, finite safe numeric lease/counters, arrays for defects/conflicts/blockers, and unchanged UNKNOWN state until a correctly shaped target reconciliation succeeds. Root accepted this finding.

### P2 — recovery guard itself cannot recover after process death

V1 lines 82–92 serialize stale-writer recovery with `lock-recovery.lock`, created exclusively without recoverable owner metadata. If that recovery process dies after creating the guard, every later startup returns `NATIVE_LOCK_RECOVERY_BUSY` indefinitely, even though the original writer PID is dead. The guard removes the concurrent-unlink race only while its owner survives.

Independent local reproduction used a real child process that exited normally (PID 17728), then the precise interrupted filesystem state: `writer.lock` contains that dead PID and `lock-recovery.lock` exists empty. Two subsequent `executeNativeTarget(..., action:"validate")` calls both rejected with `NATIVE_LOCK_RECOVERY_BUSY` before dispatch. This confirms a cold-restart availability failure, not concurrent target writes.

Required correction: process-lifetime locking whose OS lock releases on death, or independently recoverable and race-safe recovery ownership. Persistent operation UNKNOWN state must remain separate from transient lock ownership. Root accepted the finding and proposed a transport-owned private SQLite transaction lock, separate from the content Store; that proposal is not considered tested in this v1 verdict.

### Target identity binding boundary requiring explicit resolution

V1 binds the journal to profile `target_id`, project, container, document root and package/state roots. The target ID is not passed to the PHP importer. Apply's backup receipt is compared to the container's `UPGRADE_TARGET_ID`, but there is no comparison to `profile.target_id`. If the profile field is the actual target UUID, the transport must verify it through a pinned target handshake/expected-ID argument. If it is only a logical label, that weaker meaning must be explicit; journal equality alone does not attest the remote target identity. This source-level finding was sent to root; no foreign target or server test was performed.

## Version 1 executed checks

```powershell
node --disable-warning=ExperimentalWarning --test tests/integration/native-target.test.ts
```

**7/7 PASS, zero fail/cancel/skip, 4281.6984 ms.** They cover replay, lost apply response with destination reconciliation, malformed explicit reconciliation, different-package UNKNOWN blocking, profile/package/private-path checks, concurrent calls in one process and manual-edit conflicts. They are behavior tests with `NativeRunner` doubles, not actual Docker/Bitrix integration. They do not cover process death during recovery or malformed post-apply receipts, which the independent reproductions above reject.

The reproductions built a normal local package using `buildBitrixPackage`, passed the resulting real manifest pin through `executeNativeTarget`, and supplied only the destination runner as a double. Temporary fixture directories were bounded beneath the OS temporary root and removed after tests. No package/source/Store file in the workspace was rewritten. Frozen v1 source hash was rechecked after reproduction and remained unchanged.

Four additional checks exercised `runNativeProcess` with actual local Node child processes, without Docker/CMS/network: valid JSON readback PASS; stderr sentinel redacted from an exit-2 error PASS; invalid JSON rejection PASS; absolute 10-second deadline PASS at 10,004 ms with `NATIVE_OUTCOME_UNKNOWN_TIMEOUT`. The timeout stops the local transport client; it does not prove termination of PHP already executing inside a real Docker container. UNKNOWN persistence and the destination Gateway lock/reconciliation remain required. No target side-effect claim follows from these subprocess checks.

```json
[
  {"id":"native-v1-input-pins","status":"PASS","details":"Three requested SHA-256 pins matched local files."},
  {"id":"native-v1-existing-contract-suite","status":"PASS","details":"7 local tests, 0 skips; destination is a runner double."},
  {"id":"native-v1-malformed-receipt-rejection","status":"FAIL","details":"Post-reconcile defects empty string and missing claim lease both reached TARGET_CONFIRMED."},
  {"id":"native-v1-dead-recovery-owner","status":"FAIL","details":"Dead recovery guard blocked two subsequent starts indefinitely."},
  {"id":"native-v1-actual-target-through-this-review","status":"NOT_RUN","details":"No Docker, SSH or CMS/target DB operation performed by reviewer."}
]
```

## Version 2 verdict: ACCEPT within the local transport boundary

Separate persisted task `native-adapter-review-v2-20260930`, owner `discovery`, fence 1, input `art-28354fe7-72cb-4a37-88ec-49b6191ebc93`. V1 REJECT remains unchanged above. Root-reported r12 reconciliation predating the lock/receipt changes is separate evidence and was not used to pass the new transport.

Verified v2 pins before and after local checks:

| File | SHA-256 |
|---|---|
| `packages/bitrix-adapter/native.ts` | `23668a2b3c2976676ae182d4eefe5b64c83ead227612a8c3a0e094d1bf075d66` |
| `bitrix/importer/cli.php` | `a5e9baa47da1382abe9b74dd52f0229d957286239227d01771fbc3736121290b` |
| `tests/integration/native-target.test.ts` | `0283b023febb3883bec65ba830130b809326c65a481f1c4d4523cc666f3fffc3` |
| `scripts/native-target.ts` | `0e9596703f26a684e3d95a31a87fa790584f91958e8b9f22f8d5aec7edebea10` (unchanged) |

No remaining blocker was found in this bounded review. The corrections address the three concrete v1 boundaries:

- Every dispatched command validates `_target.project_id`, actual target ID and accepted manifest hash. Receipt counters must be nonnegative safe integers; claim requires a safe future lease within the permitted horizon; reconciliation requires an array of object defects consistent with its success/failure status. A malformed receipt cannot update confirmation. Claim/apply still persist UNKNOWN before dispatch.
- A private transport-owned SQLite `BEGIN EXCLUSIVE` lock replaces both PID/recovery files. It remains separate from the content Store and is held across the whole transport sequence. The OS releases it when the process dies; JSON UNKNOWN state remains durable for target reconciliation. Different-package UNKNOWN blocking and pinned journal binding remain.
- The adapter passes `--target-id`; own PHP compares it with `UPGRADE_TARGET_ID` before CMS bootstrap and includes target/project/manifest binding in command responses. Native adapter calls always supply this argument. Legacy direct PHP invocation can omit the new optional flag, so this strengthened expected-ID claim applies specifically to the reviewed native path.

### Repeated maintained tests

```powershell
node --disable-warning=ExperimentalWarning --test tests/integration/native-target.test.ts
npm run check
git diff --check -- packages/bitrix-adapter/native.ts bitrix/importer/cli.php scripts/native-target.ts tests/integration/native-target.test.ts
```

**9/9 PASS, zero fail/cancel/skip, 4426.2551 ms; TypeScript and whitespace checks PASS.** New maintained regressions cover empty-string defects, missing/NaN lease, foreign target identity, string counters, and actual child process SIGKILL after persisted UNKNOWN claim followed by reconciliation on restart. Destination responses in these maintained tests remain doubles.

### Independent process and PHP checks

A stronger independent crash scenario used **three actual Node processes** and an on-disk destination double:

1. Process A applied one simulated destination write, saved ledger `{created:true,writes:1}`, and deliberately stopped responding before its apply result. Its actual transport journal was read back as UNKNOWN.
2. Separate process B attempted the same target and returned `NATIVE_WRITER_BUSY`; it did not dispatch to the destination double.
3. A was killed with SIGKILL. Fresh process C opened the surviving journal, dispatched **only `reconcile`**, returned `TARGET_CONFIRMED` with `replayed:true`, and left the ledger at one write.

Observed raw summary:

```json
{"case":"actual-multiprocess-lock-and-lost-write-response","competing_process":"NATIVE_WRITER_BUSY","first_process_killed":true,"persisted_before_kill":"UNKNOWN","restart_calls":["reconcile"],"replayed":true,"destination_double_writes":1,"result":"PASS"}
```

This proves the local process-lock/journal lifecycle and retry ordering for that case; the destination ledger is a file double, not Bitrix. It does not assert a real database commit/rollback or Linux Docker process lifecycle.

Own PHP target binding was then tested with a real temporary validated package and local PHP 8.3.35:

```powershell
# Arguments supplied by the fixture include real temporary package/manifest pins.
var/tools/php-8.3.35/php.exe -n -d extension_dir=<absolute-ext-dir> -d extension=mbstring `
  <temporary-package>/code/importer/cli.php --command=reconcile --package=<temporary-package> `
  --project=test-project --target-id=isolated-test --manifest-sha256=<fixture-manifest-pin>
var/tools/php-8.3.35/php.exe -n -l bitrix/importer/cli.php
```

With child-only `UPGRADE_TARGET_ID=foreign-target`, exit 1 and `TARGET_ID_BINDING_MISMATCH` were observed. With `UPGRADE_TARGET_ID=isolated-test`, execution still stopped with `ISOLATED_PHP_PREPEND_REQUIRED_BEFORE_BOOTSTRAP`. Both assertions PASS: the expected-ID gate executes before bootstrap and matching ID cannot bypass isolation. PHP lint PASS. The first draft used `-n` without mbstring and stopped earlier with `Call to undefined function Upgrade\\Importer\\mb_strlen()`; that harness dependency failure was not counted as a target-ID check. Repeating only the PHP probe with explicit mbstring produced the results above. CMS was never bootstrapped.

Actual CLI subprocess smoke used the temporary pinned profile/package and a deliberately absent `--data-dir`:

- `packages/cli/index.ts target validate ... --environment demo` returned exit 0 / `PACKAGE_VALID`.
- The same command with `--environment production` rejected with nonzero exit.
- `scripts/native-target.ts validate PROFILE PROFILE_SHA PACKAGE MANIFEST_SHA JOURNAL` returned exit 0 / `PACKAGE_VALID`.
- The content data directory remained absent after every command. No destination process was dispatched for validation.

This behavior supports the reviewed CLI branch separation from the content Store. Local fixture journals include the new private transport SQLite file as intended; this is not a write to the authoritative application Store.

### Acceptance checks and remaining boundary

```json
[
  {"id":"native-v2-input-pins","status":"PASS","details":"All four frozen file pins matched before and after checks."},
  {"id":"native-v2-maintained-contract-tests","status":"PASS","details":"9/9 local behavioral tests, no skips; destination runner doubles."},
  {"id":"native-v2-malformed-and-foreign-receipts","status":"PASS","details":"Strict command receipt validation rejects v1 malformed success/lease cases and foreign target binding."},
  {"id":"native-v2-process-crash-reconcile-only","status":"PASS","details":"Three real Node processes: competing writer rejected, killed owner released OS lock, cold restart reconciled a file-double write without repeat."},
  {"id":"native-v2-php-target-id-before-bootstrap","status":"PASS","details":"Real local PHP rejected wrong target ID before CMS bootstrap; correct ID still required isolated prepend."},
  {"id":"native-v2-cli-store-separation","status":"PASS","details":"Actual CLI/standalone validate subprocesses succeeded in demo scope; production option rejected; content data path stayed absent."},
  {"id":"native-v2-types-lint","status":"PASS","details":"TypeScript, own PHP lint and whitespace checks passed."},
  {"id":"native-v2-actual-docker-bitrix-bridge","status":"NOT_RUN","details":"Reviewer performed no Docker/SSH/CMS target DB calls. Root must verify the new package/importer and profile on the actual isolated target."}
]
```

The local transport client timeout remains an unknown-outcome boundary: killing the Docker client does not prove termination of PHP already running inside the container. The destination Gateway's lock, fencing and reconciliation are therefore still essential. No Linux filesystem/power-loss durability, broad capacity benchmark, real container crash-kill or production recovery claim is made. The new adapter also requires bound response metadata, so old packaged PHP without `_target` is expected to fail closed; root must use a compatible reviewed package for integration.

Root may accept the **local transport implementation checks** and proceed to separately authorized actual isolated-target QA. The reviewer did not modify source, tests, package snapshots or Store, and did not accept its own implementation: all reviewed fixes were made by root.

No verdict here grants DEMO_READY, full source coverage, commerce functionality, license activation, target restore or production authorization.
