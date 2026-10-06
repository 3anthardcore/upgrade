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
import {
  ingestNativeRuntimeEvidence,
  readNativeRuntimeEvidence,
} from "../../packages/core/native-runtime-evidence.ts";
import { writeReport } from "../../packages/reporter/index.ts";
import type { Artifact } from "../../packages/contracts/index.ts";

const json = (v: any) => JSON.stringify(v, null, 2) + "\n";
const project = "evidence-pilot",
  target = "dedicated-demo";
const origin = "https://source.example",
  source = origin + "/product?x=&x=2";
async function fixture(assetCount = 0) {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-target-evidence-"));
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

function phpValue(v: any): any {
  if (Array.isArray(v)) return v.map(phpValue);
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    return e.every(([k], i) => k === String(i))
      ? e.map(([, x]) => phpValue(x))
      : Object.fromEntries(e.map(([k, x]) => [k, phpValue(x)]));
  }
  return v;
}
async function runtimeFixture() {
  const f = await fixture();
  const imported = await ingestTargetEvidence(f.store, f.options());
  const bundle = join(f.dir, "runtime-bundle");
  mkdirSync(bundle);
  const snapshotBytes = readFileSync(
      join(f.build.package_dir, "data/demo-snapshot.json"),
    ),
    snapshot = JSON.parse(snapshotBytes.toString());
  const entities = JSON.parse(
    readFileSync(join(f.build.package_dir, "data/entities.json"), "utf8"),
  );
  const docs: any = {
    facts_before: {
      scope: "READ_ONLY_NATIVE_FACTS_AND_COUNTS",
      pass: true,
      manifest_sha256: f.build.manifest_sha256_package,
      counts: {
        ug_entity: 1,
        ug_route: 1,
        ug_operation: 1,
        b_sale_order: 0,
        b_event: 0,
        b_user: 1,
      },
      facts: entities.map((e: any) => {
        const raw = Buffer.from(
          JSON.stringify(phpValue(e.facts ?? []))
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029"),
        );
        return {
          entity_key: e.stable_key,
          bitrix_id: 10,
          stored_bytes: Math.min(raw.length, 65535),
          raw_bytes: raw.length,
          raw_sha256: hash(raw),
          expected_sha256: hash(raw),
          pass: true,
        };
      }),
      full_readiness: "NOT_READY",
    },
  };
  docs.facts_after = structuredClone(docs.facts_before);
  const resultArtifact = f.store.get<Artifact>(
    "artifact",
    imported.result_artifact_id!,
  );
  const manifest: any = {
    ...f.evidence,
    kind: "native-runtime-evidence",
    target_evidence: {
      record_id: imported.id,
      result_artifact_id: resultArtifact.artifact_id,
      sha256: resultArtifact.sha256,
    },
    snapshot: { id: snapshot.snapshot_id, sha256: hash(snapshotBytes) },
    origin: "https://demo.example",
    code_pins: {},
    files: {},
  };
  const pin = () => {
    manifest.files = {};
    for (const [role, value] of Object.entries(docs)) {
      const bytes = Buffer.from(json(value));
      const relative_path = role + ".json";
      writeFileSync(join(bundle, relative_path), bytes);
      manifest.files[role] = {
        relative_path,
        sha256: hash(bytes),
        size_bytes: bytes.length,
      };
    }
    const bytes = json(manifest);
    writeFileSync(join(bundle, "native-runtime-evidence.json"), bytes);
    return hash(bytes);
  };
  const options = () => ({
    buildId: f.build.id,
    directory: bundle,
    expectedManifestSha256: pin(),
  });
  return {
    ...f,
    docs,
    runtimeManifest: manifest,
    runtimeBundle: bundle,
    runtimeOptions: options,
  };
}
type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
function cleanup(f: Fixture) {
  f.store.close();
  assert.equal(dirname(resolve(f.dir)), resolve(tmpdir()));
  assert.match(basename(f.dir), /^upgrade-target-evidence-/);
  rmSync(f.dir, { recursive: true, force: true });
}

test("stored receipt tampering is INVALID and cannot be replayed as committed", async () => {
  const f = await runtimeFixture();
  try {
    const r = await ingestNativeRuntimeEvidence(f.store, f.runtimeOptions());
    const record = f.store.get<any>("native_runtime_evidence", r.id),
      a = f.store.get<Artifact>(
        "artifact",
        record.file_artifact_ids.facts_before,
      ),
      path = inside(f.root, a.relative_path);
    chmodSync(path, 0o600);
    writeFileSync(path, "{}");
    assert.equal(
      readNativeRuntimeEvidence(f.store, new Set([f.build.id]), f.build.id)[0]
        .integrity,
      "UNVERIFIED",
    );
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /PIN/,
    );
    assert.equal(
      f.store.get<any>("native_runtime_evidence", r.id).state,
      "COMMITTED",
    );
  } finally {
    cleanup(f);
  }
});
test("pending record with an unlisted receipt reference is rejected without resetting it", async () => {
  const f = await runtimeFixture();
  try {
    const publish = f.store.publishArtifact.bind(f.store);
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      if (args[0].startsWith("native-runtime-"))
        throw Error("PAUSE_BEFORE_PUBLICATION");
      return publish(...args);
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /PAUSE_BEFORE/,
    );
    f.store.publishArtifact = publish;
    const r = f.store.list<any>("native_runtime_evidence")[0];
    r.file_artifact_ids.unknown = "art-unlisted";
    f.store.transaction(() => f.store.put("native_runtime_evidence", r.id, r));
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /PENDING_FILESET/,
    );
    assert.equal(
      f.store.get<any>("native_runtime_evidence", r.id).file_artifact_ids
        .unknown,
      "art-unlisted",
    );
  } finally {
    cleanup(f);
  }
});

test("real Store ingest commits pinned evidence and cold restart reuses the same immutable result", async () => {
  const f = await runtimeFixture();
  try {
    const result = await ingestNativeRuntimeEvidence(
      f.store,
      f.runtimeOptions(),
    );
    assert.equal(result.checks.database_unchanged, "PASS");
    assert.equal(result.checks.browser, "NOT_RUN");
    assert.equal(result.readiness, "NOT_READY");
    const count = f.store.list("artifact").length;
    f.store.close();
    f.store = new Store(f.root);
    const replay = await ingestNativeRuntimeEvidence(
      f.store,
      f.runtimeOptions(),
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.result_artifact_id, result.result_artifact_id);
    assert.equal(f.store.list("artifact").length, count);
    const rows = readNativeRuntimeEvidence(
      f.store,
      new Set([f.build.id]),
      f.build.id,
    );
    assert.equal(rows[0].integrity, "VERIFIED");
    assert.equal(rows[0].binding_status, "CURRENT");
    assert.equal(
      readNativeRuntimeEvidence(
        f.store,
        new Set([f.build.id]),
        hash("new-current-build"),
      )[0].binding_status,
      "STALE",
    );
  } finally {
    cleanup(f);
  }
});
test("tampered bundle bytes and foreign target/build/package pins cannot create pending evidence", async () => {
  const f = await runtimeFixture();
  try {
    const opts = f.runtimeOptions();
    writeFileSync(join(f.runtimeBundle, "facts_before.json"), "{}");
    await assert.rejects(ingestNativeRuntimeEvidence(f.store, opts), /PIN/);
    assert.equal(f.store.list("native_runtime_evidence").length, 0);
    for (const k of [
      "target_id",
      "build_record_id",
      "package_manifest_sha256",
    ]) {
      const old = f.runtimeManifest[k];
      f.runtimeManifest[k] =
        k === "target_id" ? "foreign-demo" : hash("foreign");
      await assert.rejects(
        ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      );
      f.runtimeManifest[k] = old;
      assert.equal(f.store.list("native_runtime_evidence").length, 0);
    }
  } finally {
    cleanup(f);
  }
});
test("loss of reply after artifact publication resumes PENDING by exact bytes without duplicate artifacts", async () => {
  const f = await runtimeFixture();
  try {
    const publish = f.store.publishArtifact.bind(f.store);
    let once = false;
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const value = publish(...args);
      if (
        !once &&
        args[0].startsWith("native-runtime-") &&
        args[0].endsWith("-facts_before.json")
      ) {
        once = true;
        throw Error("LOST_PUBLICATION_REPLY");
      }
      return value;
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /LOST_PUBLICATION/,
    );
    const pending = f.store.list<any>("native_runtime_evidence")[0];
    assert.equal(pending.state, "PENDING");
    const prior = f.store
      .list<Artifact>("artifact")
      .find((a) => a.type.endsWith("-facts_before.json"))!;
    f.store.close();
    f.store = new Store(f.root);
    const result = await ingestNativeRuntimeEvidence(
      f.store,
      f.runtimeOptions(),
    );
    assert.equal(result.state, "RECORDED_NATIVE_RUNTIME");
    assert.equal(
      f.store.get<any>("native_runtime_evidence", result.id).file_artifact_ids
        .facts_before,
      prior.artifact_id,
    );
    assert.equal(
      f.store.list<Artifact>("artifact").filter((a) => a.type === prior.type)
        .length,
      1,
    );
  } finally {
    cleanup(f);
  }
});
test("authoritative Store key corruption fails closed on replay", async () => {
  const f = await runtimeFixture();
  try {
    const result = await ingestNativeRuntimeEvidence(
      f.store,
      f.runtimeOptions(),
    );
    const record = f.store.get<any>("native_runtime_evidence", result.id);
    f.store.transaction(() =>
      f.store.put("native_runtime_evidence", result.id, {
        ...record,
        id: hash("wrong-id"),
      }),
    );
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /RECORD_KEY/,
    );
  } finally {
    cleanup(f);
  }
});
test("ownership takeover after publication cannot overwrite successor receipt metadata", async () => {
  const f = await runtimeFixture(),
    other = new Store(f.root);
  try {
    const publish = f.store.publishArtifact.bind(f.store);
    let once = false;
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const value = publish(...args);
      if (!once && args[0].startsWith("native-runtime-")) {
        once = true;
        const run = other.currentRun();
        run.dispatcher_until = 0;
        other.transaction(() => other.put("run", run.run_id, run));
        other.acquireDispatcher(run.run_id, "successor");
        const record = other.list<any>("native_runtime_evidence")[0];
        other.transaction(() =>
          other.put("native_runtime_evidence", record.id, {
            ...record,
            successor: "preserved",
          }),
        );
      }
      return value;
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /ownership lost/,
    );
    assert.equal(once, true);
    assert.equal(
      other.list<any>("native_runtime_evidence")[0].successor,
      "preserved",
    );
    assert.equal(other.currentRun().dispatcher_owner, "successor");
  } finally {
    other.close();
    cleanup(f);
  }
});
test("publication guard rejects takeover before artifact Store metadata publication", async () => {
  const f = await runtimeFixture(),
    other = new Store(f.root);
  try {
    const publish = f.store.publishArtifact.bind(f.store),
      transaction = f.store.transaction.bind(f.store);
    let once = false,
      publishing = false;
    f.store.transaction = ((fn: any) => {
      if (publishing && !once) {
        once = true;
        const r = other.currentRun();
        r.dispatcher_until = 0;
        other.transaction(() => other.put("run", r.run_id, r));
        other.acquireDispatcher(r.run_id, "metadata-successor");
      }
      return transaction(fn);
    }) as Store["transaction"];
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      publishing = args[0].startsWith("native-runtime-");
      try {
        return publish(...args);
      } finally {
        publishing = false;
      }
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /ownership lost/,
    );
    assert.equal(once, true);
    assert.equal(
      f.store
        .list<Artifact>("artifact")
        .filter((a) => a.type.startsWith("native-runtime-")).length,
      0,
    );
  } finally {
    other.close();
    cleanup(f);
  }
});
test("corrupt accepted capture bytes are rejected before recording runtime evidence", async () => {
  const f = await runtimeFixture();
  try {
    const capture = f.store.list<any>("operator_capture")[0],
      a = f.store.get<Artifact>(
        "artifact",
        capture.files.find((r: any) => r.relative_path === "page.html")
          .artifact_id,
      ),
      path = inside(f.root, a.relative_path);
    chmodSync(path, 0o600);
    writeFileSync(path, "changed source");
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
    );
    assert.equal(f.store.list("native_runtime_evidence").length, 0);
  } finally {
    cleanup(f);
  }
});
test("deadline expiration and held dispatcher reject without new evidence", async () => {
  const f = await runtimeFixture();
  try {
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, {
        ...f.runtimeOptions(),
        deadlineMs: Date.now() - 1,
      }),
      /DEADLINE/,
    );
    const run = f.store.currentRun();
    f.store.acquireDispatcher(run.run_id, "other");
    await assert.rejects(
      ingestNativeRuntimeEvidence(f.store, f.runtimeOptions()),
      /already owned/,
    );
    assert.equal(f.store.list("native_runtime_evidence").length, 0);
    f.store.releaseDispatcher(run.run_id, "other");
  } finally {
    cleanup(f);
  }
});
