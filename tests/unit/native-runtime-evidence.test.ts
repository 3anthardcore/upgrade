import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  validateNativeRuntimeReceipts,
  validateNativeRuntimeManifest,
  parseNativeRuntimeJson,
} from "../../packages/contracts/native-runtime-evidence.ts";
import type {
  NativeRuntimeManifest,
  NativeRuntimePackageData,
} from "../../packages/contracts/native-runtime-evidence.ts";
const hash = (v: string | Buffer) =>
    createHash("sha256").update(v).digest("hex"),
  json = (v: any) => JSON.stringify(v, null, 2) + "\n";
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
function fixture() {
  const entity = {
    source_id: "entity-one",
    stable_key: hash("stable-one"),
    facts: [],
  };
  const snapshot: any = {
    schema_version: 1,
    project_id: "generic-pilot",
    items: [
      {
        id: entity.source_id,
        request_target: "/product?x=&x=2",
        page_kind: "PRODUCT",
      },
    ],
  };
  snapshot.snapshot_id = hash(JSON.stringify(snapshot));
  const packageData: NativeRuntimePackageData = {
    entities: [entity],
    routes: [
      {
        request_target: snapshot.items[0].request_target,
        entity_key: entity.stable_key,
      },
    ],
    assets: [],
    scope: {
      known_url_count: 3,
      selected_url_count: 1,
      unresolved_url_count: 2,
    },
    snapshot,
    manifest: {
      project_id: "generic-pilot",
      files: {
        "data/demo-snapshot.json": hash(json(snapshot)),
        "code/module/upgrade.core/lib/demotransport.php": hash("transport"),
      },
    },
  };
  const ref = { artifact_id: "art-fixture", sha256: hash("artifact") };
  const manifest: NativeRuntimeManifest = {
    schema_version: 1,
    kind: "native-runtime-evidence",
    project_id: "generic-pilot",
    target_id: "isolated-demo",
    build_record_id: hash("build"),
    model_record_id: hash("model"),
    build_artifact: ref,
    model_artifact: ref,
    route_artifact: ref,
    scope_artifact: ref,
    target_evidence: {
      record_id: hash("import"),
      result_artifact_id: "art-target",
      sha256: hash("target"),
    },
    package_manifest_sha256: hash("package"),
    snapshot: { id: snapshot.snapshot_id, sha256: hash(json(snapshot)) },
    origin: "https://demo.example",
    attestation: {
      kind: "operator-copied-native-receipts",
      recorded_at: "2026-09-30T09:00:00.000Z",
    },
    code_pins: {
      browser_verifier: hash("browser"),
      transport: hash("transport"),
      prepend: hash("prepend"),
      guard: hash("guard"),
      current_restore_executor: hash("restore"),
      backup_helper: hash("backup"),
      historical_helper: hash("historical"),
    },
    files: {},
  };
  const widths = [360, 390, 768, 1024, 1440],
    operations = [
      ["cart-add", "cart.add"],
      ["cart-update", "cart.update"],
      ["checkout", "demo.checkout"],
      ["lead", "demo.lead"],
    ].map(([name, action]) => ({
      name,
      action,
      operation_id: hash(name),
      status: "CONFIRMED",
      location: `/__upgrade/${action.startsWith("cart.") ? "cart" : "receipt"}?operation=${hash(name)}`,
    }));
  const exchanges = [
    {
      method: "GET",
      request_target: snapshot.items[0].request_target,
      status: 200,
    },
    ...operations.flatMap((o) => [
      { method: "POST", request_target: "/__upgrade/action", status: 303 },
      { method: "GET", request_target: o.location, status: 200 },
    ]),
    { method: "GET", request_target: "/__upgrade/search?q=empty", status: 200 },
    {
      method: "GET",
      request_target: "/__upgrade/search?sort=title_asc",
      status: 200,
    },
  ];
  const checks: any[] = [
    "home",
    "content",
    "category",
    "product",
    "cart",
    "receipt",
    "lead",
    "search",
    "empty-search",
  ].map((name) => ({
    id: name + "-responsive",
    status: ["home", "content", "category"].includes(name)
      ? "NOT_APPLICABLE"
      : "PASS",
    details: { widths, viewport_only: true },
  }));
  for (const [id, details] of Object.entries({
    "keyboard-skip-link": "Native Tab/Enter checked",
    "cart-add-update-reload": {
      exact_quantities_checked: true,
      distinct_update: true,
    },
    "synthetic-checkout-receipt": { exact_visible_receipt_reload: true },
    "synthetic-lead-receipt": { synthetic_identity_only: true },
    "search-empty-filter-sort": {
      sort: "title_asc",
      exact_first_page_targets: true,
      result_membership: "caller-pinned snapshot",
    },
  }))
    checks.push({ id, status: "PASS", details });
  const docs: any = {
    browser: {
      schema_version: 1,
      status: "BROWSER_SCENARIOS_VERIFIED",
      binding: {
        schema_version: 1,
        verifier_sha256: manifest.code_pins.browser_verifier,
        snapshot_sha256: manifest.snapshot.sha256,
        snapshot_id: manifest.snapshot.id,
        project_id: manifest.project_id,
        origin: manifest.origin,
        user: "upgrade",
        product_route: snapshot.items[0].request_target,
        local_only: false,
      },
      java_script_enabled: false,
      checks,
      counters: {
        cdp_request_intercepts: exchanges.length,
        browser_requests: exchanges.length,
        browser_responses: exchanges.length,
        mediated_fetches: exchanges.length,
        response_bytes: 1000,
        blocked: 0,
      },
      exchanges,
      operations,
      screenshots: { widths, height: 1000, viewport_only: true },
      native_bitrix: "CALLER_ATTESTATION_REQUIRED",
      native_db_side_effects: "NOT_RUN_SEPARATE_READBACK_REQUIRED",
      full_source: "UNKNOWN",
      full_readiness: "NOT_READY",
    },
  };
  const counts = {
    ug_entity: 1,
    ug_route: 1,
    ug_operation: 3,
    b_sale_order: 0,
    b_event: 0,
    b_user: 1,
  };
  docs.facts_before = {
    scope: "READ_ONLY_NATIVE_FACTS_AND_COUNTS",
    pass: true,
    manifest_sha256: manifest.package_manifest_sha256,
    counts,
    facts: [
      {
        entity_key: entity.stable_key,
        bitrix_id: 10,
        stored_bytes: 2,
        raw_bytes: 2,
        raw_sha256: hash("[]"),
        expected_sha256: hash("[]"),
        pass: true,
      },
    ],
    full_readiness: "NOT_READY",
  };
  docs.facts_after = structuredClone(docs.facts_before);
  docs.transport = {
    schema_version: 1,
    status: "CHECKS_PASSED",
    project_id: manifest.project_id,
    target_id: manifest.target_id,
    execution_scope: "CLI_CMS_CONTEXT_PROBE",
    effective_uid: 33,
    transport_sha256: manifest.code_pins.transport,
    prepend_sha256: manifest.code_pins.prepend,
    prolog_sha256: hash("vendor-prolog"),
    cms_bootstrap_attempted: true,
    cms_bootstrap_completed: true,
    context: {
      query_count: 0,
      post_count: 0,
      cookie_count: 0,
      method: "GET",
      uri: "/local/upgrade-route.php",
    },
    own_request: {
      get_target_sha256: hash(
        "/__upgrade/cart?bx_hit_hash=synthetic_probe&x=1&x=2&empty=&encoded=%2F",
      ),
      post_target_sha256: hash("/__upgrade/action"),
      post_body_sha256: hash(
        "AUTH_FORM=Y&TYPE=REGISTRATION&USER_LOGIN=synthetic_transport_probe&csrf=synthetic_only",
      ),
      exact_preserved: true,
    },
    counts: { b_user: 1, b_sale_order: 0, b_event: 0 },
    counts_status: "READ_ONLY_SNAPSHOT",
    before_after_comparison: "NOT_PERFORMED",
    native_deployment_attestation: "REQUIRED_SEPARATELY",
    readiness: "NOT_EVALUATED",
  };
  docs.guard = {
    status: "PASS",
    command: "isolate-network check",
    script_sha256: manifest.code_pins.guard,
    marker: {
      project: manifest.project_id,
      network: `upgrade-${manifest.project_id}-isolated`,
      bridge: "br-demo",
      subnet: "172.30.50.0/24",
    },
    returncode: 0,
    stdout_sha256: hash("guard passed"),
    stderr_sha256: hash(""),
  };
  docs.runtime_compose = {
    services: {
      php: {
        environment: {
          UPGRADE_PROJECT_ID: manifest.project_id,
          UPGRADE_TARGET_ID: manifest.target_id,
        },
      },
    },
  };
  docs.runtime_configuration = {
    schema_version: 1,
    project_id: manifest.project_id,
    target_id: manifest.target_id,
    package_manifest_sha256: manifest.package_manifest_sha256,
    origin: manifest.origin,
    prepend_sha256: manifest.code_pins.prepend,
    guard_sha256: manifest.code_pins.guard,
    transport_sha256: manifest.code_pins.transport,
    configuration_sha256: hash(json(docs.runtime_compose)),
  };
  const validate = () => {
    const files: any = {};
    manifest.files = {};
    for (const [role, doc] of Object.entries(docs)) {
      const bytes = Buffer.from(
        role === "current_events"
          ? (doc as any[]).map((d) => JSON.stringify(d)).join("\n") + "\n"
          : role === "current_state_ledger"
            ? JSON.stringify(canonical(doc))
            : json(doc),
      );
      files[role] = bytes;
      (manifest.files as any)[role] = {
        relative_path: role + (role === "current_events" ? ".jsonl" : ".json"),
        sha256: hash(bytes),
        size_bytes: bytes.length,
      };
    }
    return validateNativeRuntimeReceipts(manifest, files, packageData);
  };
  return { manifest, packageData, docs, validate, counts };
}
function addRestore(f: ReturnType<typeof fixture>) {
  const m = f.manifest,
    active = {
      relative_path: "release/data/demo-snapshot.json",
      sha256: m.snapshot.sha256,
      snapshot_id: m.snapshot.id,
    };
  const entries = [
    { path: "release", type: "directory", mode: 448, uid: 33, gid: 33 },
    { path: "release/data", type: "directory", mode: 448, uid: 33, gid: 33 },
    {
      path: "release/manifest.json",
      type: "file",
      mode: 256,
      uid: 33,
      gid: 33,
      size: 10,
      sha256: m.package_manifest_sha256,
    },
    {
      path: active.relative_path,
      type: "file",
      mode: 256,
      uid: 33,
      gid: 33,
      size: 20,
      sha256: m.snapshot.sha256,
    },
  ];
  const ledger = {
    schema_version: 1,
    root: "/source/state",
    root_metadata: { mode: 448, uid: 33, gid: 33 },
    entries,
  };
  const tree = {
    sha256: hash("archive"),
    ledger_sha256: hash(JSON.stringify(canonical(ledger))),
    entries: 4,
    raw_bytes: 30,
  };
  const outputs = {
    cms_root: { ...tree },
    state_root: { ...tree },
    native_journal_dir: { ...tree },
    database: { sha256: hash("sql") },
  };
  const retained = {
    cookie_file: "/private/cookie",
    cookie_sha256: hash("private-cookie-not-in-bundle"),
    operation_id: hash("operation"),
    response_sha256: hash("retained-response"),
    http_body_sha256: hash("exact-body"),
  };
  const p: any = {
    schema_version: 1,
    mode: "NEW_ISOLATED_CURRENT_RUNTIME_COPY",
    source_project: m.project_id,
    source_target: m.target_id,
    clone_target: m.target_id,
    clone_project: "copy-demo",
    source_root: "/source",
    destination: "/opt/upgrade/recovery/new-copy",
    application_identity_policy:
      "RETAIN_SOURCE_PROJECT_TARGET_FOR_PRIVATE_STATE_ONLY",
    native_journal_policy: "AUDIT_ONLY_NOT_MOUNTED_OR_ACTIVATED",
    source_actions: "READ_ONLY_NO_STOP_NO_SQL",
    http_actions: "GET_ONLY_NO_REPLAY",
    production_recovery: "NOT_RUN",
    automatic_cleanup: false,
    executor_sha256: m.code_pins.current_restore_executor,
    backup_helper_sha256: m.code_pins.backup_helper,
    historical_helper_sha256: m.code_pins.historical_helper,
    guard_sha256: m.code_pins.guard,
    baseline: {
      project_id: m.project_id,
      target_id: m.target_id,
      trusted_host: "demo.example",
      database_counts: f.counts,
      current_state: { active_snapshot: active, retained_receipt: retained },
    },
    backup_profile: { state_root: "/source/state" },
    backup_manifest: {
      project_id: m.project_id,
      target_id: m.target_id,
      scope: "SQL_CMS_ALL_PRIVATE_STATE_ALL_NATIVE_JOURNAL",
      exclusions: [],
      active_snapshot: active,
      outputs,
    },
  };
  const readbacks = Object.fromEntries(
    Object.entries(outputs)
      .filter(([k]) => k !== "database")
      .map(([k, v]: any) => [
        k,
        {
          entries: v.entries,
          expanded_bytes: v.raw_bytes,
          archive_sha256: v.sha256,
          ledger_sha256: v.ledger_sha256,
          file_readback_ledger_sha256: hash("readback"),
        },
      ]),
  ) as any;
  const events: any[] = Object.entries(readbacks).map(([tree, body]: any) => ({
    stage: "CURRENT_TREE_READBACK",
    status: "PASS",
    tree,
    ...body,
  }));
  events.push(
    {
      stage: "PRIVATE_STATE_READBACK",
      status: "PASS",
      active_snapshot: active,
      retained_receipt: "VERIFIED_BYTES",
    },
    { stage: "GUARD_CHECK_BEFORE_DB", exit_code: 0 },
    { stage: "DATABASE_READBACK", status: "PASS", counts: f.counts },
    { stage: "GUARD_CHECK_BEFORE_PHP", exit_code: 0 },
    {
      stage: "PRE_CMS_ISOLATION",
      status: "PASS",
      source_db_host_positive: true,
      external_packet_capture: "NOT_RUN",
      evidence: {
        prepend_active: true,
        prepend_sha256: m.code_pins.prepend,
        allow_url_fopen: false,
        own_db_connected: true,
        source_db_connected: false,
        external_dns_failed: true,
        disabled: Object.fromEntries(
          [
            "mail",
            "exec",
            "passthru",
            "shell_exec",
            "system",
            "popen",
            "proc_open",
          ].map((k) => [k, true]),
        ),
      },
    },
    {
      stage: "RETAINED_RECEIPT_HTTP",
      status: "PASS",
      method: "GET",
      session_unchanged: true,
      operation_id: retained.operation_id,
      response_sha256: retained.response_sha256,
      http_body_sha256: retained.http_body_sha256,
      bytes: 100,
    },
    { stage: "GUARD_CHECK_FINAL", exit_code: 0 },
    {
      stage: "FINAL_READBACK",
      status: "PASS",
      counts: f.counts,
      active_snapshot: active,
      source_runtime_unchanged: true,
    },
  );
  events.unshift({
    stage: "SOURCE_INSPECT",
    exit_code: 0,
    stdout_sha256: hash("source-before"),
    stderr_sha256: hash(""),
  });
  events.splice(
    events.findIndex((e) => e.stage === "DATABASE_READBACK"),
    0,
    { stage: "SQL_IMPORT", exit_code: 0 },
  );
  events.splice(
    events.findIndex((e) => e.stage === "GUARD_CHECK_FINAL"),
    0,
    {
      stage: "SOURCE_INSPECT",
      exit_code: 0,
      stdout_sha256: hash("source-after"),
      stderr_sha256: hash(""),
    },
  );
  p.baseline.http = [
    {
      request_target: "/product?x=&x=2",
      status: 200,
      body_sha256: hash("page"),
    },
    { request_target: "/missing", status: 404 },
  ];
  events.splice(
    events.findIndex((e) => e.stage === "RETAINED_RECEIPT_HTTP"),
    0,
    { stage: "UNAUTHENTICATED_HTTP", status: "PASS", http_status: 401 },
    ...p.baseline.http.map((h: any) => ({
      stage: "AUTHENTICATED_HTTP",
      status: "PASS",
      request_target: h.request_target,
      http_status: h.status,
      body_sha256: h.body_sha256 ?? hash("404"),
    })),
  );
  for (const e of events) e.at = "2026-09-30T09:00:00.000Z";
  const r: any = {
    status: "ISOLATED_CURRENT_COPY_RESTORED_AND_SMOKE_VERIFIED",
    plan_sha256: hash(JSON.stringify(canonical(p))),
    all_trees_before_bootstrap: readbacks,
    native_journal_restore: "AUDIT_ONLY_BYTES_VERIFIED_NOT_ACTIVATED",
    source_stop_or_sql: false,
    external_packet_capture: "NOT_RUN",
    production_recovery: "NOT_RUN",
    automatic_cleanup: false,
  };
  for (const k of [
    "database_import",
    "database_readback",
    "cms_restore",
    "private_state_restore",
    "active_snapshot_readback",
    "retained_receipt_http",
    "http_smoke",
    "source_runtime_unchanged",
  ])
    r[k] = "PASS";
  Object.assign(f.docs, {
    current_plan: p,
    current_result: r,
    current_events: events,
    current_state_ledger: ledger,
  });
  return { p, r, events, ledger };
}
test("copied browser, facts and transport validate independently without readiness promotion", () => {
  const f = fixture(),
    r = f.validate();
  assert.deepEqual(r.checks, {
    browser: "PASS",
    database_unchanged: "PASS",
    transport: "PASS",
    current_restore: "NOT_RUN",
  });
  assert.equal(r.readiness, "NOT_READY");
  assert.equal(r.source_scope.known_urls, 3);
  assert.equal(r.source_scope.unresolved_urls, 2);
});
test("complete current private-copy receipts bind exact package ledger and retained operation", () => {
  const f = fixture();
  addRestore(f);
  assert.equal(f.validate().checks.current_restore, "PASS");
});
test("missing groups stay NOT_RUN, a lone supplied group is not invented", () => {
  const f = fixture();
  for (const k of Object.keys(f.docs))
    if (k !== "facts_before") delete f.docs[k];
  const r = f.validate();
  assert.ok(Object.values(r.checks).every((v) => v === "NOT_RUN"));
});
for (const [name, mutate] of [
  ["local browser", (f: any) => (f.docs.browser.binding.local_only = true)],
  [
    "foreign snapshot",
    (f: any) => (f.docs.browser.binding.snapshot_id = hash("other")),
  ],
  [
    "browser code drift",
    (f: any) => (f.docs.browser.binding.verifier_sha256 = hash("other")),
  ],
  ["missing exchange", (f: any) => f.docs.browser.exchanges.pop()],
  [
    "counter contradiction",
    (f: any) => f.docs.browser.counters.mediated_fetches--,
  ],
  [
    "foreign POST",
    (f: any) =>
      (f.docs.browser.exchanges.find(
        (e: any) => e.method === "POST",
      ).request_target = "/real-order"),
  ],
  [
    "duplicate operation",
    (f: any) => (f.docs.browser.operations[1] = f.docs.browser.operations[0]),
  ],
  [
    "unknown write",
    (f: any) => (f.docs.browser.operations[0].status = "UNKNOWN"),
  ],
  [
    "readback before POST",
    (f: any) =>
      ([f.docs.browser.exchanges[1], f.docs.browser.exchanges[2]] = [
        f.docs.browser.exchanges[2],
        f.docs.browser.exchanges[1],
      ]),
  ],
  [
    "source external redirect",
    (f: any) =>
      (f.docs.browser.exchanges[0].request_target = "https://source.example/"),
  ],
  [
    "false NA",
    (f: any) =>
      (f.docs.browser.checks.find(
        (c: any) => c.id === "product-responsive",
      ).status = "NOT_APPLICABLE"),
  ],
  [
    "equal nonzero native orders",
    (f: any) => {
      f.docs.facts_before.counts.b_sale_order = 1;
      f.docs.facts_after.counts.b_sale_order = 1;
    },
  ],
  [
    "facts bytes lie",
    (f: any) => (f.docs.facts_after.facts[0].raw_sha256 = hash("wrong")),
  ],
  [
    "transport query leak",
    (f: any) => (f.docs.transport.context.query_count = 1),
  ],
  [
    "transport arbitrary code pin",
    (f: any) => {
      f.manifest.code_pins.transport = hash("wrong");
      f.docs.transport.transport_sha256 = hash("wrong");
    },
  ],
  [
    "orphan configuration hash",
    (f: any) =>
      (f.docs.runtime_configuration.configuration_sha256 = hash("orphan")),
  ],
] as const)
  test(`reject ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(f.validate, /NATIVE_RUNTIME_/);
  });
for (const [name, mutate] of [
  ["historical mode", (x: any) => (x.p.mode = "NEW_ISOLATED_COPY")],
  [
    "incomplete private state",
    (x: any) => (x.r.private_state_restore = "NOT_RUN"),
  ],
  [
    "changed session",
    (x: any) =>
      (x.events.find(
        (e: any) => e.stage === "RETAINED_RECEIPT_HTTP",
      ).session_unchanged = false),
  ],
  [
    "wrong receipt bytes",
    (x: any) =>
      (x.events.find(
        (e: any) => e.stage === "RETAINED_RECEIPT_HTTP",
      ).http_body_sha256 = hash("other")),
  ],
  [
    "source changed",
    (x: any) =>
      (x.events.find(
        (e: any) => e.stage === "FINAL_READBACK",
      ).source_runtime_unchanged = false),
  ],
  [
    "guard too late",
    (x: any) => {
      const i = x.events.findIndex(
        (e: any) => e.stage === "GUARD_CHECK_BEFORE_PHP",
      );
      x.events.push(x.events.splice(i, 1)[0]);
    },
  ],
  [
    "unknown SQL",
    (x: any) =>
      x.events.push({
        stage: "SQL_IMPORT",
        status: "UNKNOWN_TIMEOUT",
        at: "2026-09-30T09:00:00Z",
      }),
  ],
  [
    "old package ledger",
    (x: any) =>
      (x.ledger.entries.find(
        (e: any) => e.path === "release/manifest.json",
      ).sha256 = hash("old")),
  ],
] as const)
  test(`current copy rejects ${name}`, () => {
    const f = fixture(),
      x = addRestore(f);
    mutate(x);
    assert.throws(f.validate, /NATIVE_RUNTIME_/);
  });
test("raw JSON duplicate keys and file traversal are rejected", () => {
  assert.throws(
    () => parseNativeRuntimeJson(Buffer.from('{"a":1,"a":2}')),
    /DUPLICATE/,
  );
  const f = fixture();
  f.validate();
  f.manifest.files.browser!.relative_path = "../receipt.json";
  assert.throws(() => validateNativeRuntimeManifest(f.manifest), /FILE_REF/);
});

test("user secrets cannot be attached inside copied receipts", () => {
  const f = fixture();
  f.docs.transport.cookie = "private-user-cookie";
  assert.throws(f.validate, /PRIVATE_SECRET_FIELD/);
});
test("transport counters from another observation cohort do not match current facts", () => {
  const f = fixture();
  f.docs.transport.counts.b_user = 2;
  assert.throws(f.validate, /TRANSPORT_COUNTER_COHORT/);
});
