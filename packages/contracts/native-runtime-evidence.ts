/** Offline copied-receipt contracts. A valid bundle is not live attestation or readiness. */
import { createHash } from "node:crypto";

export const nativeRuntimeCaps = {
  browser: 2_000_000,
  facts_before: 8_000_000,
  facts_after: 8_000_000,
  transport: 65_536,
  guard: 65_536,
  runtime_configuration: 65_536,
  runtime_compose: 4_000_000,
  current_plan: 32_000_000,
  current_result: 1_000_000,
  current_events: 16_000_000,
  current_state_ledger: 16_000_000,
} as const;
export type NativeRuntimeRole = keyof typeof nativeRuntimeCaps;
export type NativeRuntimeRef = { artifact_id: string; sha256: string };
export interface NativeRuntimeManifest {
  schema_version: 1;
  kind: "native-runtime-evidence";
  project_id: string;
  target_id: string;
  build_record_id: string;
  model_record_id: string;
  build_artifact: NativeRuntimeRef;
  model_artifact: NativeRuntimeRef;
  route_artifact: NativeRuntimeRef;
  scope_artifact: NativeRuntimeRef;
  target_evidence: {
    record_id: string;
    result_artifact_id: string;
    sha256: string;
  };
  package_manifest_sha256: string;
  snapshot: { id: string; sha256: string };
  origin: string;
  attestation: { kind: "operator-copied-native-receipts"; recorded_at: string };
  code_pins: Partial<
    Record<
      | "browser_verifier"
      | "transport"
      | "prepend"
      | "guard"
      | "current_restore_executor"
      | "backup_helper"
      | "historical_helper",
      string
    >
  >;
  files: Partial<
    Record<
      NativeRuntimeRole,
      { relative_path: string; sha256: string; size_bytes: number }
    >
  >;
}
export interface NativeRuntimeRecord {
  schema_version: 1;
  id: string;
  state: "PENDING" | "COMMITTED";
  project_id: string;
  target_id: string;
  build_record_id: string;
  manifest_sha256: string;
  manifest_artifact_id?: string;
  file_artifact_ids: Partial<Record<NativeRuntimeRole, string>>;
  result_artifact_id?: string;
}
export interface NativeRuntimePackageData {
  entities: any[];
  routes: any[];
  assets: any[];
  scope: any;
  snapshot: any;
  manifest: any;
}
export class NativeRuntimeEvidenceError extends Error {
  code: string;
  constructor(code: string) {
    super("NATIVE_RUNTIME_" + code);
    this.name = "NativeRuntimeEvidenceError";
    this.code = code;
  }
}
const sha = /^[a-f0-9]{64}$/;
const digest = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const need: (value: unknown, code: string) => asserts value = (v, c) => {
  if (!v) throw new NativeRuntimeEvidenceError(c);
};
const object = (v: any) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: any, names: string[]) =>
  object(v) &&
  Object.keys(v).length === names.length &&
  names.every((k) => Object.hasOwn(v, k));
const int = (v: any, max = 1_000_000_000_000) =>
  Number.isSafeInteger(v) && v >= 0 && v <= max;
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a: any, b: any) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const relative = (v: any) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 240 &&
  !/[\\:\x00-\x1f]/.test(v) &&
  !v.startsWith("/") &&
  v.split("/").every((p) => p !== "" && p !== "." && p !== "..");
const target = (v: any) =>
  typeof v === "string" &&
  v.startsWith("/") &&
  !v.startsWith("//") &&
  v.length <= 8192 &&
  !/[\\#\x00-\x20\x7f]/.test(v);
function noSecrets(v: any) {
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    need(
      !/^(password|cookie|cookies|csrf|authorization|checkpoint|session_token|idempotency_key|PHPSESSID|upgrade_demo_session|MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD)$/i.test(
        k,
      ),
      "PRIVATE_SECRET_FIELD_FORBIDDEN",
    );
    noSecrets(x);
  }
}
export function parseNativeRuntimeJson(bytes: Uint8Array): any {
  const b = Buffer.from(bytes),
    text = b.toString("utf8");
  need(Buffer.from(text).equals(b), "UTF8_INVALID");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NativeRuntimeEvidenceError("JSON_INVALID");
  }
  const stack: Array<Set<string> | null> = [];
  for (const t of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    if (t[0] === "{") stack.push(new Set());
    else if (t[0] === "[") stack.push(null);
    else if (t[0] === "}" || t[0] === "]") stack.pop();
    else if (/^\s*:/.test(text.slice(t.index! + t[0].length))) {
      const k = JSON.parse(t[0]),
        s = stack.at(-1);
      need(s && !s.has(k), "DUPLICATE_JSON_KEY");
      s.add(k);
    }
    need(stack.length <= 80, "JSON_DEPTH_LIMIT");
  }
  return value;
}
export function validateNativeRuntimeManifest(
  m: any,
): asserts m is NativeRuntimeManifest {
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
      "code_pins",
      "files",
    ]) &&
      m.schema_version === 1 &&
      m.kind === "native-runtime-evidence",
    "MANIFEST_INVALID",
  );
  need(
    [m.project_id, m.target_id].every(
      (x) => typeof x === "string" && /^[a-z0-9][a-z0-9-]{0,80}$/.test(x),
    ),
    "IDENTITY_INVALID",
  );
  need(
    [m.build_record_id, m.model_record_id, m.package_manifest_sha256].every(
      (x) => typeof x === "string" && sha.test(x),
    ),
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
        /^art-[a-z0-9-]{1,100}$/.test(ref.artifact_id) &&
        sha.test(ref.sha256),
      "ARTIFACT_REF_INVALID",
    );
  need(
    keys(m.target_evidence, ["record_id", "result_artifact_id", "sha256"]) &&
      sha.test(m.target_evidence.record_id) &&
      /^art-[a-z0-9-]{1,100}$/.test(m.target_evidence.result_artifact_id) &&
      sha.test(m.target_evidence.sha256),
    "TARGET_REF_INVALID",
  );
  need(
    keys(m.snapshot, ["id", "sha256"]) &&
      sha.test(m.snapshot.id) &&
      sha.test(m.snapshot.sha256),
    "SNAPSHOT_REF_INVALID",
  );
  let url;
  try {
    url = new URL(m.origin);
  } catch {
    throw new NativeRuntimeEvidenceError("ORIGIN_INVALID");
  }
  need(
    url.protocol === "https:" &&
      url.origin === m.origin &&
      !url.username &&
      !url.password &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "HTTPS_ORIGIN_REQUIRED",
  );
  need(
    keys(m.attestation, ["kind", "recorded_at"]) &&
      m.attestation.kind === "operator-copied-native-receipts" &&
      typeof m.attestation.recorded_at === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(m.attestation.recorded_at) &&
      Number.isFinite(Date.parse(m.attestation.recorded_at)),
    "ATTESTATION_INVALID",
  );
  const pins = [
    "browser_verifier",
    "transport",
    "prepend",
    "guard",
    "current_restore_executor",
    "backup_helper",
    "historical_helper",
  ];
  need(
    object(m.code_pins) &&
      Object.entries(m.code_pins).every(
        ([k, v]) => pins.includes(k) && typeof v === "string" && sha.test(v),
      ),
    "CODE_PINS_INVALID",
  );
  need(
    object(m.files) &&
      Object.keys(m.files).length > 0 &&
      Object.keys(m.files).every((k) => Object.hasOwn(nativeRuntimeCaps, k)),
    "FILESET_INVALID",
  );
  const paths = new Set<string>();
  let total = 0;
  for (const [r, f] of Object.entries(m.files) as [NativeRuntimeRole, any][]) {
    need(
      keys(f, ["relative_path", "sha256", "size_bytes"]) &&
        relative(f.relative_path) &&
        f.relative_path !== "native-runtime-evidence.json" &&
        !paths.has(f.relative_path) &&
        sha.test(f.sha256) &&
        int(f.size_bytes, nativeRuntimeCaps[r]) &&
        f.size_bytes > 0,
      "FILE_REF_INVALID",
    );
    paths.add(f.relative_path);
    total += f.size_bytes;
  }
  need(total <= 64_000_000, "BUNDLE_LIMIT");
}
function phpValue(v: any): any {
  if (Array.isArray(v)) return v.map(phpValue);
  if (object(v)) {
    const e = Object.entries(v);
    return e.every(([k], i) => k === String(i))
      ? e.map(([, x]) => phpValue(x))
      : Object.fromEntries(e.map(([k, x]) => [k, phpValue(x)]));
  }
  return v;
}
const factBytes = (v: any) =>
  Buffer.from(
    JSON.stringify(phpValue(v))
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029"),
  );
const countKeys = [
  "ug_entity",
  "ug_route",
  "ug_operation",
  "b_sale_order",
  "b_event",
  "b_user",
];
function counts(c: any, b: NativeRuntimePackageData) {
  need(
    keys(c, countKeys) &&
      Object.values(c).every((x) => int(x)) &&
      c.ug_entity === b.entities.length &&
      c.ug_route === b.routes.length &&
      c.b_sale_order === 0 &&
      c.b_event === 0,
    "COUNTS_INVALID",
  );
}
const widths = [360, 390, 768, 1024, 1440];
export function validateNativeRuntimeReceipts(
  m: NativeRuntimeManifest,
  files: Partial<Record<NativeRuntimeRole, Buffer>>,
  b: NativeRuntimePackageData,
) {
  validateNativeRuntimeManifest(m);
  need(
    same(Object.keys(files).sort(), Object.keys(m.files).sort()),
    "RECEIPT_FILESET_MISMATCH",
  );
  const d: any = {};
  for (const [role, ref] of Object.entries(m.files) as [
    NativeRuntimeRole,
    NonNullable<NativeRuntimeManifest["files"][NativeRuntimeRole]>,
  ][]) {
    const bytes = files[role];
    need(
      Buffer.isBuffer(bytes) &&
        bytes.length === ref.size_bytes &&
        digest(bytes) === ref.sha256,
      "RECEIPT_PIN_MISMATCH",
    );
    if (role !== "current_events") {
      d[role] = parseNativeRuntimeJson(bytes);
      noSecrets(d[role]);
    }
  }
  need(
    Array.isArray(b.entities) &&
      Array.isArray(b.routes) &&
      Array.isArray(b.assets) &&
      Array.isArray(b.snapshot?.items) &&
      b.entities.length <= 10000 &&
      b.routes.length <= 10000,
    "PACKAGE_DATA_INVALID",
  );
  need(
    b.manifest.project_id === m.project_id &&
      b.manifest.files?.["data/demo-snapshot.json"] === m.snapshot.sha256 &&
      b.snapshot.project_id === m.project_id &&
      b.snapshot.snapshot_id === m.snapshot.id &&
      digest(
        JSON.stringify({
          schema_version: b.snapshot.schema_version,
          project_id: b.snapshot.project_id,
          items: b.snapshot.items,
        }),
      ) === m.snapshot.id,
    "SNAPSHOT_BINDING_INVALID",
  );
  const planned = new Set(b.routes.map((r) => r.request_target));
  need(
    planned.size === b.routes.length &&
      b.routes.every((r) => target(r.request_target)) &&
      b.snapshot.items.length === b.entities.length &&
      b.snapshot.items.every((i: any) => planned.has(i.request_target)),
    "PACKAGE_MEMBERSHIP_INVALID",
  );
  const checks = {
    browser: "NOT_RUN",
    database_unchanged: "NOT_RUN",
    transport: "NOT_RUN",
    current_restore: "NOT_RUN",
  };
  const missing: string[] = [];
  for (const role of ["facts_before", "facts_after"] as const)
    if (d[role]) {
      const f = d[role];
      need(
        keys(f, [
          "scope",
          "pass",
          "manifest_sha256",
          "counts",
          "facts",
          "full_readiness",
          ...(Object.hasOwn(f, "legacy_hw500_id") ? ["legacy_hw500_id"] : []),
        ]) &&
          (!Object.hasOwn(f, "legacy_hw500_id") ||
            (int(f.legacy_hw500_id) && f.legacy_hw500_id > 0)) &&
          f.scope === "READ_ONLY_NATIVE_FACTS_AND_COUNTS" &&
          f.pass === true &&
          f.manifest_sha256 === m.package_manifest_sha256 &&
          f.full_readiness === "NOT_READY",
        "FACTS_BINDING_INVALID",
      );
      counts(f.counts, b);
      need(
        Array.isArray(f.facts) && f.facts.length === b.entities.length,
        "FACTS_MEMBERSHIP_INVALID",
      );
      const rows = new Map<string, any>();
      const ids = new Set();
      for (const r of f.facts) {
        need(
          sha.test(r.entity_key) &&
            !rows.has(r.entity_key) &&
            int(r.bitrix_id) &&
            r.bitrix_id > 0 &&
            !ids.has(r.bitrix_id),
          "FACTS_DUPLICATE",
        );
        rows.set(r.entity_key, r);
        ids.add(r.bitrix_id);
      }
      for (const e of b.entities) {
        const r = rows.get(e.stable_key),
          raw = factBytes(e.facts ?? []);
        need(
          keys(r, [
            "entity_key",
            "bitrix_id",
            "stored_bytes",
            "raw_bytes",
            "raw_sha256",
            "expected_sha256",
            "pass",
          ]) &&
            r?.pass === true &&
            r.raw_sha256 === digest(raw) &&
            r.expected_sha256 === digest(raw) &&
            r.raw_bytes === raw.length &&
            int(r.stored_bytes, 65535) &&
            r.stored_bytes > 0,
          "FACTS_BYTES_MISMATCH",
        );
      }
    }
  if (d.facts_before && d.facts_after) {
    need(same(d.facts_before, d.facts_after), "FACTS_DRIFT");
    checks.database_unchanged = "PASS";
  } else missing.push(...["facts_before", "facts_after"].filter((r) => !d[r]));
  if (d.browser) {
    const r = d.browser,
      x = r.binding;
    need(
      keys(r, [
        "schema_version",
        "status",
        "binding",
        "java_script_enabled",
        "checks",
        "counters",
        "exchanges",
        "operations",
        "screenshots",
        "native_bitrix",
        "native_db_side_effects",
        "full_source",
        "full_readiness",
      ]) &&
        r.schema_version === 1 &&
        r.status === "BROWSER_SCENARIOS_VERIFIED" &&
        r.java_script_enabled === false &&
        r.native_bitrix === "CALLER_ATTESTATION_REQUIRED" &&
        r.native_db_side_effects === "NOT_RUN_SEPARATE_READBACK_REQUIRED" &&
        r.full_source === "UNKNOWN" &&
        r.full_readiness === "NOT_READY",
      "BROWSER_HEADER_INVALID",
    );
    need(
      keys(x, [
        "schema_version",
        "verifier_sha256",
        "snapshot_sha256",
        "snapshot_id",
        "project_id",
        "origin",
        "user",
        "product_route",
        "local_only",
      ]) &&
        x.schema_version === 1 &&
        x.project_id === m.project_id &&
        x.origin === m.origin &&
        x.snapshot_id === m.snapshot.id &&
        x.snapshot_sha256 === m.snapshot.sha256 &&
        x.verifier_sha256 === m.code_pins.browser_verifier &&
        sha.test(x.verifier_sha256) &&
        x.local_only === false &&
        typeof x.user === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(x.user) &&
        b.snapshot.items.some(
          (i: any) =>
            i.request_target === x.product_route && i.page_kind === "PRODUCT",
        ),
      "BROWSER_BINDING_INVALID",
    );
    const c = r.counters;
    need(
      keys(c, [
        "cdp_request_intercepts",
        "browser_requests",
        "browser_responses",
        "mediated_fetches",
        "response_bytes",
        "blocked",
      ]) &&
        [
          c.cdp_request_intercepts,
          c.browser_requests,
          c.browser_responses,
          c.mediated_fetches,
        ].every((n) => int(n, 220) && n > 0) &&
        c.cdp_request_intercepts === c.browser_requests &&
        c.browser_requests === c.browser_responses &&
        c.browser_responses === c.mediated_fetches &&
        int(c.response_bytes, 100 * 1024 * 1024) &&
        c.response_bytes > 0 &&
        c.blocked === 0,
      "BROWSER_COUNTERS_INVALID",
    );
    need(
      Array.isArray(r.exchanges) &&
        r.exchanges.length === c.browser_responses &&
        Array.isArray(r.operations) &&
        r.operations.length === 4,
      "BROWSER_COHORT_INVALID",
    );
    const actions: Record<string, string> = {
      "cart-add": "cart.add",
      "cart-update": "cart.update",
      checkout: "demo.checkout",
      lead: "demo.lead",
    };
    const ids = new Set();
    for (const op of r.operations) {
      const path = op.action?.startsWith("cart.") ? "cart" : "receipt";
      need(
        keys(op, ["name", "action", "operation_id", "status", "location"]) &&
          actions[op.name] === op.action &&
          op.status === "CONFIRMED" &&
          sha.test(op.operation_id) &&
          !ids.has(op.operation_id) &&
          op.location === `/__upgrade/${path}?operation=${op.operation_id}`,
        "BROWSER_OPERATION_INVALID",
      );
      ids.add(op.operation_id);
    }
    need(
      new Set(r.operations.map((o: any) => o.name)).size === 4,
      "BROWSER_OPERATION_DUPLICATE",
    );
    need(
      same(
        r.operations.map((o: any) => o.name),
        ["cart-add", "cart-update", "checkout", "lead"],
      ),
      "BROWSER_OPERATION_ORDER",
    );
    let posts = 0;
    const seen = new Set<string>();
    const pending = [...r.operations];
    for (const e of r.exchanges) {
      need(
        keys(e, ["method", "request_target", "status"]) &&
          target(e.request_target),
        "BROWSER_EXCHANGE_INVALID",
      );
      if (e.method === "POST") {
        need(
          e.request_target === "/__upgrade/action" &&
            e.status === 303 &&
            posts < 4,
          "BROWSER_POST_INVALID",
        );
        posts++;
      } else {
        need(
          e.method === "GET" && e.status === 200,
          "BROWSER_RESPONSE_INVALID",
        );
        const u = new URL(e.request_target, m.origin);
        let allowed =
          planned.has(e.request_target) ||
          e.request_target === "/local/templates/upgrade/styles.css" ||
          b.assets.some(
            (a) =>
              e.request_target === a.public_path &&
              a.public_path.startsWith(`/upload/upgrade/${m.project_id}/`) &&
              sha.test(a.sha256),
          );
        if (u.pathname === "/__upgrade/search") {
          const pairs = [...u.searchParams];
          allowed =
            pairs.length <= 24 &&
            new Set(pairs.map(([k]) => k)).size === pairs.length &&
            pairs.every(
              ([k, v]) =>
                /^(q|sort|category|page|a(?:[0-9]|1[0-9]))$/.test(k) &&
                v.length <= 256,
            );
        }
        if (["/__upgrade/cart", "/__upgrade/lead"].includes(e.request_target))
          allowed = true;
        if (r.operations.some((op: any) => op.location === e.request_target)) {
          allowed = true;
          const index = r.operations.findIndex(
            (op: any) => op.location === e.request_target,
          );
          need(index < posts, "BROWSER_READBACK_BEFORE_WRITE");
          pending[index] = null;
        }
        need(allowed, "BROWSER_FOREIGN_TARGET");
        seen.add(e.request_target);
      }
    }
    need(
      posts === 4 && pending.every((v) => v === null),
      "BROWSER_MISSING_READBACK",
    );
    const required = [
      "home-responsive",
      "content-responsive",
      "category-responsive",
      "product-responsive",
      "keyboard-skip-link",
      "cart-responsive",
      "cart-add-update-reload",
      "receipt-responsive",
      "synthetic-checkout-receipt",
      "lead-responsive",
      "synthetic-lead-receipt",
      "search-responsive",
      "empty-search-responsive",
      "search-empty-filter-sort",
    ];
    need(
      Array.isArray(r.checks) &&
        r.checks.length === required.length &&
        new Set(r.checks.map((v: any) => v.id)).size === required.length,
      "BROWSER_CHECKSET_INVALID",
    );
    for (const id of required) {
      const q = r.checks.find((v: any) => v.id === id);
      need(q && keys(q, ["id", "status", "details"]), "BROWSER_CHECK_MISSING");
      const kind = (
        {
          "home-responsive": "HOME",
          "content-responsive": "CONTENT",
          "category-responsive": "CATEGORY",
        } as Record<string, string>
      )[id];
      if (kind && !b.snapshot.items.some((i: any) => i.page_kind === kind))
        need(q.status === "NOT_APPLICABLE", "BROWSER_FALSE_APPLICABILITY");
      else {
        need(q.status === "PASS", "BROWSER_CHECK_FAILED");
        if (id.endsWith("-responsive"))
          need(
            same(q.details.widths, widths) && q.details.viewport_only === true,
            "BROWSER_WIDTHS_INVALID",
          );
      }
      if (kind) {
        const item = b.snapshot.items.find((i: any) => i.page_kind === kind);
        if (item)
          need(seen.has(item.request_target), "BROWSER_KIND_NOT_VISITED");
      }
    }
    const detail = (id: string) =>
      r.checks.find((q: any) => q.id === id).details;
    need(
      detail("cart-add-update-reload").exact_quantities_checked === true &&
        detail("cart-add-update-reload").distinct_update === true &&
        detail("synthetic-checkout-receipt").exact_visible_receipt_reload ===
          true &&
        detail("synthetic-lead-receipt").synthetic_identity_only === true &&
        detail("search-empty-filter-sort").sort === "title_asc" &&
        detail("search-empty-filter-sort").exact_first_page_targets === true &&
        detail("search-empty-filter-sort").result_membership ===
          "caller-pinned snapshot",
      "BROWSER_DETAILS_INVALID",
    );
    need(
      same(r.screenshots, { widths, height: 1000, viewport_only: true }) &&
        seen.has(x.product_route) &&
        [...seen].some(
          (t) =>
            t.startsWith("/__upgrade/search?") &&
            new URL(t, m.origin).searchParams.has("q"),
        ) &&
        [...seen].some(
          (t) =>
            t.startsWith("/__upgrade/search?") &&
            new URL(t, m.origin).searchParams.get("sort") === "title_asc",
        ),
      "BROWSER_SCENARIO_INCOMPLETE",
    );
    checks.browser = "PASS";
  } else missing.push("browser");
  const t = d.transport,
    g = d.guard,
    config = d.runtime_configuration;
  if (t) {
    need(
      t.schema_version === 1 &&
        t.status === "CHECKS_PASSED" &&
        t.project_id === m.project_id &&
        t.target_id === m.target_id &&
        t.execution_scope === "CLI_CMS_CONTEXT_PROBE" &&
        t.effective_uid === 33 &&
        t.cms_bootstrap_attempted === true &&
        t.cms_bootstrap_completed === true &&
        same(t.context, {
          query_count: 0,
          post_count: 0,
          cookie_count: 0,
          method: "GET",
          uri: "/local/upgrade-route.php",
        }) &&
        t.transport_sha256 === m.code_pins.transport &&
        t.transport_sha256 ===
          b.manifest.files["code/module/upgrade.core/lib/demotransport.php"] &&
        t.prepend_sha256 === m.code_pins.prepend &&
        sha.test(t.prepend_sha256) &&
        sha.test(t.prolog_sha256),
      "TRANSPORT_BINDING_INVALID",
    );
    need(
      same(t.own_request, {
        get_target_sha256: digest(
          "/__upgrade/cart?bx_hit_hash=synthetic_probe&x=1&x=2&empty=&encoded=%2F",
        ),
        post_target_sha256: digest("/__upgrade/action"),
        post_body_sha256: digest(
          "AUTH_FORM=Y&TYPE=REGISTRATION&USER_LOGIN=synthetic_transport_probe&csrf=synthetic_only",
        ),
        exact_preserved: true,
      }) &&
        keys(t.counts, ["b_user", "b_sale_order", "b_event"]) &&
        int(t.counts.b_user) &&
        t.counts.b_sale_order === 0 &&
        t.counts.b_event === 0 &&
        t.counts_status === "READ_ONLY_SNAPSHOT" &&
        t.before_after_comparison === "NOT_PERFORMED" &&
        t.native_deployment_attestation === "REQUIRED_SEPARATELY" &&
        t.readiness === "NOT_EVALUATED",
      "TRANSPORT_CONTEXT_INVALID",
    );
    if (d.facts_after)
      need(
        t.counts.b_user === d.facts_after.counts.b_user,
        "TRANSPORT_COUNTER_COHORT_MISMATCH",
      );
  }
  if (g)
    need(
      g.status === "PASS" &&
        g.command === "isolate-network check" &&
        g.script_sha256 === m.code_pins.guard &&
        sha.test(g.script_sha256) &&
        g.marker?.project === m.project_id &&
        g.marker.network === `upgrade-${m.project_id}-isolated` &&
        typeof g.marker.bridge === "string" &&
        g.marker.bridge.length <= 15 &&
        typeof g.marker.subnet === "string" &&
        g.returncode === 0 &&
        sha.test(g.stdout_sha256) &&
        g.stderr_sha256 === digest(""),
      "GUARD_INVALID",
    );
  if (config)
    need(
      keys(config, [
        "schema_version",
        "project_id",
        "target_id",
        "package_manifest_sha256",
        "origin",
        "prepend_sha256",
        "guard_sha256",
        "transport_sha256",
        "configuration_sha256",
      ]) &&
        config.schema_version === 1 &&
        config.project_id === m.project_id &&
        config.target_id === m.target_id &&
        config.package_manifest_sha256 === m.package_manifest_sha256 &&
        config.origin === m.origin &&
        config.prepend_sha256 === m.code_pins.prepend &&
        config.guard_sha256 === m.code_pins.guard &&
        config.transport_sha256 ===
          b.manifest.files["code/module/upgrade.core/lib/demotransport.php"] &&
        sha.test(config.configuration_sha256),
      "RUNTIME_CONFIGURATION_INVALID",
    );
  if (config && d.runtime_compose)
    need(
      config.configuration_sha256 === m.files.runtime_compose!.sha256 &&
        d.runtime_compose.services?.php?.environment?.UPGRADE_PROJECT_ID ===
          m.project_id &&
        d.runtime_compose.services.php.environment.UPGRADE_TARGET_ID ===
          m.target_id,
      "RUNTIME_COMPOSE_BINDING",
    );
  if (t && g && config && d.runtime_compose) checks.transport = "PASS";
  else
    missing.push(
      ...[
        "transport",
        "guard",
        "runtime_configuration",
        "runtime_compose",
      ].filter((r) => !d[r]),
    );
  const restore = validateCurrentRestore(m, files, d, b);
  checks.current_restore = restore.status;
  missing.push(...restore.missing);
  return {
    checks,
    missing_receipts: missing,
    source_scope: {
      known_urls: b.scope.known_url_count,
      selected_urls: b.scope.selected_url_count,
      unresolved_urls: b.scope.unresolved_url_count,
      full_source_denominator: "UNKNOWN",
    },
    current_restore: restore.details,
    native_target_current_state: "NOT_RECHECKED",
    trust_boundary: "OPERATOR_ATTESTED_COPIED_NATIVE_RECEIPTS",
    screenshots: "NOT_VISUALLY_REVIEWED_BY_INGESTION",
    code_review_approval: "NOT_ASSERTED",
    readiness: "NOT_READY",
  };
}

function validateCurrentRestore(
  m: NativeRuntimeManifest,
  files: Partial<Record<NativeRuntimeRole, Buffer>>,
  d: any,
  b: NativeRuntimePackageData,
) {
  const group = [
    "current_plan",
    "current_result",
    "current_events",
    "current_state_ledger",
  ] as const;
  const missing = group.filter((k) => !files[k]);
  if (missing.length) return { status: "NOT_RUN", missing, details: null };
  const envelope = d.current_plan,
    p = envelope?.plan ?? envelope,
    r = d.current_result;
  const planPin = digest(JSON.stringify(canonical(p))); // Python canonical uses UTF-8, sorted keys, compact separators.
  need(
    p.schema_version === 1 &&
      p.mode === "NEW_ISOLATED_CURRENT_RUNTIME_COPY" &&
      p.source_project === m.project_id &&
      p.source_target === m.target_id &&
      p.clone_target === m.target_id &&
      p.clone_project !== m.project_id &&
      p.application_identity_policy ===
        "RETAIN_SOURCE_PROJECT_TARGET_FOR_PRIVATE_STATE_ONLY" &&
      p.native_journal_policy === "AUDIT_ONLY_NOT_MOUNTED_OR_ACTIVATED" &&
      p.source_actions === "READ_ONLY_NO_STOP_NO_SQL" &&
      p.http_actions === "GET_ONLY_NO_REPLAY" &&
      p.production_recovery === "NOT_RUN" &&
      p.automatic_cleanup === false,
    "CURRENT_PLAN_INVALID",
  );
  if (envelope.plan)
    need(
      envelope.status === "PLAN_ONLY" && envelope.plan_sha256 === planPin,
      "CURRENT_PLAN_PIN_INVALID",
    );
  for (const [field, pin] of [
    ["executor_sha256", "current_restore_executor"],
    ["backup_helper_sha256", "backup_helper"],
    ["historical_helper_sha256", "historical_helper"],
    ["guard_sha256", "guard"],
  ] as const)
    need(
      sha.test(p[field]) && p[field] === m.code_pins[pin],
      "CURRENT_CODE_BINDING",
    );
  need(
    typeof p.source_root === "string" &&
      typeof p.destination === "string" &&
      p.destination.startsWith("/opt/upgrade/recovery/") &&
      !p.destination.includes("/../") &&
      !p.destination.startsWith(p.source_root + "/") &&
      p.destination !== p.source_root &&
      p.baseline?.project_id === m.project_id &&
      p.baseline?.target_id === m.target_id &&
      p.baseline.trusted_host === new URL(m.origin).host,
    "CURRENT_TARGET_BINDING",
  );
  counts(
    Object.fromEntries(
      countKeys.map((k) => [k, p.baseline.database_counts?.[k]]),
    ),
    b,
  );
  const active = p.backup_manifest?.active_snapshot,
    retained = p.baseline.current_state?.retained_receipt;
  need(
    p.backup_manifest?.project_id === m.project_id &&
      p.backup_manifest.target_id === m.target_id &&
      p.backup_manifest.scope ===
        "SQL_CMS_ALL_PRIVATE_STATE_ALL_NATIVE_JOURNAL" &&
      same(p.backup_manifest.exclusions, []) &&
      active?.sha256 === m.snapshot.sha256 &&
      active.snapshot_id === m.snapshot.id &&
      same(active, p.baseline.current_state.active_snapshot),
    "CURRENT_SNAPSHOT_BINDING",
  );
  need(
    retained &&
      [
        "cookie_sha256",
        "operation_id",
        "response_sha256",
        "http_body_sha256",
      ].every((k) => sha.test(retained[k])) &&
      typeof retained.cookie_file === "string",
    "CURRENT_RETAINED_RECEIPT_REQUIRED",
  );
  const trees = ["cms_root", "state_root", "native_journal_dir"];
  need(
    keys(p.backup_manifest.outputs, [...trees, "database"]),
    "CURRENT_BACKUP_INCOMPLETE",
  );
  for (const tree of trees) {
    const x = p.backup_manifest.outputs[tree];
    need(
      sha.test(x.sha256) &&
        sha.test(x.ledger_sha256) &&
        int(x.entries) &&
        x.entries > 0 &&
        int(x.raw_bytes),
      "CURRENT_TREE_INVALID",
    );
  }
  const ledger = d.current_state_ledger;
  need(
    m.files.current_state_ledger!.sha256 ===
      p.backup_manifest.outputs.state_root.ledger_sha256 &&
      digest(JSON.stringify(canonical(ledger))) ===
        p.backup_manifest.outputs.state_root.ledger_sha256 &&
      ledger.schema_version === 1 &&
      ledger.root === p.backup_profile.state_root &&
      Array.isArray(ledger.entries) &&
      ledger.entries.length === p.backup_manifest.outputs.state_root.entries &&
      ledger.entries.length <= 100000,
    "CURRENT_STATE_LEDGER_BINDING",
  );
  const paths = new Map<string, any>();
  let rawSize = 0;
  for (const row of ledger.entries) {
    need(
      relative(row.path) &&
        !paths.has(row.path) &&
        ["file", "directory"].includes(row.type) &&
        int(row.mode, 4095) &&
        int(row.uid) &&
        int(row.gid),
      "CURRENT_LEDGER_ROW_INVALID",
    );
    if (row.type === "file") {
      need(
        sha.test(row.sha256) && int(row.size),
        "CURRENT_LEDGER_FILE_INVALID",
      );
      rawSize += row.size;
    }
    paths.set(row.path, row);
  }
  for (const row of paths.values()) {
    const parents = row.path.split("/");
    parents.pop();
    while (parents.length) {
      need(
        paths.get(parents.join("/"))?.type === "directory",
        "CURRENT_LEDGER_PARENT_INVALID",
      );
      parents.pop();
    }
  }
  need(
    rawSize === p.backup_manifest.outputs.state_root.raw_bytes &&
      relative(active.relative_path) &&
      active.relative_path.endsWith("/data/demo-snapshot.json"),
    "CURRENT_LEDGER_TOTAL",
  );
  const packagePath =
    active.relative_path.slice(0, -"data/demo-snapshot.json".length) +
    "manifest.json";
  need(
    paths.get(packagePath)?.sha256 === m.package_manifest_sha256 &&
      paths.get(active.relative_path)?.sha256 === m.snapshot.sha256,
    "CURRENT_PACKAGE_LEDGER_BINDING",
  );
  need(
    r.status === "ISOLATED_CURRENT_COPY_RESTORED_AND_SMOKE_VERIFIED" &&
      r.plan_sha256 === planPin &&
      [
        "database_import",
        "database_readback",
        "cms_restore",
        "private_state_restore",
        "active_snapshot_readback",
        "retained_receipt_http",
        "http_smoke",
        "source_runtime_unchanged",
      ].every((k) => r[k] === "PASS") &&
      r.native_journal_restore === "AUDIT_ONLY_BYTES_VERIFIED_NOT_ACTIVATED" &&
      r.source_stop_or_sql === false &&
      r.external_packet_capture === "NOT_RUN" &&
      r.production_recovery === "NOT_RUN" &&
      r.automatic_cleanup === false,
    "CURRENT_RESULT_INVALID",
  );
  const lines = files.current_events!.toString("utf8").trimEnd().split("\n");
  need(lines.length > 0 && lines.length <= 2000, "CURRENT_EVENTS_LIMIT");
  need(
    Buffer.from(files.current_events!.toString("utf8")).equals(
      files.current_events!,
    ),
    "CURRENT_EVENTS_UTF8_INVALID",
  );
  const events = lines.map((l) => parseNativeRuntimeJson(Buffer.from(l)));
  noSecrets(events);
  const one = (name: string) => {
    const found = events.filter(
      (e) => e.stage === name && e.status !== "STARTED",
    );
    need(found.length === 1, "CURRENT_EVENT_" + name);
    return found[0];
  };
  const index = (name: string) => events.indexOf(one(name));
  for (const e of events)
    need(
      typeof e.stage === "string" &&
        Number.isFinite(Date.parse(e.at)) &&
        !["UNKNOWN_TIMEOUT", "FAILED", "ERROR"].includes(e.status) &&
        (e.exit_code === undefined ||
          e.exit_code === 0 ||
          ["DB_READY", "NEW_VOLUME_CHECK", "NEW_NETWORK_CHECK"].includes(
            e.stage,
          )),
      "CURRENT_EVENT_FAILED",
    );
  const privateRead = one("PRIVATE_STATE_READBACK"),
    final = one("FINAL_READBACK"),
    db = one("DATABASE_READBACK"),
    isolate = one("PRE_CMS_ISOLATION"),
    receipt = one("RETAINED_RECEIPT_HTTP");
  need(
    privateRead.status === "PASS" &&
      same(privateRead.active_snapshot, active) &&
      privateRead.retained_receipt === "VERIFIED_BYTES" &&
      final.status === "PASS" &&
      final.source_runtime_unchanged === true &&
      same(final.active_snapshot, active) &&
      same(final.counts, p.baseline.database_counts) &&
      db.status === "PASS" &&
      same(db.counts, final.counts),
    "CURRENT_READBACK_INVALID",
  );
  if (d.facts_after)
    need(
      countKeys.every((k) => final.counts[k] === d.facts_after.counts[k]),
      "CURRENT_COUNTER_COHORT_MISMATCH",
    );
  const probe = isolate.evidence;
  need(
    isolate.status === "PASS" &&
      isolate.source_db_host_positive === true &&
      isolate.external_packet_capture === "NOT_RUN" &&
      probe?.prepend_active === true &&
      probe.prepend_sha256 === m.code_pins.prepend &&
      probe.allow_url_fopen === false &&
      probe.own_db_connected === true &&
      probe.source_db_connected === false &&
      probe.external_dns_failed === true &&
      [
        "mail",
        "exec",
        "passthru",
        "shell_exec",
        "system",
        "popen",
        "proc_open",
      ].every((k) => probe.disabled?.[k] === true),
    "CURRENT_ISOLATION_INVALID",
  );
  need(
    receipt.status === "PASS" &&
      receipt.method === "GET" &&
      receipt.session_unchanged === true &&
      receipt.operation_id === retained.operation_id &&
      receipt.response_sha256 === retained.response_sha256 &&
      receipt.http_body_sha256 === retained.http_body_sha256 &&
      int(receipt.bytes, 4 * 1024 * 1024) &&
      receipt.bytes > 0,
    "CURRENT_RETAINED_RECEIPT_INVALID",
  );
  for (const tree of trees) {
    const rows = events.filter(
      (e) => e.stage === "CURRENT_TREE_READBACK" && e.tree === tree,
    );
    const expected = p.backup_manifest.outputs[tree];
    need(
      rows.length === 1 &&
        rows[0].status === "PASS" &&
        rows[0].entries === expected.entries &&
        rows[0].expanded_bytes === expected.raw_bytes &&
        rows[0].ledger_sha256 === expected.ledger_sha256 &&
        rows[0].archive_sha256 === expected.sha256 &&
        same(
          r.all_trees_before_bootstrap[tree],
          Object.fromEntries(
            Object.entries(rows[0]).filter(
              ([k]) => !["stage", "at", "status", "tree"].includes(k),
            ),
          ),
        ),
      "CURRENT_TREE_READBACK_INVALID",
    );
  }
  for (const name of [
    "GUARD_CHECK_BEFORE_DB",
    "GUARD_CHECK_BEFORE_PHP",
    "GUARD_CHECK_FINAL",
  ])
    need(one(name).exit_code === 0, "CURRENT_GUARD_FAILED");
  const inspections = events.filter(
    (e) => e.stage === "SOURCE_INSPECT" && e.exit_code !== undefined,
  );
  need(
    inspections.length === 2 &&
      inspections.every(
        (e) =>
          e.exit_code === 0 &&
          sha.test(e.stdout_sha256) &&
          sha.test(e.stderr_sha256),
      ) &&
      events.indexOf(inspections[0]) < index("PRIVATE_STATE_READBACK") &&
      events.indexOf(inspections[1]) > index("RETAINED_RECEIPT_HTTP"),
    "CURRENT_SOURCE_INSPECTION_REQUIRED",
  );
  need(
    one("SQL_IMPORT").exit_code === 0 &&
      index("GUARD_CHECK_BEFORE_DB") < index("SQL_IMPORT") &&
      index("SQL_IMPORT") < index("DATABASE_READBACK"),
    "CURRENT_SQL_IMPORT_ORDER",
  );
  const unauth = one("UNAUTHENTICATED_HTTP");
  need(
    unauth.status === "PASS" && unauth.http_status === 401,
    "CURRENT_AUTH_NOT_ENFORCED",
  );
  need(
    Array.isArray(p.baseline.http) &&
      p.baseline.http.length > 0 &&
      p.baseline.http.length <= 20,
    "CURRENT_HTTP_BASELINE_INVALID",
  );
  const httpEvents = events.filter((e) => e.stage === "AUTHENTICATED_HTTP");
  need(httpEvents.length === p.baseline.http.length, "CURRENT_HTTP_MEMBERSHIP");
  for (const expected of p.baseline.http) {
    const matches = httpEvents.filter(
      (e) => e.request_target === expected.request_target,
    );
    need(
      matches.length === 1 &&
        target(expected.request_target) &&
        matches[0].status === "PASS" &&
        matches[0].http_status === expected.status &&
        sha.test(matches[0].body_sha256) &&
        (!expected.body_sha256 ||
          expected.body_sha256 === matches[0].body_sha256) &&
        index("PRE_CMS_ISOLATION") < events.indexOf(matches[0]),
      "CURRENT_HTTP_MISMATCH",
    );
  }
  need(
    index("PRIVATE_STATE_READBACK") < index("GUARD_CHECK_BEFORE_DB") &&
      index("GUARD_CHECK_BEFORE_DB") < index("DATABASE_READBACK") &&
      index("DATABASE_READBACK") < index("GUARD_CHECK_BEFORE_PHP") &&
      index("GUARD_CHECK_BEFORE_PHP") < index("PRE_CMS_ISOLATION") &&
      index("PRE_CMS_ISOLATION") < index("RETAINED_RECEIPT_HTTP") &&
      index("RETAINED_RECEIPT_HTTP") < index("GUARD_CHECK_FINAL") &&
      index("GUARD_CHECK_FINAL") < index("FINAL_READBACK"),
    "CURRENT_EVENT_ORDER_INVALID",
  );
  return {
    status: "PASS",
    missing: [],
    details: {
      plan_sha256: planPin,
      scope: "ISOLATED_CURRENT_PRIVATE_COPY",
      snapshot: m.snapshot,
      retained_operation_id: retained.operation_id,
      native_journal: "AUDIT_ONLY_NOT_ACTIVATED",
      production_recovery: "NOT_RUN",
      packet_capture: "NOT_RUN",
    },
  };
}
