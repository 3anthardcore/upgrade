/** Offline operator attestation of native CLI receipts; never contacts a target. */
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { resolve, posix, win32 } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Ajv } from "ajv";
import { Store, UpgradeError, hash, inside, uid } from "./index.ts";
import { defaultTokens } from "./design.ts";
import { validateBitrixPackage } from "../bitrix-adapter/index.ts";
import {
  operatorCaptureSchema,
  OPERATOR_CAPTURE_LIMITS,
} from "../crawler/operator.ts";
import type { Artifact, Project } from "../contracts/index.ts";
import type {
  OperatorBuildRecord,
  OperatorModelRecord,
} from "./operator-model.ts";

type Ref = { artifact_id: string; sha256: string };
type FileRef = { relative_path: string; sha256: string; size_bytes: number };
const roles = [
  "profile",
  "journal_head",
  "reconcile_request",
  "reconcile_response",
] as const;
type Role = (typeof roles)[number];
export interface TargetEvidenceManifest {
  schema_version: 1;
  kind: "native-import-evidence";
  project_id: string;
  target_id: string;
  build_record_id: string;
  model_record_id: string;
  build_artifact: Ref;
  model_artifact: Ref;
  route_artifact: Ref;
  scope_artifact: Ref;
  package_manifest_sha256: string;
  attestation: { kind: "operator-copied-native-receipts"; recorded_at: string };
  files: Record<Role, FileRef>;
}
export interface TargetEvidenceRecord {
  schema_version: 1;
  id: string;
  state: "PENDING" | "COMMITTED";
  project_id: string;
  target_id: string;
  build_record_id: string;
  manifest_sha256: string;
  manifest_artifact_id?: string;
  file_artifact_ids: Partial<Record<Role, string>>;
  result_artifact_id?: string;
}
const sha = /^[a-f0-9]{64}$/;
const ident = /^[a-z0-9][a-z0-9-]{0,62}$/;
const caps: Record<Role, number> = {
  profile: 65536,
  journal_head: 65536,
  reconcile_request: 16384,
  reconcile_response: 4_000_000,
};
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new UpgradeError(`TARGET_EVIDENCE_${message}`, 5);
}
function keys(value: any, expected: string[]) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((k) => Object.hasOwn(value, k))
  );
}
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a: any, b: any) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function parse(bytes: Buffer) {
  const text = bytes.toString("utf8");
  requireValue(Buffer.from(text).equals(bytes), "INVALID_UTF8");
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UpgradeError("TARGET_EVIDENCE_INVALID_JSON", 5);
  }
  // JSON.parse alone accepts duplicate keys. Refuse ambiguous receipt objects.
  const stack: Array<Set<string> | null> = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  for (const token of text.matchAll(tokens)) {
    const t = token[0];
    if (t === "{") stack.push(new Set());
    else if (t === "[") stack.push(null);
    else if (t === "}" || t === "]") stack.pop();
    else if (/^\s*:/.test(text.slice(token.index! + t.length))) {
      const name = JSON.parse(t),
        set = stack.at(-1);
      requireValue(set && !set.has(name), "DUPLICATE_JSON_KEY");
      set.add(name);
    }
  }
  return value;
}
function relativeFile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.includes("\\") &&
    !/[\x00-\x1f:]/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((p) => p !== "." && p !== ".." && p !== "")
  );
}
function bounded(
  root: string,
  rel: string,
  pin: string,
  cap: number,
  size?: number,
) {
  requireValue(relativeFile(rel) && sha.test(pin), "FILE_REFERENCE_INVALID");
  const path = inside(root, rel),
    info = lstatSync(path);
  requireValue(
    info.isFile() && info.nlink === 1 && info.size <= cap,
    "BOUNDED_REGULAR_FILE_REQUIRED",
  );
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    requireValue(
      before.isFile() &&
        before.nlink === 1 &&
        before.dev === info.dev &&
        before.ino === info.ino,
      "FILE_IDENTITY_CHANGED",
    );
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, cap - total + 1));
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      total += n;
      requireValue(total <= cap, "FILE_TOO_LARGE");
      chunks.push(chunk.subarray(0, n));
    }
    const after = fstatSync(fd),
      bytes = Buffer.concat(chunks, total);
    requireValue(
      before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        realpathSync(path) === path &&
        (size === undefined || bytes.length === size) &&
        hash(bytes) === pin,
      "FILE_PIN_MISMATCH",
    );
    return bytes;
  } finally {
    closeSync(fd);
  }
}
function artifact(store: Store, ref: Ref, type: string, cap = 256_000_000) {
  requireValue(
    keys(ref, ["artifact_id", "sha256"]) &&
      typeof ref.artifact_id === "string" &&
      sha.test(ref.sha256),
    "ARTIFACT_REFERENCE_INVALID",
  );
  const a = store.get<Artifact>("artifact", ref.artifact_id);
  requireValue(
    a.project_id === store.currentRun().project_id &&
      a.sha256 === ref.sha256 &&
      a.type === type &&
      a.validation_status === "VALID",
    "ARTIFACT_BINDING_MISMATCH",
  );
  return bounded(store.root, a.relative_path, ref.sha256, cap, a.size_bytes);
}
function validManifest(m: any): asserts m is TargetEvidenceManifest {
  requireValue(
    keys(m, [
      "schema_version",
      "kind",
      "project_id",
      "target_id",
      "build_record_id",
      "model_record_id",
      "build_artifact",
      "model_artifact",
      "route_artifact",
      "scope_artifact",
      "package_manifest_sha256",
      "attestation",
      "files",
    ]) &&
      m.schema_version === 1 &&
      m.kind === "native-import-evidence" &&
      ident.test(m.project_id) &&
      ident.test(m.target_id) &&
      [m.build_record_id, m.model_record_id, m.package_manifest_sha256].every(
        (v) => typeof v === "string" && sha.test(v),
      ),
    "MANIFEST_INVALID",
  );
  requireValue(
    keys(m.attestation, ["kind", "recorded_at"]) &&
      m.attestation.kind === "operator-copied-native-receipts" &&
      typeof m.attestation.recorded_at === "string" &&
      Number.isFinite(Date.parse(m.attestation.recorded_at)) &&
      new Date(m.attestation.recorded_at).toISOString() ===
        m.attestation.recorded_at &&
      Date.parse(m.attestation.recorded_at) <= Date.now() + 60000,
    "ATTESTATION_INVALID",
  );
  requireValue(keys(m.files, [...roles]), "FILES_INVALID");
  for (const role of roles) {
    const f = m.files[role];
    requireValue(
      keys(f, ["relative_path", "sha256", "size_bytes"]) &&
        relativeFile(f.relative_path) &&
        sha.test(f.sha256) &&
        Number.isSafeInteger(f.size_bytes) &&
        f.size_bytes > 0 &&
        f.size_bytes <= caps[role],
      "FILE_REFERENCE_INVALID",
    );
  }
  requireValue(
    new Set(roles.map((r) => m.files[r].relative_path)).size === roles.length &&
      !roles.some((r) => m.files[r].relative_path === "target-evidence.json"),
    "AMBIGUOUS_FILES",
  );
}
function acceptedBuild(store: Store, m: TargetEvidenceManifest) {
  const project = store.list<Project>("project")[0];
  requireValue(m.project_id === project.project_id, "FOREIGN_PROJECT");
  const build = store.get<OperatorBuildRecord>(
    "operator_build",
    m.build_record_id,
  );
  const model = store.get<OperatorModelRecord>(
    "operator_model",
    m.model_record_id,
  );
  requireValue(
    build.state === "COMMITTED" &&
      model.state === "COMMITTED" &&
      build.id === m.build_record_id &&
      model.id === m.model_record_id &&
      build.model_record_id === model.id &&
      build.result_artifact_id === m.build_artifact.artifact_id &&
      build.manifest_sha256_package === m.package_manifest_sha256 &&
      same(build.operator_binding, model.operator_binding) &&
      same(build.input_artifact_ids, [
        model.output_artifact_ids.model,
        model.output_artifact_ids.routes,
        model.output_artifact_ids.scope,
      ]),
    "COMMITTED_BUILD_BINDING_MISMATCH",
  );
  requireValue(
    model.input_hash === model.id &&
      model.id ===
        hash(
          JSON.stringify([
            model.operator_binding.schema_version === 1
              ? "operator-model-v1"
              : "operator-model-v2",
            model.operator_binding,
            model.code_sha256,
          ]),
        ) &&
      build.input_hash === build.id &&
      build.id ===
        hash(
          JSON.stringify([
            build.operator_binding.schema_version === 1
              ? "operator-build-v1"
              : "operator-build-v2",
            model.id,
            model.output_sha256,
            build.code_sha256,
            defaultTokens,
          ]),
        ),
    "DERIVED_INPUT_HASH_MISMATCH",
  );
  const binding = model.operator_binding;
  requireValue(
    binding.project_id === m.project_id &&
      binding.capture_id === model.capture_id &&
      binding.capture_id === build.capture_id &&
      binding.manifest_sha256 === model.manifest_sha256 &&
      binding.manifest_sha256 === build.manifest_sha256,
    "CAPTURE_BINDING_MISMATCH",
  );
  const capture = store
    .list<any>("operator_capture")
    .filter(
      (c) =>
        c.capture_id === binding.capture_id &&
        c.manifest_sha256 === binding.manifest_sha256,
    );
  requireValue(
    capture.length === 1 &&
      capture[0].state === "COMMITTED" &&
      capture[0].result_artifact_id === binding.capture_result_artifact_id &&
      model.capture_result_artifact_id === binding.capture_result_artifact_id &&
      build.capture_result_artifact_id === binding.capture_result_artifact_id &&
      capture[0].source_artifact_id === binding.source_artifact_id &&
      capture[0].server_access_block_id === binding.server_access_block_id,
    "CAPTURE_NOT_COMMITTED",
  );
  if (binding.source_artifact_id)
    artifact(
      store,
      {
        artifact_id: binding.source_artifact_id,
        sha256: binding.source_artifact_sha256!,
      },
      "crawl-result.json",
    );
  else
    requireValue(
      binding.source_artifact_sha256 === null,
      "SOURCE_BINDING_MISMATCH",
    );
  const captureArtifact = store.get<Artifact>(
    "artifact",
    binding.capture_result_artifact_id,
  );
  const captureBody = parse(
    artifact(
      store,
      {
        artifact_id: captureArtifact.artifact_id,
        sha256: binding.capture_result_sha256,
      },
      captureArtifact.type,
    ),
  );
  const docs: any = {};
  for (const [key, ref, type] of [
    ["model", m.model_artifact, "operator-content-model.json"],
    ["routes", m.route_artifact, "operator-route-manifest.json"],
    ["scope", m.scope_artifact, "operator-scope-manifest.json"],
  ] as const) {
    requireValue(
      ref.artifact_id === model.output_artifact_ids[key] &&
        ref.sha256 === model.output_sha256[key],
      "MODEL_ARTIFACT_PIN_MISMATCH",
    );
    docs[key] = parse(artifact(store, ref, type));
    requireValue(
      docs[key].state === "PARTIAL" &&
        docs[key].full_source_denominator === "UNKNOWN" &&
        docs[key].input_hash === model.id &&
        same(docs[key].operator_binding, binding),
      "MODEL_PROVENANCE_MISMATCH",
    );
  }
  requireValue(
    Array.isArray(docs.model.entities) &&
      Array.isArray(docs.routes.routes) &&
      Array.isArray(docs.scope.inventory) &&
      same(docs.scope.inventory, captureBody.inventory) &&
      docs.scope.known_url_count === docs.scope.inventory.length &&
      docs.scope.planned_route_count === docs.routes.routes.length,
    "SCOPE_BINDING_MISMATCH",
  );
  const release = parse(
    artifact(store, m.build_artifact, "operator-release-manifest.json"),
  );
  requireValue(
    release.project_id === m.project_id &&
      release.input_hash === build.id &&
      release.release_id === build.release_id &&
      release.state === "PARTIAL" &&
      release.full_source_denominator === "UNKNOWN" &&
      same(release.operator_binding, binding) &&
      release.manifest_sha256 === m.package_manifest_sha256 &&
      release.package_relative_path === build.package_relative_path &&
      release.model_record_id === model.id &&
      release.model_artifact_id === m.model_artifact.artifact_id &&
      release.route_manifest_artifact_id === m.route_artifact.artifact_id &&
      release.scope_artifact_id === m.scope_artifact.artifact_id &&
      release.code_sha256 === build.code_sha256,
    "RELEASE_PROVENANCE_MISMATCH",
  );
  const packageDir = inside(store.root, build.package_relative_path);
  const manifest = parse(
    bounded(packageDir, "manifest.json", m.package_manifest_sha256, 4_000_000),
  );
  requireValue(
    manifest.project_id === m.project_id &&
      manifest.source_version === m.model_artifact.sha256 &&
      same(manifest.files, release.files) &&
      Array.isArray(manifest.blockers) &&
      manifest.blockers.length === 0 &&
      manifest.entity_count === docs.model.entities.length &&
      manifest.route_count === docs.routes.routes.length,
    "PACKAGE_PROVENANCE_MISMATCH",
  );
  return {
    build,
    model,
    capture: capture[0],
    captureBody,
    packageDir,
    manifest,
    counts: {
      entities: manifest.entity_count,
      routes: manifest.route_count,
      known_urls: docs.scope.known_url_count,
      unresolved_urls: docs.scope.unresolved_url_count,
    },
  };
}
/** Revalidate every accepted source payload before publishing an import attestation.
 * One metadata index and one bounded file at a time keep this linear in file count.
 */
async function validateCapturePayloads(
  store: Store,
  bound: ReturnType<typeof acceptedBuild>,
  assertOwnership: () => void,
) {
  const { capture, captureBody, model } = bound;
  requireValue(
    Array.isArray(capture.files) &&
      capture.files.length >= 2 &&
      capture.files.length <=
        OPERATOR_CAPTURE_LIMITS.assets +
          OPERATOR_CAPTURE_LIMITS.observations +
          1 &&
      Array.isArray(captureBody.files) &&
      same(captureBody.artifact_files, capture.files),
    "CAPTURE_FILE_REGISTRY_MISMATCH",
  );
  const refs = new Map<string, any>();
  for (const ref of capture.files) {
    requireValue(
      keys(ref, ["relative_path", "artifact_id", "sha256"]) &&
        relativeFile(ref.relative_path) &&
        !refs.has(ref.relative_path) &&
        typeof ref.artifact_id === "string" &&
        sha.test(ref.sha256),
      "CAPTURE_FILE_REFERENCE_INVALID",
    );
    refs.set(ref.relative_path, ref);
  }
  const artifacts = new Map(
    store.list<Artifact>("artifact").map((a) => [a.artifact_id, a]),
  );
  const type = (path: string) =>
    `operator-capture-${hash(JSON.stringify([capture.capture_id, capture.manifest_sha256, path]))}.bin`;
  const read = async (ref: any, cap: number, size?: number) => {
    await nextTurn();
    assertOwnership();
    const a = artifacts.get(ref.artifact_id);
    requireValue(
      a &&
        a.project_id === model.operator_binding.project_id &&
        a.type === type(ref.relative_path) &&
        a.sha256 === ref.sha256 &&
        a.validation_status === "VALID" &&
        (size === undefined || a.size_bytes === size),
      "CAPTURE_PAYLOAD_BINDING_MISMATCH",
    );
    const bytes = bounded(
      store.root,
      a.relative_path,
      a.sha256,
      cap,
      a.size_bytes,
    );
    assertOwnership();
    return bytes;
  };
  const paths = new Set(captureBody.files.map((ref: any) => ref.relative_path));
  requireValue(
    paths.size === captureBody.files.length,
    "CAPTURE_DUPLICATE_PAYLOAD",
  );
  const manifests = capture.files.filter(
    (ref: any) => !paths.has(ref.relative_path),
  );
  requireValue(
    manifests.length === 1 && manifests[0].sha256 === capture.manifest_sha256,
    "CAPTURE_MANIFEST_REFERENCE_INVALID",
  );
  const manifest = parse(
    await read(manifests[0], OPERATOR_CAPTURE_LIMITS.manifestBytes),
  );
  requireValue(
    new Ajv().compile<any>(operatorCaptureSchema)(manifest) &&
      manifest.capture_id === capture.capture_id &&
      manifest.project_id === model.operator_binding.project_id &&
      manifest.source_origin ===
        new URL(store.list<Project>("project")[0].source.entry_url).origin,
    "CAPTURE_MANIFEST_BINDING_MISMATCH",
  );
  const expected = [
    ...manifest.observations.map((o: any) => o.file),
    ...manifest.assets.map((a: any) => a.file),
  ];
  requireValue(
    same(captureBody.files, expected) &&
      refs.size === expected.length + 1 &&
      same(captureBody.assets, manifest.assets),
    "CAPTURE_MANIFEST_FILESET_MISMATCH",
  );
  let total = 0;
  for (const expectedRef of expected) {
    const ref = refs.get(expectedRef.relative_path);
    requireValue(
      ref && ref.sha256 === expectedRef.sha256,
      "CAPTURE_PAYLOAD_PIN_MISMATCH",
    );
    total += expectedRef.size_bytes;
    requireValue(
      total <= OPERATOR_CAPTURE_LIMITS.totalBytes,
      "CAPTURE_TOTAL_LIMIT",
    );
    await read(ref, OPERATOR_CAPTURE_LIMITS.fileBytes, expectedRef.size_bytes);
  }
  assertOwnership();
}
function validateReceipts(
  m: TargetEvidenceManifest,
  files: Record<Role, Buffer>,
) {
  const p = parse(files.profile),
    head = parse(files.journal_head),
    req = parse(files.reconcile_request),
    res = parse(files.reconcile_response);
  requireValue(
    keys(p, [
      "schema_version",
      "environment",
      "project_id",
      "target_id",
      "driver",
      "docker_executable",
      "container",
      "host_package_root",
      "container_package_root",
      "document_root",
      "state_dir",
      "backup_receipt",
      "backup_receipt_sha256",
      "timeout_seconds",
    ]) &&
      p.schema_version === 1 &&
      p.environment === "demo" &&
      p.driver === "docker-exec" &&
      p.project_id === m.project_id &&
      p.target_id === m.target_id &&
      typeof p.container === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(p.container) &&
      sha.test(p.backup_receipt_sha256) &&
      Number.isInteger(p.timeout_seconds) &&
      p.timeout_seconds >= 10 &&
      p.timeout_seconds <= 3600,
    "PROFILE_INVALID",
  );
  for (const key of [
    "docker_executable",
    "host_package_root",
    "container_package_root",
    "document_root",
    "state_dir",
    "backup_receipt",
  ])
    requireValue(
      typeof p[key] === "string" &&
        p[key].length <= 4096 &&
        !/[\x00-\x1f]/.test(p[key]) &&
        (posix.isAbsolute(p[key]) || win32.isAbsolute(p[key])),
      "PROFILE_PATH_INVALID",
    );
  for (const key of [
    "container_package_root",
    "document_root",
    "state_dir",
    "backup_receipt",
  ])
    requireValue(
      p[key].startsWith("/") &&
        posix.normalize(p[key]) === p[key] &&
        p[key] !== "/",
      "PROFILE_PATH_INVALID",
    );
  requireValue(
    p.state_dir !== p.document_root &&
      !p.state_dir.startsWith(p.document_root + "/") &&
      p.backup_receipt.startsWith(p.state_dir + "/") &&
      (p.container_package_root === p.state_dir ||
        p.container_package_root.startsWith(p.state_dir + "/")),
    "PROFILE_PRIVATE_STATE_REQUIRED",
  );
  requireValue(
    head.schema_version === 1 &&
      head.status === "CONFIRMED" &&
      head.project_id === m.project_id &&
      head.target_id === m.target_id &&
      head.manifest_sha256 === m.package_manifest_sha256 &&
      head.profile_sha256 === m.files.profile.sha256 &&
      [
        "container",
        "document_root",
        "state_dir",
        "host_package_root",
        "container_package_root",
      ].every((k) => head[k] === p[k]) &&
      Number.isSafeInteger(head.attempt) &&
      head.attempt >= 1 &&
      head.last_command === "reconcile" &&
      keys(head.last_result, ["command", "file", "sha256"]) &&
      head.last_result.command === "reconcile" &&
      head.last_result.sha256 === m.files.reconcile_response.sha256 &&
      typeof head.last_result.file === "string",
    "JOURNAL_UNCONFIRMED_OR_MISMATCHED",
  );
  const base = `${m.package_manifest_sha256}.${String(head.attempt).padStart(5, "0")}.reconcile`;
  requireValue(
    posix.basename(head.last_result.file.replaceAll("\\", "/")) ===
      base + ".response.json" &&
      posix.basename(m.files.reconcile_response.relative_path) ===
        base + ".response.json" &&
      posix.basename(m.files.reconcile_request.relative_path) ===
        base + ".request.json",
    "RECEIPT_IDENTITY_MISMATCH",
  );
  requireValue(
    keys(req, [
      "schema_version",
      "command",
      "manifest_sha256",
      "target_id",
      "profile_sha256",
      "dispatched_at",
    ]) &&
      req.schema_version === 1 &&
      req.command === "reconcile" &&
      req.manifest_sha256 === m.package_manifest_sha256 &&
      req.target_id === m.target_id &&
      req.profile_sha256 === m.files.profile.sha256 &&
      typeof req.dispatched_at === "string" &&
      Number.isFinite(Date.parse(req.dispatched_at)) &&
      new Date(req.dispatched_at).toISOString() === req.dispatched_at &&
      Date.parse(req.dispatched_at) <= Date.parse(m.attestation.recorded_at),
    "RECONCILE_REQUEST_MISMATCH",
  );
  requireValue(
    keys(res, [
      "status",
      "defects",
      "unreferenced_files",
      "http_browser_admin",
      "_target",
    ]) &&
      keys(res._target, ["project_id", "target_id", "manifest_sha256"]) &&
      res._target.project_id === m.project_id &&
      res._target.target_id === m.target_id &&
      res._target.manifest_sha256 === m.package_manifest_sha256 &&
      res.status === "DATABASE_RECONCILED" &&
      Array.isArray(res.defects) &&
      res.defects.length === 0 &&
      Array.isArray(res.unreferenced_files) &&
      res.unreferenced_files.every((v: any) => typeof v === "string") &&
      res.http_browser_admin === "NOT_RUN",
    "NATIVE_RECONCILE_NOT_CONFIRMED",
  );
  return {
    observed_at: req.dispatched_at,
    unreferenced_files: res.unreferenced_files.length,
  };
}
function summary(
  m: TargetEvidenceManifest,
  bound: ReturnType<typeof acceptedBuild>,
  receipts: ReturnType<typeof validateReceipts>,
  pin: string,
) {
  return {
    schema_version: 1,
    kind: "recorded-native-import",
    state: "RECORDED_NATIVE_IMPORT",
    project_id: m.project_id,
    target_id: m.target_id,
    build_record_id: m.build_record_id,
    model_record_id: m.model_record_id,
    manifest_sha256: pin,
    package_manifest_sha256: m.package_manifest_sha256,
    build_artifact: m.build_artifact,
    model_artifact: m.model_artifact,
    route_artifact: m.route_artifact,
    scope_artifact: m.scope_artifact,
    checks: {
      receipt_integrity: "VERIFIED",
      committed_build_binding: "VERIFIED",
      native_database_reconcile: "RECORDED_PASS",
      defects: 0,
    },
    counts: bound.counts,
    ...receipts,
    recorded_at: m.attestation.recorded_at,
    trust_boundary: "OPERATOR_ATTESTED_COPIED_NATIVE_RECEIPTS",
    target_current_state: "NOT_RECHECKED",
    http: "NOT_RUN",
    browser: "NOT_RUN",
    admin: "NOT_RUN",
    restore: "NOT_RUN",
    source_coverage: "UNKNOWN",
    readiness: "NOT_READY",
  };
}
function receiptType(pin: string, role: Role | "manifest") {
  return `target-evidence-${pin}-${role}.json`;
}
function existingArtifact(
  store: Store,
  type: string,
  bytes: Buffer,
  assertOwnership: () => void,
) {
  assertOwnership();
  const pin = hash(bytes),
    prior = store
      .list<Artifact>("artifact")
      .filter((a) => a.type === type && a.sha256 === pin);
  for (const a of prior) {
    artifact(
      store,
      { artifact_id: a.artifact_id, sha256: pin },
      type,
      Math.max(bytes.length, 1),
    );
    assertOwnership();
    return a;
  }
  return store.publishArtifact(
    type,
    bytes,
    null,
    undefined,
    undefined,
    assertOwnership,
  );
}
function readRecord(store: Store, r: TargetEvidenceRecord) {
  requireValue(
    r.schema_version === 1 &&
      r.state === "COMMITTED" &&
      sha.test(r.manifest_sha256) &&
      r.id ===
        hash(
          JSON.stringify([
            "target-evidence-v1",
            r.project_id,
            r.target_id,
            r.build_record_id,
            r.manifest_sha256,
          ]),
        ) &&
      r.manifest_artifact_id &&
      r.result_artifact_id,
    "RECORD_NOT_COMMITTED",
  );
  const m = parse(
    artifact(
      store,
      { artifact_id: r.manifest_artifact_id, sha256: r.manifest_sha256 },
      receiptType(r.manifest_sha256, "manifest"),
      131072,
    ),
  );
  validManifest(m);
  requireValue(
    r.project_id === m.project_id &&
      r.target_id === m.target_id &&
      r.build_record_id === m.build_record_id &&
      keys(r.file_artifact_ids, [...roles]),
    "RECORD_BINDING_MISMATCH",
  );
  const files = {} as Record<Role, Buffer>;
  for (const role of roles)
    files[role] = artifact(
      store,
      { artifact_id: r.file_artifact_ids[role]!, sha256: m.files[role].sha256 },
      receiptType(r.manifest_sha256, role),
      caps[role],
    );
  const result = summary(
    m,
    acceptedBuild(store, m),
    validateReceipts(m, files),
    r.manifest_sha256,
  );
  const a = store.get<Artifact>("artifact", r.result_artifact_id);
  requireValue(
    same(
      parse(
        artifact(
          store,
          { artifact_id: a.artifact_id, sha256: a.sha256 },
          "target-evidence-result.json",
          131072,
        ),
      ),
      result,
    ),
    "RESULT_BINDING_MISMATCH",
  );
  return result;
}
/** Report only; failures are explicit and cannot turn stale/tampered evidence into PASS. */
export function readTargetEvidence(
  store: Store,
  verifiedBuildIds: ReadonlySet<string>,
) {
  return store.list<TargetEvidenceRecord>("target_evidence").map((r) => {
    try {
      requireValue(
        verifiedBuildIds.has(r.build_record_id),
        "BUILD_NOT_CURRENTLY_VERIFIED",
      );
      return {
        ...readRecord(store, r),
        id: r.id,
        result_artifact_id: r.result_artifact_id,
        integrity: "VERIFIED",
        issues: [] as string[],
      };
    } catch (error) {
      return {
        id: r.id,
        build_record_id: r.build_record_id,
        target_id: r.target_id,
        state: r.state === "PENDING" ? "PENDING" : "INVALID",
        integrity: "UNVERIFIED",
        issues: [
          error instanceof Error
            ? error.message
            : "Target evidence validation failed",
        ],
      };
    }
  });
}
/** Maintenance operation: no target writes, no readiness or source-state transitions. */
export async function ingestTargetEvidence(
  store: Store,
  options: {
    buildId: string;
    directory: string;
    expectedManifestSha256: string;
  },
) {
  const run = store.currentRun(),
    owner = `target-evidence:${process.pid}:${uid("op")}`;
  store.acquireDispatcher(run.run_id, owner);
  const assertOwnership = () => {
    const current = store.currentRun();
    if (
      current.run_id !== run.run_id ||
      current.dispatcher_owner !== owner ||
      current.dispatcher_until <= Date.now()
    )
      throw new UpgradeError("Dispatcher ownership lost", 3);
  };
  const checkLease = () => {
    assertOwnership();
    store.renewDispatcher(run.run_id, owner);
  };
  const fenced = <T>(mutate: () => T): T =>
    store.transaction(() => {
      assertOwnership();
      const value = mutate();
      assertOwnership();
      return value;
    });
  const timer = setInterval(() => {
    try {
      checkLease();
    } catch {}
  }, 10000);
  try {
    requireValue(
      sha.test(options.expectedManifestSha256) && sha.test(options.buildId),
      "EXPLICIT_PINS_REQUIRED",
    );
    const root = resolve(options.directory),
      bytes = bounded(
        root,
        "target-evidence.json",
        options.expectedManifestSha256,
        131072,
      );
    const m = parse(bytes);
    validManifest(m);
    requireValue(
      m.build_record_id === options.buildId,
      "BUILD_ARGUMENT_MISMATCH",
    );
    const expected = new Set([
      "target-evidence.json",
      ...roles.map((role) => m.files[role].relative_path),
    ]);
    const walk = (rel = "", depth = 0) => {
      requireValue(depth < 8, "TREE_TOO_DEEP");
      for (const name of readdirSync(rel ? inside(root, rel) : root)) {
        const path = rel ? `${rel}/${name}` : name,
          stat = lstatSync(inside(root, path));
        requireValue(!stat.isSymbolicLink(), "SYMLINK_FORBIDDEN");
        if (stat.isDirectory()) {
          requireValue(
            [...expected].some((p) => p.startsWith(path + "/")),
            "UNLISTED_DIRECTORY",
          );
          walk(path, depth + 1);
        } else
          requireValue(stat.isFile() && expected.delete(path), "UNLISTED_FILE");
      }
    };
    walk();
    requireValue(expected.size === 0, "MISSING_FILE");
    const files = {} as Record<Role, Buffer>;
    for (const role of roles) {
      const f = m.files[role];
      files[role] = bounded(
        root,
        f.relative_path,
        f.sha256,
        caps[role],
        f.size_bytes,
      );
    }
    const bound = acceptedBuild(store, m),
      receipts = validateReceipts(m, files);
    await validateCapturePayloads(store, bound, assertOwnership);
    await validateBitrixPackage(
      bound.packageDir,
      m.project_id,
      m.package_manifest_sha256,
    );
    checkLease();
    const id = hash(
      JSON.stringify([
        "target-evidence-v1",
        m.project_id,
        m.target_id,
        m.build_record_id,
        options.expectedManifestSha256,
      ]),
    );
    let record: TargetEvidenceRecord | undefined;
    try {
      record = store.get<TargetEvidenceRecord>("target_evidence", id);
    } catch (error) {
      if (
        !(error instanceof UpgradeError) ||
        error.message !== `target_evidence not found: ${id}`
      )
        throw error;
    }
    if (record) requireValue(record.id === id, "STORED_RECORD_KEY_MISMATCH");
    if (record?.state === "COMMITTED") {
      const result = readRecord(store, record);
      assertOwnership();
      return {
        ...result,
        id,
        result_artifact_id: record.result_artifact_id,
        replayed: true,
      };
    }
    const intent: TargetEvidenceRecord = {
      schema_version: 1,
      id,
      state: "PENDING",
      project_id: m.project_id,
      target_id: m.target_id,
      build_record_id: m.build_record_id,
      manifest_sha256: options.expectedManifestSha256,
      file_artifact_ids: {},
    };
    if (record)
      requireValue(
        record.state === "PENDING" &&
          [
            "schema_version",
            "id",
            "project_id",
            "target_id",
            "build_record_id",
            "manifest_sha256",
          ].every((k) => (record as any)[k] === (intent as any)[k]),
        "PENDING_INTENT_MISMATCH",
      );
    else {
      record = intent;
      fenced(() => {
        store.put("target_evidence", id, record);
        store.event(
          "target_evidence.pending",
          "operator",
          { id, build_record_id: m.build_record_id },
          run.run_id,
        );
      });
    }
    const save = (role: Role | "manifest", data: Buffer) => {
      checkLease();
      const priorId =
        role === "manifest"
          ? record!.manifest_artifact_id
          : record!.file_artifact_ids[role];
      const type = receiptType(options.expectedManifestSha256, role);
      if (priorId) {
        artifact(
          store,
          { artifact_id: priorId, sha256: hash(data) },
          type,
          data.length,
        );
        return priorId;
      }
      return existingArtifact(store, type, data, assertOwnership).artifact_id;
    };
    record.manifest_artifact_id = save("manifest", bytes);
    fenced(() => store.put("target_evidence", id, record));
    for (const role of roles) {
      record.file_artifact_ids[role] = save(role, files[role]);
      fenced(() => store.put("target_evidence", id, record));
    }
    const result = summary(m, bound, receipts, options.expectedManifestSha256),
      resultBytes = Buffer.from(json(result));
    if (record.result_artifact_id)
      artifact(
        store,
        { artifact_id: record.result_artifact_id, sha256: hash(resultBytes) },
        "target-evidence-result.json",
        131072,
      );
    else
      record.result_artifact_id = existingArtifact(
        store,
        "target-evidence-result.json",
        resultBytes,
        assertOwnership,
      ).artifact_id;
    checkLease();
    record.state = "COMMITTED";
    fenced(() => {
      store.put("target_evidence", id, record);
      store.event(
        "target_evidence.committed",
        "operator",
        {
          id,
          result_artifact_id: record!.result_artifact_id,
          target_id: m.target_id,
          build_record_id: m.build_record_id,
          readiness: "NOT_READY",
        },
        run.run_id,
      );
    });
    assertOwnership();
    return {
      ...result,
      id,
      result_artifact_id: record.result_artifact_id,
      replayed: false,
    };
  } finally {
    clearInterval(timer);
    if (store.currentRun().dispatcher_owner === owner)
      store.releaseDispatcher(run.run_id, owner);
    store.exportEvents();
  }
}
