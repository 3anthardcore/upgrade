# Native handoff v1

This is an executable bridge for a **single-origin public-demo editable content snapshot**. It invokes the existing `executeNativeTarget` transport and its authoritative journal. It does not install a licensed CMS, activate a template/site, create native Catalog/SKU offers, authorize production or declare `DEMO_READY`.

The content Store belongs to the unprivileged Upgrade account. The root operator owns a private profile, inbox, outbox and the existing native journal. The root executor never opens the content Store, never accepts a callback, and never receives a request-selected executable, container, journal or filesystem destination. Upgrade does not need Docker group membership, sudo shell access or a public privileged service.

## Inputs and identities

Use Node 24. The approved package must have no package blockers and must be an exact COMMITTED operator build or a normal pipeline build. Operator scope remains PARTIAL/UNKNOWN and its original source access block remains unchanged. A newly COMMITTED operator build supersedes the prior selection; explicitly configure its new ID. Historical code fingerprints and the package's sealed design tokens are used when checking accepted build identity. Network access to the source is never part of handoff replay.

`node scripts/execute-native-handoff.ts --fingerprint` prints a deterministic SHA over the root executor, its own runtime dependency closure, package schema and package lock. PHP/importer/module files are separately pinned by the accepted package manifest. Installing a different executor requires a new private profile pin and a new public binding; it does not authorize a new journal.

Root profile example (all paths and hashes are operator-approved values, not source data):

```json
{
  "schema_version": 1,
  "kind": "private-native-handoff-profile",
  "project_id": "pilot",
  "target_id": "isolated-pilot",
  "profile_id": "pilot-operator",
  "executor_sha256": "EXECUTOR_SHA256",
  "native_profile_path": "/root/upgrade-handoff/native-profile.json",
  "native_profile_sha256": "NATIVE_PROFILE_SHA256",
  "journal_dir": "/root/upgrade-target-journal",
  "journal_binding_sha256": "EXISTING_TARGET_BINDING_SHA256",
  "inbox_root": "/root/upgrade-handoff/inbox",
  "outbox_root": "/root/upgrade-handoff/outbox"
}
```

The existing native profile supplies `docker_executable`, `container`, `host_package_root`, container package root, document root, state directory, bounded command timeout and exact backup receipt pin. IDs use lowercase letters/digits/dashes, at most 63 characters. Root profile/inbox/outbox/journal paths must be absolute canonical paths, with no symlink ancestors or group/other-writable ancestors; their owner is root. Use 0600 profile files and 0700 private directories.

The journal must already contain `<target_id>/binding.json`, whose exact bytes are pinned. For an existing installation use its current journal, including all UNKNOWN states and prior attempts. Never initialize another journal to bypass an uncertain write. A genuinely new target is bootstrapped once by the explicit existing `target validate` operator command against its approved package and chosen journal; validate does not issue a native CMS write. The same journal is thereafter the single authority for this target.

The mounted CMS state may instead be a canonical **uid33 directory with mode0700**, with root-owned nonwritable ancestors. This accommodates the deployed private target state. Root first makes a verified private snapshot in its outbox. A fixed builtin-only Node child, with uid33/gid33 and no shell or source-defined program, receives a read-only directory FD to that snapshot and materializes a hash-named package in the target's state. Its environment contains only fixed PATH/LANG values; root secrets, NODE_OPTIONS and authentication variables are not inherited. Root never chowns or writes through a uid33-controlled target path. Read access to the snapshot FD does not grant traversal of the private outbox's other contents. Both the private snapshot and the published target package are validated.

**Trust boundary:** the installed CMS uid33 account, the privileged operator and the root-owned executable installation are trusted. This is not protection against a malicious CMS uid33 process replacing its importer before PHP starts. Package validation is integrity checking, not a sandbox for executing arbitrary PHP. Untrusted source HTML/assets and the Upgrade account cannot select or supply the root materializer program. Native apply runs PHP as uid33 using the existing isolated target transport.

Create a public binding without exposing private paths:

```json
{
  "schema_version": 1,
  "project_id": "pilot",
  "target_id": "isolated-pilot",
  "profile_id": "pilot-operator",
  "profile_sha256": "SHA256_OF_PRIVATE_PROFILE_BYTES",
  "executor_sha256": "EXECUTOR_SHA256",
  "native_profile_sha256": "NATIVE_PROFILE_SHA256",
  "journal_identity_sha256": "JOURNAL_IDENTITY_SHA256"
}
```

`journal_identity_sha256` is SHA256 of UTF-8 `JSON.stringify([journal_dir, target_id, journal_binding_sha256])`, with no trailing newline. The coordinator refuses a changed target or journal identity after initial configuration. Backup/profile rotation may change the profile SHA while preserving that journal identity. The coordinator never reads the private profile.

## Unprivileged preparation

Run these as the account owning the existing Store. Substitute actual pinned IDs; do not start a new Store to reset prior run budgets.

```sh
node packages/cli/index.ts native configure --project pilot --binding public-binding.json --kind operator --build BUILD_ID --data-dir var/projects
node packages/cli/index.ts native prepare --project pilot --action apply --data-dir var/projects
```

For the normal source pipeline use `--kind pipeline --build build` after its existing crawl/extract/build stages. The normal builder passes observed `model.commerce` into the sealed demo snapshot; unknown prices/units remain unknown and native Catalog mapping is still a separate integration.

Preparation records a PENDING intent before publishing its immutable request, copies the exact validated package buffers, then records EXPORTED. It returns `request_id`, `request_sha256` and `directory`. Only transfer a successfully EXPORTED/COMMITTED result. A PENDING record or leftover `.pending-*` directory is not permission to dispatch.

Configured `run --until demo-ready` and `import --apply --environment demo` prepare the apply handoff. `import --dry-run` prepares native dry-run; `verify` prepares native reconcile. These commands do not run root commands themselves. `native status` consumes current pinned handoff receipts and compatible accepted native-import/QA evidence, with its evidence basis explicitly marked as recorded, not live checked. `doctor --project pilot` reports the public configuration separately from native verification.

## Root execution and receipt return

The operator reviews the request/build/scope pins, the package's own code and the target/backups. Transfer the exported directory into the root-only inbox under exactly `<request_id>`. Create a fresh root-only temporary destination, copy without dereferencing source symlinks or preserving source ownership, then rename it to that request ID. Do not overwrite an existing inbox: retries reuse the same exact request. The executor verifies request SHA, schema, private-profile SHA, code fingerprint, target/journal binding and every approved package byte before native execution. It does not execute files from the inbox.

```sh
node /opt/upgrade/current/scripts/execute-native-handoff.ts \
  --profile /root/upgrade-handoff/profile.json \
  --profile-sha256 PROFILE_SHA \
  --request-id REQUEST_ID \
  --request-sha256 REQUEST_SHA
```

This is the actual root step, not a plan-only command. It invokes `executeNativeTarget` with the profile's canonical journal. Repeated apply re-enters that journal and reconciles before another write. A lost process or response never creates a new journal. A second package is blocked while another package has an UNKNOWN native outcome. Outbox SQLite provides only an OS-released local transport lock; it is not the content Store. Root output is a durable receipt path, exact SHA and outcome. Transport failure records `UNKNOWN`; re-run the same command after investigating, retaining all attempts.

Receipt output is private. Return only the selected bounded receipt to an Upgrade-owned receiving directory. Have the **unprivileged account open the destination** (for example fixed `runuser -u upgrade -- ...` stdin copying), so root does not open/chown a predictable file under an Upgrade-writable directory. Do not copy profile secrets, native state or root directory permissions into the Store.

```sh
node packages/cli/index.ts native ingest --project pilot \
  --request-id REQUEST_ID --receipt copied-receipt.json \
  --receipt-sha256 RECEIPT_SHA --data-dir var/projects
node packages/cli/index.ts native status --project pilot --data-dir var/projects
```

Ingestion rechecks the current accepted build, full captured payload byte hashes, immutable package and all request/receipt bindings under the current dispatcher lease and original run deadline. A publication that completed before process death is found by deterministic artifact type and exact bytes before retry. Changed source/build/profile/code, stale attempts or lost lease fail closed. Wall-clock receipt timestamps cannot override a later UNKNOWN native journal attempt.

`NATIVE_IMPORT_CONFIRMED_QA_REQUIRED` means a recorded native reconcile for the selected package. `TEST_DOUBLE` receipts can be retained for diagnostics but never confirm native import. Activation, full QA and readiness are not promoted by this bridge: `activation=NOT_RUN`, `full_qa=NOT_RUN`, `readiness=NOT_READY`. The existing report/readiness policy remains authoritative and has not been expanded by this slice.

## Limits and recovery

- Request ≤256KiB; receipt ≤8,000,000 bytes; package ≤2,000,000,000 bytes, ≤20,000 listed files, each ≤200,000,000 bytes. Provide free space for inbox, private snapshot and target copy. No automatic retention cleanup is included.
- Native command timeouts remain those of the pinned native profile. The uid33 materializer has a bounded timeout (at most600 seconds). Interrupted staging is retained and never adopted; only a published hash-verified package is reused.
- All native attempts and the original run/source budget/history are retained. An exhausted run requires an explicit new run/budget decision; configuration/preparation never resets it.
- Root executes an explicitly approved request SHA. Cancelling a Store run prevents subsequent coordinator publication/ingestion, but does not remotely revoke a previously copied request from a privileged human operator. Recheck unprivileged `native status` before approving dispatch; this tool is not a remote authorization service.
- Source URLs/queries and the source denominator remain pinned to the accepted model/routes/scope. Partial imports do not imply the whole source site is complete, that all outgoing links work, or that native production commerce is implemented.

Local verification is described in `docs/reviews/native-handoff-20260930.md`. Actual licensed target execution of this new bridge remains a separate operator acceptance step.
