/** Durable unprivileged coordinator. No Docker, SSH, shell or target credentials. */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Store, hash, inside } from "./index.ts";
import type { Artifact, Project } from "../contracts/index.ts";
import { readTargetEvidence } from "./target-evidence.ts";
import { readNativeQaEvidence } from "./native-qa-evidence.ts";
import {
  assertNoStoredAccessChallenge,
  verifyCrawlSnapshots,
} from "../crawler/index.ts";
import { validateBitrixPackage } from "../bitrix-adapter/index.ts";
import {
  copyHandoffPackage,
  nativeExecutorFingerprint,
  readHandoffFile,
} from "../bitrix-adapter/handoff.ts";
import {
  HANDOFF_LIMITS,
  handoffAssert as need,
  handoffEqual as same,
  handoffCanonical,
  handoffJson,
  handoffRequestId,
  parseHandoff,
  validateHandoffBinding,
  validateHandoffRequest,
  validateHandoffReceipt,
} from "../contracts/native-handoff.ts";
import type {
  HandoffBinding,
  HandoffBuild,
  HandoffAction,
  NativeHandoffRequest,
  NativeHandoffReceipt,
} from "../contracts/native-handoff.ts";

export interface NativeSelection {
  kind: "operator" | "pipeline";
  id: string;
}
export interface NativeConfiguration {
  schema_version: 1;
  binding: HandoffBinding;
  selection: NativeSelection;
}
export interface NativeHandoffRecord {
  schema_version: 1;
  id: string;
  state: "PENDING" | "EXPORTED" | "COMMITTED";
  request_sha256: string;
  request_artifact_id?: string;
  receipt_artifact_ids: string[];
  latest_attempt: number;
  outcome: "NOT_RUN" | NativeHandoffReceipt["status"];
  execution: "NOT_RUN" | NativeHandoffReceipt["execution"];
}
const digestObject = (v: unknown) => hash(JSON.stringify(handoffCanonical(v)));
function optional<T>(store: Store, kind: string, id: string): T | undefined {
  try {
    return store.get<T>(kind, id);
  } catch (e) {
    if (e instanceof Error && /not found:/.test(e.message)) return;
    throw e;
  }
}
export function nativeConfiguration(store: Store) {
  return optional<NativeConfiguration>(store, "native-config", "current");
}
export function nativeGuard(store: Store, assertOwnership: () => void) {
  assertOwnership();
  const run = store.currentRun();
  need(
    !["CANCELLED", "FAILED"].includes(run.execution_status),
    "RUN_TERMINATED",
  );
  need(
    Date.now() < run.budget.started_at + run.budget.max_seconds * 1000,
    "RUN_BUDGET_EXHAUSTED",
  );
}
function transaction(store: Store, guard: () => void, fn: () => void) {
  store.transaction(() => {
    guard();
    fn();
    guard();
  });
}
function artifact(store: Store, id: string, type?: string, pin?: string) {
  const a = store.validateArtifact(id);
  // Byte integrity does not override an explicit artifact rejection.
  need(a.validation_status === "VALID", "ARTIFACT_NOT_VALID");
  need(
    a.artifact_id === id &&
      (!type || a.type === type) &&
      (!pin || a.sha256 === pin),
    "ARTIFACT_PIN_MISMATCH",
  );
  const bytes = readFileSync(inside(store.root, a.relative_path));
  need(
    bytes.length <= 200000000 && hash(bytes) === a.sha256,
    "ARTIFACT_BYTES_MISMATCH",
  );
  return { artifact: a, value: parseHandoff(bytes) };
}
const ref = (a: Artifact) => ({ artifact_id: a.artifact_id, sha256: a.sha256 });
function latest(store: Store, type: string) {
  const a = store
    .list<Artifact>("artifact")
    .filter((a) => a.type === type)
    .at(-1);
  need(a, "BUILD_ARTIFACT_MISSING");
  return artifact(store, a.artifact_id, type);
}
/** Revalidates historical code provenance from recorded fingerprints; a new
 * executable release does not silently rebuild accepted source facts. */
export async function validateNativeBuild(
  store: Store,
  selection: NativeSelection,
  guard: () => void,
) {
  guard();
  const project = store.list<Project>("project")[0],
    origin = new URL(project.source.entry_url).origin;
  let build: HandoffBuild,
    packageDir: string,
    model: any,
    routes: any,
    scope: any,
    release: any;
  if (selection.kind === "operator") {
    const b = store.get<any>("operator_build", selection.id),
      m = store.get<any>("operator_model", b.model_record_id);
    need(
      b.id === selection.id &&
        b.state === "COMMITTED" &&
        m.state === "COMMITTED" &&
        m.id === b.model_record_id &&
        same(b.operator_binding, m.operator_binding),
      "COMMITTED_BUILD_REQUIRED",
    );
    need(
      store
        .list<any>("operator_build")
        .filter((x) => x.state === "COMMITTED")
        .at(-1)?.id === b.id,
      "BUILD_SUPERSEDED",
    );
    const binding = m.operator_binding;
    packageDir = inside(store.root, b.package_relative_path);
    const sealed = parseHandoff(
      await readHandoffFile(
        resolve(packageDir, "manifest.json"),
        4000000,
        b.manifest_sha256_package,
      ),
    );
    need(
      /^[a-f0-9]{64}$/.test(sealed.files?.["data/design-tokens.json"] ?? ""),
      "SEALED_DESIGN_TOKENS_REQUIRED",
    );
    const sealedTokens = parseHandoff(
      await readHandoffFile(
        resolve(packageDir, "data/design-tokens.json"),
        1000000,
        sealed.files["data/design-tokens.json"],
      ),
    );
    need(
      binding.project_id === project.project_id &&
        m.id === m.input_hash &&
        m.id ===
          hash(
            JSON.stringify([
              binding.schema_version === 1
                ? "operator-model-v1"
                : "operator-model-v2",
              binding,
              m.code_sha256,
            ]),
          ) &&
        b.id === b.input_hash &&
        b.id ===
          hash(
            JSON.stringify([
              binding.schema_version === 1
                ? "operator-build-v1"
                : "operator-build-v2",
              m.id,
              m.output_sha256,
              b.code_sha256,
              sealedTokens,
            ]),
          ),
      "BUILD_INTENT_MISMATCH",
    );
    need(
      same(b.input_artifact_ids, [
        m.output_artifact_ids.model,
        m.output_artifact_ids.routes,
        m.output_artifact_ids.scope,
      ]) &&
        [m, b].every(
          (x) =>
            x.capture_id === binding.capture_id &&
            x.manifest_sha256 === binding.manifest_sha256 &&
            x.capture_result_artifact_id === binding.capture_result_artifact_id,
        ),
      "BUILD_CAPTURE_MISMATCH",
    );
    const capture = store
      .list<any>("operator_capture")
      .filter(
        (c) =>
          c.capture_id === binding.capture_id &&
          c.manifest_sha256 === binding.manifest_sha256,
      );
    need(
      capture.length === 1 &&
        capture[0].state === "COMMITTED" &&
        capture[0].result_artifact_id === binding.capture_result_artifact_id &&
        capture[0].source_artifact_id === binding.source_artifact_id &&
        capture[0].server_access_block_id === binding.server_access_block_id,
      "CAPTURE_NOT_COMMITTED",
    );
    const captured = artifact(
      store,
      binding.capture_result_artifact_id,
      undefined,
      binding.capture_result_sha256,
    ).value;
    need(
      same(captured.artifact_files, capture[0].files) &&
        Array.isArray(capture[0].files) &&
        capture[0].files.length <= 7000,
      "CAPTURE_FILESET_MISMATCH",
    );
    const metadata = new Map(
      store.list<Artifact>("artifact").map((a) => [a.artifact_id, a]),
    );
    for (const f of capture[0].files) {
      await nextTurn();
      guard();
      const a = metadata.get(f.artifact_id);
      need(
        a &&
          a.project_id === project.project_id &&
          a.sha256 === f.sha256 &&
          a.validation_status === "VALID" &&
          a.type ===
            `operator-capture-${hash(JSON.stringify([binding.capture_id, binding.manifest_sha256, f.relative_path]))}.bin`,
        "CAPTURE_PAYLOAD_MISMATCH",
      );
      await readHandoffFile(
        inside(store.root, a.relative_path),
        200000000,
        a.sha256,
      );
      guard();
    }
    if (binding.source_artifact_id)
      artifact(
        store,
        binding.source_artifact_id,
        "crawl-result.json",
        binding.source_artifact_sha256,
      );
    const docs = Object.fromEntries(
      ["model", "routes", "scope"].map((k) => {
        const d = artifact(
          store,
          m.output_artifact_ids[k],
          (
            {
              model: "operator-content-model.json",
              routes: "operator-route-manifest.json",
              scope: "operator-scope-manifest.json",
            } as any
          )[k],
          m.output_sha256[k],
        );
        need(
          d.value.state === "PARTIAL" &&
            d.value.full_source_denominator === "UNKNOWN" &&
            d.value.input_hash === m.id &&
            same(d.value.operator_binding, binding),
          "MODEL_PROVENANCE_MISMATCH",
        );
        return [k, d];
      }),
    );
    ({ model, routes, scope } = Object.fromEntries(
      Object.entries(docs).map(([k, d]) => [k, d.value]),
    ));
    const r = artifact(
      store,
      b.result_artifact_id,
      "operator-release-manifest.json",
    );
    release = r.value;
    need(
      release.project_id === project.project_id &&
        release.input_hash === b.id &&
        release.model_record_id === m.id &&
        release.model_artifact_id === docs.model.artifact.artifact_id &&
        release.route_manifest_artifact_id ===
          docs.routes.artifact.artifact_id &&
        release.scope_artifact_id === docs.scope.artifact.artifact_id &&
        release.release_id === b.release_id &&
        release.code_sha256 === b.code_sha256 &&
        release.manifest_sha256 === b.manifest_sha256_package &&
        release.package_relative_path === b.package_relative_path &&
        release.state === "PARTIAL" &&
        same(release.operator_binding, binding),
      "RELEASE_PROVENANCE_MISMATCH",
    );
    need(
      same(scope.inventory, captured.inventory) &&
        scope.known_url_count === scope.inventory.length &&
        scope.planned_route_count === routes.routes.length &&
        scope.unresolved_url_count ===
          scope.known_url_count - routes.routes.length,
      "SCOPE_MISMATCH",
    );
    packageDir = inside(store.root, b.package_relative_path);
    build = {
      kind: "operator",
      id: b.id,
      record_sha256: digestObject([b, m]),
      model: ref(docs.model.artifact),
      routes: ref(docs.routes.artifact),
      scope: ref(docs.scope.artifact),
      release: ref(r.artifact),
      package_manifest_sha256: b.manifest_sha256_package,
      source_origin: origin,
      known_urls: scope.known_url_count,
      planned_routes: routes.routes.length,
      full_source_denominator: "UNKNOWN",
    };
  } else {
    need(
      selection.kind === "pipeline" && selection.id === "build",
      "SELECTION_INVALID",
    );
    const b = store.get<any>("stage", "build"),
      m = latest(store, "content-model.json"),
      r = latest(store, "route-manifest.json"),
      s = latest(store, "scope-manifest.json"),
      rel = latest(store, "release-manifest.json");
    model = m.value;
    routes = r.value;
    scope = s.value;
    release = rel.value;
    need(
      b.id === "build" &&
        b.release_id === release.release_id &&
        b.manifest_sha256 === release.manifest_sha256 &&
        model.project_id === project.project_id &&
        scope.project_id === project.project_id &&
        Array.isArray(scope.urls),
      "PIPELINE_BUILD_MISMATCH",
    );
    const stage = store.get<any>("stage", "extract");
    need(
      stage.outputs?.includes(m.artifact.artifact_id) &&
        stage.outputs?.includes(r.artifact.artifact_id),
      "PIPELINE_MODEL_STALE",
    );
    const tokens = latest(store, "design-tokens.json");
    need(
      /^[a-f0-9]{64}$/.test(release.code_sha256) &&
        b.input_hash ===
          hash(
            m.artifact.sha256 +
              r.artifact.sha256 +
              tokens.artifact.sha256 +
              release.code_sha256,
          ),
      "PIPELINE_BUILD_INTENT_MISMATCH",
    );
    const crawl = artifact(
      store,
      scope.source_artifact_id,
      "crawl-result.json",
    ).value;
    need(
      crawl.state === "COMPLETE" &&
        crawl.project_id === project.project_id &&
        crawl.source_origin === origin,
      "PIPELINE_SOURCE_INCOMPLETE",
    );
    for (const row of [...crawl.entries, ...crawl.assets])
      for (const field of ["body_path", "dom_path"])
        if (row[field]) {
          const pin =
            field === "dom_path"
              ? row.dom_sha256
              : (row.body_sha256 ?? row.sha256);
          need(/^[a-f0-9]{64}$/.test(pin), "SOURCE_PIN_MISSING");
          row[field] = inside(store.root, `source/snapshots/${pin}.bin`);
        }
    await verifyCrawlSnapshots(crawl);
    await assertNoStoredAccessChallenge(crawl);
    guard();
    packageDir = inside(store.root, `releases/${b.release_id}`);
    build = {
      kind: "pipeline",
      id: "build",
      record_sha256: digestObject([b, stage]),
      model: ref(m.artifact),
      routes: ref(r.artifact),
      scope: ref(s.artifact),
      release: ref(rel.artifact),
      package_manifest_sha256: b.manifest_sha256,
      source_origin: origin,
      known_urls: scope.urls.length,
      planned_routes: routes.routes.length,
      full_source_denominator: "UNKNOWN",
    };
  }
  need(
    model.source_origin === origin &&
      Array.isArray(model.entities) &&
      Array.isArray(routes.routes),
    "SINGLE_ORIGIN_MODEL_REQUIRED",
  );
  for (const r of routes.routes)
    need(
      !r.source_origin || r.source_origin === origin,
      "FOREIGN_ROUTE_ORIGIN",
    );
  const manifest = await validateBitrixPackage(
    packageDir,
    project.project_id,
    build.package_manifest_sha256,
  );
  guard();
  need(
    manifest.source_version === build.model.sha256 &&
      same(manifest.files, release.files) &&
      manifest.entity_count === model.entities.length &&
      manifest.route_count === routes.routes.length &&
      manifest.blockers.length === 0,
    "PACKAGE_BLOCKED_OR_UNBOUND",
  );
  return { build, packageDir, manifest };
}
export async function configureNative(
  store: Store,
  config: NativeConfiguration,
  guard: () => void,
) {
  guard();
  validateHandoffBinding(config.binding);
  need(
    config.schema_version === 1 &&
      config.binding.project_id ===
        store.list<Project>("project")[0].project_id &&
      ["operator", "pipeline"].includes(config.selection?.kind),
    "CONFIG_INVALID",
  );
  need(
    config.binding.executor_sha256 === (await nativeExecutorFingerprint()),
    "EXECUTOR_CODE_CHANGED",
  );
  await validateNativeBuild(store, config.selection, guard);
  const prior = nativeConfiguration(store);
  if (prior)
    need(
      prior.binding.project_id === config.binding.project_id &&
        prior.binding.target_id === config.binding.target_id &&
        prior.binding.journal_identity_sha256 ===
          config.binding.journal_identity_sha256,
      "AUTHORITATIVE_JOURNAL_CHANGED",
    );
  transaction(store, guard, () => {
    store.put("native-config", "current", config);
    store.event("native.configured", "native-coordinator", {
      binding: config.binding,
      selection: config.selection,
    });
  });
  return {
    status: "CONFIGURED",
    ...config,
    activation: "NOT_RUN",
    full_qa: "NOT_RUN",
  };
}
function publishOnce(
  store: Store,
  type: string,
  bytes: Buffer,
  guard: () => void,
) {
  guard();
  const existing = store
    .list<Artifact>("artifact")
    .filter((a) => a.type === type);
  need(existing.length <= 1, "DUPLICATE_PUBLICATION");
  if (existing.length) {
    const a = store.validateArtifact(existing[0].artifact_id);
    need(a.validation_status === "VALID", "ARTIFACT_NOT_VALID");
    need(
      a.sha256 === hash(bytes) &&
        readFileSync(inside(store.root, a.relative_path)).equals(bytes),
      "PUBLICATION_CONFLICT",
    );
    return a;
  }
  return store.publishArtifact(type, bytes, null, undefined, undefined, guard);
}
export async function prepareNativeHandoff(
  store: Store,
  action: HandoffAction,
  guard: () => void,
) {
  guard();
  const config = nativeConfiguration(store);
  need(config, "NOT_CONFIGURED");
  validateHandoffBinding(config.binding);
  need(
    config.binding.executor_sha256 === (await nativeExecutorFingerprint()),
    "EXECUTOR_CODE_CHANGED",
  );
  const current = await validateNativeBuild(store, config.selection, guard);
  const request: NativeHandoffRequest = {
    schema_version: 1,
    kind: "native-handoff-request",
    request_id: "",
    binding: config.binding,
    build: current.build,
    action,
  };
  request.request_id = handoffRequestId(request);
  validateHandoffRequest(request);
  const bytes = Buffer.from(handoffJson(request)),
    sha = hash(bytes),
    id = request.request_id;
  let record = optional<NativeHandoffRecord>(store, "native-handoff", id);
  if (record)
    need(record.id === id && record.request_sha256 === sha, "INTENT_CONFLICT");
  else {
    record = {
      schema_version: 1,
      id,
      state: "PENDING",
      request_sha256: sha,
      receipt_artifact_ids: [],
      latest_attempt: 0,
      outcome: "NOT_RUN",
      execution: "NOT_RUN",
    };
    transaction(store, guard, () => store.put("native-handoff", id, record));
  }
  const a = publishOnce(
    store,
    `native-handoff-request-${id}.json`,
    bytes,
    guard,
  );
  const directory = inside(store.root, `native-handoffs/${id}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "request.json");
  if (existsSync(path))
    need(
      (await readHandoffFile(path, HANDOFF_LIMITS.request, sha)).equals(bytes),
      "EXPORTED_REQUEST_CHANGED",
    );
  else {
    guard();
    writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
  }
  await copyHandoffPackage(
    current.packageDir,
    resolve(directory, "package"),
    config.binding.project_id,
    current.build.package_manifest_sha256,
    guard,
  );
  transaction(store, guard, () => {
    record!.request_artifact_id = a.artifact_id;
    if (record!.state === "PENDING") record!.state = "EXPORTED";
    store.put("native-handoff", id, record);
    store.event("native.request.prepared", "native-coordinator", {
      request_id: id,
      request_sha256: sha,
      action,
    });
  });
  return {
    status:
      record.state === "COMMITTED" ? "RECEIPT_RECORDED" : "AWAITING_OPERATOR",
    request_id: id,
    request_sha256: sha,
    directory,
    record,
    native: statusFromBuild(store, config, current, guard),
    activation: "NOT_RUN",
    full_qa: "NOT_RUN",
  };
}
export async function ingestNativeHandoff(
  store: Store,
  options: { requestId: string; receiptPath: string; receiptSha256: string },
  guard: () => void,
) {
  guard();
  need(
    /^[a-f0-9]{64}$/.test(options.requestId) &&
      /^[a-f0-9]{64}$/.test(options.receiptSha256),
    "PINS_REQUIRED",
  );
  const record = store.get<NativeHandoffRecord>(
    "native-handoff",
    options.requestId,
  );
  need(
    record.id === options.requestId && record.request_artifact_id,
    "INTENT_MISSING",
  );
  const request = artifact(
    store,
    record.request_artifact_id,
    `native-handoff-request-${record.id}.json`,
    record.request_sha256,
  ).value as NativeHandoffRequest;
  validateHandoffRequest(request);
  const config = nativeConfiguration(store);
  need(config && same(config.binding, request.binding), "CONFIG_CHANGED");
  need(
    config.binding.executor_sha256 === (await nativeExecutorFingerprint()),
    "EXECUTOR_CODE_CHANGED",
  );
  const current = await validateNativeBuild(store, config.selection, guard);
  need(same(current.build, request.build), "BUILD_CHANGED");
  const bytes = await readHandoffFile(
      resolve(options.receiptPath),
      HANDOFF_LIMITS.receipt,
      options.receiptSha256,
    ),
    receipt: NativeHandoffReceipt = parseHandoff(bytes);
  validateHandoffReceipt(receipt, request, record.request_sha256);
  guard();
  if (receipt.status !== "VALIDATED" && receipt.journal_head !== null)
    need(
      Number.isSafeInteger((receipt.journal_head as any).attempt) &&
        (receipt.journal_head as any).attempt >= 1,
      "JOURNAL_ATTEMPT_INVALID",
    );
  need(receipt.attempt >= record.latest_attempt, "STALE_RECEIPT");
  const a = publishOnce(
    store,
    `native-handoff-receipt-${record.id}-${receipt.attempt}.json`,
    bytes,
    guard,
  );
  transaction(store, guard, () => {
    if (!record.receipt_artifact_ids.includes(a.artifact_id))
      record.receipt_artifact_ids.push(a.artifact_id);
    record.latest_attempt = receipt.attempt;
    record.outcome = receipt.status;
    record.execution = receipt.execution;
    record.state = ["UNKNOWN", "INCOMPLETE"].includes(receipt.status)
      ? "EXPORTED"
      : "COMMITTED";
    store.put("native-handoff", record.id, record);
    store.event("native.receipt.recorded", "native-coordinator", {
      request_id: record.id,
      receipt_artifact_id: a.artifact_id,
      status: receipt.status,
      execution: receipt.execution,
    });
  });
  return {
    status: "RECEIPT_RECORDED",
    record,
    receipt_artifact_id: a.artifact_id,
    activation: "NOT_RUN",
    full_qa: "NOT_RUN",
  };
}
export async function nativeRunStatus(store: Store, guard: () => void) {
  const config = nativeConfiguration(store);
  if (!config)
    return {
      status: "NOT_CONFIGURED",
      native_import: "NOT_RUN",
      activation: "NOT_RUN",
      full_qa: "NOT_RUN",
      readiness: "NOT_READY",
      build: null,
    };
  validateHandoffBinding(config.binding);
  need(
    config.binding.executor_sha256 === (await nativeExecutorFingerprint()),
    "EXECUTOR_CODE_CHANGED",
  );
  const current = await validateNativeBuild(store, config.selection, guard);
  return statusFromBuild(store, config, current, guard);
}
function statusFromBuild(
  store: Store,
  config: NativeConfiguration,
  current: Awaited<ReturnType<typeof validateNativeBuild>>,
  guard: () => void,
) {
  const receipts: any[] = [];
  for (const row of store.list<NativeHandoffRecord>("native-handoff")) {
    guard();
    need(
      same(store.get<NativeHandoffRecord>("native-handoff", row.id), row),
      "RECORD_ID_MISMATCH",
    );
    if (!row.request_artifact_id) continue;
    const req = artifact(
      store,
      row.request_artifact_id,
      `native-handoff-request-${row.id}.json`,
      row.request_sha256,
    ).value as NativeHandoffRequest;
    validateHandoffRequest(req);
    if (!same(req.binding, config.binding) || !same(req.build, current.build))
      continue;
    for (const id of row.receipt_artifact_ids) {
      const r = artifact(store, id).value as NativeHandoffReceipt;
      validateHandoffReceipt(r, req, row.request_sha256);
      receipts.push({
        artifact_id: id,
        request_id: r.request_id,
        action: r.action,
        attempt: r.attempt,
        execution: r.execution,
        status: r.status,
        recorded_at: r.recorded_at,
        journal_head:
          r.journal_head === null
            ? null
            : { attempt: (r.journal_head as any).attempt },
      });
    }
  }
  const nativeReceipts = receipts.filter(
    (r) => r.execution === "NATIVE" && r.status !== "VALIDATED",
  );
  for (const r of nativeReceipts)
    if (r.journal_head !== null)
      need(
        Number.isSafeInteger(r.journal_head.attempt) &&
          r.journal_head.attempt >= 1,
        "JOURNAL_ATTEMPT_INVALID",
      );
  // Native journal attempts, not operator wall clocks or arrival order, order
  // apply/reconcile receipts for the same package. Uncertainty wins a tie.
  const native = nativeReceipts
    .sort(
      (a, b) =>
        (a.journal_head?.attempt ?? Number.MAX_SAFE_INTEGER) -
          (b.journal_head?.attempt ?? Number.MAX_SAFE_INTEGER) ||
        Number(a.status !== "CONFIRMED") - Number(b.status !== "CONFIRMED"),
    )
    .at(-1);
  const accepted =
    current.build.kind === "operator"
      ? readTargetEvidence(store, new Set([current.build.id])).filter(
          (r: any) => {
            if (!(
              r.integrity === "VERIFIED" &&
              r.target_id === config.binding.target_id &&
              r.build_record_id === current.build.id &&
              r.package_manifest_sha256 ===
                current.build.package_manifest_sha256
            ))
              return false;
            const record = store.get<any>("target_evidence", r.id),
              manifest = artifact(store, record.manifest_artifact_id).value;
            return (
              manifest.files.profile.sha256 ===
              config.binding.native_profile_sha256
            );
          },
        )
      : [];
  const acceptedIds = new Set(accepted.map((r: any) => r.id));
  const qa =
    current.build.kind === "operator"
      ? readNativeQaEvidence(
          store,
          new Set([current.build.id]),
          current.build.id,
        ).filter(
          (r: any) =>
            r.integrity === "VERIFIED" &&
            r.binding_status === "CURRENT" &&
            r.target_id === config.binding.target_id &&
            acceptedIds.has(r.target_evidence.record_id),
        )
      : [];
  guard();
  const confirmed = native
    ? native.status === "CONFIRMED"
    : accepted.length > 0;
  return {
    status: confirmed
      ? "NATIVE_IMPORT_CONFIRMED_QA_REQUIRED"
      : "AWAITING_OPERATOR",
    native_import: confirmed ? "CONFIRMED" : "NOT_VERIFIED",
    build: current.build,
    receipts,
    accepted_native_evidence: accepted,
    accepted_qa_evidence: qa,
    activation: "NOT_RUN",
    full_qa: "NOT_RUN",
    readiness: "NOT_READY",
    evidence_basis: "PINNED_OPERATOR_RECEIPT_NOT_LIVE_RECHECK",
  };
}
