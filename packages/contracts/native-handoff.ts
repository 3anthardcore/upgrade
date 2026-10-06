/** Public, path-free boundary between the content Store and a private operator. */
import { createHash } from "node:crypto";
export const handoffHash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export const handoffJson = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
export const HANDOFF_LIMITS = Object.freeze({
  request: 262144,
  receipt: 8000000,
  file: 200000000,
  package: 2000000000,
  files: 20000,
});
export type HandoffAction = "validate" | "dry-run" | "reconcile" | "apply";
export interface HandoffBinding {
  schema_version: 1;
  project_id: string;
  target_id: string;
  profile_id: string;
  profile_sha256: string;
  executor_sha256: string;
  native_profile_sha256: string;
  journal_identity_sha256: string;
}
export interface HandoffArtifact {
  artifact_id: string;
  sha256: string;
}
export interface HandoffBuild {
  kind: "operator" | "pipeline";
  id: string;
  record_sha256: string;
  model: HandoffArtifact;
  routes: HandoffArtifact;
  scope: HandoffArtifact;
  release: HandoffArtifact;
  package_manifest_sha256: string;
  source_origin: string;
  known_urls: number;
  planned_routes: number;
  full_source_denominator: "UNKNOWN" | number;
}
export interface NativeHandoffRequest {
  schema_version: 1;
  kind: "native-handoff-request";
  request_id: string;
  binding: HandoffBinding;
  build: HandoffBuild;
  action: HandoffAction;
}
export interface NativeHandoffReceipt {
  schema_version: 1;
  kind: "native-handoff-receipt";
  request_id: string;
  request_sha256: string;
  binding: HandoffBinding;
  build: HandoffBuild;
  action: HandoffAction;
  attempt: number;
  execution: "NATIVE" | "TEST_DOUBLE";
  status: "CONFIRMED" | "DRY_RUN" | "VALIDATED" | "UNKNOWN" | "INCOMPLETE";
  recorded_at: string;
  native_profile_sha256: string;
  journal_binding_sha256: string;
  journal_head: unknown;
  native_result: unknown;
  activation: "NOT_RUN";
  full_qa: "NOT_RUN";
}
export interface NativeHandoffProfile {
  schema_version: 1;
  kind: "private-native-handoff-profile";
  project_id: string;
  target_id: string;
  profile_id: string;
  executor_sha256: string;
  native_profile_path: string;
  native_profile_sha256: string;
  journal_dir: string;
  journal_binding_sha256: string;
  inbox_root: string;
  outbox_root: string;
}
const sha = /^[a-f0-9]{64}$/;
const id = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function handoffAssert(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error("HANDOFF_" + code);
}
export function handoffKeys(v: any, names: string[]) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === names.length &&
    names.every((k) => Object.hasOwn(v, k))
  );
}
export function handoffCanonical(v: any): any {
  return Array.isArray(v)
    ? v.map(handoffCanonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, handoffCanonical(v[k])]),
        )
      : v;
}
export function handoffEqual(a: any, b: any) {
  return (
    JSON.stringify(handoffCanonical(a)) === JSON.stringify(handoffCanonical(b))
  );
}
export function parseHandoff(bytes: Buffer): any {
  const s = bytes.toString("utf8");
  handoffAssert(Buffer.from(s).equals(bytes), "UTF8");
  const value = JSON.parse(s),
    stack: Array<Set<string> | null> = [];
  for (const m of s.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    const t = m[0];
    if (t === "{") stack.push(new Set());
    else if (t === "[") stack.push(null);
    else if (t === "}" || t === "]") stack.pop();
    else if (/^\s*:/.test(s.slice(m.index! + t.length))) {
      const k = JSON.parse(t),
        set = stack.at(-1);
      handoffAssert(set && !set.has(k), "DUPLICATE_KEY");
      set.add(k);
    }
  }
  return value;
}
export function validateHandoffBinding(v: any): asserts v is HandoffBinding {
  handoffAssert(
    handoffKeys(v, [
      "schema_version",
      "project_id",
      "target_id",
      "profile_id",
      "profile_sha256",
      "executor_sha256",
      "native_profile_sha256",
      "journal_identity_sha256",
    ]) &&
      v.schema_version === 1 &&
      [v.project_id, v.target_id, v.profile_id].every(
        (x) => typeof x === "string" && id.test(x),
      ) &&
      [
        v.profile_sha256,
        v.executor_sha256,
        v.native_profile_sha256,
        v.journal_identity_sha256,
      ].every((x) => typeof x === "string" && sha.test(x)),
    "BINDING_INVALID",
  );
}
function validateBuild(v: any) {
  handoffAssert(
    handoffKeys(v, [
      "kind",
      "id",
      "record_sha256",
      "model",
      "routes",
      "scope",
      "release",
      "package_manifest_sha256",
      "source_origin",
      "known_urls",
      "planned_routes",
      "full_source_denominator",
    ]) &&
      ["operator", "pipeline"].includes(v.kind) &&
      typeof v.id === "string" &&
      /^[a-zA-Z0-9-]{1,100}$/.test(v.id) &&
      sha.test(v.record_sha256) &&
      sha.test(v.package_manifest_sha256),
    "BUILD_INVALID",
  );
  for (const k of ["model", "routes", "scope", "release"])
    handoffAssert(
      handoffKeys(v[k], ["artifact_id", "sha256"]) &&
        /^art-[a-zA-Z0-9-]{1,100}$/.test(v[k].artifact_id) &&
        sha.test(v[k].sha256),
      "ARTIFACT_REFERENCE_INVALID",
    );
  let u: URL;
  try {
    u = new URL(v.source_origin);
  } catch {
    throw Error("HANDOFF_ORIGIN_INVALID");
  }
  handoffAssert(
    ["https:", "http:"].includes(u.protocol) &&
      u.origin === v.source_origin &&
      !u.username &&
      !u.password,
    "ORIGIN_INVALID",
  );
  handoffAssert(
    Number.isSafeInteger(v.known_urls) &&
      v.known_urls >= 0 &&
      Number.isSafeInteger(v.planned_routes) &&
      v.planned_routes >= 0 &&
      v.planned_routes <= v.known_urls &&
      (v.full_source_denominator === "UNKNOWN" ||
        (Number.isSafeInteger(v.full_source_denominator) &&
          v.full_source_denominator >= v.known_urls)),
    "SCOPE_INVALID",
  );
}
export function handoffRequestId(
  v: Pick<NativeHandoffRequest, "binding" | "build" | "action">,
) {
  return handoffHash(
    JSON.stringify(
      handoffCanonical(["native-handoff-v1", v.binding, v.build, v.action]),
    ),
  );
}
export function validateHandoffRequest(
  v: any,
): asserts v is NativeHandoffRequest {
  handoffAssert(
    handoffKeys(v, [
      "schema_version",
      "kind",
      "request_id",
      "binding",
      "build",
      "action",
    ]) &&
      v.schema_version === 1 &&
      v.kind === "native-handoff-request" &&
      ["validate", "dry-run", "reconcile", "apply"].includes(v.action),
    "REQUEST_INVALID",
  );
  validateHandoffBinding(v.binding);
  validateBuild(v.build);
  handoffAssert(v.request_id === handoffRequestId(v), "REQUEST_ID_MISMATCH");
}
export function validateHandoffReceipt(
  v: any,
  r: NativeHandoffRequest,
  requestSha: string,
): asserts v is NativeHandoffReceipt {
  handoffAssert(
    handoffKeys(v, [
      "schema_version",
      "kind",
      "request_id",
      "request_sha256",
      "binding",
      "build",
      "action",
      "attempt",
      "execution",
      "status",
      "recorded_at",
      "native_profile_sha256",
      "journal_binding_sha256",
      "journal_head",
      "native_result",
      "activation",
      "full_qa",
    ]) &&
      v.schema_version === 1 &&
      v.kind === "native-handoff-receipt" &&
      v.request_id === r.request_id &&
      v.request_sha256 === requestSha &&
      handoffEqual(v.binding, r.binding) &&
      handoffEqual(v.build, r.build) &&
      v.action === r.action,
    "RECEIPT_BINDING_MISMATCH",
  );
  handoffAssert(
    Number.isSafeInteger(v.attempt) &&
      v.attempt >= 1 &&
      v.attempt <= 1000 &&
      ["NATIVE", "TEST_DOUBLE"].includes(v.execution) &&
      ["CONFIRMED", "DRY_RUN", "VALIDATED", "UNKNOWN", "INCOMPLETE"].includes(
        v.status,
      ) &&
      typeof v.recorded_at === "string" &&
      new Date(v.recorded_at).toISOString() === v.recorded_at &&
      v.native_profile_sha256 === r.binding.native_profile_sha256 &&
      sha.test(v.journal_binding_sha256) &&
      v.activation === "NOT_RUN" &&
      v.full_qa === "NOT_RUN",
    "RECEIPT_INVALID",
  );
  if (v.status === "UNKNOWN") {
    handoffAssert(v.native_result === null, "UNKNOWN_RESULT_INVALID");
    return;
  }
  if (v.status === "VALIDATED") {
    handoffAssert(
      r.action === "validate" && v.native_result === null,
      "VALIDATION_INVALID",
    );
    return;
  }
  const n = v.native_result;
  handoffAssert(
    n &&
      handoffEqual(n._target, {
        project_id: r.binding.project_id,
        target_id: r.binding.target_id,
        manifest_sha256: r.build.package_manifest_sha256,
      }),
    "NATIVE_RESULT_TARGET_MISMATCH",
  );
  handoffAssert(
    v.journal_head?.profile_sha256 === v.native_profile_sha256 &&
      v.journal_head?.manifest_sha256 === r.build.package_manifest_sha256 &&
      v.journal_head?.last_result?.sha256 === handoffHash(handoffJson(n)),
    "JOURNAL_RESULT_MISMATCH",
  );
  if (v.status === "DRY_RUN") {
    handoffAssert(
      r.action === "dry-run" &&
        Array.isArray(n.conflicts) &&
        Array.isArray(n.blockers) &&
        ["created", "updated", "skipped", "reconciled"].every(
          (k) => Number.isSafeInteger(n[k]) && n[k] >= 0,
        ),
      "DRY_RUN_INVALID",
    );
  } else {
    handoffAssert(
      ["apply", "reconcile"].includes(r.action) && Array.isArray(n.defects),
      "RECONCILE_INVALID",
    );
    if (v.status === "CONFIRMED")
      handoffAssert(
        n.status === "DATABASE_RECONCILED" &&
          n.defects.length === 0 &&
          v.journal_head?.status === "CONFIRMED" &&
          v.journal_head?.manifest_sha256 === r.build.package_manifest_sha256 &&
          v.journal_head?.project_id === r.binding.project_id &&
          v.journal_head?.target_id === r.binding.target_id,
        "CONFIRMATION_INVALID",
      );
    else
      handoffAssert(
        n.status === "FAIL" && n.defects.length > 0,
        "INCOMPLETE_INVALID",
      );
  }
}
export function validateHandoffProfile(
  v: any,
): asserts v is NativeHandoffProfile {
  handoffAssert(
    handoffKeys(v, [
      "schema_version",
      "kind",
      "project_id",
      "target_id",
      "profile_id",
      "executor_sha256",
      "native_profile_path",
      "native_profile_sha256",
      "journal_dir",
      "journal_binding_sha256",
      "inbox_root",
      "outbox_root",
    ]) &&
      v.schema_version === 1 &&
      v.kind === "private-native-handoff-profile" &&
      [v.project_id, v.target_id, v.profile_id].every(
        (x) => typeof x === "string" && id.test(x),
      ) &&
      [
        v.executor_sha256,
        v.native_profile_sha256,
        v.journal_binding_sha256,
      ].every((x) => typeof x === "string" && sha.test(x)),
    "PRIVATE_PROFILE_INVALID",
  );
  for (const k of [
    "native_profile_path",
    "journal_dir",
    "inbox_root",
    "outbox_root",
  ])
    handoffAssert(
      typeof v[k] === "string" &&
        v[k].length > 1 &&
        v[k].length <= 1000 &&
        !/[\x00-\x1f]/.test(v[k]),
      "PRIVATE_PATH_INVALID",
    );
}
