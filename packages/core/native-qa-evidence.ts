/** Offline, operator-attested native QA. CURRENT means Store binding, never a live probe. */
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

type Ref = { artifact_id: string; sha256: string };
type FileRef = { relative_path: string; sha256: string; size_bytes: number };
const caps = {
  facts_before: 8_000_000,
  facts_after: 8_000_000,
  http_routes: 16_000_000,
  activation: 65_536,
  http_scenarios: 1_000_000,
  browser: 2_000_000,
  historical_plan: 1_000_000,
  historical_intent: 1_000_000,
  historical_result: 65_536,
  historical_events: 8_000_000,
} as const;
type Role = keyof typeof caps;
const roles = Object.keys(caps) as Role[];
export interface NativeQaManifest {
  schema_version: 1;
  kind: "native-qa-evidence";
  project_id: string;
  target_id: string;
  build_record_id: string;
  model_record_id: string;
  build_artifact: Ref;
  model_artifact: Ref;
  route_artifact: Ref;
  scope_artifact: Ref;
  target_evidence: {
    record_id: string;
    result_artifact_id: string;
    sha256: string;
  };
  package_manifest_sha256: string;
  snapshot: { id: string; sha256: string };
  origin: string;
  attestation: { kind: "operator-copied-native-receipts"; recorded_at: string };
  files: Partial<Record<Role, FileRef>>;
}
export interface NativeQaRecord {
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
const ident = /^[a-z0-9][a-z0-9-]{0,80}$/;
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw new UpgradeError(`NATIVE_QA_${code}`, 5);
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
    throw new UpgradeError("NATIVE_QA_JSON_INVALID", 5);
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
function validManifest(m: any): asserts m is NativeQaManifest {
  need(
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
      "target_evidence",
      "package_manifest_sha256",
      "snapshot",
      "origin",
      "attestation",
      "files",
    ]) &&
      m.schema_version === 1 &&
      m.kind === "native-qa-evidence" &&
      ident.test(m.project_id) &&
      ident.test(m.target_id),
    "MANIFEST_INVALID",
  );
  need(
    [m.build_record_id, m.model_record_id, m.package_manifest_sha256].every(
      (v) => typeof v === "string" && sha.test(v),
    ) &&
      keys(m.snapshot, ["id", "sha256"]) &&
      sha.test(m.snapshot.id) &&
      sha.test(m.snapshot.sha256),
    "PINS_INVALID",
  );
  for (const ref of [
    m.build_artifact,
    m.model_artifact,
    m.route_artifact,
    m.scope_artifact,
  ])
    need(
      keys(ref, ["artifact_id", "sha256"]) &&
        typeof ref.artifact_id === "string" &&
        sha.test(ref.sha256),
      "REF_INVALID",
    );
  need(
    keys(m.target_evidence, ["record_id", "result_artifact_id", "sha256"]) &&
      sha.test(m.target_evidence.record_id) &&
      typeof m.target_evidence.result_artifact_id === "string" &&
      sha.test(m.target_evidence.sha256),
    "TARGET_REF_INVALID",
  );
  let origin: URL;
  try {
    origin = new URL(m.origin);
  } catch {
    throw new UpgradeError("NATIVE_QA_ORIGIN_INVALID", 5);
  }
  need(
    origin.protocol === "https:" &&
      origin.origin === m.origin &&
      !origin.username &&
      !origin.password,
    "HTTPS_ORIGIN_REQUIRED",
  );
  need(
    keys(m.attestation, ["kind", "recorded_at"]) &&
      m.attestation.kind === "operator-copied-native-receipts" &&
      typeof m.attestation.recorded_at === "string" &&
      Number.isFinite(Date.parse(m.attestation.recorded_at)) &&
      new Date(m.attestation.recorded_at).toISOString() ===
        m.attestation.recorded_at &&
      Date.parse(m.attestation.recorded_at) <= Date.now() + 60000,
    "ATTESTATION_INVALID",
  );
  need(
    m.files &&
      typeof m.files === "object" &&
      !Array.isArray(m.files) &&
      Object.keys(m.files).length > 0 &&
      Object.keys(m.files).every((k) => roles.includes(k as Role)),
    "FILES_INVALID",
  );
  let total = 0;
  const paths = new Set<string>();
  for (const [role, f] of Object.entries(m.files) as [Role, FileRef][]) {
    need(
      keys(f, ["relative_path", "sha256", "size_bytes"]) &&
        relative(f.relative_path) &&
        f.relative_path !== "native-qa.json" &&
        sha.test(f.sha256) &&
        finiteInt(f.size_bytes, caps[role]) &&
        f.size_bytes > 0 &&
        !paths.has(f.relative_path),
      "FILE_REF_INVALID",
    );
    paths.add(f.relative_path);
    total += f.size_bytes;
  }
  need(total <= 48_000_000, "TOTAL_LIMIT");
}
function bind(store: Store, m: NativeQaManifest) {
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
// PHP JSON associative decoding turns empty objects and sequential numeric-key objects into arrays.
function phpValue(v: any): any {
  if (Array.isArray(v)) return v.map(phpValue);
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    if (entries.every(([k], i) => k === String(i)))
      return entries.map(([, x]) => phpValue(x));
    return Object.fromEntries(entries.map(([k, x]) => [k, phpValue(x)]));
  }
  return v;
}
const factsBytes = (v: any) =>
  Buffer.from(
    JSON.stringify(phpValue(v))
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029"),
  );
function unique<T>(rows: T[], key: (r: T) => string, code: string) {
  need(Array.isArray(rows) && rows.length <= 100000, code);
  const result = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    need(typeof k === "string" && !result.has(k), code);
    result.set(k, row);
  }
  return result;
}
const counterKeys = [
  "ug_entity",
  "ug_route",
  "ug_operation",
  "b_sale_order",
  "b_event",
  "b_user",
];
function counters(c: any) {
  need(
    keys(c, counterKeys) && counterKeys.every((k) => finiteInt(c[k])),
    "COUNTERS_INVALID",
  );
  return c;
}
const httpCheckIds = [
  "authentication",
  "search-sort",
  "filter",
  "product-session",
  "csrf-origin",
  "cart-add",
  "exact-replay",
  "cart-update",
  "cart-remove",
  "synthetic-checkout-form",
  "synthetic-checkout-receipt",
  "synthetic-lead-receipt",
  "receipt-readback",
];
const browserCheckIds = [
  "product-five-widths",
  "keyboard-skip-link",
  "cart-five-widths",
  "native-form-add-update-reload-unknown-total",
  "receipt-five-widths",
  "native-form-synthetic-checkout",
  "lead-five-widths",
  "native-form-synthetic-lead",
  "search-five-widths",
  "empty-search-five-widths",
];
function validChecks(rows: any, ids: string[], details: boolean) {
  need(Array.isArray(rows) && rows.length === ids.length, "CHECKSET_INVALID");
  const seen = unique<any>(rows, (r) => r.id, "CHECKSET_DUPLICATE");
  need(
    ids.every((id) => seen.has(id)),
    "CHECKSET_MISSING",
  );
  for (const r of rows)
    need(
      keys(r, details ? ["id", "status", "details"] : ["id", "status"]) &&
        r.status === "PASS" &&
        (!details ||
          (typeof r.details === "string" && r.details.length <= 4000)),
      "CHECK_NOT_PASS",
    );
}
function safeTarget(v: any) {
  return (
    typeof v === "string" &&
    v.length <= 8192 &&
    v.startsWith("/") &&
    !v.startsWith("//") &&
    !/[\x00-\x20#\\]/.test(v)
  );
}
export function validateNativeQaReceipts(
  m: NativeQaManifest,
  files: Partial<Record<Role, Buffer>>,
  b: Pick<
    ReturnType<typeof bind>,
    "entities" | "routes" | "assets" | "scope" | "snapshot"
  >,
) {
  validManifest(m);
  need(
    same(Object.keys(files).sort(), Object.keys(m.files).sort()),
    "RECEIPT_FILESET_MISMATCH",
  );
  for (const role of roles) {
    const bytes = files[role],
      ref = m.files[role];
    if (ref)
      need(
        Buffer.isBuffer(bytes) &&
          bytes.length === ref.size_bytes &&
          hash(bytes) === ref.sha256,
        "RECEIPT_BYTES_MISMATCH",
      );
  }
  const docs: any = {};
  for (const role of roles)
    if (files[role] && role !== "historical_events")
      docs[role] = parse(files[role]!);
  const checks: Record<string, string> = {
    facts: "NOT_RUN",
    counters: "NOT_RUN",
    routes: "NOT_RUN",
    media: "NOT_RUN",
    http_isolation: "NOT_RUN",
    snapshot_activation: "NOT_RUN",
    http_scenarios: "NOT_RUN",
    browser: "NOT_RUN",
    admin_edit: "NOT_RUN",
    transport: "NOT_RUN",
    current_restore: "NOT_RUN",
    internal_link_closure: "NOT_VERIFIED",
  };
  const missing: string[] = [];
  for (const role of ["facts_before", "facts_after"] as const) {
    const d = docs[role];
    if (!d) {
      missing.push(role);
      continue;
    }
    need(
      keys(d, [
        "scope",
        "pass",
        "manifest_sha256",
        "counts",
        "legacy_hw500_id",
        "facts",
        "full_readiness",
      ]) &&
        d.scope === "READ_ONLY_NATIVE_FACTS_AND_COUNTS" &&
        d.pass === true &&
        d.manifest_sha256 === m.package_manifest_sha256 &&
        d.full_readiness === "NOT_READY" &&
        d.legacy_hw500_id === 1,
      "FACTS_HEADER_INVALID",
    );
    const c = counters(d.counts);
    need(
      c.ug_entity === b.entities.length &&
        c.ug_route === b.routes.length &&
        c.b_sale_order === 0 &&
        c.b_event === 0,
      "FACTS_COUNTS_MISMATCH",
    );
    const facts = unique<any>(d.facts, (r) => r.entity_key, "FACTS_DUPLICATE");
    need(
      facts.size === b.entities.length &&
        new Set(d.facts.map((r: any) => r.bitrix_id)).size === facts.size,
      "FACTS_MEMBERSHIP",
    );
    // This admitted receipt is produced by verify-pilot-bitrix.php. Its legacy
    // identity and zero-side-effect predicate are part of that producer contract.
    const legacy = b.routes.filter(
      (r: any) => r.request_target === "/termoregulyatory/grand-meyer-hw-500",
    );
    need(
      legacy.length === 1 &&
        facts.get(legacy[0].entity_key)?.bitrix_id === d.legacy_hw500_id,
      "FACTS_LEGACY_IDENTITY_MISMATCH",
    );
    for (const e of b.entities) {
      const r = facts.get(e.stable_key),
        raw = factsBytes(e.facts ?? []);
      need(
        r &&
          keys(r, [
            "entity_key",
            "bitrix_id",
            "stored_bytes",
            "raw_bytes",
            "raw_sha256",
            "expected_sha256",
            "pass",
          ]) &&
          r.pass === true &&
          finiteInt(r.bitrix_id) &&
          r.bitrix_id > 0 &&
          finiteInt(r.stored_bytes, 65535) &&
          r.stored_bytes > 0 &&
          r.raw_bytes === raw.length &&
          r.raw_sha256 === hash(raw) &&
          r.expected_sha256 === hash(raw),
        "FACTS_PAYLOAD_MISMATCH",
      );
    }
  }
  if (docs.facts_before && docs.facts_after) {
    need(same(docs.facts_before, docs.facts_after), "FACTS_BEFORE_AFTER_DRIFT");
    checks.facts = checks.counters = "RECORDED_PASS";
  }
  const routeReceipt = docs.http_routes;
  if (routeReceipt) {
    need(
      keys(routeReceipt, [
        "scope",
        "created_at",
        "manifest_sha256",
        "known_url_count",
        "selected_url_count",
        "unresolved_url_count",
        "full_source_denominator",
        "readiness",
        "privacy_header_matrix",
        "routes",
        "assets",
        "isolation",
        "pass",
      ]) &&
        routeReceipt.scope ===
          "SELECTED_BITRIX_ROUTES_AND_VERIFIED_MEDIA_ONLY" &&
        routeReceipt.manifest_sha256 === m.package_manifest_sha256 &&
        routeReceipt.pass === true &&
        routeReceipt.full_source_denominator === "UNKNOWN" &&
        routeReceipt.readiness === "NOT_READY" &&
        routeReceipt.privacy_header_matrix === "NOT_RUN_BY_THIS_SCRIPT" &&
        Number.isFinite(Date.parse(routeReceipt.created_at)) &&
        Date.parse(routeReceipt.created_at) <=
          Date.parse(m.attestation.recorded_at),
      "HTTP_HEADER_INVALID",
    );
    for (const k of [
      "known_url_count",
      "selected_url_count",
      "unresolved_url_count",
    ])
      need(routeReceipt[k] === b.scope[k], "HTTP_SCOPE_MISMATCH");
    const routes = unique<any>(
      routeReceipt.routes,
      (r) => r.request_target,
      "HTTP_ROUTE_DUPLICATE",
    );
    need(routes.size === b.routes.length, "HTTP_ROUTE_MEMBERSHIP");
    const factualCounts = new Map(
      b.entities.map((entity: any) => {
        let count = 0;
        for (const block of entity.blocks) {
          if (
            [
              "paragraph",
              "heading",
              "quote",
              "link",
              "card",
              "document",
            ].includes(block.type) &&
            block.text
          )
            count++;
          if (["list", "card"].includes(block.type))
            count += (block.items ?? []).length;
          if (block.type === "table")
            for (const row of block.rows) count += row.length;
        }
        return [entity.stable_key, count];
      }),
    );
    for (const expected of b.routes) {
      const r = routes.get(expected.request_target);
      need(
        r &&
          keys(r, [
            "request_target",
            "status",
            "factual_texts_checked",
            "checks",
            "pass",
          ]) &&
          r.status === expected.expected_status &&
          r.status === 200 &&
          r.pass === true &&
          finiteInt(r.factual_texts_checked) &&
          r.factual_texts_checked === factualCounts.get(expected.entity_key) &&
          keys(r.checks, [
            "status",
            "h1",
            "entity",
            "facts",
            "noindex",
            "demo",
          ]) &&
          Object.values(r.checks).every((v) => v === true),
        "HTTP_ROUTE_FAILED",
      );
    }
    const assets = unique<any>(
        routeReceipt.assets,
        (r) => r.path,
        "HTTP_MEDIA_DUPLICATE",
      ),
      expectedAssets = new Map<string, string>();
    for (const a of b.assets) {
      need(
        !expectedAssets.has(a.public_path) ||
          expectedAssets.get(a.public_path) === a.sha256,
        "PACKAGE_MEDIA_COLLISION",
      );
      expectedAssets.set(a.public_path, a.sha256);
    }
    need(assets.size === expectedAssets.size, "HTTP_MEDIA_MEMBERSHIP");
    for (const [path, pin] of expectedAssets) {
      const a = assets.get(path);
      need(
        a &&
          keys(a, ["path", "status", "sha256", "pass"]) &&
          a.status === 200 &&
          a.pass === true &&
          a.sha256 === pin,
        "HTTP_MEDIA_FAILED",
      );
    }
    const isolation = [
      ["/", "GET", false, 401],
      ["/", "POST", true, 403],
      ["/bitrix/admin/", "GET", true, 404],
      ["/bitrix/license_key.php", "GET", true, 404],
      ["/local/upgrade-installer-resume.php", "GET", true, 404],
      ["/absent-upgrade-route", "GET", true, 404],
    ];
    need(
      Array.isArray(routeReceipt.isolation) &&
        routeReceipt.isolation.length === isolation.length &&
        routeReceipt.isolation.every(
          (r: any, i: number) =>
            keys(r, [
              "path",
              "method",
              "authenticated",
              "status",
              "expected",
              "pass",
            ]) &&
            same([r.path, r.method, r.authenticated, r.status], isolation[i]) &&
            r.expected === r.status &&
            r.pass === true,
        ),
      "HTTP_ISOLATION_FAILED",
    );
    checks.routes = checks.media = checks.http_isolation = "RECORDED_PASS";
  } else missing.push("http_routes");
  if (docs.activation) {
    const a = docs.activation;
    need(
      keys(a, [
        "status",
        "snapshot_id",
        "snapshot_file_sha256",
        "nginx_sha256",
        "nginx_test_exit",
        "http",
      ]) &&
        a.status === "ACTIVATED_AWAITING_HTTP" &&
        a.snapshot_id === m.snapshot.id &&
        a.snapshot_file_sha256 === m.snapshot.sha256 &&
        sha.test(a.nginx_sha256) &&
        a.nginx_test_exit === 0 &&
        a.http === "NOT_RUN",
      "ACTIVATION_INVALID",
    );
    checks.snapshot_activation = "RECORDED_PASS";
  } else missing.push("activation");
  if (docs.http_scenarios) {
    const s = docs.http_scenarios;
    need(
      keys(s, [
        "base_url",
        "browser_native_form_semantics",
        "checks",
        "elapsed_seconds",
        "error_code",
        "exchanges",
        "native_bitrix",
        "native_orders_mail_payments_database_counters",
        "network_egress_isolation",
        "product_route",
        "requests",
        "run_id",
        "schema_version",
        "snapshot_id",
        "source_coverage",
        "status",
        "unknown_write",
        "verifier_sha256",
      ]) &&
        s.schema_version === 1 &&
        s.status === "HTTP_SCENARIOS_VERIFIED" &&
        s.base_url === m.origin &&
        s.snapshot_id === m.snapshot.id &&
        s.unknown_write === false &&
        s.error_code === null &&
        sha.test(s.verifier_sha256) &&
        /^[a-f0-9]{32}$/.test(s.run_id) &&
        typeof s.elapsed_seconds === "number" &&
        Number.isFinite(s.elapsed_seconds) &&
        s.elapsed_seconds >= 0 &&
        s.elapsed_seconds <= 3600 &&
        b.routes.some((r: any) => r.request_target === s.product_route) &&
        s.browser_native_form_semantics === "NOT_RUN" &&
        s.native_bitrix === "NOT_ASSERTED_BY_HTTP_VERIFIER" &&
        s.native_orders_mail_payments_database_counters === "NOT_RUN" &&
        s.network_egress_isolation === "NOT_RUN" &&
        s.source_coverage === "NOT_RUN",
      "SCENARIOS_INVALID",
    );
    validChecks(s.checks, httpCheckIds, true);
    need(
      Array.isArray(s.exchanges) &&
        s.requests === s.exchanges.length &&
        s.requests === 29,
      "EXCHANGES_INVALID",
    );
    for (const [i, e] of s.exchanges.entries())
      need(
        keys(e, [
          "body_bytes",
          "body_sha256",
          "method",
          "request_target",
          "sequence",
          "status",
        ]) &&
          e.sequence === i + 1 &&
          sha.test(e.body_sha256) &&
          finiteInt(e.body_bytes, 16_000_000) &&
          safeTarget(e.request_target) &&
          ["GET", "POST"].includes(e.method) &&
          (e.method !== "POST" || e.request_target === "/__upgrade/action") &&
          [200, 303, 401, 403].includes(e.status),
        "EXCHANGE_INVALID",
      );
    need(
      s.exchanges.filter((e: any) => e.method === "POST" && e.status === 403)
        .length === 2 &&
        s.exchanges.filter((e: any) => e.method === "POST" && e.status === 303)
          .length === 7,
      "SYNTHETIC_POST_COUNTS_INVALID",
    );
    const sequence = [
      ["GET", 401],
      ["GET", 200],
      ["GET", 200],
      ["GET", 200],
      ["GET", 200],
      ["GET", 200],
      ["POST", 403],
      ["POST", 403],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["GET", 200],
      ["GET", 200],
      ["GET", 200],
      ["POST", 303],
      ["GET", 200],
      ["GET", 200],
      ["GET", 200],
    ];
    need(
      s.exchanges.every((e: any, i: number) =>
        same([e.method, e.status], sequence[i]),
      ) &&
        s.exchanges[5].request_target === s.product_route &&
        s.exchanges[17].request_target === s.product_route,
      "SCENARIO_SEQUENCE_INVALID",
    );
    const cart = /^\/__upgrade\/cart\?operation=[a-f0-9]{64}$/,
      receipt = /^\/__upgrade\/receipt\?operation=[a-f0-9]{64}$/;
    for (const i of [10, 12, 14, 16, 19])
      need(
        cart.test(s.exchanges[i].request_target),
        "SCENARIO_OPERATION_INVALID",
      );
    for (const i of [21, 22, 26, 27, 28])
      need(
        receipt.test(s.exchanges[i].request_target),
        "SCENARIO_RECEIPT_INVALID",
      );
    need(
      s.exchanges[10].request_target === s.exchanges[12].request_target &&
        [22, 28].every(
          (i) =>
            s.exchanges[i].request_target === s.exchanges[21].request_target &&
            s.exchanges[i].body_sha256 === s.exchanges[21].body_sha256 &&
            s.exchanges[i].body_bytes === s.exchanges[21].body_bytes,
        ) &&
        s.exchanges[26].request_target === s.exchanges[27].request_target &&
        s.exchanges[26].body_sha256 === s.exchanges[27].body_sha256 &&
        s.exchanges[26].body_bytes === s.exchanges[27].body_bytes,
      "SCENARIO_REPLAY_OR_READBACK_MISMATCH",
    );
    need(
      new Set(
        [10, 14, 16, 19, 21, 26].map(
          (i) => s.exchanges[i].request_target.split("?operation=")[1],
        ),
      ).size === 6,
      "SCENARIO_DISTINCT_OPERATION_REUSED",
    );
    if (docs.activation) checks.http_scenarios = "RECORDED_PASS";
  } else missing.push("http_scenarios");
  if (docs.browser) {
    const d = docs.browser;
    need(
      keys(d, [
        "status",
        "javaScriptEnabled",
        "origin",
        "checks",
        "requests",
        "exchanges",
        "native_db_side_effects",
        "full_source",
        "full_readiness",
      ]) &&
        d.status === "NATIVE_BROWSER_SCENARIOS_VERIFIED" &&
        d.javaScriptEnabled === false &&
        d.origin === m.origin &&
        d.native_db_side_effects === "SEPARATE_CHECK" &&
        d.full_source === "UNKNOWN" &&
        d.full_readiness === "NOT_READY" &&
        finiteInt(d.requests, 1000),
      "BROWSER_INVALID",
    );
    validChecks(d.checks, browserCheckIds, false);
    need(
      Array.isArray(d.exchanges) &&
        d.exchanges.length >= 10 &&
        d.exchanges.length <= 1000,
      "BROWSER_EXCHANGES_INVALID",
    );
    for (const e of d.exchanges)
      need(
        keys(e, ["method", "path", "status"]) &&
          safeTarget(e.path) &&
          ((e.method === "GET" && e.status === 200) ||
            (e.method === "POST" &&
              e.path === "/__upgrade/action" &&
              e.status === 303)),
        "BROWSER_EXCHANGE_INVALID",
      );
    need(
      d.exchanges.filter((e: any) => e.method === "POST").length === 4,
      "BROWSER_POST_COUNTS_INVALID",
    );
    if (docs.activation && docs.http_scenarios)
      checks.browser = "RECORDED_PASS";
  } else missing.push("browser");
  const historyRoles = [
    "historical_plan",
    "historical_intent",
    "historical_result",
    "historical_events",
  ] as const;
  let historical: any = {
    status: "NOT_RUN",
    current_package_restore: "NOT_RUN",
    private_session_restore: "NOT_RUN",
  };
  if (historyRoles.every((r) => files[r])) {
    const accepted = docs.historical_plan,
      intent = docs.historical_intent,
      r = docs.historical_result,
      p = accepted.plan,
      pin = hash(JSON.stringify(canonical(p)));
    need(
      keys(accepted, ["status", "plan", "plan_sha256"]) &&
        keys(intent, ["ownership_nonce", "plan", "plan_sha256"]) &&
        /^[a-f0-9]{64}$/.test(intent.ownership_nonce) &&
        keys(p, [
          "archive",
          "automatic_cleanup",
          "baseline",
          "baseline_sha256",
          "bridge",
          "clone_project",
          "clone_target",
          "config_pins",
          "configuration_derivation",
          "database_sha256",
          "destination",
          "executor_sha256",
          "files_sha256",
          "guard_sha256",
          "mode",
          "production_recovery",
          "projection",
          "receipt_sha256",
          "schema_version",
          "source_actions",
          "source_compose_sha256",
          "source_project",
          "source_root",
          "source_target",
          "subnet",
        ]) &&
        accepted.status === "PLAN_ONLY" &&
        accepted.plan_sha256 === pin &&
        intent.plan_sha256 === pin &&
        same(intent.plan, p) &&
        r.plan_sha256 === pin &&
        p.schema_version === 1 &&
        p.mode === "NEW_ISOLATED_SQL_AND_FILES_COPY" &&
        p.source_project === m.project_id &&
        p.source_target === m.target_id &&
        p.clone_project !== m.project_id &&
        p.clone_target !== m.target_id &&
        p.automatic_cleanup === false &&
        p.production_recovery === "NOT_RUN" &&
        sha.test(p.database_sha256) &&
        sha.test(p.files_sha256) &&
        p.source_actions === "READ_ONLY",
      "HISTORICAL_PLAN_INVALID",
    );
    need(
      keys(r, [
        "cleanup",
        "configuration_derivation",
        "database_import",
        "database_readback",
        "external_packet_capture",
        "files_readback_scope",
        "files_restore",
        "http_smoke",
        "mail_disabled",
        "orders_events_counts_unchanged",
        "original_site_modified",
        "plan_sha256",
        "production_recovery",
        "source_runtime_unchanged",
        "status",
      ]) &&
        r.status === "ISOLATED_COPY_RESTORED_AND_SMOKE_VERIFIED" &&
        [
          "database_import",
          "database_readback",
          "files_restore",
          "http_smoke",
          "mail_disabled",
          "orders_events_counts_unchanged",
          "source_runtime_unchanged",
        ].every((k) => r[k] === "PASS") &&
        r.original_site_modified === false &&
        ["production_recovery", "external_packet_capture", "cleanup"].every(
          (k) => r[k] === "NOT_RUN",
        ),
      "HISTORICAL_RESULT_INVALID",
    );
    const eventText = files.historical_events!.toString("utf8");
    need(
      Buffer.from(eventText).equals(files.historical_events!),
      "HISTORICAL_UTF8_INVALID",
    );
    const events = eventText
      .trim()
      .split(/\r?\n/)
      .map((line) => parse(Buffer.from(line)));
    need(
      events.length > 0 &&
        events.length <= 2000 &&
        events.at(-1).stage === "FINAL_READBACK",
      "HISTORICAL_EVENTS_INVALID",
    );
    const base = counters(p.baseline.database_counts),
      end = events.at(-1);
    need(
      p.baseline.project_id === m.project_id &&
        p.baseline.target_id === m.target_id &&
        p.destination !== p.source_root &&
        typeof p.destination === "string" &&
        p.destination.startsWith("/") &&
        p.projection.network !== p.projection.source_network &&
        p.projection.compose?.name === p.clone_project,
      "HISTORICAL_ISOLATION_BINDING",
    );
    for (const service of Object.values(
      p.projection.compose.services,
    ) as any[]) {
      need(
        !service.ports?.length &&
          !service.network_mode &&
          !service.privileged &&
          Array.isArray(service.volumes) &&
          service.volumes.every((v: any) =>
            v.type === "volume"
              ? v.source === "database"
              : v.type === "bind" &&
                typeof v.source === "string" &&
                v.source.startsWith(p.destination + "/") &&
                !v.source.split("/").includes(".."),
          ),
        "HISTORICAL_ISOLATION_BINDING",
      );
    }
    need(
      p.projection.compose.volumes?.database?.name ===
        p.clone_project + "-database",
      "HISTORICAL_VOLUME_BINDING",
    );
    for (let i = 0; i < events.length; i++)
      need(
        typeof events[i].at === "string" &&
          Number.isFinite(Date.parse(events[i].at)) &&
          Date.parse(events[i].at) <= Date.parse(m.attestation.recorded_at) &&
          (i === 0 || Date.parse(events[i].at) >= Date.parse(events[i - 1].at)),
        "HISTORICAL_TIMELINE_INVALID",
      );
    const find = (stage: string) => events.filter((e) => e.stage === stage),
      one = (stage: string) => {
        const rows = find(stage);
        need(rows.length === 1, "HISTORICAL_REQUIRED_EVENT");
        return rows[0];
      };
    const transition = (stage: string, rows = find(stage), polling = false) => {
      need(
        rows.length === 2 &&
          keys(rows[0], ["at", "stage", "status"]) &&
          rows[0].status === "STARTED" &&
          keys(rows[1], [
            "at",
            "stage",
            "exit_code",
            "stdout_sha256",
            "stderr_sha256",
          ]) &&
          finiteInt(rows[1].exit_code, 255) &&
          (polling || rows[1].exit_code === 0) &&
          sha.test(rows[1].stdout_sha256) &&
          sha.test(rows[1].stderr_sha256),
        "HISTORICAL_COMMAND_TRANSITION_INVALID",
      );
      const start = events.indexOf(rows[0]),
        end = events.indexOf(rows[1]);
      need(start < end, "HISTORICAL_STAGE_ORDER");
      return { start, end, exit: rows[1].exit_code };
    };
    const guardDb = transition("GUARD_CHECK_BEFORE_DB"),
      dbStart = transition("DB_START"),
      sqlImport = transition("SQL_IMPORT"),
      guardPhp = transition("GUARD_CHECK_BEFORE_PHP"),
      runtimeProbe = transition("PRE_CMS_RUNTIME_PROBE"),
      webStart = transition("WEB_START"),
      guardFinal = transition("GUARD_CHECK_FINAL");
    const readyRows = find("DB_READY");
    need(
      readyRows.length >= 2 &&
        readyRows.length <= 240 &&
        readyRows.length % 2 === 0,
      "HISTORICAL_DATABASE_READY_INVALID",
    );
    let readyEnd = dbStart.end;
    for (let i = 0; i < readyRows.length; i += 2) {
      const attempt = transition("DB_READY", readyRows.slice(i, i + 2), true);
      need(
        readyEnd < attempt.start &&
          attempt.end < sqlImport.start &&
          (i + 2 === readyRows.length
            ? attempt.exit === 0
            : attempt.exit !== 0),
        "HISTORICAL_DATABASE_READY_INVALID",
      );
      readyEnd = attempt.end;
    }
    need(
      one("DATABASE_READBACK").status === "PASS" &&
        same(one("DATABASE_READBACK").counts, base),
      "HISTORICAL_DATABASE_READBACK",
    );
    const probe = one("PRE_CMS_ISOLATION");
    need(
      probe.status === "PASS" &&
        probe.external_packet_capture === "NOT_RUN" &&
        probe.evidence.own_db_connected === true &&
        probe.evidence.source_db_connected === false &&
        probe.evidence.external_dns_failed === true &&
        probe.evidence.prepend_active === true &&
        probe.evidence.prepend_sha256 === p.baseline.php_prepend_sha256 &&
        probe.evidence.allow_url_fopen === false &&
        keys(probe.evidence.disabled, [
          "exec",
          "mail",
          "passthru",
          "popen",
          "proc_open",
          "shell_exec",
          "system",
        ]) &&
        Object.values(probe.evidence.disabled).every((v) => v === true),
      "HISTORICAL_PRE_CMS_ISOLATION",
    );
    const stages = events.map((e) => e.stage);
    need(
      guardDb.end < dbStart.start &&
        dbStart.end < sqlImport.start &&
        sqlImport.end < events.indexOf(one("DATABASE_READBACK")) &&
        events.indexOf(one("DATABASE_READBACK")) < guardPhp.start &&
        guardPhp.end < runtimeProbe.start &&
        runtimeProbe.end < events.indexOf(probe) &&
        events.indexOf(probe) < webStart.start &&
        webStart.end < events.indexOf(one("UNAUTHENTICATED_HTTP")) &&
        events.indexOf(one("UNAUTHENTICATED_HTTP")) < guardFinal.start &&
        webStart.end < guardFinal.start &&
        guardFinal.end < events.indexOf(end),
      "HISTORICAL_STAGE_ORDER",
    );
    const filesRead = one("FILES_READBACK"),
      derived = one("SETTINGS_DERIVATION");
    need(
      filesRead.status === "PASS" &&
        filesRead.entries === p.archive.entries &&
        filesRead.expanded_bytes === p.archive.expanded_bytes &&
        filesRead.entry_ledger_sha256 === p.archive.entry_ledger_sha256 &&
        derived.status === "PASS" &&
        derived.path === p.configuration_derivation.path &&
        derived.path === "bitrix/.settings.php" &&
        derived.host_after === "db" &&
        p.configuration_derivation.allowed_original_hosts.includes(
          derived.host_before,
        ) &&
        derived.receipt_sha256 === r.configuration_derivation.receipt_sha256 &&
        stages.indexOf("FILES_READBACK") <
          stages.indexOf("SETTINGS_DERIVATION") &&
        stages.indexOf("SETTINGS_DERIVATION") < guardDb.start,
      "HISTORICAL_FILE_DERIVATION",
    );
    need(
      one("UNAUTHENTICATED_HTTP").http_status === 401 &&
        one("UNAUTHENTICATED_HTTP").status === "PASS",
      "HISTORICAL_AUTH_PROBE",
    );
    const http = find("AUTHENTICATED_HTTP");
    need(
      http.length === p.baseline.http.length &&
        http.every(
          (e: any, i: number) =>
            e.status === "PASS" &&
            events.indexOf(e) > webStart.end &&
            events.indexOf(e) < guardFinal.start &&
            e.request_target === p.baseline.http[i].request_target &&
            e.http_status === p.baseline.http[i].status &&
            sha.test(e.body_sha256),
        ),
      "HISTORICAL_HTTP_PROBE",
    );
    need(
      end.status === "PASS" &&
        same(end.counts, base) &&
        end.source_runtime_unchanged === true,
      "HISTORICAL_READBACK_INVALID",
    );
    historical = {
      status: "RECORDED_HISTORICAL_RESTORE",
      plan_sha256: pin,
      database_sha256: p.database_sha256,
      files_sha256: p.files_sha256,
      counts: base,
      current_package_restore: "NOT_RUN",
      private_session_restore: "NOT_RUN",
      production_recovery: "NOT_RUN",
      external_packet_capture: "NOT_RUN",
    };
  } else if (historyRoles.some((r) => files[r]))
    missing.push(...historyRoles.filter((r) => !files[r]));
  const plannedTargets = new Set(b.routes.map((r: any) => r.request_target));
  let links = 0,
    uncovered = 0;
  const missingTargets = new Set<string>();
  for (const entity of b.entities)
    for (const block of entity.blocks ?? [])
      if (
        (block.type === "link" || block.type === "card") &&
        typeof block.request_target === "string"
      ) {
        links++;
        if (!plannedTargets.has(block.request_target)) {
          uncovered++;
          missingTargets.add(block.request_target);
        }
      }
  const allMissing = [...missingTargets].sort(),
    sample: string[] = [];
  let sampleBytes = 0;
  for (const target of allMissing) {
    const size = Buffer.byteLength(target);
    if (sample.length === 100 || sampleBytes + size > 24576) break;
    sample.push(target);
    sampleBytes += size;
  }
  const internalLinks = {
    status: uncovered ? "PARTIAL" : "NOT_VERIFIED",
    scope: "EXACT_PACKAGE_LINK_AND_CARD_TARGET_MEMBERSHIP_ONLY",
    total_links: links,
    uncovered_links: uncovered,
    unique_uncovered_count: missingTargets.size,
    uncovered_targets: sample,
    uncovered_targets_sha256: hash(JSON.stringify(allMissing)),
    uncovered_targets_truncated: sample.length !== allMissing.length,
    query_policy: "PRESERVE_EXACT",
    http_click_verification: "NOT_RUN",
  };
  return {
    checks,
    historical_restore: historical,
    missing_receipts: missing,
    counts: docs.facts_after?.counts ?? null,
    source_scope: {
      known_urls: b.scope.known_url_count,
      selected_urls: b.scope.selected_url_count,
      unresolved_urls: b.scope.unresolved_url_count,
      full_source_denominator: "UNKNOWN",
    },
    media_count: routeReceipt?.assets.length ?? null,
    internal_link_closure: internalLinks,
    browser_binding: docs.browser
      ? "OPERATOR_ATTESTED_COHORT_ORIGIN_ONLY"
      : "NOT_RUN",
    screenshots: "NOT_VISUALLY_REVIEWED_BY_INGESTION",
    privacy_header_matrix: "NOT_RUN",
    native_target_current_state: "NOT_RECHECKED",
    readiness: "NOT_READY",
  };
}
function result(
  m: NativeQaManifest,
  b: ReturnType<typeof bind>,
  files: Partial<Record<Role, Buffer>>,
  pin: string,
) {
  return {
    schema_version: 1,
    kind: "recorded-native-qa",
    state: "RECORDED_NATIVE_QA",
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
    trust_boundary: "OPERATOR_ATTESTED_COPIED_NATIVE_RECEIPTS",
    ...validateNativeQaReceipts(m, files, b),
  };
}
const type = (pin: string, role: Role | "manifest") =>
  `native-qa-${pin}-${role}.json`;
function committed(store: Store, r: NativeQaRecord) {
  need(
    r.schema_version === 1 &&
      r.state === "COMMITTED" &&
      sha.test(r.manifest_sha256) &&
      r.id ===
        hash(
          JSON.stringify([
            "native-qa-v1",
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
          "native-qa-result.json",
          262144,
        ),
      ),
      expected,
    ),
    "RESULT_MISMATCH",
  );
  return expected;
}
export function readNativeQaEvidence(
  store: Store,
  verifiedBuildIds: ReadonlySet<string>,
  currentBuildId: string | null,
) {
  return store.list<NativeQaRecord>("native_qa_evidence").map((r) => {
    try {
      need(verifiedBuildIds.has(r.build_record_id), "BUILD_NOT_VERIFIED");
      const stored = store.get<NativeQaRecord>("native_qa_evidence", r.id);
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
          e instanceof Error ? e.message : "Native QA validation failed",
        ],
      };
    }
  });
}
export async function ingestNativeQaEvidence(
  store: Store,
  options: {
    buildId: string;
    directory: string;
    expectedManifestSha256: string;
  },
) {
  const run = store.currentRun(),
    owner = `native-qa:${process.pid}:${uid("op")}`;
  store.acquireDispatcher(run.run_id, owner);
  const guard = () => {
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
        "native-qa.json",
        options.expectedManifestSha256,
        131072,
      ),
      m = parse(bytes);
    validManifest(m);
    need(m.build_record_id === options.buildId, "BUILD_ARGUMENT_MISMATCH");
    const expected = new Set([
      "native-qa.json",
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
        "native-qa-v1",
        m.project_id,
        m.target_id,
        m.build_record_id,
        options.expectedManifestSha256,
      ]),
    );
    let record: NativeQaRecord | undefined;
    try {
      record = store.get<NativeQaRecord>("native_qa_evidence", id);
    } catch (e) {
      if (
        !(e instanceof UpgradeError) ||
        e.message !== `native_qa_evidence not found: ${id}`
      )
        throw e;
    }
    const intent: NativeQaRecord = {
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
        store.put("native_qa_evidence", id, record);
        store.event(
          "native_qa.pending",
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
    fenced(() => store.put("native_qa_evidence", id, record));
    for (const role of roles)
      if (files[role]) {
        await nextTurn();
        record.file_artifact_ids[role] = save(
          type(options.expectedManifestSha256, role),
          files[role]!,
          record.file_artifact_ids[role],
        );
        fenced(() => store.put("native_qa_evidence", id, record));
      }
    record.result_artifact_id = save(
      "native-qa-result.json",
      Buffer.from(json(output)),
      record.result_artifact_id,
    );
    renew();
    record.state = "COMMITTED";
    fenced(() => {
      store.put("native_qa_evidence", id, record);
      store.event(
        "native_qa.committed",
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
