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
type Fixture = Awaited<ReturnType<typeof fixture>>;
function cleanup(f: Fixture) {
  assert.equal(dirname(resolve(f.dir)), resolve(tmpdir()));
  assert.match(basename(f.dir), /^upgrade-target-evidence-[A-Za-z0-9_-]+$/);
  f.store.close();
  rmSync(f.dir, { recursive: true, force: true });
}
function cli(f: Fixture, command: string[], expected = 0) {
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

test("actual CLI records exact native receipts; restart/replay and all report formats retain independent gates", async () => {
  const f = await fixture();
  try {
    const before = readReport(f),
      sourceBefore = before.source,
      registryBefore = before.operator.registry;
    assert.equal(before.target.operator_capture_import, "NOT_RUN");
    const args = [
      "target-evidence",
      "ingest",
      "--build",
      f.build.id,
      "--directory",
      f.bundle,
      "--manifest-sha256",
      f.currentPin,
    ];
    const result = cli(f, args);
    assert.equal(result.replayed, false);
    assert.equal(result.state, "RECORDED_NATIVE_IMPORT");
    const count = f.store.list("artifact").length,
      state = f.store.currentRun().execution_status;
    const replay = cli(f, args);
    assert.equal(replay.replayed, true);
    assert.equal(f.store.list("artifact").length, count);
    assert.equal(replay.result_artifact_id, result.result_artifact_id);
    assert.equal(state, "PAUSED");
    rmSync(f.bundle, { recursive: true });
    cli(f, ["report"]);
    const after = readReport(f);
    assert.equal(after.readiness, "NOT_READY");
    assert.equal(
      after.target.operator_capture_import,
      "RECORDED_NATIVE_IMPORT",
    );
    assert.deepEqual(after.source, sourceBefore);
    assert.deepEqual(after.operator.registry, registryBefore);
    assert.equal(after.target.native_import_evidence[0].counts.known_urls, 3);
    assert.equal(after.target.native_import_evidence[0].counts.routes, 1);
    assert.equal(
      after.target.native_import_evidence[0].target_current_state,
      "NOT_RECHECKED",
    );
    assert.deepEqual(after.target.independent_checks, {
      http: "NOT_RUN",
      browser: "NOT_RUN",
      admin: "NOT_RUN",
      restore: "NOT_RUN",
      full_source_coverage: "UNKNOWN",
    });
    for (const name of ["index.html", "summary.md"]) {
      const s = readFileSync(join(f.root, "reports", name), "utf8").replaceAll(
        "\\_",
        "_",
      );
      assert.match(s, /RECORDED_NATIVE_IMPORT/);
      assert.match(s, new RegExp(target));
      assert.match(s, new RegExp(f.build.id));
    }
  } finally {
    cleanup(f);
  }
});

test("guard rejects lease takeover before artifact metadata commit; only an unreferenced disk orphan can remain", async () => {
  const f = await fixture(),
    other = new Store(f.root);
  const transaction = f.store.transaction.bind(f.store);
  try {
    const run = f.store.currentRun(),
      owner = "guard-publication-owner";
    f.store.acquireDispatcher(run.run_id, owner);
    const before = f.store.list("artifact").length;
    let takeover = false;
    f.store.transaction = (<T>(fn: () => T): T => {
      if (!takeover) {
        takeover = true;
        const r = other.currentRun();
        r.dispatcher_until = 0;
        other.transaction(() => other.put("run", r.run_id, r));
        other.acquireDispatcher(r.run_id, "publication-successor");
      }
      return transaction(fn);
    }) as Store["transaction"];
    const guard = () => {
      if (f.store.currentRun().dispatcher_owner !== owner)
        throw Error("Dispatcher ownership lost");
    };
    assert.throws(
      () =>
        f.store.publishArtifact(
          "fenced-test.json",
          "{}",
          null,
          undefined,
          undefined,
          guard,
        ),
      /ownership lost/,
    );
    assert.equal(takeover, true);
    assert.equal(f.store.list("artifact").length, before);
    assert.equal(other.currentRun().dispatcher_owner, "publication-successor");
  } finally {
    f.store.transaction = transaction;
    other.close();
    cleanup(f);
  }
});

test("capture validation indexes metadata once and yields between every payload", async () => {
  const f = await fixture(64);
  try {
    const list = f.store.list.bind(f.store);
    let artifactScans = 0,
      turns = 0,
      active = true;
    f.store.list = ((kind: string) => {
      if (kind === "artifact") artifactScans++;
      return list(kind);
    }) as Store["list"];
    const tick = () => {
      if (active) {
        turns++;
        setImmediate(tick);
      }
    };
    setImmediate(tick);
    try {
      const result = await ingestTargetEvidence(f.store, f.options());
      assert.equal(result.state, "RECORDED_NATIVE_IMPORT");
      assert.ok(
        artifactScans <= 10,
        `metadata scans must not grow per capture file: ${artifactScans}`,
      );
      assert.ok(turns >= 66, `payload validation must yield: ${turns}`);
    } finally {
      active = false;
      f.store.list = list;
    }
  } finally {
    cleanup(f);
  }
});

test("lease takeover during source payload validation prevents intent or artifact publication", async () => {
  const f = await fixture(8),
    other = new Store(f.root);
  try {
    const count = f.store.list("artifact").length;
    const operation = ingestTargetEvidence(f.store, f.options());
    setImmediate(() => {
      const r = other.currentRun();
      r.dispatcher_until = 0;
      other.transaction(() => other.put("run", r.run_id, r));
      other.acquireDispatcher(r.run_id, "capture-validation-successor");
    });
    await assert.rejects(operation, /ownership lost/);
    assert.equal(f.store.list("target_evidence").length, 0);
    assert.equal(f.store.list("artifact").length, count);
    assert.equal(
      other.currentRun().dispatcher_owner,
      "capture-validation-successor",
    );
  } finally {
    other.close();
    cleanup(f);
  }
});

test("regression: corrupted accepted capture payload rejects native evidence before publication", async () => {
  const f = await fixture();
  try {
    const capture = f.store.list<any>("operator_capture")[0];
    const ref = capture.files.find((r: any) => r.relative_path === "page.html");
    const a = f.store.get<Artifact>("artifact", ref.artifact_id),
      path = inside(f.root, a.relative_path);
    chmodSync(path, 0o600);
    writeFileSync(path, "corrupt source bytes");
    await assert.rejects(ingestTargetEvidence(f.store, f.options()), /PIN/);
    assert.equal(f.store.list("target_evidence").length, 0);
  } finally {
    cleanup(f);
  }
});

test("regression: authoritative Store key cannot be bypassed by a corrupt body id", async () => {
  const f = await fixture();
  try {
    const result = await ingestTargetEvidence(f.store, f.options());
    const original = f.store.get<any>("target_evidence", result.id);
    const corrupt = { ...original, id: "f".repeat(64) };
    f.store.transaction(() =>
      f.store.put("target_evidence", result.id, corrupt),
    );
    await assert.rejects(
      ingestTargetEvidence(f.store, f.options()),
      /STORED_RECORD_KEY_MISMATCH/,
    );
    assert.deepEqual(f.store.get("target_evidence", result.id), corrupt);
  } finally {
    cleanup(f);
  }
});

test("regression: takeover after immutable publication cannot clobber the successor receipt", async () => {
  const f = await fixture(),
    other = new Store(f.root);
  try {
    const publish = f.store.publishArtifact.bind(f.store);
    let takeover = false;
    f.store.publishArtifact = (
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const a = publish(...args);
      if (
        !takeover &&
        args[0].startsWith("target-evidence-") &&
        args[0].endsWith("-manifest.json")
      ) {
        takeover = true;
        const run = other.currentRun();
        run.dispatcher_until = 0;
        other.transaction(() => other.put("run", run.run_id, run));
        other.acquireDispatcher(run.run_id, "receipt-successor");
        const r = other.list<any>("target_evidence")[0];
        other.transaction(() =>
          other.put("target_evidence", r.id, {
            ...r,
            successor_marker: "must-survive",
          }),
        );
      }
      return a;
    };
    await assert.rejects(
      ingestTargetEvidence(f.store, f.options()),
      /ownership lost/,
    );
    assert.equal(takeover, true);
    assert.equal(
      other.list<any>("target_evidence")[0].successor_marker,
      "must-survive",
    );
  } finally {
    other.close();
    cleanup(f);
  }
});

test("crash after immutable publication reconciles before repeat without duplicate artifacts", async () => {
  const f = await fixture();
  try {
    const original = f.store.publishArtifact.bind(f.store);
    let fired = false;
    f.store.publishArtifact = ((
      ...args: Parameters<Store["publishArtifact"]>
    ) => {
      const result = original(...args);
      if (!fired && args[0].endsWith("-profile.json")) {
        fired = true;
        throw Error("SIMULATED_LOST_PUBLICATION_REPLY");
      }
      return result;
    }) as Store["publishArtifact"];
    await assert.rejects(
      ingestTargetEvidence(f.store, f.options()),
      /SIMULATED/,
    );
    assert.equal(f.store.list<any>("target_evidence")[0].state, "PENDING");
    const artifact = f.store
      .list<Artifact>("artifact")
      .find((a) => a.type.endsWith("-profile.json"))!;
    const result = cli(f, [
      "target-evidence",
      "ingest",
      "--build",
      f.build.id,
      "--directory",
      f.bundle,
      "--manifest-sha256",
      f.currentPin,
    ]);
    assert.equal(result.state, "RECORDED_NATIVE_IMPORT");
    const record = f.store.list<any>("target_evidence")[0];
    assert.equal(record.file_artifact_ids.profile, artifact.artifact_id);
    assert.equal(
      f.store.list<Artifact>("artifact").filter((a) => a.type === artifact.type)
        .length,
      1,
    );
  } finally {
    cleanup(f);
  }
});

test("mismatched native request, target, package, result and unconfirmed heads never publish evidence", async (t) => {
  const f = await fixture();
  try {
    const originals = new Map(
      readdirSync(f.bundle).map((name) => [
        name,
        readFileSync(join(f.bundle, name)),
      ]),
    );
    const manifestText = json(f.evidence),
      artifacts = f.store.list("artifact").length;
    const cases: Array<[string, () => void]> = [
      [
        "foreign response project",
        () =>
          updateFile(f, "reconcile_response", (v) => {
            v._target.project_id = "foreign";
          }),
      ],
      [
        "foreign response target",
        () =>
          updateFile(f, "reconcile_response", (v) => {
            v._target.target_id = "foreign";
          }),
      ],
      [
        "foreign response package",
        () =>
          updateFile(f, "reconcile_response", (v) => {
            v._target.manifest_sha256 = "a".repeat(64);
          }),
      ],
      [
        "unknown head",
        () =>
          updateFile(f, "journal_head", (v) => {
            v.status = "UNKNOWN";
          }),
      ],
      [
        "defect array required",
        () =>
          updateFile(f, "reconcile_response", (v) => {
            v.defects = true;
          }),
      ],
      [
        "nonempty defects",
        () =>
          updateFile(f, "reconcile_response", (v) => {
            v.defects = [{ code: "MISSING_ENTITY" }];
          }),
      ],
      [
        "forged request",
        () =>
          updateFile(f, "reconcile_request", (v) => {
            v.profile_sha256 = "b".repeat(64);
          }),
      ],
      [
        "foreign manifest project",
        () => {
          f.evidence.project_id = "foreign";
        },
      ],
      [
        "wrong model artifact",
        () => {
          f.evidence.model_artifact = { ...f.evidence.scope_artifact };
        },
      ],
      [
        "wrong scope pin",
        () => {
          f.evidence.scope_artifact.sha256 = "c".repeat(64);
        },
      ],
      [
        "foreign build",
        () => {
          f.evidence.build_record_id = "d".repeat(64);
        },
      ],
      [
        "invented runtime PASS",
        () =>
          updateFile(f, "reconcile_response", (v) => {
            v.http_browser_admin = "PASS";
          }),
      ],
    ];
    for (const [name, mutate] of cases)
      await t.test(name, async () => {
        Object.assign(f.evidence, JSON.parse(manifestText));
        for (const [name, bytes] of originals)
          writeFileSync(join(f.bundle, name), bytes);
        mutate();
        await assert.rejects(ingestTargetEvidence(f.store, f.options()));
        assert.equal(f.store.list("artifact").length, artifacts);
        assert.equal(f.store.list("target_evidence").length, 0);
      });
  } finally {
    cleanup(f);
  }
});

test("external pin, missing files, ambiguous JSON, traversal, hardlinks and extra receipts are rejected", async (t) => {
  const f = await fixture();
  try {
    const originals = new Map(
        readdirSync(f.bundle).map((name) => [
          name,
          readFileSync(join(f.bundle, name)),
        ]),
      ),
      manifestText = json(f.evidence);
    const reset = () => {
      for (const name of readdirSync(f.bundle))
        rmSync(join(f.bundle, name), { force: true });
      for (const [name, bytes] of originals)
        writeFileSync(join(f.bundle, name), bytes);
      Object.assign(f.evidence, JSON.parse(manifestText));
    };
    await t.test("wrong external pin", async () => {
      await assert.rejects(
        ingestTargetEvidence(f.store, {
          ...f.options(),
          expectedManifestSha256: "f".repeat(64),
        }),
        /PIN/,
      );
    });
    await t.test("tampered raw response", async () => {
      reset();
      writeFileSync(
        join(f.bundle, f.evidence.files.reconcile_response.relative_path),
        "{}",
      );
      await assert.rejects(ingestTargetEvidence(f.store, f.options()), /PIN/);
    });
    await t.test("missing response", async () => {
      reset();
      rmSync(join(f.bundle, f.evidence.files.reconcile_response.relative_path));
      await assert.rejects(
        ingestTargetEvidence(f.store, f.options()),
        /MISSING/,
      );
    });
    await t.test("duplicate JSON key", async () => {
      reset();
      const ref = f.evidence.files.profile,
        path = join(f.bundle, ref.relative_path),
        bytes = readFileSync(path, "utf8").replace(
          "{",
          '{"project_id":"foreign",',
        );
      writeFileSync(path, bytes);
      ref.sha256 = hash(bytes);
      ref.size_bytes = Buffer.byteLength(bytes);
      await assert.rejects(
        ingestTargetEvidence(f.store, f.options()),
        /DUPLICATE/,
      );
    });
    await t.test("traversal", async () => {
      reset();
      f.evidence.files.profile.relative_path = "../native-profile.json";
      await assert.rejects(
        ingestTargetEvidence(f.store, f.options()),
        /REFERENCE/,
      );
    });
    await t.test("hardlink", async () => {
      reset();
      const path = join(f.bundle, "profile.json");
      rmSync(path);
      linkSync(join(f.dir, "native-profile.json"), path);
      await assert.rejects(
        ingestTargetEvidence(f.store, f.options()),
        /REGULAR/,
      );
    });
    await t.test("extra receipt", async () => {
      reset();
      writeFileSync(join(f.bundle, "unselected-response.json"), "{}");
      await assert.rejects(
        ingestTargetEvidence(f.store, f.options()),
        /UNLISTED/,
      );
    });
    assert.equal(f.store.list("target_evidence").length, 0);
  } finally {
    cleanup(f);
  }
});

test("tampered committed receipt is INVALID in report and cannot replay or hide missing scope", async () => {
  const f = await fixture();
  try {
    await ingestTargetEvidence(f.store, f.options());
    const record = f.store.list<any>("target_evidence")[0],
      a = f.store.get<Artifact>(
        "artifact",
        record.file_artifact_ids.reconcile_response,
      ),
      path = inside(f.root, a.relative_path);
    chmodSync(path, 0o600);
    writeFileSync(path, "{}");
    const report = readReport(f);
    assert.equal(report.target.operator_capture_import, "NOT_RUN");
    assert.equal(report.target.native_import_evidence[0].state, "INVALID");
    assert.equal(report.readiness, "NOT_READY");
    await assert.rejects(ingestTargetEvidence(f.store, f.options()), /PIN/);
  } finally {
    cleanup(f);
  }
});

test("tampered accepted package and model scope block ingest despite valid copied native receipts", async (t) => {
  const f = await fixture();
  try {
    await t.test("package tree bytes", async () => {
      // Pick a listed real code file instead of depending on a package layout alias.
      const manifest = JSON.parse(
        readFileSync(join(f.build.package_dir, "manifest.json"), "utf8"),
      );
      const actual = join(
        f.build.package_dir,
        Object.keys(manifest.files).find((p) => p.endsWith(".php"))!,
      );
      const before = readFileSync(actual);
      chmodSync(actual, 0o600);
      writeFileSync(actual, "<?php /* modified */");
      await assert.rejects(ingestTargetEvidence(f.store, f.options()));
      writeFileSync(actual, before);
      chmodSync(actual, 0o400);
    });
    await t.test("scope bytes", async () => {
      const a = f.store.get<Artifact>(
          "artifact",
          f.model.output_artifact_ids.scope,
        ),
        path = inside(f.root, a.relative_path);
      chmodSync(path, 0o600);
      writeFileSync(path, "{}");
      await assert.rejects(ingestTargetEvidence(f.store, f.options()), /PIN/);
    });
    assert.equal(f.store.list("target_evidence").length, 0);
  } finally {
    cleanup(f);
  }
});
