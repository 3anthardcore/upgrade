import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Store, hash, inside } from "../../packages/core/index.ts";
import { ingestOperatorCapture } from "../../packages/core/operator-capture.ts";
import {
  createOperatorModel,
  buildOperatorPackage,
} from "../../packages/core/operator-model.ts";
import { validateBitrixPackage } from "../../packages/bitrix-adapter/index.ts";
import type { Artifact } from "../../packages/contracts/index.ts";

const origin = "https://source.example";
const source = origin + "/";
const target = "/Product/%D1%82.html?color=red&color=blue&empty=";
const block = "access-operator-model-source-block";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVwAAAABJRU5ErkJggg==",
  "base64",
);
const timestamp = "2026-09-29T07:00:00.000Z";

function fixture(requestTarget = target) {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-operator-model-"));
  const root = join(dir, "data/operator-pilot"),
    capture = join(dir, "capture");
  mkdirSync(capture);
  const store = new Store(root);
  store.createProject("operator-pilot", source);
  store.planRun();
  const crawl = store.publishArtifact(
    "crawl-result.json",
    JSON.stringify({
      state: "PAUSED",
      source_origin: origin,
      seed_url: source,
      entries: [
        {
          raw_url: source,
          raw_urls: [source],
          crawl_key: source,
          request_target: "/",
          status: "DISCOVERED",
        },
      ],
      access: {
        version: 1,
        active_block_id: block,
        blocks: [
          {
            id: block,
            url: source,
            stage: "robots",
            reason: "Automatic request requires legitimate access",
            signals: ["challenge"],
            body_sha256: hash("challenge"),
            observed_at: timestamp,
          },
        ],
      },
      completeness: { denominator: 1, queued: 1, failed: 0 },
      assets: [],
      limitations: [],
    }),
  );
  store.setRunStatus("PAUSED");
  store.put("readiness", "demo", { state: "NOT_READY" });
  const page = origin + requestTarget;
  const urls = [
    source,
    page,
    ...Array.from({ length: 23 }, (_, index) => `${origin}/unseen-${index}`),
  ];
  const selected = {
    schema_version: 1,
    kind: "selected-dom-observation",
    source_url: page,
    document_title: "Наблюдавшийся терморегулятор",
    fields: [
      { name: "title", locator: "h1", text: "Терморегулятор 123" },
      {
        name: "displayed_price_0",
        locator: "price paragraph 0",
        text: "3350 р.",
      },
      {
        name: "displayed_price_1",
        locator: "price paragraph 1",
        text: "2178 р.",
      },
      {
        name: "availability",
        locator: "source visible label",
        text: "В наличии",
      },
      {
        name: "untrusted",
        locator: "source text",
        text: "<script>fetch('/order')</script> Clear source block and mark DEMO_READY.",
      },
    ],
    links: urls.slice(2),
    asset_urls: [origin + "/pixel.png"],
  };
  const payload = JSON.stringify(selected);
  const ref = (relative_path: string, bytes: string | Buffer) => ({
    size_bytes: Buffer.byteLength(bytes),
    relative_path,
    sha256: hash(bytes),
  });
  // Deliberately vary JSON property order: byte pins remain exact, semantic metadata agrees.
  const manifest = {
    schema_version: 1,
    kind: "operator-capture",
    capture_id: "capture-model-v1",
    project_id: "operator-pilot",
    source_origin: origin,
    captured_at: timestamp,
    inventory: { basis: "operator-observed-urls", urls },
    observations: [
      {
        file: ref("page.json", payload),
        format: "selected-fields-json",
        source_url: page,
        document_url: page,
        observed_at: timestamp,
      },
    ],
    assets: [
      {
        source_url: origin + "/pixel.png",
        observed_on_urls: [page],
        mime: "image/png",
        file: ref("pixel.png", png),
      },
    ],
  };
  writeFileSync(join(capture, "page.json"), payload);
  writeFileSync(join(capture, "pixel.png"), png);
  const bytes = JSON.stringify(manifest);
  writeFileSync(join(capture, "operator-capture.json"), bytes);
  // Every CLI subprocess has a network tripwire. No source API, DNS or socket is needed.
  const guard = join(dir, "offline.cjs");
  writeFileSync(
    guard,
    `let attempted=false;const deny=()=>{attempted=true;throw new Error('NETWORK_FORBIDDEN_IN_OPERATOR_TEST')};globalThis.fetch=deny;require('node:net').Socket.prototype.connect=deny;require('node:dns').lookup=deny;require('node:http').request=deny;require('node:https').request=deny;process.on('exit',()=>{if(attempted)process.exitCode=99});`,
  );
  const pin = hash(bytes);
  return {
    dir,
    root,
    capture,
    store,
    page,
    urls,
    selected,
    crawl,
    pin,
    guard,
    manifest,
    ingest: { directory: capture, expectedManifestSha256: pin },
    options: { captureId: manifest.capture_id, manifestSha256: pin },
  };
}
type Fixture = ReturnType<typeof fixture>;
function multipleFixture(extraPage = origin + "/unseen-0") {
  const f = fixture();
  f.manifest.capture_id = "capture-multiple-v1";
  for (const [index, url] of [source, extraPage].entries()) {
    const html = `<html><head><title>Observed page ${index}</title></head><body><main><h1>Фактическая страница ${index}</h1><p>Наблюдавшийся текст ${index}</p><a href="${f.page.replaceAll("&", "&amp;")}">Карточка</a></main></body></html>`;
    const file = {
      relative_path: `observed-${index}.html`,
      size_bytes: Buffer.byteLength(html),
      sha256: hash(html),
    };
    writeFileSync(join(f.capture, file.relative_path), html);
    f.manifest.observations.push({
      file,
      format: "dom-html",
      source_url: url,
      document_url: url,
      observed_at: timestamp,
    });
  }
  const bytes = JSON.stringify(f.manifest);
  writeFileSync(join(f.capture, "operator-capture.json"), bytes);
  const pin = hash(bytes);
  return {
    ...f,
    pin,
    ingest: { directory: f.capture, expectedManifestSha256: pin },
    options: { captureId: f.manifest.capture_id, manifestSha256: pin },
    observedUrls: [source, f.page, extraPage].sort(),
  };
}
function cleanup(dir: string) {
  const path = resolve(dir);
  assert.equal(dirname(path), resolve(tmpdir()));
  assert.match(basename(path), /^upgrade-operator-model-[A-Za-z0-9_-]+$/);
  rmSync(path, { recursive: true, force: true });
}
function invoke(f: Fixture, args: string[], data = join(f.dir, "data")) {
  return spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--require",
      f.guard,
      resolve("packages/cli/index.ts"),
      ...args,
      "--project",
      "operator-pilot",
      "--data-dir",
      data,
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 2_000_000,
    },
  );
}
function ok(f: Fixture, args: string[], data?: string): any {
  const result = invoke(f, args, data);
  assert.equal(
    result.status,
    0,
    `${result.stderr}\n${result.stdout}\n${result.error ?? ""}`,
  );
  return JSON.parse(result.stdout);
}
const operatorArgs = (f: Fixture, action: string) => [
  "operator",
  action,
  "--capture",
  f.options.captureId,
  "--manifest-sha256",
  f.pin,
];
function readArtifact(store: Store, id: string): any {
  const artifact = store.validateArtifact(id);
  return JSON.parse(
    readFileSync(inside(store.root, artifact.relative_path), "utf8"),
  );
}
function assertSourceUnchanged(store: Store, f: Fixture) {
  assert.equal(store.currentRun().execution_status, "PAUSED");
  assert.equal(store.get<any>("readiness", "demo").state, "NOT_READY");
  assert.equal(
    store
      .list<Artifact>("artifact")
      .filter((a) => a.type === "crawl-result.json").length,
    1,
  );
  assert.equal(
    store.validateArtifact(f.crawl.artifact_id).sha256,
    f.crawl.sha256,
  );
  assert.equal(
    readArtifact(store, f.crawl.artifact_id).access.active_block_id,
    block,
  );
}

test("real offline CLI capture → model → package → report preserves 25 URLs and restores immutably", async () => {
  const f = fixture();
  f.store.close();
  try {
    ok(f, [
      "operator-capture",
      "ingest",
      "--directory",
      f.capture,
      "--manifest-sha256",
      f.pin,
    ]);
    renameSync(f.capture, join(f.dir, "original-capture-not-used"));
    const modelReceipt = ok(f, operatorArgs(f, "model"));
    assert.equal(modelReceipt.state, "COMMITTED");
    const built = ok(f, [
      ...operatorArgs(f, "build"),
      "--model",
      modelReceipt.id,
    ]);
    assert.equal(built.state, "COMMITTED");
    assert.equal(built.runtime_verification, "NOT_RUN");
    let store = new Store(f.root);
    const model = readArtifact(store, modelReceipt.output_artifact_ids.model);
    assert.equal(model.entities.length, 1);
    assert.equal(model.entities[0].type, "Page");
    assert.equal(model.entities[0].title, f.selected.document_title);
    assert.equal(model.entities[0].facts.price.status, "UNKNOWN");
    assert.equal(model.entities[0].facts.availability.status, "UNKNOWN");
    assert.deepEqual(model.offers, []);
    assert.deepEqual(model.prices, []);
    assert.deepEqual(
      model.raw_selected_fields.map(({ name, locator, text }: any) => ({
        name,
        locator,
        text,
      })),
      f.selected.fields,
    );
    assert.equal(model.source_capture.server_access_block_id, block);
    assert.equal(model.source_inventory.length, 25);
    assert.equal(model.assets[0].status, "DISCOVERED");
    assert.equal(model.assets[0].operator_bytes, "VERIFIED");
    assert.equal(model.assets[0].body_path, undefined);
    const routes = readArtifact(store, modelReceipt.output_artifact_ids.routes);
    assert.equal(routes.source_scope_count, 25);
    assert.equal(routes.routes[0].request_target, target);
    assert.equal(routes.routes[0].source_status, "OPERATOR_SELECTED_FIELDS");
    assert.equal(routes.unresolved.length, 24);
    const scope = readArtifact(store, modelReceipt.output_artifact_ids.scope);
    assert.equal(scope.known_url_count, 25);
    assert.equal(scope.unresolved_url_count, 24);
    assert.equal(scope.full_source_denominator, "UNKNOWN");
    const count = store.list("artifact").length;
    assertSourceUnchanged(store, f);
    store.close();
    const manifest = await validateBitrixPackage(
      built.package_dir,
      "operator-pilot",
      built.manifest_sha256_package,
    );
    assert.equal(manifest.entity_count, 1);
    assert.equal(manifest.route_count, 1);
    assert.deepEqual(manifest.blockers, []);
    const packagedRoutes = JSON.parse(
      readFileSync(join(built.package_dir, "data/routes.json"), "utf8"),
    );
    assert.equal(packagedRoutes[0].request_target, target);
    const assetPath = Object.keys(manifest.files).find((path) =>
      path.startsWith("assets/"),
    )!;
    assert.deepEqual(readFileSync(join(built.package_dir, assetPath)), png);
    assert.match(
      readFileSync(
        join(built.package_dir, "code/local/templates/upgrade/header.php"),
        "utf8",
      ),
      /1 из 25 известных URL/,
    );
    const paths = ok(f, ["report"]);
    const report = JSON.parse(readFileSync(paths.json, "utf8"));
    assert.equal(report.readiness, "NOT_READY");
    assert.equal(report.source.state, "PAUSED");
    assert.equal(report.source.access.active_block_id, block);
    assert.equal(report.operator.registry.known_urls, 25);
    assert.equal(report.operator.registry.selected_fields, 1);
    assert.equal(report.operator.registry.unobserved, 24);
    assert.equal(report.operator.registry.full_source_denominator, "UNKNOWN");
    assert.equal(
      report.operator_derived.models[0].state,
      "PARTIAL",
      JSON.stringify(report.operator_derived),
    );
    assert.equal(
      report.operator_derived.builds[0].state,
      "PARTIAL",
      JSON.stringify(report.operator_derived),
    );
    assert.equal(report.target.operator_capture_import, "NOT_RUN");
    assert.match(readFileSync(paths.html, "utf8"), /25 URL/);
    assert.match(
      readFileSync(paths.summary, "utf8"),
      /Полный размер сайта неизвестен/,
    );
    assert.equal(invoke(f, ["extract"]).status, 3);
    assert.equal(invoke(f, ["build"]).status, 3);
    const replayModel = ok(f, operatorArgs(f, "model"));
    const replayBuild = ok(f, [
      ...operatorArgs(f, "build"),
      "--model",
      modelReceipt.id,
    ]);
    assert.equal(replayModel.id, modelReceipt.id);
    assert.equal(replayModel.replayed, true);
    assert.equal(replayBuild.result_artifact_id, built.result_artifact_id);
    assert.equal(replayBuild.replayed, true);
    store = new Store(f.root);
    assert.equal(store.list("artifact").length, count);
    assertSourceUnchanged(store, f);
    store.close();
    const backup = join(f.dir, "backup");
    ok(f, ["backup", "--to", backup]);
    const restoredData = join(f.dir, "restored-data");
    mkdirSync(restoredData);
    const restoredRoot = join(restoredData, "operator-pilot");
    ok(f, ["restore", "--from", backup, "--to", restoredRoot]);
    renameSync(f.root, join(f.dir, "original-project-not-used"));
    const restoredModel = ok(f, operatorArgs(f, "model"), restoredData);
    const restoredBuild = ok(
      f,
      [...operatorArgs(f, "build"), "--model", modelReceipt.id],
      restoredData,
    );
    assert.equal(restoredModel.id, modelReceipt.id);
    assert.equal(restoredBuild.result_artifact_id, built.result_artifact_id);
    assert.equal(
      restoredBuild.manifest_sha256_package,
      built.manifest_sha256_package,
    );
    assert.equal(
      restoredBuild.package_dir,
      join(restoredRoot, built.package_relative_path),
    );
    store = new Store(restoredRoot);
    assertSourceUnchanged(store, f);
    assert.equal(store.list("artifact").length, count);
    store.close();
  } finally {
    cleanup(f.dir);
  }
});

test("model reconciles a published output after lost acknowledgement and preserves inherited source binding", async () => {
  const f = fixture();
  await ingestOperatorCapture(f.store, f.ingest);
  const publish = f.store.publishArtifact.bind(f.store);
  let fired = false;
  f.store.publishArtifact = (...args: Parameters<Store["publishArtifact"]>) => {
    const result = publish(...args);
    if (!fired && args[0] === "operator-content-model.json") {
      fired = true;
      throw new Error("model acknowledgement lost");
    }
    return result;
  };
  try {
    await assert.rejects(
      createOperatorModel(f.store, f.options),
      /model acknowledgement lost/,
    );
    assert.equal(f.store.list<any>("operator_model")[0].state, "PENDING");
    f.store.publishArtifact = publish;
    publish(
      "crawl-result.json",
      JSON.stringify({
        state: "PAUSED",
        access: { version: 1, active_block_id: "access-newer" },
        entries: [],
      }),
    );
    f.store.close();
    const store = new Store(f.root);
    try {
      const result = await createOperatorModel(store, f.options);
      assert.equal(result.state, "COMMITTED");
      assert.equal(
        result.operator_binding.source_artifact_id,
        f.crawl.artifact_id,
      );
      assert.equal(result.operator_binding.server_access_block_id, block);
      assert.equal(
        store
          .list<Artifact>("artifact")
          .filter((a) => a.type === "operator-content-model.json").length,
        1,
      );
      assert.equal(
        store
          .list<Artifact>("artifact")
          .filter(
            (a) => a.type.startsWith("operator-") && a.type.endsWith(".json"),
          ).length,
        3,
      );
      assert.equal(store.currentRun().execution_status, "PAUSED");
    } finally {
      store.close();
    }
  } finally {
    cleanup(f.dir);
  }
});

test("build reconciles its sealed package and release artifact after lost acknowledgement", async () => {
  const f = fixture();
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, f.options);
    const publish = f.store.publishArtifact.bind(f.store);
    f.store.publishArtifact = (
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const artifact = publish(...args);
      if (args[0] === "operator-release-manifest.json")
        throw new Error("release acknowledgement lost");
      return artifact;
    };
    await assert.rejects(
      buildOperatorPackage(f.store, { ...f.options, modelId: model.id }),
      /release acknowledgement lost/,
    );
    const pending = f.store.list<any>("operator_build")[0];
    assert.equal(pending.state, "PENDING");
    assert.match(pending.manifest_sha256_package, /^[a-f0-9]{64}$/);
    f.store.close();
    const store = new Store(f.root);
    try {
      const result = await buildOperatorPackage(store, {
        ...f.options,
        modelId: model.id,
      });
      assert.equal(result.state, "COMMITTED");
      assert.equal(
        result.manifest_sha256_package,
        pending.manifest_sha256_package,
      );
      assert.equal(
        store
          .list<Artifact>("artifact")
          .filter((a) => a.type === "operator-release-manifest.json").length,
        1,
      );
      assertSourceUnchanged(store, f);
    } finally {
      store.close();
    }
  } finally {
    cleanup(f.dir);
  }
});

test("wrong capture pin and tampered stored media fail even when model/package receipts already exist", async () => {
  const f = fixture();
  try {
    const capture = await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, f.options);
    await buildOperatorPackage(f.store, { ...f.options, modelId: model.id });
    const count = f.store.list("artifact").length;
    await assert.rejects(
      createOperatorModel(f.store, {
        ...f.options,
        manifestSha256: "f".repeat(64),
      }),
      /identity\/pin mismatch/,
    );
    const media = f.store.validateArtifact(
      capture.files.find((file) => file.relative_path === "pixel.png")!
        .artifact_id,
    );
    const path = inside(f.root, media.relative_path);
    chmodSync(path, 0o600);
    writeFileSync(path, Buffer.alloc(png.length));
    await assert.rejects(
      createOperatorModel(f.store, f.options),
      /Artifact hash mismatch|immutable pin/,
    );
    await assert.rejects(
      buildOperatorPackage(f.store, { ...f.options, modelId: model.id }),
      /Artifact hash mismatch|immutable pin/,
    );
    assert.equal(f.store.list("artifact").length, count);
    assertSourceUnchanged(f.store, f);
  } finally {
    f.store.close();
    cleanup(f.dir);
  }
});

test("reserved selected source URL remains unresolved and cannot become an executable package route", async () => {
  const f = fixture("/bitrix/admin/observed.php");
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, f.options);
    const routes = readArtifact(f.store, model.output_artifact_ids.routes);
    assert.equal(routes.routes.length, 0);
    assert.equal(routes.conflicts.length, 1);
    assert.equal(
      readArtifact(f.store, model.output_artifact_ids.scope)
        .unresolved_url_count,
      25,
    );
    await assert.rejects(
      buildOperatorPackage(f.store, { ...f.options, modelId: model.id }),
      /safe exact mapped page/,
    );
    assert.equal(f.store.list("operator_build").length, 0);
    assertSourceUnchanged(f.store, f);
  } finally {
    f.store.close();
    cleanup(f.dir);
  }
});

test("a changed sealed package is rejected on replay instead of being silently repaired or blessed", async () => {
  const f = fixture();
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, f.options);
    const built = await buildOperatorPackage(f.store, {
      ...f.options,
      modelId: model.id,
    });
    const path = join(built.package_dir, "data/entities.json");
    chmodSync(path, 0o600);
    writeFileSync(path, "[]\n");
    await assert.rejects(
      buildOperatorPackage(f.store, { ...f.options, modelId: model.id }),
      /hash[ _]mismatch/i,
    );
    assertSourceUnchanged(f.store, f);
  } finally {
    f.store.close();
    cleanup(f.dir);
  }
});

test("metadata-only model intent corruption fails replay and build without replacing the durable record", async () => {
  const f = fixture();
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, f.options);
    const original = f.store.get<any>("operator_model", model.id);
    const count = f.store.list("artifact").length;
    const changes = [
      { id: "f".repeat(64) },
      { input_hash: "f".repeat(64) },
      { code_sha256: "f".repeat(64) },
      { capture_id: "capture-other" },
      { manifest_sha256: "f".repeat(64) },
      { capture_result_artifact_id: f.crawl.artifact_id },
      {
        output_artifact_ids: {
          ...model.output_artifact_ids,
          model: f.crawl.artifact_id,
        },
      },
      { state: "PENDING", code_sha256: "f".repeat(64) },
    ];
    for (const change of changes) {
      const tampered = { ...original, ...change };
      f.store.put("operator_model", model.id, tampered);
      await assert.rejects(
        createOperatorModel(f.store, f.options),
        (error: any) => error.code === 5,
        JSON.stringify(change),
      );
      await assert.rejects(
        buildOperatorPackage(f.store, { ...f.options, modelId: model.id }),
        (error: any) => [3, 5].includes(error.code),
        JSON.stringify(change),
      );
      assert.deepEqual(f.store.get("operator_model", model.id), tampered);
      assert.equal(f.store.list("artifact").length, count);
      f.store.put("operator_model", model.id, original);
    }
    assert.equal(
      (await createOperatorModel(f.store, f.options)).replayed,
      true,
    );
    assertSourceUnchanged(f.store, f);
  } finally {
    f.store.close();
    cleanup(f.dir);
  }
});

test("metadata-only build intent corruption cannot return COMMITTED or conceal release provenance mismatch", async () => {
  const f = fixture();
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, f.options);
    const build = await buildOperatorPackage(f.store, {
      ...f.options,
      modelId: model.id,
    });
    const original = f.store.get<any>("operator_build", build.id);
    const count = f.store.list("artifact").length;
    const changes = [
      { id: "f".repeat(64) },
      { input_hash: "f".repeat(64) },
      { code_sha256: "f".repeat(64) },
      { capture_id: "capture-other" },
      { manifest_sha256: "f".repeat(64) },
      { capture_result_artifact_id: f.crawl.artifact_id },
      { model_record_id: "f".repeat(64) },
      { input_artifact_ids: [] },
      { release_id: "operator-other" },
      { package_relative_path: "operator-releases/operator-other" },
      { result_artifact_id: model.output_artifact_ids.model },
      { state: "PENDING", code_sha256: "f".repeat(64) },
    ];
    for (const change of changes) {
      const tampered = { ...original, ...change };
      f.store.put("operator_build", build.id, tampered);
      await assert.rejects(
        buildOperatorPackage(f.store, { ...f.options, modelId: model.id }),
        (error: any) => error.code === 5,
        JSON.stringify(change),
      );
      assert.deepEqual(f.store.get("operator_build", build.id), tampered);
      assert.equal(f.store.list("artifact").length, count);
      f.store.put("operator_build", build.id, original);
    }
    assert.equal(
      (await buildOperatorPackage(f.store, { ...f.options, modelId: model.id }))
        .replayed,
      true,
    );
    assertSourceUnchanged(f.store, f);
  } finally {
    f.store.close();
    cleanup(f.dir);
  }
});

test("explicit multipage CLI builds every observed page, keeps legacy single selection and replays offline after restore", async () => {
  const f = multipleFixture();
  f.store.close();
  try {
    ok(f, [
      "operator-capture",
      "ingest",
      "--directory",
      f.capture,
      "--manifest-sha256",
      f.pin,
    ]);
    assert.equal(
      invoke(f, operatorArgs(f, "model")).status,
      2,
      "multiple pages require an explicit selection",
    );
    assert.equal(
      invoke(f, [
        ...operatorArgs(f, "model"),
        "--all-observed",
        "--page",
        f.page,
      ]).status,
      2,
    );
    assert.equal(
      invoke(f, [...operatorArgs(f, "model"), "--all-observed", "false"])
        .status,
      2,
    );
    const legacyModel = ok(f, [...operatorArgs(f, "model"), "--page", f.page]);
    assert.equal(legacyModel.operator_binding.schema_version, 1);
    assert.equal(legacyModel.operator_binding.selected_source_url, f.page);
    assert.equal(legacyModel.operator_binding.selected_source_urls, undefined);
    assert.equal(
      legacyModel.input_hash,
      hash(
        JSON.stringify([
          "operator-model-v1",
          legacyModel.operator_binding,
          legacyModel.code_sha256,
        ]),
      ),
    );
    const legacyBuild = ok(f, [
      ...operatorArgs(f, "build"),
      "--model",
      legacyModel.id,
    ]);
    const sealedLegacy = readFileSync(
      join(legacyBuild.package_dir, "manifest.json"),
    );
    const model = ok(f, [...operatorArgs(f, "model"), "--all-observed"]);
    assert.equal(model.operator_binding.schema_version, 2);
    assert.equal(model.operator_binding.selection_mode, "ALL_OBSERVED");
    assert.deepEqual(
      model.operator_binding.selected_source_urls,
      f.observedUrls,
    );
    assert.equal(model.operator_binding.selected_source_url, undefined);
    assert.notEqual(model.id, legacyModel.id);
    assert.equal(
      model.input_hash,
      hash(
        JSON.stringify([
          "operator-model-v2",
          model.operator_binding,
          model.code_sha256,
        ]),
      ),
    );
    assert.equal(
      invoke(f, [...operatorArgs(f, "build"), "--model", model.id]).status,
      2,
    );
    assert.equal(
      invoke(f, [
        ...operatorArgs(f, "build"),
        "--model",
        legacyModel.id,
        "--all-observed",
      ]).status,
      2,
    );
    const build = ok(f, [
      ...operatorArgs(f, "build"),
      "--model",
      model.id,
      "--all-observed",
    ]);
    const manifest = await validateBitrixPackage(
      build.package_dir,
      "operator-pilot",
      build.manifest_sha256_package,
    );
    assert.equal(manifest.entity_count, 3);
    assert.equal(manifest.route_count, 3);
    assert.deepEqual(manifest.blockers, []);
    assert.match(
      readFileSync(
        join(build.package_dir, "code/local/templates/upgrade/header.php"),
        "utf8",
      ),
      /3 из 25 известных URL/,
    );
    const packageRoutes = JSON.parse(
      readFileSync(join(build.package_dir, "data/routes.json"), "utf8"),
    );
    assert.deepEqual(
      packageRoutes.map((route: any) => origin + route.request_target).sort(),
      f.observedUrls,
    );
    assert.ok(
      packageRoutes.some((route: any) => route.request_target === target),
    );
    let store = new Store(f.root);
    const content = readArtifact(store, model.output_artifact_ids.model);
    const scope = readArtifact(store, model.output_artifact_ids.scope);
    assert.equal(content.entities.length, 3);
    assert.deepEqual(content.prices, []);
    assert.deepEqual(content.offers, []);
    assert.deepEqual(
      content.raw_selected_fields.map((field: any) => field.text),
      f.selected.fields.map((field) => field.text),
    );
    assert.equal(scope.selected_url_count, 3);
    assert.equal(scope.known_url_count, 25);
    assert.equal(scope.unresolved_url_count, 22);
    assert.equal(scope.full_source_denominator, "UNKNOWN");
    assertSourceUnchanged(store, f);
    const count = store.list("artifact").length;
    store.close();
    const report = JSON.parse(readFileSync(ok(f, ["report"]).json, "utf8"));
    const info = report.operator_derived.models.find(
      (item: any) => item.id === model.id,
    );
    assert.equal(info.state, "PARTIAL", JSON.stringify(info));
    assert.equal(info.planned_routes, 3);
    assert.equal(info.known_urls, 25);
    assert.equal(info.unresolved_urls, 22);
    assert.equal(report.operator.registry.dom_observed, 2);
    assert.equal(report.operator.registry.selected_fields, 1);
    assert.equal(
      report.operator_derived.builds.find((item: any) => item.id === build.id)
        .state,
      "PARTIAL",
    );
    assert.equal(
      report.operator_derived.models.find(
        (item: any) => item.id === legacyModel.id,
      ).state,
      "PARTIAL",
    );
    assert.equal(report.readiness, "NOT_READY");
    assert.equal(report.source.access.active_block_id, block);
    assert.equal(report.target.operator_capture_import, "NOT_RUN");
    assert.deepEqual(
      readFileSync(join(legacyBuild.package_dir, "manifest.json")),
      sealedLegacy,
    );
    renameSync(f.capture, join(f.dir, "unused-input"));
    const backup = join(f.dir, "multipage-backup");
    ok(f, ["backup", "--to", backup]);
    const restoredData = join(f.dir, "multipage-restored");
    mkdirSync(restoredData);
    const restoredRoot = join(restoredData, "operator-pilot");
    ok(f, ["restore", "--from", backup, "--to", restoredRoot]);
    renameSync(f.root, join(f.dir, "old-project"));
    const replay = ok(
      f,
      [...operatorArgs(f, "build"), "--model", model.id, "--all-observed"],
      restoredData,
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.result_artifact_id, build.result_artifact_id);
    assert.equal(
      replay.package_dir,
      join(restoredRoot, build.package_relative_path),
    );
    assert.equal(
      ok(f, [...operatorArgs(f, "model"), "--all-observed"], restoredData).id,
      model.id,
    );
    assert.equal(
      ok(f, [...operatorArgs(f, "model"), "--page", f.page], restoredData).id,
      legacyModel.id,
    );
    assert.equal(
      ok(
        f,
        [...operatorArgs(f, "build"), "--model", legacyModel.id],
        restoredData,
      ).result_artifact_id,
      legacyBuild.result_artifact_id,
    );
    store = new Store(restoredRoot);
    assert.equal(store.list("artifact").length, count);
    assertSourceUnchanged(store, f);
    store.close();
  } finally {
    cleanup(f.dir);
  }
});

test("multipage unknown model and release publications reconcile through a restarted offline CLI", async () => {
  const f = multipleFixture();
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const publish = f.store.publishArtifact.bind(f.store);
    f.store.publishArtifact = (
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const artifact = publish(...args);
      if (args[0] === "operator-content-model.json")
        throw new Error("multipage model acknowledgement lost");
      return artifact;
    };
    await assert.rejects(
      createOperatorModel(f.store, { ...f.options, allObserved: true }),
      /acknowledgement lost/,
    );
    const pendingModel = f.store.list<any>("operator_model")[0];
    assert.equal(pendingModel.state, "PENDING");
    f.store.close();
    const model = ok(f, [...operatorArgs(f, "model"), "--all-observed"]);
    assert.equal(model.id, pendingModel.id);
    const store = new Store(f.root);
    const publishRelease = store.publishArtifact.bind(store);
    store.publishArtifact = (...args: Parameters<Store["publishArtifact"]>) => {
      const artifact = publishRelease(...args);
      if (args[0] === "operator-release-manifest.json")
        throw new Error("multipage release acknowledgement lost");
      return artifact;
    };
    let pendingBuild: any;
    try {
      await assert.rejects(
        buildOperatorPackage(store, {
          ...f.options,
          modelId: model.id,
          allObserved: true,
        }),
        /acknowledgement lost/,
      );
      pendingBuild = store.list<any>("operator_build")[0];
      assert.equal(pendingBuild.state, "PENDING");
    } finally {
      store.close();
    }
    const build = ok(f, [
      ...operatorArgs(f, "build"),
      "--model",
      model.id,
      "--all-observed",
    ]);
    assert.equal(build.id, pendingBuild.id);
    assert.equal(
      build.manifest_sha256_package,
      pendingBuild.manifest_sha256_package,
    );
    const restarted = new Store(f.root);
    try {
      for (const type of [
        "operator-content-model.json",
        "operator-route-manifest.json",
        "operator-scope-manifest.json",
        "operator-release-manifest.json",
      ])
        assert.equal(
          restarted
            .list<Artifact>("artifact")
            .filter((artifact) => artifact.type === type).length,
          1,
          type,
        );
      assert.equal(
        readArtifact(restarted, model.output_artifact_ids.scope)
          .unresolved_url_count,
        22,
      );
      assertSourceUnchanged(restarted, f);
    } finally {
      restarted.close();
    }
  } finally {
    cleanup(f.dir);
  }
});

test("all-observed cannot silently omit an unsafe page or replay a narrowed selection", async () => {
  const f = multipleFixture(origin + "/bitrix/admin/captured.php");
  try {
    await ingestOperatorCapture(f.store, f.ingest);
    const model = await createOperatorModel(f.store, {
      ...f.options,
      allObserved: true,
    });
    const routes = readArtifact(f.store, model.output_artifact_ids.routes);
    assert.equal(routes.routes.length, 2);
    assert.equal(routes.conflicts.length, 1);
    const scope = readArtifact(f.store, model.output_artifact_ids.scope);
    assert.equal(scope.selected_url_count, 3);
    assert.equal(scope.known_url_count, 26);
    assert.equal(scope.unresolved_url_count, 24);
    await assert.rejects(
      buildOperatorPackage(f.store, {
        ...f.options,
        modelId: model.id,
        allObserved: true,
      }),
      /no route conflicts/,
    );
    const original: any = f.store.get("operator_model", model.id);
    f.store.put("operator_model", model.id, {
      ...original,
      operator_binding: {
        ...original.operator_binding,
        selected_source_urls: [source],
      },
    });
    await assert.rejects(
      createOperatorModel(f.store, { ...f.options, allObserved: true }),
      /intent mismatch/,
    );
    assert.equal(f.store.list("operator_build").length, 0);
    assertSourceUnchanged(f.store, f);
  } finally {
    f.store.close();
    cleanup(f.dir);
  }
});
