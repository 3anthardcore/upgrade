import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  copyFileSync,
  readdirSync,
  linkSync,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Store, hash, inside } from "../../packages/core/index.ts";
import { ingestOperatorCapture } from "../../packages/core/operator-capture.ts";
import {
  createOperatorModel,
  buildOperatorPackage,
} from "../../packages/core/operator-model.ts";
import { executeNativeTarget } from "../../packages/bitrix-adapter/native.ts";
import { ingestTargetEvidence } from "../../packages/core/target-evidence.ts";
import { writeReport } from "../../packages/reporter/index.ts";
import type { Artifact } from "../../packages/contracts/index.ts";

const json = (v: any) => JSON.stringify(v, null, 2) + "\n";
const project = "evidence-pilot",
  target = "dedicated-demo";
const origin = "https://source.example",
  source = origin + "/termoregulyatory/grand-meyer-hw-500";
async function targetFixture(assetCount = 0) {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-native-qa-"));
  const root = join(dir, "data", project),
    capture = join(dir, "capture");
  mkdirSync(capture);
  const store = new Store(root);
  store.createProject(project, origin + "/");
  store.planRun();
  store.publishArtifact(
    "crawl-result.json",
    json({
      state: "PAUSED",
      source_origin: origin,
      entries: [
        {
          raw_url: origin + "/",
          raw_urls: [origin + "/"],
          crawl_key: origin + "/",
          status: "DISCOVERED",
        },
      ],
      access: {
        version: 1,
        active_block_id: "access-fixture",
        blocks: [{ id: "access-fixture" }],
      },
      assets: [],
      limitations: [],
    }),
  );
  store.setRunStatus("PAUSED");
  const html =
    "<!doctype html><html><head><title>Observed fact</title></head><body><main><h1>Observed fact</h1><p>Price unknown</p></main></body></html>";
  writeFileSync(join(capture, "page.html"), html);
  const manifest = {
    schema_version: 1,
    kind: "operator-capture",
    capture_id: "evidence-capture",
    project_id: project,
    source_origin: origin,
    captured_at: "2026-09-29T10:00:00.000Z",
    inventory: {
      basis: "operator-observed-urls",
      urls: [origin + "/", source, origin + "/unseen"],
    },
    observations: [
      {
        file: {
          relative_path: "page.html",
          sha256: hash(html),
          size_bytes: Buffer.byteLength(html),
        },
        format: "dom-html",
        source_url: source,
        document_url: source,
        observed_at: "2026-09-29T10:00:00.000Z",
      },
    ],
    assets: Array.from({ length: assetCount }, (_, index) => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVwAAAABJRU5ErkJggg==",
        "base64",
      );
      const relative_path = `pixel-${index}.png`;
      writeFileSync(join(capture, relative_path), png);
      return {
        source_url: origin + "/" + relative_path,
        observed_on_urls: [source],
        mime: "image/png",
        file: { relative_path, sha256: hash(png), size_bytes: png.length },
      };
    }),
  };
  const bytes = json(manifest),
    capturePin = hash(bytes);
  writeFileSync(join(capture, "operator-capture.json"), bytes);
  await ingestOperatorCapture(store, {
    directory: capture,
    expectedManifestSha256: capturePin,
  });
  const options = {
    captureId: manifest.capture_id,
    manifestSha256: capturePin,
    page: source,
  };
  const model = await createOperatorModel(store, options);
  const build = await buildOperatorPackage(store, {
    ...options,
    modelId: model.id,
  });
  const profile = {
    schema_version: 1,
    environment: "demo",
    project_id: project,
    target_id: target,
    driver: "docker-exec",
    docker_executable: resolve("var/tools/docker-not-executed"),
    container: "private-php-1",
    host_package_root: root,
    container_package_root: "/private/packages",
    document_root: "/site",
    state_dir: "/private",
    backup_receipt: "/private/backup/receipt.json",
    backup_receipt_sha256: hash("fixture backup"),
    timeout_seconds: 30,
  };
  const profilePath = join(dir, "native-profile.json"),
    profileBytes = json(profile);
  writeFileSync(profilePath, profileBytes);
  let calls = 0;
  // Actual native journal, modeled read-only target response. Never claims live CMS verification.
  const native = await executeNativeTarget(
    {
      profilePath,
      profileSha256: hash(profileBytes),
      packageDir: build.package_dir,
      manifestSha256: build.manifest_sha256_package!,
      journalDir: join(dir, "native-journal"),
      action: "reconcile",
    },
    async (command) => {
      calls++;
      assert.equal(command, "reconcile");
      return {
        status: "DATABASE_RECONCILED",
        defects: [],
        unreferenced_files: [],
        http_browser_admin: "NOT_RUN",
        _target: {
          project_id: project,
          target_id: target,
          manifest_sha256: build.manifest_sha256_package,
        },
      };
    },
  );
  assert.equal(calls, 1);
  const headPath = (native as any).journal,
    head = JSON.parse(readFileSync(headPath, "utf8")),
    responsePath = head.last_result.file;
  const bundle = join(dir, "bundle");
  mkdirSync(bundle);
  const file = (path: string, name: string) => {
    copyFileSync(path, join(bundle, name));
    const b = readFileSync(path);
    return { relative_path: name, sha256: hash(b), size_bytes: b.length };
  };
  const ref = (id: string) => {
    const a = store.get<Artifact>("artifact", id);
    return { artifact_id: id, sha256: a.sha256 };
  };
  const evidence: any = {
    schema_version: 1,
    kind: "native-import-evidence",
    project_id: project,
    target_id: target,
    build_record_id: build.id,
    model_record_id: model.id,
    build_artifact: ref(build.result_artifact_id!),
    model_artifact: ref(model.output_artifact_ids.model),
    route_artifact: ref(model.output_artifact_ids.routes),
    scope_artifact: ref(model.output_artifact_ids.scope),
    package_manifest_sha256: build.manifest_sha256_package,
    attestation: {
      kind: "operator-copied-native-receipts",
      recorded_at: new Date().toISOString(),
    },
    files: {
      profile: file(profilePath, "profile.json"),
      journal_head: file(headPath, "head.json"),
      reconcile_request: file(
        responsePath.replace(/\.response\.json$/, ".request.json"),
        basename(responsePath).replace(/\.response\.json$/, ".request.json"),
      ),
      reconcile_response: file(responsePath, basename(responsePath)),
    },
  };
  const pin = () => {
    const text = json(evidence);
    writeFileSync(join(bundle, "target-evidence.json"), text);
    return hash(text);
  };
  const currentPin = pin();
  const guard = join(dir, "offline.cjs");
  writeFileSync(
    guard,
    "const deny=()=>{throw Error('NETWORK_FORBIDDEN')};globalThis.fetch=deny;require('node:net').Socket.prototype.connect=deny;require('node:dns').lookup=deny;require('node:http').request=deny;require('node:https').request=deny;",
  );
  return {
    dir,
    root,
    store,
    bundle,
    evidence,
    build,
    model,
    currentPin,
    pin,
    guard,
    options: () => ({
      buildId: build.id,
      directory: bundle,
      expectedManifestSha256: pin(),
    }),
  };
}
type Fixture = Awaited<ReturnType<typeof targetFixture>>;
function cleanup(f: Fixture) {
  assert.equal(dirname(resolve(f.dir)), resolve(tmpdir()));
  assert.match(basename(f.dir), /^upgrade-native-qa-[A-Za-z0-9_-]+$/);
  f.store.close();
  rmSync(f.dir, { recursive: true, force: true });
}
function targetCli(f: Fixture, command: string[], expected = 0) {
  const r = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--require",
      f.guard,
      "packages/cli/index.ts",
      ...command,
      "--project",
      project,
      "--data-dir",
      join(f.dir, "data"),
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 60000 },
  );
  assert.equal(r.status, expected, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
}
function readReport(f: Fixture) {
  writeReport(f.store);
  return JSON.parse(readFileSync(join(f.root, "reports/report.json"), "utf8"));
}
function updateFile(f: Fixture, role: string, mutate: (v: any) => void) {
  const ref = f.evidence.files[role],
    path = join(f.bundle, ref.relative_path),
    v = JSON.parse(readFileSync(path, "utf8"));
  mutate(v);
  const bytes = json(v);
  writeFileSync(path, bytes);
  ref.sha256 = hash(bytes);
  ref.size_bytes = Buffer.byteLength(bytes);
  if (role === "reconcile_response")
    updateFile(f, "journal_head", (head) => {
      head.last_result.sha256 = ref.sha256;
    });
}

import {
  ingestNativeQaEvidence,
  readNativeQaEvidence,
  validateNativeQaReceipts,
} from "../../packages/core/native-qa-evidence.ts";

async function fixture() {
  const f = await targetFixture(1);
  const imported = await ingestTargetEvidence(f.store, f.options());
  const bundle = join(f.dir, "qa");
  mkdirSync(bundle);
  const packageData = (name: string) =>
    JSON.parse(
      readFileSync(join(f.build.package_dir, "data", name + ".json"), "utf8"),
    );
  const packageManifest = JSON.parse(
    readFileSync(join(f.build.package_dir, "manifest.json"), "utf8"),
  );
  const entities = packageData("entities"),
    routes = packageData("routes"),
    assets = packageData("assets"),
    scope = packageData("operator-scope"),
    snapshot = packageData("demo-snapshot");
  const facts = entities.map((e: any, i: number) => {
    const raw = JSON.stringify(e.facts ?? []);
    return {
      entity_key: e.stable_key,
      bitrix_id: i + 1,
      stored_bytes: Buffer.byteLength(raw),
      raw_bytes: Buffer.byteLength(raw),
      raw_sha256: hash(raw),
      expected_sha256: hash(raw),
      pass: true,
    };
  });
  const count = {
    ug_entity: entities.length,
    ug_route: routes.length,
    ug_operation: 2,
    b_sale_order: 0,
    b_event: 0,
    b_user: 1,
  };
  const before = {
    scope: "READ_ONLY_NATIVE_FACTS_AND_COUNTS",
    pass: true,
    manifest_sha256: f.build.manifest_sha256_package,
    counts: count,
    legacy_hw500_id: 1,
    facts,
    full_readiness: "NOT_READY",
  };
  const paths = [
    ["/", "GET", false, 401],
    ["/", "POST", true, 403],
    ["/bitrix/admin/", "GET", true, 404],
    ["/bitrix/license_key.php", "GET", true, 404],
    ["/local/upgrade-installer-resume.php", "GET", true, 404],
    ["/absent-upgrade-route", "GET", true, 404],
  ];
  const http = {
    scope: "SELECTED_BITRIX_ROUTES_AND_VERIFIED_MEDIA_ONLY",
    created_at: "2026-09-29T15:00:00.123456+00:00",
    manifest_sha256: f.build.manifest_sha256_package,
    known_url_count: scope.known_url_count,
    selected_url_count: scope.selected_url_count,
    unresolved_url_count: scope.unresolved_url_count,
    full_source_denominator: "UNKNOWN",
    readiness: "NOT_READY",
    privacy_header_matrix: "NOT_RUN_BY_THIS_SCRIPT",
    routes: routes.map((r: any) => ({
      request_target: r.request_target,
      status: 200,
      factual_texts_checked: entities
        .find((e: any) => e.stable_key === r.entity_key)
        .blocks.reduce(
          (n: number, block: any) =>
            n +
            ([
              "paragraph",
              "heading",
              "quote",
              "link",
              "card",
              "document",
            ].includes(block.type) && block.text
              ? 1
              : 0) +
            (["list", "card"].includes(block.type)
              ? (block.items ?? []).length
              : 0) +
            (block.type === "table" ? block.rows.flat().length : 0),
          0,
        ),
      checks: {
        status: true,
        h1: true,
        entity: true,
        facts: true,
        noindex: true,
        demo: true,
      },
      pass: true,
    })),
    assets: assets.map((a: any) => ({
      path: a.public_path,
      status: 200,
      sha256: a.sha256,
      pass: true,
    })),
    isolation: paths.map(([path, method, authenticated, status]) => ({
      path,
      method,
      authenticated,
      status,
      expected: status,
      pass: true,
    })),
    pass: true,
  };
  const ids = [
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
  const exchanges = Array.from({ length: 29 }, (_, i) => ({
    body_bytes: 12,
    body_sha256: hash("same-receipt"),
    method: [6, 7, 9, 11, 13, 15, 18, 20, 25].includes(i) ? "POST" : "GET",
    request_target: [6, 7, 9, 11, 13, 15, 18, 20, 25].includes(i)
      ? "/__upgrade/action"
      : [5, 17].includes(i)
        ? routes[0].request_target
        : [10, 12, 14, 16, 19].includes(i)
          ? "/__upgrade/cart?operation=" + hash("cart-" + (i === 12 ? 10 : i))
          : [21, 22, 26, 27, 28].includes(i)
            ? "/__upgrade/receipt?operation=" +
              hash([26, 27].includes(i) ? "lead" : "checkout")
            : "/__upgrade/cart",
    sequence: i + 1,
    status:
      i === 0
        ? 401
        : [6, 7].includes(i)
          ? 403
          : [9, 11, 13, 15, 18, 20, 25].includes(i)
            ? 303
            : 200,
  }));
  const scenarios = {
    base_url: "https://demo.example",
    browser_native_form_semantics: "NOT_RUN",
    checks: ids.map((id) => ({
      id,
      status: "PASS",
      details: "Fixture evidence, not native deployment",
    })),
    elapsed_seconds: 2,
    error_code: null,
    exchanges,
    native_bitrix: "NOT_ASSERTED_BY_HTTP_VERIFIER",
    native_orders_mail_payments_database_counters: "NOT_RUN",
    network_egress_isolation: "NOT_RUN",
    product_route: routes[0].request_target,
    requests: 29,
    run_id: "a".repeat(32),
    schema_version: 1,
    snapshot_id: snapshot.snapshot_id,
    source_coverage: "NOT_RUN",
    status: "HTTP_SCENARIOS_VERIFIED",
    unknown_write: false,
    verifier_sha256: hash("fixture-verifier"),
  };
  const browser = {
    status: "NATIVE_BROWSER_SCENARIOS_VERIFIED",
    javaScriptEnabled: false,
    origin: "https://demo.example",
    checks: [
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
    ].map((id) => ({ id, status: "PASS" })),
    requests: 10,
    exchanges: [
      ...Array.from({ length: 10 }, () => ({
        method: "GET",
        path: routes[0].request_target,
        status: 200,
      })),
      ...Array.from({ length: 4 }, () => ({
        method: "POST",
        path: "/__upgrade/action",
        status: 303,
      })),
    ],
    native_db_side_effects: "SEPARATE_CHECK",
    full_source: "UNKNOWN",
    full_readiness: "NOT_READY",
  };
  const native: any = {
    facts_before: before,
    facts_after: structuredClone(before),
    http_routes: http,
    activation: {
      status: "ACTIVATED_AWAITING_HTTP",
      snapshot_id: snapshot.snapshot_id,
      snapshot_file_sha256: packageManifest.files["data/demo-snapshot.json"],
      nginx_sha256: hash("fixture-nginx"),
      nginx_test_exit: 0,
      http: "NOT_RUN",
    },
    http_scenarios: scenarios,
    browser,
  };
  const ref = (id: string) => ({
    artifact_id: id,
    sha256: f.store.get<Artifact>("artifact", id).sha256,
  });
  const m: any = {
    schema_version: 1,
    kind: "native-qa-evidence",
    project_id: project,
    target_id: target,
    build_record_id: f.build.id,
    model_record_id: f.model.id,
    build_artifact: ref(f.build.result_artifact_id!),
    model_artifact: ref(f.model.output_artifact_ids.model),
    route_artifact: ref(f.model.output_artifact_ids.routes),
    scope_artifact: ref(f.model.output_artifact_ids.scope),
    target_evidence: {
      record_id: imported.id,
      result_artifact_id: imported.result_artifact_id,
      sha256: f.store.get<Artifact>("artifact", imported.result_artifact_id!)
        .sha256,
    },
    package_manifest_sha256: f.build.manifest_sha256_package,
    snapshot: {
      id: snapshot.snapshot_id,
      sha256: packageManifest.files["data/demo-snapshot.json"],
    },
    origin: "https://demo.example",
    attestation: {
      kind: "operator-copied-native-receipts",
      recorded_at: new Date().toISOString(),
    },
    files: {},
  };
  const write = (role: string, value: any) => {
    const data = json(value),
      relative_path = role + ".json";
    writeFileSync(join(bundle, relative_path), data);
    m.files[role] = {
      relative_path,
      sha256: hash(data),
      size_bytes: Buffer.byteLength(data),
    };
    native[role] = value;
  };
  for (const [role, value] of Object.entries(native)) write(role, value);
  const pin = () => {
    const bytes = json(m);
    writeFileSync(join(bundle, "native-qa.json"), bytes);
    return hash(bytes);
  };
  pin();
  const remove = (role: string) => {
    rmSync(join(bundle, m.files[role].relative_path));
    delete m.files[role];
    delete native[role];
  };
  return {
    ...f,
    qaBundle: bundle,
    m,
    native,
    write,
    remove,
    qaOptions: () => ({
      buildId: f.build.id,
      directory: bundle,
      expectedManifestSha256: pin(),
    }),
  };
}
type QaFixture = Awaited<ReturnType<typeof fixture>>;

test("native QA actual offline CLI copies immutable receipts, replay/restart and report preserve scope and missing native gates", async () => {
  const f = await fixture();
  try {
    const before = readReport(f),
      opts = f.qaOptions(),
      args = [
        "native-qa",
        "ingest",
        "--build",
        f.build.id,
        "--directory",
        f.qaBundle,
        "--manifest-sha256",
        opts.expectedManifestSha256,
      ];
    const result = targetCli(f, args);
    assert.equal(result.state, "RECORDED_NATIVE_QA");
    assert.equal(result.checks.facts, "RECORDED_PASS");
    assert.equal(result.checks.browser, "RECORDED_PASS");
    assert.equal(result.checks.current_restore, "NOT_RUN");
    assert.equal(result.readiness, "NOT_READY");
    const n = f.store.list("artifact").length;
    const again = targetCli(f, args);
    assert.equal(again.replayed, true);
    assert.equal(again.id, result.id);
    assert.equal(f.store.list("artifact").length, n);
    const report = readReport(f);
    assert.equal(report.target.native_qa_binding, "CURRENT");
    assert.deepEqual(report.source, before.source);
    assert.deepEqual(report.operator.registry, before.operator.registry);
    assert.equal(report.target.native_qa_scope.known_urls, 3);
    assert.equal(report.target.native_qa_scope.unresolved_urls, 2);
    assert.equal(report.readiness, "NOT_READY");
    for (const file of ["reports/index.html", "reports/summary.md"])
      assert.match(
        readFileSync(join(f.root, file), "utf8").replaceAll("\\_", "_"),
        /RECORDED_NATIVE_QA/,
      );
  } finally {
    cleanup(f);
  }
});

test("missing required receipt is NOT_RUN while other supplied evidence remains recorded", async () => {
  const f = await fixture();
  try {
    f.remove("facts_after");
    f.remove("browser");
    const r = await ingestNativeQaEvidence(f.store, f.qaOptions());
    assert.equal(r.checks.facts, "NOT_RUN");
    assert.equal(r.checks.counters, "NOT_RUN");
    assert.equal(r.checks.routes, "RECORDED_PASS");
    assert.equal(r.checks.browser, "NOT_RUN");
    assert.equal(r.historical_restore.status, "NOT_RUN");
    assert.ok(r.missing_receipts.includes("facts_after"));
  } finally {
    cleanup(f);
  }
});

test("native QA semantic corruptions and foreign/UNKNOWN bindings reject before publication", async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.m),
      native = structuredClone(f.native);
    const cases: Array<[string, () => void]> = [
      [
        "foreign target",
        () => {
          f.m.target_id = "foreign";
        },
      ],
      [
        "foreign build",
        () => {
          f.m.build_record_id = "a".repeat(64);
        },
      ],
      [
        "foreign scope",
        () => {
          f.m.scope_artifact.sha256 = "a".repeat(64);
        },
      ],
      [
        "snapshot",
        () => {
          f.m.snapshot.id = "a".repeat(64);
        },
      ],
      [
        "pending prerequisite",
        () => {
          const r = f.store.get<any>(
            "target_evidence",
            f.m.target_evidence.record_id,
          );
          r.state = "PENDING";
          f.store.put("target_evidence", r.id, r);
        },
      ],
      [
        "facts",
        () => {
          f.native.facts_before.facts[0].raw_sha256 = "a".repeat(64);
          f.write("facts_before", f.native.facts_before);
        },
      ],
      [
        "counter drift",
        () => {
          f.native.facts_after.counts.b_event = 1;
          f.write("facts_after", f.native.facts_after);
        },
      ],
      [
        "URL membership",
        () => {
          f.native.http_routes.routes[0].request_target = "/different";
          f.write("http_routes", f.native.http_routes);
        },
      ],
      [
        "media SHA",
        () => {
          f.native.http_routes.assets[0].sha256 = "a".repeat(64);
          f.write("http_routes", f.native.http_routes);
        },
      ],
      [
        "lost query",
        () => {
          f.native.http_routes.routes[0].request_target = "/product";
          f.write("http_routes", f.native.http_routes);
        },
      ],
      [
        "unknown write",
        () => {
          f.native.http_scenarios.unknown_write = true;
          f.write("http_scenarios", f.native.http_scenarios);
        },
      ],
      [
        "readback changed",
        () => {
          f.native.http_scenarios.exchanges[22].body_sha256 = "a".repeat(64);
          f.write("http_scenarios", f.native.http_scenarios);
        },
      ],
      [
        "replay different operation",
        () => {
          f.native.http_scenarios.exchanges[12].request_target =
            "/__upgrade/cart?operation=" + "b".repeat(64);
          f.write("http_scenarios", f.native.http_scenarios);
        },
      ],
      [
        "foreign origin",
        () => {
          f.native.browser.origin = "https://foreign.example";
          f.write("browser", f.native.browser);
        },
      ],
      [
        "browser unknown",
        () => {
          f.native.browser.checks[0].status = "UNKNOWN";
          f.write("browser", f.native.browser);
        },
      ],
      [
        "source completeness",
        () => {
          f.native.http_routes.full_source_denominator = "COMPLETE";
          f.write("http_routes", f.native.http_routes);
        },
      ],
      [
        "extra schema key",
        () => {
          f.m.readiness = "DEMO_READY";
        },
      ],
    ];
    const targetRecord = f.store.get<any>(
      "target_evidence",
      f.m.target_evidence.record_id,
    );
    for (const [name, mutate] of cases) {
      Object.keys(f.m).forEach((k) => delete f.m[k]);
      Object.assign(f.m, structuredClone(original));
      for (const [role, value] of Object.entries(native))
        f.write(role, structuredClone(value));
      f.store.put("target_evidence", targetRecord.id, targetRecord);
      mutate();
      await assert.rejects(
        ingestNativeQaEvidence(f.store, f.qaOptions()),
        /NATIVE_QA_/,
        name,
      );
      assert.equal(f.store.list("native_qa_evidence").length, 0, name);
    }
  } finally {
    cleanup(f);
  }
});

test("pending/restart unknown publication is reconciled, and takeover forbids record writes", async () => {
  const f = await fixture();
  try {
    const publish = f.store.publishArtifact.bind(f.store);
    let failed = false;
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const a = publish(...args);
      if (!failed && args[0].endsWith("-facts_before.json")) {
        failed = true;
        throw Error("lost-ack");
      }
      return a;
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestNativeQaEvidence(f.store, f.qaOptions()),
      /lost-ack/,
    );
    const pending = f.store.list<any>("native_qa_evidence")[0];
    assert.equal(pending.state, "PENDING");
    f.store.publishArtifact = publish;
    const r = await ingestNativeQaEvidence(f.store, f.qaOptions());
    assert.equal(r.state, "RECORDED_NATIVE_QA");
    assert.equal(
      f.store
        .list<any>("artifact")
        .filter((a) => a.type.endsWith("-facts_before.json")).length,
      1,
    );
  } finally {
    cleanup(f);
  }
  const g = await fixture();
  try {
    const publish = g.store.publishArtifact.bind(g.store);
    let stolen = false;
    g.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const a = publish(...args);
      if (!stolen && String(args[0]).startsWith("native-qa-")) {
        stolen = true;
        const run = g.store.currentRun();
        run.dispatcher_owner = "new-owner";
        run.dispatcher_until = Date.now() + 60000;
        g.store.put("run", run.run_id, run);
        const rec = g.store.list<any>("native_qa_evidence")[0];
        g.store.put("native_qa_evidence", rec.id, {
          ...rec,
          new_owner_marker: true,
        });
      }
      return a;
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestNativeQaEvidence(g.store, g.qaOptions()),
      /Dispatcher ownership lost/,
    );
    assert.equal(
      g.store.list<any>("native_qa_evidence")[0].new_owner_marker,
      true,
    );
    assert.equal(
      g.store.list<any>("native_qa_evidence")[0].manifest_artifact_id,
      undefined,
    );
  } finally {
    cleanup(g);
  }
});

test("report marks historical binding STALE and corruption INVALID without reducing source registry", async () => {
  const f = await fixture();
  try {
    const r = await ingestNativeQaEvidence(f.store, f.qaOptions());
    const stale = readNativeQaEvidence(
      f.store,
      new Set([f.build.id]),
      "a".repeat(64),
    )[0];
    assert.equal(stale.binding_status, "STALE");
    assert.equal("readiness" in stale && stale.readiness, "NOT_READY");
    const before = readReport(f).operator.registry;
    const record = f.store.get<any>("native_qa_evidence", r.id),
      a = f.store.get<Artifact>("artifact", record.file_artifact_ids.browser);
    chmodSync(inside(f.root, a.relative_path), 0o600);
    writeFileSync(inside(f.root, a.relative_path), "{}");
    const report = readReport(f);
    assert.equal(report.target.native_qa_binding, "NOT_RUN");
    assert.equal(report.target.native_qa_evidence[0].state, "INVALID");
    assert.deepEqual(report.operator.registry, before);
  } finally {
    cleanup(f);
  }
});

test("modified accepted source payload rejects native QA even when old native import receipt remains intact", async () => {
  const f = await fixture();
  try {
    const c = f.store.list<any>("operator_capture")[0],
      ref = c.files.find((x: any) => x.relative_path === "page.html"),
      a = f.store.get<Artifact>("artifact", ref.artifact_id);
    chmodSync(inside(f.root, a.relative_path), 0o600);
    writeFileSync(inside(f.root, a.relative_path), "tampered");
    await assert.rejects(
      ingestNativeQaEvidence(f.store, f.qaOptions()),
      /FILE_PIN_MISMATCH/,
    );
    assert.equal(f.store.list("native_qa_evidence").length, 0);
  } finally {
    cleanup(f);
  }
});

test("native QA rejects path traversal, duplicate keys, hardlinks, missing or unlisted files and declared over-budget bytes", async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.m);
    const cases: Array<[string, () => void, () => void]> = [
      [
        "traversal",
        () => {
          f.m.files.browser.relative_path = "../browser.json";
        },
        () => {},
      ],
      [
        "cap",
        () => {
          f.m.files.browser.size_bytes = 2_000_001;
        },
        () => {},
      ],
      [
        "extra",
        () => writeFileSync(join(f.qaBundle, "extra.json"), "{}"),
        () => rmSync(join(f.qaBundle, "extra.json")),
      ],
      [
        "hardlink",
        () =>
          linkSync(
            join(f.qaBundle, "browser.json"),
            join(f.dir, "extra-link.json"),
          ),
        () => rmSync(join(f.dir, "extra-link.json")),
      ],
      [
        "missing",
        () => {
          rmSync(join(f.qaBundle, "browser.json"));
        },
        () => f.write("browser", f.native.browser),
      ],
    ];
    for (const [name, change, undo] of cases) {
      Object.assign(f.m, structuredClone(original));
      change();
      await assert.rejects(
        ingestNativeQaEvidence(f.store, f.qaOptions()),
        /NATIVE_QA_/,
        name,
      );
      undo();
      assert.equal(f.store.list("native_qa_evidence").length, 0);
    }
    Object.assign(f.m, structuredClone(original));
    const opts = f.qaOptions(),
      raw = readFileSync(join(f.qaBundle, "native-qa.json"), "utf8").replace(
        "{",
        '{"schema_version":1,',
      );
    writeFileSync(join(f.qaBundle, "native-qa.json"), raw);
    await assert.rejects(
      ingestNativeQaEvidence(f.store, {
        ...opts,
        expectedManifestSha256: hash(raw),
      }),
      /DUPLICATE_JSON_KEY/,
    );
  } finally {
    cleanup(f);
  }
});

test("validated input bytes are published unchanged after external directory changes; authoritative record key rejects body ID corruption", async () => {
  const f = await fixture();
  try {
    const opts = f.qaOptions(),
      old = readFileSync(join(f.qaBundle, "browser.json")),
      publish = f.store.publishArtifact.bind(f.store);
    let changed = false;
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      if (!changed) {
        changed = true;
        writeFileSync(join(f.qaBundle, "browser.json"), "{}");
      }
      return publish(...args);
    }) as Store["publishArtifact"];
    const r = await ingestNativeQaEvidence(f.store, opts),
      record = f.store.get<any>("native_qa_evidence", r.id),
      a = f.store.get<Artifact>("artifact", record.file_artifact_ids.browser);
    assert.deepEqual(readFileSync(inside(f.root, a.relative_path)), old);
    writeFileSync(join(f.qaBundle, "browser.json"), old);
    f.store.put("native_qa_evidence", r.id, { ...record, id: "a".repeat(64) });
    await assert.rejects(
      ingestNativeQaEvidence(f.store, opts),
      /RECORD_KEY_MISMATCH/,
    );
  } finally {
    cleanup(f);
  }
});

test("publication is fenced inside metadata transaction, not only before the filesystem write", async () => {
  const f = await fixture();
  try {
    const put = f.store.put.bind(f.store);
    let changed = false;
    f.store.put = ((kind: string, id: string, v: unknown) => {
      if (
        !changed &&
        kind === "artifact" &&
        (v as Artifact).type.startsWith("native-qa-")
      ) {
        changed = true;
        const r = f.store.currentRun();
        r.dispatcher_owner = "other";
        r.dispatcher_until = Date.now() + 60000;
        put("run", r.run_id, r);
      }
      put(kind, id, v);
    }) as Store["put"];
    await assert.rejects(
      ingestNativeQaEvidence(f.store, f.qaOptions()),
      /Dispatcher ownership lost/,
    );
    assert.equal(
      f.store
        .list<Artifact>("artifact")
        .filter((a) => a.type.startsWith("native-qa-")).length,
      0,
    );
    assert.equal(f.store.list<any>("native_qa_evidence")[0].state, "PENDING");
  } finally {
    cleanup(f);
  }
});

test("report metadata index is per report and cache never hides later payload tampering", async () => {
  const f = await fixture();
  try {
    let lists = 0;
    const list = f.store.list.bind(f.store);
    f.store.list = ((kind: string) => {
      if (kind === "artifact") lists++;
      return list(kind);
    }) as Store["list"];
    writeReport(f.store);
    assert.equal(lists, 1);
    const c = f.store.list<any>("operator_capture")[0],
      ref = c.files.find((r: any) => r.relative_path === "page.html"),
      a = f.store.get<Artifact>("artifact", ref.artifact_id);
    chmodSync(inside(f.root, a.relative_path), 0o600);
    writeFileSync(
      inside(f.root, a.relative_path),
      Buffer.alloc(a.size_bytes, 120),
    );
    const report = readReport(f);
    assert.equal(report.operator.state, "INVALID");
    assert.equal(report.operator.registry.known_urls, 3);
    assert.equal(lists, 2);
  } finally {
    cleanup(f);
  }
});

test("exact internal link/card membership remains partial; raw significant query is not normalized", async () => {
  const f = await fixture();
  try {
    const packageData = (name: string) =>
      JSON.parse(
        readFileSync(join(f.build.package_dir, "data", name + ".json"), "utf8"),
      );
    const entities = packageData("entities");
    entities[0].blocks.push(
      { type: "link", request_target: new URL(source).pathname, text: "known" },
      {
        type: "card",
        request_target: "/unseen?m",
        text: "unresolved",
        items: [],
      },
      { type: "link", request_target: "/unseen?m=", text: "distinct" },
    );
    f.native.http_routes.routes[0].factual_texts_checked += 3;
    f.write("http_routes", f.native.http_routes);
    const files = Object.fromEntries(
      Object.entries(f.m.files).map(([role, ref]: [string, any]) => [
        role,
        readFileSync(join(f.qaBundle, ref.relative_path)),
      ]),
    );
    const result = validateNativeQaReceipts(f.m, files, {
      entities,
      routes: packageData("routes"),
      assets: packageData("assets"),
      scope: packageData("operator-scope"),
      snapshot: packageData("demo-snapshot"),
    });
    assert.equal(result.internal_link_closure.status, "PARTIAL");
    assert.equal(result.internal_link_closure.total_links, 3);
    assert.deepEqual(result.internal_link_closure.uncovered_targets, [
      "/unseen?m",
      "/unseen?m=",
    ]);
    assert.equal(result.checks.routes, "RECORDED_PASS");
    assert.equal(result.checks.internal_link_closure, "NOT_VERIFIED");
  } finally {
    cleanup(f);
  }
});

test("factual coverage follows supported producer text, card/list items and table cells exactly", async () => {
  const f = await fixture();
  try {
    const data = (name: string) =>
      JSON.parse(
        readFileSync(join(f.build.package_dir, "data", name + ".json"), "utf8"),
      );
    const metadata = {
      entities: data("entities"),
      routes: data("routes"),
      assets: data("assets"),
      scope: data("operator-scope"),
      snapshot: data("demo-snapshot"),
    };
    metadata.entities[0].blocks = [
      { type: "paragraph", text: "paragraph" },
      { type: "heading", text: "" },
      { type: "quote", text: "quote" },
      { type: "link", text: "link", request_target: "/a" },
      { type: "card", text: "card", items: ["item", ""], request_target: "/b" },
      { type: "document", text: "document" },
      { type: "list", items: ["one", "two"] },
      { type: "table", rows: [["a", ""], ["b"]] },
      { type: "image", alt: "not factual_texts" },
    ];
    const validate = (count: number) => {
      f.native.http_routes.routes[0].factual_texts_checked = count;
      f.write("http_routes", f.native.http_routes);
      const files = Object.fromEntries(
        Object.entries(f.m.files).map(([role, ref]: [string, any]) => [
          role,
          readFileSync(join(f.qaBundle, ref.relative_path)),
        ]),
      );
      return validateNativeQaReceipts(f.m, files, metadata);
    };
    assert.equal(validate(12).checks.routes, "RECORDED_PASS");
    for (const count of [0, 11, 13])
      assert.throws(() => validate(count), /HTTP_ROUTE_FAILED/);
  } finally {
    cleanup(f);
  }
});

test("native producer success predicates bind legacy identity, zero side effects, factual coverage and distinct immutable operation receipts", async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.native);
    const cases: [string, (native: any) => void, RegExp][] = [
      [
        "unknown legacy ID",
        (n) => {
          n.facts_before.legacy_hw500_id =
            n.facts_after.legacy_hw500_id = 999999;
        },
        /FACTS_HEADER_INVALID/,
      ],
      [
        "legacy ID bound to another native item",
        (n) => {
          n.facts_before.facts[0].bitrix_id =
            n.facts_after.facts[0].bitrix_id = 2;
        },
        /FACTS_LEGACY_IDENTITY_MISMATCH/,
      ],
      [
        "native order side effects",
        (n) => {
          n.facts_before.counts.b_sale_order =
            n.facts_after.counts.b_sale_order = 7;
        },
        /FACTS_COUNTS_MISMATCH/,
      ],
      [
        "native mail side effects",
        (n) => {
          n.facts_before.counts.b_event = n.facts_after.counts.b_event = 4;
        },
        /FACTS_COUNTS_MISMATCH/,
      ],
      [
        "factual coverage zero",
        (n) => {
          n.http_routes.routes[0].factual_texts_checked = 0;
        },
        /HTTP_ROUTE_FAILED/,
      ],
      [
        "factual coverage inflated",
        (n) => {
          n.http_routes.routes[0].factual_texts_checked++;
        },
        /HTTP_ROUTE_FAILED/,
      ],
      [
        "lead aliases checkout",
        (n) => {
          for (const i of [26, 27])
            for (const k of ["request_target", "body_sha256", "body_bytes"])
              n.http_scenarios.exchanges[i][k] =
                n.http_scenarios.exchanges[21][k];
        },
        /SCENARIO_DISTINCT_OPERATION_REUSED/,
      ],
      [
        "cart update aliases add",
        (n) => {
          n.http_scenarios.exchanges[14].request_target =
            n.http_scenarios.exchanges[10].request_target;
        },
        /SCENARIO_DISTINCT_OPERATION_REUSED/,
      ],
      [
        "checkout immutable length mismatch",
        (n) => {
          n.http_scenarios.exchanges[22].body_bytes++;
        },
        /SCENARIO_REPLAY_OR_READBACK_MISMATCH/,
      ],
      [
        "lead immutable length mismatch",
        (n) => {
          n.http_scenarios.exchanges[27].body_bytes++;
        },
        /SCENARIO_REPLAY_OR_READBACK_MISMATCH/,
      ],
    ];
    for (const [name, mutate, expected] of cases) {
      const native = structuredClone(original);
      mutate(native);
      for (const [role, doc] of Object.entries(native)) f.write(role, doc);
      await assert.rejects(
        ingestNativeQaEvidence(f.store, f.qaOptions()),
        expected,
        name,
      );
    }
    for (const [role, doc] of Object.entries(original)) f.write(role, doc);
    f.native.http_scenarios.exchanges[12].body_sha256 = hash(
      "new rendered CSRF form state",
    );
    f.write("http_scenarios", f.native.http_scenarios);
    const accepted = await ingestNativeQaEvidence(f.store, f.qaOptions());
    assert.equal(accepted.checks.http_scenarios, "RECORDED_PASS");
    assert.equal(accepted.checks.facts, "RECORDED_PASS");
    assert.equal(accepted.checks.routes, "RECORDED_PASS");
  } finally {
    cleanup(f);
  }
});

test("historical SQL/files restore remains distinct from the current package and private sessions; missing guard or foreign plan rejects", async () => {
  const f = await fixture();
  try {
    const pin = hash("historical fixture"),
      counts = {
        ug_entity: 103,
        ug_route: 103,
        ug_operation: 105,
        b_sale_order: 0,
        b_event: 0,
        b_user: 1,
      };
    const plan: any = Object.fromEntries(
      [
        "baseline_sha256",
        "bridge",
        "config_pins",
        "database_sha256",
        "executor_sha256",
        "files_sha256",
        "guard_sha256",
        "receipt_sha256",
        "source_compose_sha256",
        "subnet",
      ].map((k) => [k, pin]),
    );
    Object.assign(plan, {
      schema_version: 1,
      mode: "NEW_ISOLATED_SQL_AND_FILES_COPY",
      source_project: project,
      source_target: target,
      source_root: "/source",
      destination: "/clone",
      clone_project: "clone-project",
      clone_target: "clone-target",
      automatic_cleanup: false,
      production_recovery: "NOT_RUN",
      source_actions: "READ_ONLY",
      archive: { entries: 1, expanded_bytes: 10, entry_ledger_sha256: pin },
      baseline: {
        project_id: project,
        target_id: target,
        database_counts: counts,
        php_prepend_sha256: pin,
        http: [
          { request_target: "/", status: 200 },
          { request_target: "/missing", status: 404 },
        ],
      },
      configuration_derivation: {
        path: "bitrix/.settings.php",
        allowed_original_hosts: ["db"],
      },
      projection: {
        network: "clone-network",
        source_network: "source-network",
        compose: {
          name: "clone-project",
          volumes: { database: { name: "clone-project-database" } },
          services: {
            db: { volumes: [{ type: "volume", source: "database" }] },
            php: { volumes: [{ type: "bind", source: "/clone/cms" }] },
          },
        },
      },
    });
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
    const planPin = hash(JSON.stringify(canonical(plan))),
      result = {
        cleanup: "NOT_RUN",
        configuration_derivation: {
          changed: true,
          status: "PASS",
          receipt_sha256: pin,
        },
        database_import: "PASS",
        database_readback: "PASS",
        external_packet_capture: "NOT_RUN",
        files_readback_scope:
          "BACKUP_BYTES_BEFORE_DECLARED_CLONE_CONFIGURATION_DERIVATION",
        files_restore: "PASS",
        http_smoke: "PASS",
        mail_disabled: "PASS",
        orders_events_counts_unchanged: "PASS",
        original_site_modified: false,
        plan_sha256: planPin,
        production_recovery: "NOT_RUN",
        source_runtime_unchanged: "PASS",
        status: "ISOLATED_COPY_RESTORED_AND_SMOKE_VERIFIED",
      };
    const events: any[] = [
      {
        stage: "FILES_READBACK",
        status: "PASS",
        entries: 1,
        expanded_bytes: 10,
        entry_ledger_sha256: pin,
      },
      {
        stage: "SETTINGS_DERIVATION",
        status: "PASS",
        path: "bitrix/.settings.php",
        host_before: "db",
        host_after: "db",
        receipt_sha256: pin,
      },
      { stage: "GUARD_CHECK_BEFORE_DB", exit_code: 0 },
      { stage: "DB_START", exit_code: 0 },
      { stage: "DB_READY", exit_code: 1 },
      { stage: "DB_READY", exit_code: 0 },
      { stage: "SQL_IMPORT", exit_code: 0 },
      { stage: "DATABASE_READBACK", status: "PASS", counts },
      { stage: "GUARD_CHECK_BEFORE_PHP", exit_code: 0 },
      { stage: "PRE_CMS_RUNTIME_PROBE", exit_code: 0 },
      {
        stage: "PRE_CMS_ISOLATION",
        status: "PASS",
        external_packet_capture: "NOT_RUN",
        evidence: {
          own_db_connected: true,
          source_db_connected: false,
          external_dns_failed: true,
          prepend_active: true,
          prepend_sha256: pin,
          allow_url_fopen: false,
          disabled: {
            exec: true,
            mail: true,
            passthru: true,
            popen: true,
            proc_open: true,
            shell_exec: true,
            system: true,
          },
        },
      },
      { stage: "WEB_START", exit_code: 0 },
      { stage: "UNAUTHENTICATED_HTTP", status: "PASS", http_status: 401 },
      {
        stage: "AUTHENTICATED_HTTP",
        status: "PASS",
        request_target: "/",
        http_status: 200,
        body_sha256: pin,
      },
      {
        stage: "AUTHENTICATED_HTTP",
        status: "PASS",
        request_target: "/missing",
        http_status: 404,
        body_sha256: pin,
      },
      { stage: "GUARD_CHECK_FINAL", exit_code: 0 },
      {
        stage: "FINAL_READBACK",
        status: "PASS",
        counts,
        source_runtime_unchanged: true,
      },
    ]
      .flatMap((e) =>
        "exit_code" in e
          ? [
              { stage: e.stage, status: "STARTED" },
              { ...e, stdout_sha256: pin, stderr_sha256: pin },
            ]
          : [e],
      )
      .map((e, i) => ({
        at: `2026-09-29T15:00:${String(i).padStart(2, "0")}.000Z`,
        ...e,
      }));
    f.write("historical_plan", {
      status: "PLAN_ONLY",
      plan,
      plan_sha256: planPin,
    });
    f.write("historical_intent", {
      ownership_nonce: "a".repeat(64),
      plan,
      plan_sha256: planPin,
    });
    f.write("historical_result", result);
    const writeEvents = () => {
      const raw =
        events
          .map((event, index) => ({
            ...event,
            at: new Date(Date.UTC(2026, 8, 29, 15, 0, index)).toISOString(),
          }))
          .map(json)
          .map((s) => JSON.stringify(JSON.parse(s)))
          .join("\n") + "\n";
      writeFileSync(join(f.qaBundle, "historical_events.json"), raw);
      f.m.files.historical_events = {
        relative_path: "historical_events.json",
        sha256: hash(raw),
        size_bytes: Buffer.byteLength(raw),
      };
    };
    writeEvents();
    const accepted = await ingestNativeQaEvidence(f.store, f.qaOptions());
    assert.equal(
      accepted.historical_restore.status,
      "RECORDED_HISTORICAL_RESTORE",
    );
    assert.equal(accepted.historical_restore.counts.ug_entity, 103);
    assert.equal(accepted.counts.ug_entity, 1);
    assert.equal(
      accepted.historical_restore.current_package_restore,
      "NOT_RUN",
    );
    assert.equal(
      accepted.historical_restore.private_session_restore,
      "NOT_RUN",
    );
    const originalEvents = structuredClone(events);
    const mutations: [string, (rows: any[]) => void][] = [
      [
        "DB start failed",
        (rows) => {
          rows.find(
            (e) => e.stage === "DB_START" && "exit_code" in e,
          ).exit_code = 1;
        },
      ],
      [
        "PHP guard after web startup",
        (rows) => {
          const guard = rows.filter(
            (e) => e.stage === "GUARD_CHECK_BEFORE_PHP",
          );
          rows.splice(
            0,
            rows.length,
            ...rows.filter((e) => e.stage !== "GUARD_CHECK_BEFORE_PHP"),
          );
          rows.splice(
            rows.findIndex((e) => e.stage === "WEB_START" && "exit_code" in e) +
              1,
            0,
            ...guard,
          );
        },
      ],
      [
        "SQL success after dependent runtime probe",
        (rows) => {
          const at = rows.findIndex(
            (e) => e.stage === "SQL_IMPORT" && "exit_code" in e,
          );
          const completion = rows.splice(at, 1)[0];
          rows.splice(
            rows.findIndex((e) => e.stage === "PRE_CMS_ISOLATION"),
            0,
            completion,
          );
        },
      ],
      [
        "duplicate successful DB start",
        (rows) => {
          rows.splice(rows.findIndex((e) => e.stage === "DB_START") + 2, 0, {
            ...rows.find((e) => e.stage === "DB_START" && "exit_code" in e),
          });
        },
      ],
      [
        "missing start",
        (rows) => {
          rows.splice(
            rows.findIndex(
              (e) => e.stage === "WEB_START" && e.status === "STARTED",
            ),
            1,
          );
        },
      ],
      [
        "unknown completion",
        (rows) => {
          const at = rows.findIndex(
            (e) => e.stage === "PRE_CMS_RUNTIME_PROBE" && "exit_code" in e,
          );
          rows[at] = {
            stage: "PRE_CMS_RUNTIME_PROBE",
            status: "UNKNOWN_TIMEOUT",
          };
        },
      ],
      [
        "database never ready",
        (rows) => {
          rows
            .filter((e) => e.stage === "DB_READY" && "exit_code" in e)
            .at(-1).exit_code = 1;
        },
      ],
      [
        "poll after success",
        (rows) => {
          rows.find(
            (e) => e.stage === "DB_READY" && "exit_code" in e,
          ).exit_code = 0;
        },
      ],
      [
        "probe started before successful PHP guard",
        (rows) => {
          const at = rows.findIndex(
            (e) => e.stage === "GUARD_CHECK_BEFORE_PHP" && "exit_code" in e,
          );
          [rows[at], rows[at + 1]] = [rows[at + 1], rows[at]];
        },
      ],
    ];
    for (const [label, mutate] of mutations) {
      const changed = structuredClone(originalEvents);
      mutate(changed);
      events.splice(0, events.length, ...changed);
      writeEvents();
      await assert.rejects(
        ingestNativeQaEvidence(f.store, f.qaOptions()),
        /HISTORICAL_/,
        label,
      );
    }
    events.splice(0, events.length, ...originalEvents);
    writeEvents();
    events.find(
      (e) => e.stage === "GUARD_CHECK_FINAL" && "exit_code" in e,
    ).exit_code = 1;
    writeEvents();
    await assert.rejects(
      ingestNativeQaEvidence(f.store, f.qaOptions()),
      /HISTORICAL_COMMAND_TRANSITION_INVALID/,
    );
    events.find(
      (e) => e.stage === "GUARD_CHECK_FINAL" && "exit_code" in e,
    ).exit_code = 0;
    writeEvents();
    plan.source_target = "foreign";
    const changedPin = hash(JSON.stringify(canonical(plan)));
    f.write("historical_plan", {
      status: "PLAN_ONLY",
      plan,
      plan_sha256: changedPin,
    });
    f.write("historical_intent", {
      ownership_nonce: "a".repeat(64),
      plan,
      plan_sha256: changedPin,
    });
    f.write("historical_result", { ...result, plan_sha256: changedPin });
    await assert.rejects(
      ingestNativeQaEvidence(f.store, f.qaOptions()),
      /HISTORICAL_PLAN_INVALID/,
    );
  } finally {
    cleanup(f);
  }
});
