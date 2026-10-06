# Native handoff implementation — 2026-09-30

Task: `native-handoff-implementation-20260930`, owner `handoff-engine`, fence1; input `art-34902b95-9d4d-4db4-a8fc-c8979f4a92bf`. This author report covers the permitted vertical slice only. No server, pilot Store, target database or Git mutation was performed by this author. Independent review and actual licensed target execution of this bridge are separate gates.

## Result

**Implemented and locally verified; native deployment NOT_RUN.** Upgrade now has an executable durable handoff from accepted operator/normal pipeline packages to the existing native target driver, with a reproducible private root-operator step. It is an editable public content snapshot, not native Catalog/SKU mapping or production orchestration.

- Strict versioned, path-free public request/config/receipt contract. An immutable private profile owns the native executable/container paths, existing canonical journal, inbox and outbox. Public binding includes native profile and journal identity digests. Code fingerprint covers the actual own executor dependency closure and package lock; package PHP is separately sealed by manifest hashes.
- Coordinator records PENDING before publishing, uses deterministic immutable artifacts, verifies exact build/model/routes/scope/capture/package provenance, validates source payload bytes and restores publication after an unknown final Store commit. Dispatcher ownership and original run deadline are checked around publication and metadata commits. Configuration does not reset source gates, run budgets or history.
- Executor calls `executeNativeTarget`, retains its UNKNOWN/reconcile-before-repeat behavior and same target journal. The root executor never opens the content Store. A fixed bounded uid33 materializer handles the actual deployment's uid33 private state without root writes through a CMS-controlled path. No request supplies a shell callback or arbitrary binary.
- `native configure|prepare|ingest|status` are real CLI commands. Configured standard `run`, `import` and `verify` dispatch to this handoff instead of an unconditional missing-target result. Doctor distinguishes public configuration from an unperformed native check. Normal pipeline builds include observed commerce in the sealed demo snapshot.
- Status consumes compatible current accepted import/QA evidence and exact handoff receipts. Global per-package native journal attempt numbers order uncertainty, including out-of-order arrival and future timestamps. `TEST_DOUBLE` never proves native import. Activation/full QA remain `NOT_RUN`, readiness remains `NOT_READY`; reporter/readiness rules were not changed.

## Commands and actual results

```text
npm run check
PASS (tsc --noEmit)

node --disable-warning=ExperimentalWarning --test \
  tests/unit/native-handoff.test.ts \
  tests/integration/native-run.test.ts \
  tests/e2e/native-handoff.test.ts \
  tests/integration/native-target.test.ts \
  tests/unit/pipeline-lock.test.ts
27/27 PASS, 0 FAIL, 0 SKIP, 45.097 seconds

git diff --check -- <owned source/test/runbook paths>
PASS
```

The new tests include actual CLI child processes for normal HTTP source→model→package→configured handoff, then offline repeat with the HTTP source stopped. The sealed package contains the actual observed commerce/demo snapshot. Another real child process exits immediately after writing the modeled destination and before a transport response; restarting releases the journal lock, reconciles, and leaves exactly one destination write. Store tests interrupt after artifact publication/before COMMIT, reject expired/taken dispatcher ownership, pins/provenance/journal/code changes, and corrupt exported package/source payloads. Partial registry denominator3/planned1/UNKNOWN and the original source access block are retained.

All native target behaviors in this local suite use a declared driver double. The production root CLI has no driver override. The explicit operator-attestation fixture in the ordering test models copied NATIVE receipts to test ordering, not a live CMS.

Actual POSIX privilege-boundary check:

```text
wsl -u root --exec node \
  /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/native-handoff-20260930/posix-materializer.cjs \
  /mnt/c/Users/root/Documents/ChatGPT/upgrade/packages/bitrix-adapter/handoff.ts
PASS: root parent -> uid33 child, private ancestor0700,
approved bytes copied into uid33 state0700,
direct root-private secret read rejected,
write through the approved snapshot directory FD rejected.
```

WSL Node22.22.1 ran this **builtin materialization boundary** check; the application/executor contract requires Node24. This does not claim native PHP, Docker, Bitrix or target database acceptance. The WSL temporary fixture was removed after bounded path checking. Project evidence remains ignored under `var/evidence/native-handoff-20260930`.

Evidence pins:

- `targeted-tests.log`: `2bb18b8cb6fa34c38bd71a963fcc6cc4cb3fe21d6b17de361e46bcfeecb82554`.
- `posix-materializer-result.json`: `f5c2ba7860b96e59b4535ff255310cc191d1e528c78a4d3c7257b802f70c1686`.
- All exact source/test/runbook pins: `var/evidence/native-handoff-20260930/frozen-pins.json`.

The first local E2E run exposed a fixture-only Windows readonly overwrite on repeated inbox copying; the fixture now transfers an immutable inbox once. A second fixture placed a product at homepage `/`, which the accepted commerce classifier correctly treats as homepage; the explicit product fixture now uses `/product`. Neither failed run is claimed as passing native evidence. The final27-test run above covers the corrected fixtures.

## Operational and trust boundaries

`docs/runbooks/native-handoff.md` gives the actual configure/prepare/root execute/receipt ingest commands and profile schema. Root retains a single canonical journal and the profile's backup receipt. Inbox/receipt transfer is an explicit operator step, without granting Upgrade Docker or sudo rights. The coordinator has no need to read the root profile. Root must verify the exact request SHA and current unprivileged status before dispatch; cancellation of an already copied capability is not a remote revocation service.

The operator, root-owned application and installed CMS uid33 account are trusted. A malicious uid33 account can replace code in its own writable target state; PHP's package validation is not a defense against replacing the importer before PHP reads it. Untrusted source data and the Upgrade account cannot choose the root materializer code or target journal. Root never opens/chowns a predictable receipt destination in an Upgrade-writable directory.

Request≤256KiB, receipt≤8MB, listed files≤20,000, individual package file≤200MB and package≤2GB; materializer timeout≤600seconds. Native command timeout remains the approved native profile's limit. Source/file IO yields between bounded files; the same in-operation accepted build is reused when composing status, avoiding repeated full capture scans. Artifacts are read again on a later independent invocation.

Remaining work is explicit: independently review this frozen implementation, deploy the same pinned code, run the new bridge against the existing private licensed target and canonical journal, and retain actual receipts. Template/site activation, complete scenario QA/readiness, source closure, native Catalog mapping, additional pilots and performance acceptance are not implemented or silently waived by this slice. Interrupted staging and earlier failure receipts remain; automatic retention deletion is not part of this implementation.

## Final environment hardening and freeze

Before independent review started, root authorized a final narrow change: the fixed uid33 materializer no longer inherits root environment. Its only variables are PATH and LANG. The production source change is restricted to that spawn option; the public contract remains unchanged.

The same27-test suite was re-run on the final source: **27/27 PASS, 0 FAIL, 0 SKIP, 32.813 seconds**; `npm run check` and formatting check also PASS. The final log is `var/evidence/native-handoff-20260930/targeted-tests-final.log`, SHA `ea395b21971dcf9110504f399af2910f486bcf0bff4f3a14edcd04bd68a993a7`.

The POSIX test was repeated with a synthetic sentinel secret and NODE_OPTIONS preload. Its positive control demonstrated inheritance when the poisoned environment was supplied; the actual fixed allowlist child had uid33, only `[LANG,PATH]` and `child_sentinel_present=false`. The copy, root-private secret denial and snapshot write denial also PASS. Final receipt: `var/evidence/native-handoff-20260930/posix-materializer-env-final.json`, SHA `5b039a5646cd18b9bdefbcb54746916d04e46fe585742ea666baa462283a0d20`. This remains a local POSIX boundary test, not native CMS acceptance.

Final executor dependency fingerprint: `c92141c86b71ab571ef6d4e815f18ce87b434db156e03d20713f05f447784cca`. The earlier pins/logs above are retained as author history. The following table is the authoritative final source/test/runbook freeze:

| File | SHA256 |
| --- | --- |
| `packages/contracts/native-handoff.ts` | `903f404a9d68a62a94917198f68c47d1a3e2960dcb3cf42f56c3d708caf85741` |
| `packages/core/native-run.ts` | `256c4fec8e6d06ad7922c742e40f7c422afe0d3c6e8868c23b62cbc36ce217db` |
| `packages/core/pipeline.ts` | `19430953c344c0d4b1e9cac48d232c21ae224b2b36f1b7f73ff50c08e64b908c` |
| `packages/core/doctor.ts` | `b5cc4c680f475b64ce91b239ce895ac050de836fde2032fb141a77ed9e490cdc` |
| `packages/bitrix-adapter/handoff.ts` | `b9870aa26d224cc4733d49c4e3cc1de1892bcd853417faf8f96e22ac5b0a9b17` |
| `scripts/execute-native-handoff.ts` | `d36a0edf0d9585b120739cd0fe3c516d887c381228b479b0fcac1a38dcbb6437` |
| `packages/cli/index.ts` | `1e68109417e093222270d6b0fbdee97bb1a8b95507770ce445402c63f1ba7316` |
| `tests/unit/native-handoff.test.ts` | `65c809e3f78813104dec285f3c25c42f545aed6a6b61adb1bb4445e0464e85ec` |
| `tests/integration/native-run.test.ts` | `c273266e7917876afa6b48489b9a0952f4fab20f10b6811ed14505f43dec1ece` |
| `tests/e2e/native-handoff.test.ts` | `885438ec284fc12ec24fa083f28e0fed5c58874bbda41daa456fb0826451c101` |
| `docs/runbooks/native-handoff.md` | `d46b32af124449bc130a216439a99e95afde28598b779fd2e029ceb510c0b324` |

## V1 rejection and V2 correction

**V1 REJECT is retained.** Independent root review `docs/reviews/native-handoff-root-v1-20260930.md` demonstrated one P2 admission defect: intact artifact bytes with metadata `validation_status: INVALID` still authorized native export. The unchanged independent tests had 1 PASS / 3 FAIL. `Store.validateArtifact()` verifies byte integrity; it does not override or enforce the artifact review decision. V1 author/pin artifacts are `art-e11745d0-fe1f-41bc-bd5c-af7efe225323` and `art-52ac28f3-d9d2-426d-8aa8-cff1473e0c5b`; the rejected implementation and logs above remain historical evidence, not acceptance.

Attempt2, fence2, owner `handoff-engine`, review input `art-99464e06-5c9f-4de5-bf6f-150fc9a9696f`: the production correction is confined to `packages/core/native-run.ts`. Every shared coordinator JSON-artifact read and deterministic publication reuse now requires `validation_status === "VALID"` in addition to the existing exact bytes, identity, type and SHA checks. Rejected evidence cannot be silently replaced or revived during replay. Capture payload admission already required VALID. The existing delegated `readTargetEvidence` and `readNativeQaEvidence` validators also require VALID on their artifact references; their files and the generic Store were not changed.

Permanent tests reject source/capture result/payload/model/routes/scope/release metadata independently at configuration, export and status boundaries while preserving intact bytes. They also reject an INVALID request after restart, and an INVALID receipt both after publication with unknown Store commit and after COMMITTED status. These checks assert no replacement artifact, no transition of the rejected intent and no additional destination write. Test fixtures only explicitly restore their own accepted metadata to reach the second boundary; production recovery never does so.

Actual V2 verification:

```text
npm run check
PASS

node --disable-warning=ExperimentalWarning --test \
  var/evidence/continuation-20260930/handoff-root-review.test.ts
4/4 PASS, 0 FAIL, 0 SKIP, 11.660 seconds

node --disable-warning=ExperimentalWarning --test \
  tests/unit/native-handoff.test.ts \
  tests/integration/native-run.test.ts \
  tests/e2e/native-handoff.test.ts \
  tests/integration/native-target.test.ts \
  tests/unit/pipeline-lock.test.ts
30/30 PASS, 0 FAIL, 0 SKIP, 63.387 seconds

npx prettier --check packages/core/native-run.ts tests/integration/native-run.test.ts
PASS
git diff --check -- packages/core/native-run.ts tests/integration/native-run.test.ts docs/reviews/native-handoff-20260930.md
PASS
```

The independent witness file was not edited: SHA `49edbfad4eb7d1e4e4420ea23643350c0d977d0df7ba369495cc14f3c6811d19`. New retained logs under `var/evidence/native-handoff-20260930`:

- `root-review-v2.log`: `c8708f2dea52ccf517069a92febb5b8c7b123b9550be2fbc03e67dc928abfd0f`.
- `targeted-tests-v2.log`: `d2e0e74d24b927e8baac6bedb56858be84636fabdabfb31e97f4174c3dde86c8`.

V2 source freeze replaces only these two V1 pins; all other source/test/runbook pins in the previous table are unchanged:

| File | SHA256 |
| --- | --- |
| `packages/core/native-run.ts` | `4634cd5b2eda5918046b84b55e6557a123dcbdb45b0262c28e9ba768cf1978b4` |
| `tests/integration/native-run.test.ts` | `1ff0e2ca8f24ec2053574614beb6dac746c23af84f6d853238f2a8142c9636ca` |

The executor dependency fingerprint remains `c92141c86b71ab571ef6d4e815f18ce87b434db156e03d20713f05f447784cca`; its POSIX environment/materialization proof was not repeated because none of that code changed. Complete current pins are `var/evidence/native-handoff-20260930/frozen-pins-v2.json`. **V2 is locally verified and ready for independent re-review. Native execution/deployment of this bridge remains NOT_RUN; readiness remains NOT_READY.** No server, authoritative pilot Store, target database or Git writes were performed.
