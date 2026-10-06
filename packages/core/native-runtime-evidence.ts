/** Offline copied native runtime evidence; no target I/O. */
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
import { resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Store, UpgradeError, hash, inside, uid } from "./index.ts";
import { readTargetEvidence } from "./target-evidence.ts";
import { validateBitrixPackage } from "../bitrix-adapter/index.ts";
import type { Artifact } from "../contracts/index.ts";

import {
  nativeRuntimeCaps as caps,
  validateNativeRuntimeManifest as validManifest,
  validateNativeRuntimeReceipts,
} from "../contracts/native-runtime-evidence.ts";
import type {
  NativeRuntimeManifest,
  NativeRuntimeRecord,
  NativeRuntimeRole as Role,
} from "../contracts/native-runtime-evidence.ts";
type Ref = { artifact_id: string; sha256: string };
const roles = Object.keys(caps) as Role[];
const sha = /^[a-f0-9]{64}$/;
const ident = /^[a-z0-9][a-z0-9-]{0,80}$/;
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw new UpgradeError(`NATIVE_RUNTIME_${code}`, 5);
}
function keys(v: any, names: string[]) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === names.length &&
    names.every((k) => Object.hasOwn(v, k))
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
const json = (v: any) => JSON.stringify(v, null, 2) + "\n";
const finiteInt = (n: any, max = 1_000_000_000_000) =>
  Number.isSafeInteger(n) && n >= 0 && n <= max;
function parse(b: Buffer): any {
  const text = b.toString("utf8");
  need(Buffer.from(text).equals(b), "UTF8_INVALID");
  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    throw new UpgradeError("NATIVE_RUNTIME_JSON_INVALID", 5);
  }
  const stack: Array<Set<string> | null> = [];
  for (const t of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    if (t[0] === "{") stack.push(new Set());
    else if (t[0] === "[") stack.push(null);
    else if (t[0] === "}" || t[0] === "]") stack.pop();
    else if (/^\s*:/.test(text.slice(t.index! + t[0].length))) {
      const key = JSON.parse(t[0]),
        set = stack.at(-1);
      need(set && !set.has(key), "DUPLICATE_JSON_KEY");
      set.add(key);
    }
  }
  return result;
}
function relative(v: any): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 240 &&
    !/[\\:\x00-\x1f]/.test(v) &&
    !v.startsWith("/") &&
    v.split("/").every((p) => p !== "" && p !== "." && p !== "..")
  );
}
function read(
  root: string,
  rel: string,
  pin: string,
  cap: number,
  size?: number,
): Buffer {
  need(relative(rel) && sha.test(pin), "FILE_REFERENCE_INVALID");
  const path = inside(root, rel),
    info = lstatSync(path);
  need(
    info.isFile() &&
      info.nlink === 1 &&
      info.size > 0 &&
      info.size <= cap &&
      !info.isSymbolicLink(),
    "BOUNDED_REGULAR_FILE_REQUIRED",
  );
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    need(
      before.isFile() &&
        before.nlink === 1 &&
        before.dev === info.dev &&
        before.ino === info.ino,
      "FILE_IDENTITY_CHANGED",
    );
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, cap - total + 1)),
        n = readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      total += n;
      need(total <= cap, "FILE_LIMIT");
      chunks.push(chunk.subarray(0, n));
    }
    const after = fstatSync(fd),
      bytes = Buffer.concat(chunks, total);
    need(
      before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        realpathSync(path) === path &&
        (size === undefined || total === size) &&
        hash(bytes) === pin,
      "FILE_PIN_MISMATCH",
    );
    return bytes;
  } finally {
    closeSync(fd);
  }
}
function artifact(store: Store, ref: Ref, type?: string, cap = 256_000_000) {
  need(
    keys(ref, ["artifact_id", "sha256"]) &&
      typeof ref.artifact_id === "string" &&
      sha.test(ref.sha256),
    "ARTIFACT_REF_INVALID",
  );
  const a = store.get<Artifact>("artifact", ref.artifact_id);
  need(
    a.artifact_id === ref.artifact_id &&
      a.sha256 === ref.sha256 &&
      (!type || a.type === type) &&
      a.project_id === store.currentRun().project_id &&
      a.validation_status === "VALID",
    "ARTIFACT_BINDING_INVALID",
  );
  return read(store.root, a.relative_path, ref.sha256, cap, a.size_bytes);
}
function bind(store: Store, m: NativeRuntimeManifest) {
  const record = store.get<any>("target_evidence", m.target_evidence.record_id);
  need(
    record.id === m.target_evidence.record_id &&
      record.state === "COMMITTED" &&
      record.result_artifact_id === m.target_evidence.result_artifact_id &&
      record.project_id === m.project_id &&
      record.target_id === m.target_id &&
      record.build_record_id === m.build_record_id,
    "TARGET_NOT_COMMITTED",
  );
  const exact = parse(
    artifact(
      store,
      {
        artifact_id: m.target_evidence.result_artifact_id,
        sha256: m.target_evidence.sha256,
      },
      "target-evidence-result.json",
      131072,
    ),
  );
  const verified = readTargetEvidence(store, new Set([m.build_record_id])).find(
    (r) => r.id === record.id,
  );
  need(
    verified?.integrity === "VERIFIED" &&
      verified.state === "RECORDED_NATIVE_IMPORT",
    "TARGET_EVIDENCE_INVALID",
  );
  for (const key of [
    "project_id",
    "target_id",
    "build_record_id",
    "model_record_id",
    "package_manifest_sha256",
    "build_artifact",
    "model_artifact",
    "route_artifact",
    "scope_artifact",
  ] as const)
    need(same(exact[key], m[key]), "TARGET_PROVENANCE_MISMATCH");
  const build = store.get<any>("operator_build", m.build_record_id),
    model = store.get<any>("operator_model", m.model_record_id);
  need(
    build.id === m.build_record_id &&
      model.id === m.model_record_id &&
      build.state === "COMMITTED" &&
      model.state === "COMMITTED",
    "DERIVED_NOT_COMMITTED",
  );
  const packageDir = inside(store.root, build.package_relative_path),
    manifest = parse(
      read(packageDir, "manifest.json", m.package_manifest_sha256, 4_000_000),
    );
  const payload = (name: string) =>
    parse(
      read(
        packageDir,
        `data/${name}.json`,
        manifest.files[`data/${name}.json`],
        128_000_000,
      ),
    );
  const entities = payload("entities"),
    routes = payload("routes"),
    assets = payload("assets"),
    scope = payload("operator-scope"),
    snapshot = payload("demo-snapshot");
  need(
    scope.input_hash === m.model_record_id &&
      same(
        scope,
        parse(
          artifact(store, m.scope_artifact, "operator-scope-manifest.json"),
        ),
      ) &&
      scope.state === "PARTIAL" &&
      scope.full_source_denominator === "UNKNOWN" &&
      scope.source_access === "NOT_VERIFIED" &&
      scope.known_url_count === scope.inventory.length &&
      scope.planned_route_count === routes.length &&
      scope.unresolved_url_count === scope.unresolved.length,
    "SCOPE_MISMATCH",
  );
  need(
    manifest.files["data/demo-snapshot.json"] === m.snapshot.sha256 &&
      snapshot.snapshot_id === m.snapshot.id &&
      snapshot.project_id === m.project_id &&
      hash(
        JSON.stringify({
          schema_version: snapshot.schema_version,
          project_id: snapshot.project_id,
          items: snapshot.items,
        }),
      ) === m.snapshot.id,
    "SNAPSHOT_MISMATCH",
  );
  need(
    Array.isArray(snapshot.items) &&
      snapshot.items.length === entities.length &&
      same(
        [...snapshot.items.map((i: any) => i.id)].sort(),
        [...entities.map((e: any) => e.source_id)].sort(),
      ) &&
      same(
        [...snapshot.items.map((i: any) => i.request_target)].sort(),
        [...routes.map((r: any) => r.request_target)].sort(),
      ),
    "SNAPSHOT_MEMBERSHIP",
  );
  return {
    build,
    model,
    packageDir,
    manifest,
    entities,
    routes,
    assets,
    scope,
    snapshot,
  };
}
function result(
  m: NativeRuntimeManifest,
  b: ReturnType<typeof bind>,
  files: Partial<Record<Role, Buffer>>,
  pin: string,
) {
  return {
    schema_version: 1,
    kind: "recorded-native-runtime",
    state: "RECORDED_NATIVE_RUNTIME",
    project_id: m.project_id,
    target_id: m.target_id,
    build_record_id: m.build_record_id,
    model_record_id: m.model_record_id,
    manifest_sha256: pin,
    package_manifest_sha256: m.package_manifest_sha256,
    target_evidence: m.target_evidence,
    snapshot: m.snapshot,
    origin: m.origin,
    recorded_at: m.attestation.recorded_at,
    ...validateNativeRuntimeReceipts(m, files, b),
  };
}
const type = (pin: string, role: Role | "manifest") =>
  `native-runtime-${pin}-${role}.json`;
function committed(store: Store, r: NativeRuntimeRecord) {
  need(
    r.schema_version === 1 &&
      r.state === "COMMITTED" &&
      sha.test(r.manifest_sha256) &&
      r.id ===
        hash(
          JSON.stringify([
            "native-runtime-v1",
            r.project_id,
            r.target_id,
            r.build_record_id,
            r.manifest_sha256,
          ]),
        ) &&
      r.manifest_artifact_id &&
      r.result_artifact_id,
    "RECORD_INVALID",
  );
  const m = parse(
    artifact(
      store,
      { artifact_id: r.manifest_artifact_id, sha256: r.manifest_sha256 },
      type(r.manifest_sha256, "manifest"),
      131072,
    ),
  );
  validManifest(m);
  need(
    r.project_id === m.project_id &&
      r.target_id === m.target_id &&
      r.build_record_id === m.build_record_id &&
      keys(r.file_artifact_ids, Object.keys(m.files)),
    "RECORD_BINDING_INVALID",
  );
  const files: Partial<Record<Role, Buffer>> = {};
  for (const role of roles)
    if (m.files[role])
      files[role] = artifact(
        store,
        {
          artifact_id: r.file_artifact_ids[role]!,
          sha256: m.files[role]!.sha256,
        },
        type(r.manifest_sha256, role),
        caps[role],
      );
  const expected = result(m, bind(store, m), files, r.manifest_sha256),
    a = store.get<Artifact>("artifact", r.result_artifact_id);
  need(
    same(
      parse(
        artifact(
          store,
          { artifact_id: a.artifact_id, sha256: a.sha256 },
          "native-runtime-result.json",
          262144,
        ),
      ),
      expected,
    ),
    "RESULT_MISMATCH",
  );
  return expected;
}
export function readNativeRuntimeEvidence(
  store: Store,
  verifiedBuildIds: ReadonlySet<string>,
  currentBuildId: string | null,
) {
  return store.list<NativeRuntimeRecord>("native_runtime_evidence").map((r) => {
    try {
      need(verifiedBuildIds.has(r.build_record_id), "BUILD_NOT_VERIFIED");
      const stored = store.get<NativeRuntimeRecord>(
        "native_runtime_evidence",
        r.id,
      );
      need(same(stored, r), "RECORD_KEY_MISMATCH");
      return {
        ...committed(store, r),
        id: r.id,
        result_artifact_id: r.result_artifact_id,
        integrity: "VERIFIED",
        binding_status:
          r.build_record_id === currentBuildId ? "CURRENT" : "STALE",
        issues: [] as string[],
      };
    } catch (e) {
      return {
        id: r.id,
        build_record_id: r.build_record_id,
        target_id: r.target_id,
        state: r.state === "PENDING" ? "PENDING" : "INVALID",
        integrity: "UNVERIFIED",
        binding_status: "NOT_RUN",
        issues: [
          e instanceof Error ? e.message : "Native runtime validation failed",
        ],
      };
    }
  });
}
export async function ingestNativeRuntimeEvidence(
  store: Store,
  options: {
    buildId: string;
    directory: string;
    expectedManifestSha256: string;
    deadlineMs?: number;
  },
) {
  const deadline = options.deadlineMs ?? Date.now() + 600_000;
  need(
    Number.isSafeInteger(deadline) &&
      deadline > Date.now() &&
      deadline <= Date.now() + 1_200_000,
    "DEADLINE_INVALID",
  );
  const run = store.currentRun(),
    owner = `native-runtime:${process.pid}:${uid("op")}`;
  store.acquireDispatcher(run.run_id, owner);
  const guard = () => {
    if (Date.now() >= deadline)
      throw new UpgradeError("NATIVE_RUNTIME_DEADLINE_EXPIRED", 3);
    const r = store.currentRun();
    if (
      r.run_id !== run.run_id ||
      r.dispatcher_owner !== owner ||
      r.dispatcher_until <= Date.now()
    )
      throw new UpgradeError("Dispatcher ownership lost", 3);
  };
  const renew = () => {
    guard();
    store.renewDispatcher(run.run_id, owner);
  };
  const fenced = <T>(fn: () => T) =>
    store.transaction(() => {
      guard();
      const v = fn();
      guard();
      return v;
    });
  const timer = setInterval(() => {
    try {
      renew();
    } catch {}
  }, 10000);
  try {
    need(
      sha.test(options.buildId) && sha.test(options.expectedManifestSha256),
      "EXPLICIT_PINS_REQUIRED",
    );
    const root = resolve(options.directory),
      bytes = read(
        root,
        "native-runtime-evidence.json",
        options.expectedManifestSha256,
        131072,
      ),
      m = parse(bytes);
    validManifest(m);
    need(m.build_record_id === options.buildId, "BUILD_ARGUMENT_MISMATCH");
    const expected = new Set([
      "native-runtime-evidence.json",
      ...Object.values(m.files).map((f) => f.relative_path),
    ]);
    const walk = (rel = "", depth = 0) => {
      need(depth < 8, "TREE_LIMIT");
      for (const n of readdirSync(rel ? inside(root, rel) : root)) {
        const p = rel ? `${rel}/${n}` : n,
          s = lstatSync(inside(root, p));
        need(!s.isSymbolicLink(), "SYMLINK_FORBIDDEN");
        if (s.isDirectory()) {
          need(
            [...expected].some((f) => f.startsWith(p + "/")),
            "UNLISTED_DIRECTORY",
          );
          walk(p, depth + 1);
        } else need(s.isFile() && expected.delete(p), "UNLISTED_FILE");
      }
    };
    walk();
    need(expected.size === 0, "MISSING_FILE");
    const files: Partial<Record<Role, Buffer>> = {};
    for (const role of roles) {
      const f = m.files[role];
      if (f) {
        await nextTurn();
        guard();
        files[role] = read(
          root,
          f.relative_path,
          f.sha256,
          caps[role],
          f.size_bytes,
        );
      }
    }
    const b = bind(store, m);
    const output = result(m, b, files, options.expectedManifestSha256);
    need(Buffer.byteLength(json(output)) <= 262144, "RESULT_LIMIT");
    // Recheck immutable source payloads and package bytes, yielding between bounded files.
    const capture = store
      .list<any>("operator_capture")
      .filter(
        (c) =>
          c.capture_id === b.model.capture_id &&
          c.manifest_sha256 === b.model.manifest_sha256,
      );
    need(
      capture.length === 1 && capture[0].state === "COMMITTED",
      "CAPTURE_NOT_COMMITTED",
    );
    const cbody = parse(
      artifact(store, {
        artifact_id: b.model.capture_result_artifact_id,
        sha256: b.model.operator_binding.capture_result_sha256,
      }),
    );
    need(
      same(cbody.artifact_files, capture[0].files),
      "CAPTURE_FILES_MISMATCH",
    );
    need(
      Array.isArray(capture[0].files) && capture[0].files.length <= 6001,
      "CAPTURE_FILE_LIMIT",
    );
    let total = 0;
    for (const ref of capture[0].files) {
      await nextTurn();
      guard();
      const a = store.get<Artifact>("artifact", ref.artifact_id);
      total += a.size_bytes;
      need(
        total <= 514_000_000 &&
          a.type ===
            `operator-capture-${hash(JSON.stringify([capture[0].capture_id, capture[0].manifest_sha256, ref.relative_path]))}.bin`,
        "CAPTURE_PAYLOAD_BINDING",
      );
      artifact(
        store,
        { artifact_id: ref.artifact_id, sha256: ref.sha256 },
        a.type,
        20_000_000,
      );
    }
    await validateBitrixPackage(
      b.packageDir,
      m.project_id,
      m.package_manifest_sha256,
    );
    renew();
    const id = hash(
      JSON.stringify([
        "native-runtime-v1",
        m.project_id,
        m.target_id,
        m.build_record_id,
        options.expectedManifestSha256,
      ]),
    );
    let record: NativeRuntimeRecord | undefined;
    try {
      record = store.get<NativeRuntimeRecord>("native_runtime_evidence", id);
    } catch (e) {
      if (
        !(e instanceof UpgradeError) ||
        e.message !== `native_runtime_evidence not found: ${id}`
      )
        throw e;
    }
    const intent: NativeRuntimeRecord = {
      schema_version: 1,
      id,
      state: "PENDING",
      project_id: m.project_id,
      target_id: m.target_id,
      build_record_id: m.build_record_id,
      manifest_sha256: options.expectedManifestSha256,
      file_artifact_ids: {},
    };
    if (record) {
      need(record.id === id, "RECORD_KEY_MISMATCH");
      need(
        record.file_artifact_ids &&
          typeof record.file_artifact_ids === "object" &&
          !Array.isArray(record.file_artifact_ids) &&
          Object.keys(record.file_artifact_ids).every((k) =>
            Object.hasOwn(m.files, k),
          ),
        "PENDING_FILESET_MISMATCH",
      );
      for (const k of [
        "schema_version",
        "id",
        "project_id",
        "target_id",
        "build_record_id",
        "manifest_sha256",
      ] as const)
        need(record[k] === intent[k], "PENDING_INTENT_MISMATCH");
      if (record.state === "COMMITTED") {
        const value = committed(store, record);
        guard();
        return {
          ...value,
          id,
          result_artifact_id: record.result_artifact_id,
          replayed: true,
        };
      }
      need(record.state === "PENDING", "RECORD_STATE_INVALID");
    } else {
      record = intent;
      fenced(() => {
        store.put("native_runtime_evidence", id, record);
        store.event(
          "native_runtime.pending",
          "operator",
          { id, build_record_id: m.build_record_id },
          run.run_id,
        );
      });
    }
    const index = store.list<Artifact>("artifact");
    const save = (kind: string, data: Buffer, priorId?: string) => {
      renew();
      const pin = hash(data);
      if (priorId) {
        artifact(
          store,
          { artifact_id: priorId, sha256: pin },
          kind,
          data.length,
        );
        return priorId;
      }
      const existing = index.find((a) => a.type === kind && a.sha256 === pin);
      if (existing) {
        artifact(
          store,
          { artifact_id: existing.artifact_id, sha256: pin },
          kind,
          data.length,
        );
        guard();
        return existing.artifact_id;
      }
      const a = store.publishArtifact(
        kind,
        data,
        null,
        undefined,
        undefined,
        guard,
      );
      index.push(a);
      return a.artifact_id;
    };
    record.manifest_artifact_id = save(
      type(options.expectedManifestSha256, "manifest"),
      bytes,
      record.manifest_artifact_id,
    );
    fenced(() => store.put("native_runtime_evidence", id, record));
    for (const role of roles)
      if (files[role]) {
        await nextTurn();
        record.file_artifact_ids[role] = save(
          type(options.expectedManifestSha256, role),
          files[role]!,
          record.file_artifact_ids[role],
        );
        fenced(() => store.put("native_runtime_evidence", id, record));
      }
    record.result_artifact_id = save(
      "native-runtime-result.json",
      Buffer.from(json(output)),
      record.result_artifact_id,
    );
    renew();
    record.state = "COMMITTED";
    fenced(() => {
      store.put("native_runtime_evidence", id, record);
      store.event(
        "native_runtime.committed",
        "operator",
        {
          id,
          result_artifact_id: record!.result_artifact_id,
          readiness: "NOT_READY",
        },
        run.run_id,
      );
    });
    guard();
    return {
      ...output,
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
