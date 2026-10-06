import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Store, hash } from "../../packages/core/index.ts";
import { Pipeline } from "../../packages/core/pipeline.ts";
import { ingestOperatorCapture } from "../../packages/core/operator-capture.ts";
import {
  createOperatorModel,
  buildOperatorPackage,
} from "../../packages/core/operator-model.ts";
import {
  configureNative,
  prepareNativeHandoff,
  ingestNativeHandoff,
  nativeGuard,
  nativeRunStatus,
} from "../../packages/core/native-run.ts";
import {
  executeNativeHandoff,
  nativeExecutorFingerprint,
} from "../../packages/bitrix-adapter/handoff.ts";
import { executeNativeTarget } from "../../packages/bitrix-adapter/native.ts";
import type { NativeRunner } from "../../packages/bitrix-adapter/native.ts";
import { handoffJson } from "../../packages/contracts/native-handoff.ts";

export async function handoffFixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-handoff-test-")),
    root = join(dir, "data", "handoff-pilot"),
    captureDir = join(dir, "capture");
  mkdirSync(captureDir);
  let store = new Store(root);
  t.after(() => {
    try {
      store.close();
    } catch {}
    const checked = resolve(dir);
    assert.ok(
      checked.startsWith(resolve(tmpdir()) + "\\") ||
        checked.startsWith(resolve(tmpdir()) + "/"),
    );
    assert.ok(basename(checked).startsWith("upgrade-handoff-test-"));
    rmSync(checked, { recursive: true, force: true });
  });
  store.createProject("handoff-pilot", "https://source.example/");
  store.planRun();
  const crawl = store.publishArtifact(
    "crawl-result.json",
    handoffJson({
      project_id: "handoff-pilot",
      state: "PAUSED",
      source_origin: "https://source.example",
      entries: [
        {
          raw_url: "https://source.example/",
          raw_urls: ["https://source.example/"],
          crawl_key: "https://source.example/",
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
  const source = "https://source.example/Product?x=&x=2",
    html =
      "<html><head><title>Observed source</title></head><body><main><h1>Observed source</h1><p>Only observed facts. Price unknown.</p></main></body></html>";
  writeFileSync(join(captureDir, "page.html"), html);
  const capture = {
    schema_version: 1,
    kind: "operator-capture",
    capture_id: "handoff-capture",
    project_id: "handoff-pilot",
    source_origin: "https://source.example",
    captured_at: "2026-09-30T07:00:00.000Z",
    inventory: {
      basis: "operator-observed-urls",
      urls: [
        "https://source.example/",
        source,
        "https://source.example/unseen",
      ],
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
        observed_at: "2026-09-30T07:00:00.000Z",
      },
    ],
    assets: [],
  };
  const captureBytes = handoffJson(capture);
  writeFileSync(join(captureDir, "operator-capture.json"), captureBytes);
  await ingestOperatorCapture(store, {
    directory: captureDir,
    expectedManifestSha256: hash(captureBytes),
  });
  const selection = {
    captureId: capture.capture_id,
    manifestSha256: hash(captureBytes),
    page: source,
  };
  const model = await createOperatorModel(store, selection),
    build = await buildOperatorPackage(store, {
      ...selection,
      modelId: model.id,
    });
  const packages = join(dir, "private-packages"),
    inbox = join(dir, "inbox"),
    outbox = join(dir, "outbox"),
    journal = join(dir, "journal");
  for (const d of [packages, inbox, outbox]) mkdirSync(d);
  cpSync(build.package_dir, join(packages, "bootstrap"), { recursive: true });
  const native = {
    schema_version: 1,
    environment: "demo",
    project_id: "handoff-pilot",
    target_id: "private-target",
    driver: "docker-exec",
    docker_executable: process.execPath,
    container: "dedicated-php",
    host_package_root: packages,
    container_package_root: "/private/packages",
    document_root: "/site",
    state_dir: "/private",
    backup_receipt: "/private/backup.json",
    backup_receipt_sha256: "a".repeat(64),
    timeout_seconds: 20,
  };
  const nativePath = join(dir, "native.json"),
    nativeBytes = handoffJson(native);
  writeFileSync(nativePath, nativeBytes);
  // Native journal bootstrap is explicit operator setup, not a request option.
  await executeNativeTarget(
    {
      profilePath: nativePath,
      profileSha256: hash(nativeBytes),
      packageDir: join(packages, "bootstrap"),
      manifestSha256: build.manifest_sha256_package!,
      journalDir: journal,
      action: "validate",
    },
    async () => {
      throw Error("validate must not execute target");
    },
  );
  const journalPin = hash(
    readFileSync(join(journal, "private-target", "binding.json")),
  );
  const profile = {
    schema_version: 1,
    kind: "private-native-handoff-profile",
    project_id: "handoff-pilot",
    target_id: "private-target",
    profile_id: "pilot-profile",
    executor_sha256: await nativeExecutorFingerprint(),
    native_profile_path: nativePath,
    native_profile_sha256: hash(nativeBytes),
    journal_dir: journal,
    journal_binding_sha256: journalPin,
    inbox_root: inbox,
    outbox_root: outbox,
  };
  const profilePath = join(dir, "private-profile.json"),
    profileBytes = handoffJson(profile);
  writeFileSync(profilePath, profileBytes);
  const binding = {
    schema_version: 1 as const,
    project_id: profile.project_id,
    target_id: profile.target_id,
    profile_id: profile.profile_id,
    profile_sha256: hash(profileBytes),
    executor_sha256: profile.executor_sha256,
    native_profile_sha256: profile.native_profile_sha256,
    journal_identity_sha256: hash(
      JSON.stringify([journal, profile.target_id, journalPin]),
    ),
  };
  const locked = <T>(fn: (guard: () => void) => Promise<T>) => {
    const p = new Pipeline(store);
    return p.locked(
      () => fn(() => nativeGuard(store, () => p.assertOwnership(true))),
      { maintenance: true },
    );
  };
  await locked((g) =>
    configureNative(
      store,
      {
        schema_version: 1,
        binding,
        selection: { kind: "operator", id: build.id },
      },
      g,
    ),
  );
  let writes = 0,
    created = false;
  const calls: string[] = [];
  const runner: NativeRunner = async (command, args, p) => {
    calls.push(command);
    const target = {
      project_id: p.project_id,
      target_id: p.target_id,
      manifest_sha256: args
        .find((a) => a.startsWith("--manifest-sha256="))!
        .split("=")[1],
    };
    const counts = {
      created: created ? 0 : 1,
      updated: 0,
      skipped: created ? 1 : 0,
      reconciled: 0,
    };
    if (command === "dry-run")
      return { ...counts, conflicts: [], blockers: [], _target: target };
    if (command === "claim")
      return {
        fence: 1,
        owner: "upgrade-cli-handoff-pilot",
        lease_until: Math.floor(Date.now() / 1000) + 300,
        _target: target,
      };
    if (command === "apply") {
      created = true;
      writes++;
      return {
        ...counts,
        routes: 1,
        errors: 0,
        verification: { status: "DATABASE_RECONCILED", defects: [] },
        _target: target,
      };
    }
    return {
      status: created ? "DATABASE_RECONCILED" : "FAIL",
      defects: created ? [] : [{ reason: "NOT_IMPORTED" }],
      _target: target,
    };
  };
  const prepare = async (
    action: "apply" | "dry-run" | "reconcile" = "apply",
  ) => {
    const prepared = await locked((g) =>
      prepareNativeHandoff(store, action, g),
    );
    if (!existsSync(join(inbox, prepared.request_id)))
      cpSync(prepared.directory, join(inbox, prepared.request_id), {
        recursive: true,
      });
    return prepared;
  };
  const execute = (p: Awaited<ReturnType<typeof prepare>>, r = runner) =>
    executeNativeHandoff(
      {
        profilePath,
        profileSha256: hash(profileBytes),
        requestId: p.request_id,
        requestSha256: p.request_sha256,
      },
      r,
    );
  return {
    dir,
    root,
    get store() {
      return store;
    },
    locked,
    binding,
    profile,
    profilePath,
    profileBytes,
    nativePath,
    native,
    build,
    model,
    crawl,
    prepare,
    execute,
    runner,
    calls,
    get writes() {
      return writes;
    },
    restart() {
      store.close();
      store = new Store(root);
    },
    get dataDir() {
      return join(dir, "data");
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  test("INVALID source, capture, model, routes, scope and release cannot authorize configuration, export or readiness", async (t) => {
    const f = await handoffFixture(t),
      model = f.store.get<any>("operator_model", f.model.id),
      capture = f.store.list<any>("operator_capture")[0],
      config = f.store.get<any>("native-config", "current"),
      inputs = {
        source: f.crawl.artifact_id,
        capture_result: capture.result_artifact_id,
        capture_payload: capture.files[0].artifact_id,
        ...model.output_artifact_ids,
        release: f.build.result_artifact_id,
      };
    for (const [name, id] of Object.entries(inputs)) {
      const accepted = f.store.get<any>("artifact", id as string);
      assert.equal(accepted.validation_status, "VALID", name);
      f.store.transaction(() =>
        f.store.put("artifact", id as string, {
          ...accepted,
          validation_status: "INVALID",
        }),
      );
      // Same bytes and SHA remain intact: rejection must be metadata-driven.
      assert.equal(
        f.store.validateArtifact(id as string).sha256,
        accepted.sha256,
      );
      await assert.rejects(
        f.locked((g) => configureNative(f.store, config, g)),
        /ARTIFACT_NOT_VALID|CAPTURE_PAYLOAD_MISMATCH/,
        name,
      );
      await assert.rejects(
        f.prepare(),
        /ARTIFACT_NOT_VALID|CAPTURE_PAYLOAD_MISMATCH/,
        name,
      );
      await assert.rejects(
        f.locked((g) => nativeRunStatus(f.store, g)),
        /ARTIFACT_NOT_VALID|CAPTURE_PAYLOAD_MISMATCH/,
        name,
      );
      assert.equal(f.store.list("native-handoff").length, 0, name);
      assert.equal(f.writes, 0, name);
      f.store.transaction(() =>
        f.store.put("artifact", id as string, accepted),
      );
    }
    assert.equal((await f.prepare()).status, "AWAITING_OPERATOR");
    assert.equal(f.writes, 0);
  });

  test("INVALID request publication cannot be reused, ingested or admitted to readiness after restart", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare(),
      response = await f.execute(request),
      before = f.store.get<any>("native-handoff", request.request_id),
      a = f.store.get<any>("artifact", before.request_artifact_id),
      count = f.store.list("artifact").length;
    f.store.transaction(() =>
      f.store.put("artifact", a.artifact_id, {
        ...a,
        validation_status: "INVALID",
      }),
    );
    f.restart();
    await assert.rejects(f.prepare(), /ARTIFACT_NOT_VALID/);
    await assert.rejects(
      f.locked((g) =>
        ingestNativeHandoff(
          f.store,
          {
            requestId: request.request_id,
            receiptPath: response.receipt_path,
            receiptSha256: response.receipt_sha256,
          },
          g,
        ),
      ),
      /ARTIFACT_NOT_VALID/,
    );
    await assert.rejects(
      f.locked((g) => nativeRunStatus(f.store, g)),
      /ARTIFACT_NOT_VALID/,
    );
    assert.deepEqual(f.store.get("native-handoff", request.request_id), before);
    assert.equal(f.store.list("artifact").length, count);
    assert.equal(f.writes, 1);
  });

  test("INVALID receipt publication blocks unknown-commit recovery and committed readiness without replacing rejected evidence", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare(),
      response = await f.execute(request),
      put = f.store.put.bind(f.store),
      options = {
        requestId: request.request_id,
        receiptPath: response.receipt_path,
        receiptSha256: response.receipt_sha256,
      };
    f.store.put = (kind, id, value: any) => {
      if (kind === "native-handoff" && value.state === "COMMITTED")
        throw Error("CRASH_BEFORE_COMMIT");
      return put(kind, id, value);
    };
    await assert.rejects(
      f.locked((g) => ingestNativeHandoff(f.store, options, g)),
      /CRASH_BEFORE_COMMIT/,
    );
    f.store.put = put;
    const a = f.store
        .list<any>("artifact")
        .find((x) => x.type.startsWith("native-handoff-receipt-")),
      before = f.store.get<any>("native-handoff", request.request_id),
      count = f.store.list("artifact").length;
    assert.ok(a);
    assert.equal(before.state, "EXPORTED");
    f.store.transaction(() =>
      f.store.put("artifact", a.artifact_id, {
        ...a,
        validation_status: "INVALID",
      }),
    );
    f.restart();
    await assert.rejects(
      f.locked((g) => ingestNativeHandoff(f.store, options, g)),
      /ARTIFACT_NOT_VALID/,
    );
    assert.deepEqual(f.store.get("native-handoff", request.request_id), before);
    assert.equal(f.store.list("artifact").length, count);
    // Explicitly restore this disposable fixture's accepted decision, then
    // reject the committed evidence to exercise the status/readiness consumer.
    f.store.transaction(() => f.store.put("artifact", a.artifact_id, a));
    await f.locked((g) => ingestNativeHandoff(f.store, options, g));
    f.store.transaction(() =>
      f.store.put("artifact", a.artifact_id, {
        ...a,
        validation_status: "INVALID",
      }),
    );
    f.restart();
    await assert.rejects(
      f.locked((g) => nativeRunStatus(f.store, g)),
      /ARTIFACT_NOT_VALID/,
    );
    await assert.rejects(
      f.locked((g) => ingestNativeHandoff(f.store, options, g)),
      /ARTIFACT_NOT_VALID/,
    );
    assert.equal(f.store.list("artifact").length, count);
    assert.equal(f.writes, 1);
  });

  test("native handoff executes actual journal driver, offline replay preserves source/budget and remains test-only", async (t) => {
    const f = await handoffFixture(t),
      budget = structuredClone(f.store.currentRun().budget),
      before = f.store.currentRun().execution_status;
    const request = await f.prepare(),
      first = await f.execute(request);
    assert.equal(first.receipt.status, "CONFIRMED");
    assert.equal(first.receipt.execution, "TEST_DOUBLE");
    assert.equal(f.writes, 1);
    await f.locked((g) =>
      ingestNativeHandoff(
        f.store,
        {
          requestId: request.request_id,
          receiptPath: first.receipt_path,
          receiptSha256: first.receipt_sha256,
        },
        g,
      ),
    );
    f.restart();
    const second = await f.execute(await f.prepare());
    assert.equal(f.writes, 1);
    assert.equal(second.receipt.attempt, 2);
    assert.equal(f.calls.at(-1), "reconcile");
    await f.locked((g) =>
      ingestNativeHandoff(
        f.store,
        {
          requestId: request.request_id,
          receiptPath: second.receipt_path,
          receiptSha256: second.receipt_sha256,
        },
        g,
      ),
    );
    const status = await f.locked((g) => nativeRunStatus(f.store, g));
    assert.equal(status.native_import, "NOT_VERIFIED");
    assert.equal(status.readiness, "NOT_READY");
    assert.equal(status.build?.known_urls, 3);
    assert.equal(status.build?.full_source_denominator, "UNKNOWN");
    assert.equal(status.build?.planned_routes, 1);
    assert.deepEqual(f.store.currentRun().budget, budget);
    assert.equal(f.store.currentRun().execution_status, before);
    assert.equal(
      JSON.parse(readFileSync(join(f.root, f.crawl.relative_path), "utf8"))
        .access.active_block_id,
      "access-fixture",
    );
  });
  test("unknown result after destination write reconciles before replay, without a second write", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare();
    let lost = false;
    const result = await f.execute(request, async (c, a, p) => {
      const r = await f.runner(c, a, p);
      if (c === "apply" && !lost) {
        lost = true;
        throw Error("LOST_AFTER_WRITE");
      }
      return r;
    });
    assert.equal(result.receipt.status, "UNKNOWN");
    assert.equal(f.writes, 1);
    await f.locked((g) =>
      ingestNativeHandoff(
        f.store,
        {
          requestId: request.request_id,
          receiptPath: result.receipt_path,
          receiptSha256: result.receipt_sha256,
        },
        g,
      ),
    );
    f.restart();
    const retry = await f.execute(request);
    assert.equal(retry.receipt.status, "CONFIRMED");
    assert.equal(f.writes, 1);
    assert.equal(f.calls.at(-1), "reconcile");
  });
  test("failure before a destination write retains intent and reconciles incomplete state before one apply", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare();
    const first = await f.execute(request, async (c, a, p) => {
      if (c === "claim") throw Error("INTERRUPTED_BEFORE_WRITE");
      return f.runner(c, a, p);
    });
    assert.equal(first.receipt.status, "UNKNOWN");
    assert.equal(f.writes, 0);
    const next = await f.execute(request);
    assert.equal(next.receipt.status, "CONFIRMED");
    assert.equal(f.writes, 1);
    assert.ok(f.calls.indexOf("reconcile") < f.calls.indexOf("apply"));
  });
  test("publication completed but Store commit unknown recovers same immutable receipt artifact", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare(),
      response = await f.execute(request),
      put = f.store.put.bind(f.store);
    let failed = false;
    f.store.put = (kind, id, value: any) => {
      if (!failed && kind === "native-handoff" && value.state === "COMMITTED") {
        failed = true;
        throw Error("CRASH_BEFORE_COMMIT");
      }
      return put(kind, id, value);
    };
    const options = {
      requestId: request.request_id,
      receiptPath: response.receipt_path,
      receiptSha256: response.receipt_sha256,
    };
    await assert.rejects(
      f.locked((g) => ingestNativeHandoff(f.store, options, g)),
      /CRASH_BEFORE_COMMIT/,
    );
    f.store.put = put;
    const count = f.store
      .list<any>("artifact")
      .filter((a) => a.type.startsWith("native-handoff-receipt-")).length;
    assert.equal(count, 1);
    f.restart();
    const result = await f.locked((g) =>
      ingestNativeHandoff(f.store, options, g),
    );
    assert.equal(result.record.state, "COMMITTED");
    assert.equal(
      f.store
        .list<any>("artifact")
        .filter((a) => a.type.startsWith("native-handoff-receipt-")).length,
      1,
    );
    assert.equal(f.writes, 1);
  });
  test("pins, receipt target, accepted metadata, code identity and authoritative journal drift fail closed", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare(),
      response = await f.execute(request);
    await assert.rejects(
      f.locked((g) =>
        ingestNativeHandoff(
          f.store,
          {
            requestId: request.request_id,
            receiptPath: response.receipt_path,
            receiptSha256: "f".repeat(64),
          },
          g,
        ),
      ),
      /PIN_MISMATCH/,
    );
    const wrong = structuredClone(response.receipt);
    wrong.native_result = {
      ...(wrong.native_result as any),
      _target: {
        project_id: "foreign",
        target_id: "private-target",
        manifest_sha256: f.build.manifest_sha256_package,
      },
    };
    const path = join(f.dir, "foreign.json"),
      bytes = handoffJson(wrong);
    writeFileSync(path, bytes);
    await assert.rejects(
      f.locked((g) =>
        ingestNativeHandoff(
          f.store,
          {
            requestId: request.request_id,
            receiptPath: path,
            receiptSha256: hash(bytes),
          },
          g,
        ),
      ),
      /TARGET_MISMATCH/,
    );
    const original = f.store.get<any>("operator_build", f.build.id);
    f.store.put("operator_build", f.build.id, {
      ...original,
      code_sha256: "f".repeat(64),
    });
    await assert.rejects(f.prepare(), /BUILD_INTENT_MISMATCH/);
    f.store.put("operator_build", f.build.id, original);
    await assert.rejects(
      f.locked((g) =>
        configureNative(
          f.store,
          {
            schema_version: 1,
            binding: { ...f.binding, journal_identity_sha256: "b".repeat(64) },
            selection: { kind: "operator", id: f.build.id },
          },
          g,
        ),
      ),
      /AUTHORITATIVE_JOURNAL_CHANGED/,
    );
    const config = f.store.get<any>("native-config", "current");
    f.store.put("native-config", "current", {
      ...config,
      binding: { ...config.binding, executor_sha256: "f".repeat(64) },
    });
    await assert.rejects(f.prepare(), /EXECUTOR_CODE_CHANGED/);
  });
  test("dispatcher takeover before artifact publication prevents metadata commit", async (t) => {
    const f = await handoffFixture(t),
      original = f.store.publishArtifact.bind(f.store);
    let takeover = false;
    f.store.publishArtifact = (...args) => {
      if (!takeover && args[0].startsWith("native-handoff-request-")) {
        takeover = true;
        const run = f.store.currentRun();
        run.dispatcher_owner = "other-worker";
        run.dispatcher_until = Date.now() + 60000;
        f.store.put("run", run.run_id, run);
      }
      return original(...args);
    };
    await assert.rejects(f.prepare(), /ownership lost/);
    assert.equal(
      f.store
        .list<any>("artifact")
        .filter((a) => a.type.startsWith("native-handoff-request-")).length,
      0,
    );
    assert.equal(f.store.list<any>("native-handoff")[0].state, "PENDING");
  });

  test("tampered exported package is rejected before any target command and source payload corruption prevents publication", async (t) => {
    const f = await handoffFixture(t),
      prepared = await f.prepare();
    const file = join(
      f.profile.inbox_root,
      prepared.request_id,
      "package/data/entities.json",
    );
    writeFileSync(file, "[]\n");
    await assert.rejects(f.execute(prepared), /PIN_MISMATCH/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes, 0);
    const capture = f.store.list<any>("operator_capture")[0],
      ref = capture.files.find((x: any) => x.relative_path === "page.html"),
      a = f.store.get<any>("artifact", ref.artifact_id),
      source = join(f.root, a.relative_path);
    chmodSync(source, 0o600);
    writeFileSync(source, "corrupt source bytes");
    await assert.rejects(f.prepare(), /PIN_MISMATCH/);
  });

  test("modeled operator receipts order uncertainty by journal attempt, never future wall clock or late arrival", async (t) => {
    const f = await handoffFixture(t),
      request = await f.prepare(),
      first = await f.execute(request);
    // Explicit attestation fixture only: no native CMS claim is made by this test.
    const copied = (result: typeof first, timestamp: string) => {
      const value = {
          ...result.receipt,
          execution: "NATIVE",
          recorded_at: timestamp,
        },
        path = join(
          f.dir,
          `attestation-${result.receipt.request_id}-${result.receipt.attempt}.json`,
        ),
        bytes = handoffJson(value);
      writeFileSync(path, bytes);
      return {
        requestId: result.receipt.request_id,
        receiptPath: path,
        receiptSha256: hash(bytes),
      };
    };
    const earlier = copied(first, "2030-01-01T00:00:00.000Z");
    await f.locked((g) => ingestNativeHandoff(f.store, earlier, g));
    assert.equal(
      (await f.locked((g) => nativeRunStatus(f.store, g))).native_import,
      "CONFIRMED",
    );
    const nextRequest = await f.prepare("reconcile"),
      unknown = await f.execute(nextRequest, async () => {
        throw Error("RECONCILE_RESPONSE_LOST");
      });
    assert.equal(unknown.receipt.status, "UNKNOWN");
    await f.locked((g) =>
      ingestNativeHandoff(
        f.store,
        copied(unknown, "2026-09-30T01:00:00.000Z"),
        g,
      ),
    );
    await f.locked((g) => ingestNativeHandoff(f.store, earlier, g));
    const result = await f.locked((g) => nativeRunStatus(f.store, g));
    assert.equal(result.native_import, "NOT_VERIFIED");
    assert.equal(result.readiness, "NOT_READY");
    assert.equal(f.writes, 1);
  });
}
