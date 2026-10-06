import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { handoffFixture } from "../integration/native-run.test.ts";
import { Store, hash } from "../../packages/core/index.ts";
import { handoffJson } from "../../packages/contracts/native-handoff.ts";
import { nativeExecutorFingerprint } from "../../packages/bitrix-adapter/handoff.ts";

function child(script: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (done, reject) => {
      const p = spawn(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", script, ...args],
        { shell: false, windowsHide: true },
      );
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        p.kill();
        reject(Error("child timeout"));
      }, 60000);
      p.stdout.on("data", (b) => (stdout += b));
      p.stderr.on("data", (b) => (stderr += b));
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        done({ code, stdout, stderr });
      });
    },
  );
}
const cli = (args: string[]) => child(resolve("packages/cli/index.ts"), args);
test("real CLI and child operator restart after native write, ingest exact receipt and preserve partial source", async (t) => {
  const f = await handoffFixture(t),
    beforeBudget = structuredClone(f.store.currentRun().budget);
  const bindingFile = join(f.dir, "public-binding.json");
  writeFileSync(bindingFile, handoffJson(f.binding));
  const common = ["--project", "handoff-pilot", "--data-dir", f.dataDir];
  const config = await cli([
    "native",
    "configure",
    ...common,
    "--binding",
    bindingFile,
    "--kind",
    "operator",
    "--build",
    f.build.id,
  ]);
  assert.equal(config.code, 0, config.stderr);
  const prepared = await cli([
    "native",
    "prepare",
    ...common,
    "--action",
    "apply",
  ]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const request = JSON.parse(prepared.stdout);
  cpSync(request.directory, join(f.profile.inbox_root, request.request_id), {
    recursive: true,
  });
  const helper = join(f.dir, "declared-local-driver.mjs"),
    target = join(f.dir, "modeled-destination.json");
  const code = `import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {executeNativeHandoff} from ${JSON.stringify(pathToFileURL(resolve("packages/bitrix-adapter/handoff.ts")).href)};
const statePath=${JSON.stringify(target)}, args=JSON.parse(process.argv[2]);
const result=await executeNativeHandoff(args,async(command,argv,p)=>{
 const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{writes:0};
 const _target={project_id:p.project_id,target_id:p.target_id,manifest_sha256:argv.find(x=>x.startsWith('--manifest-sha256=')).split('=')[1]};
 const counts={created:state.writes?0:1,updated:0,skipped:state.writes?1:0,reconciled:0};
 if(command==='dry-run')return {...counts,conflicts:[],blockers:[],_target};
 if(command==='claim')return {fence:1,owner:'upgrade-cli-handoff-pilot',lease_until:Math.floor(Date.now()/1000)+300,_target};
 if(command==='apply'){state.writes++;writeFileSync(statePath,JSON.stringify(state));if(process.argv[3]==='crash-after-write')process.exit(91);return {...counts,routes:1,errors:0,verification:{status:'DATABASE_RECONCILED',defects:[]},_target};}
 return {status:state.writes?'DATABASE_RECONCILED':'FAIL',defects:state.writes?[]:[{reason:'ABSENT'}],_target};
});console.log(JSON.stringify(result));`;
  writeFileSync(helper, code);
  const options = JSON.stringify({
    profilePath: f.profilePath,
    profileSha256: hash(f.profileBytes),
    requestId: request.request_id,
    requestSha256: request.request_sha256,
  });
  const interrupted = await child(helper, [options, "crash-after-write"]);
  assert.equal(interrupted.code, 91, interrupted.stderr);
  assert.equal(JSON.parse(readFileSync(target, "utf8")).writes, 1);
  const resumed = await child(helper, [options]);
  assert.equal(resumed.code, 0, resumed.stderr);
  const receipt = JSON.parse(resumed.stdout);
  assert.equal(receipt.receipt.status, "CONFIRMED");
  assert.equal(receipt.receipt.execution, "TEST_DOUBLE");
  assert.equal(JSON.parse(readFileSync(target, "utf8")).writes, 1);
  const ingestArgs = [
    "native",
    "ingest",
    ...common,
    "--request-id",
    request.request_id,
    "--receipt",
    receipt.receipt_path,
    "--receipt-sha256",
    receipt.receipt_sha256,
  ];
  const ingested = await cli(ingestArgs);
  assert.equal(ingested.code, 0, ingested.stderr);
  const replay = await cli(ingestArgs);
  assert.equal(replay.code, 0, replay.stderr);
  assert.equal(
    JSON.parse(replay.stdout).receipt_artifact_id,
    JSON.parse(ingested.stdout).receipt_artifact_id,
  );
  const status = await cli(["native", "status", ...common]);
  assert.equal(status.code, 0, status.stderr);
  const body = JSON.parse(status.stdout);
  assert.equal(body.native_import, "NOT_VERIFIED");
  assert.equal(body.build.known_urls, 3);
  assert.equal(body.build.full_source_denominator, "UNKNOWN");
  const run = await cli(["run", ...common, "--until", "demo-ready"]);
  assert.equal(run.code, 3, run.stderr);
  assert.equal(JSON.parse(run.stdout).activation, "NOT_RUN");
  const verify = await cli(["verify", ...common]);
  assert.equal(verify.code, 3, verify.stderr);
  assert.equal(
    JSON.parse(verify.stdout).status,
    "NATIVE_RECONCILIATION_HANDOFF",
  );
  assert.deepEqual(f.store.currentRun().budget, beforeBudget);
  assert.equal(f.store.currentRun().execution_status, "PAUSED");
  assert.equal(
    JSON.parse(readFileSync(join(f.root, f.crawl.relative_path), "utf8")).access
      .active_block_id,
    "access-fixture",
  );
});

test("normal CLI HTTP model bridges observed commerce into sealed package and handoff resumes with source offline", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-handoff-http-"));
  const server = http.createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (req.url === "/sitemap.xml") {
      res.writeHead(404).end();
      return;
    }
    const origin = "http://" + req.headers.host;
    const product = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Observed item",
      url: origin + "/product",
      sku: "FACT-SKU",
      offers: {
        "@type": "Offer",
        url: origin + "/product",
        price: "90",
        priceCurrency: "RUB",
        priceSpecification: { unitText: "piece" },
        eligibleQuantity: { minValue: "1", stepValue: "1" },
      },
    };
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<html><head><title>Observed item</title><script type="application/ld+json">${JSON.stringify(product)}</script></head><body><main><h1>Observed item</h1><p>Only observed facts</p><div id="product"><span class="price_old">100 р. / шт.</span><span class="price_new">90 р. / шт.</span><input name="quantity" min="1" step="1"></div></main></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  let closed = false;
  t.after(async () => {
    if (!closed) await new Promise<void>((r) => server.close(() => r()));
    const target = resolve(dir);
    assert.ok(basename(target).startsWith("upgrade-handoff-http-"));
    rmSync(target, { recursive: true, force: true });
  });
  const common = ["--project", "normal-pilot", "--data-dir", dir];
  for (const args of [
    [
      "init",
      "--id",
      "normal-pilot",
      "--source",
      origin + "/product",
      "--data-dir",
      dir,
    ],
    ["plan", ...common],
    ["crawl", ...common, "--fixture-origin", origin, "--max-pages", "5"],
    ["extract", ...common],
    ["build", ...common],
  ]) {
    const result = await cli(args);
    assert.equal(result.code, 0, result.stderr);
  }
  await new Promise<void>((r) => server.close(() => r()));
  closed = true;
  const store = new Store(join(dir, "normal-pilot"));
  const stage = store.get<any>("stage", "build"),
    release = join(store.root, "releases", stage.release_id);
  const manifest = JSON.parse(
    readFileSync(join(release, "manifest.json"), "utf8"),
  );
  assert.ok(manifest.files["data/demo-snapshot.json"]);
  const snapshot = JSON.parse(
    readFileSync(join(release, "data/demo-snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.items.length ?? Object.keys(snapshot.items).length, 1);
  const item = Object.values(snapshot.items)[0] as any;
  assert.equal(item.title, "Observed item");
  assert.ok(
    item.prices.some(
      (p: any) => p.money?.decimal === "90.00" || p.money?.decimal === "90",
    ),
  );
  const binding = {
      schema_version: 1,
      project_id: "normal-pilot",
      target_id: "normal-target",
      profile_id: "private",
      profile_sha256: "a".repeat(64),
      native_profile_sha256: "b".repeat(64),
      executor_sha256: await nativeExecutorFingerprint(),
      journal_identity_sha256: "c".repeat(64),
    },
    file = join(dir, "public-binding.json");
  writeFileSync(file, handoffJson(binding));
  store.close();
  const configured = await cli([
    "native",
    "configure",
    ...common,
    "--binding",
    file,
    "--kind",
    "pipeline",
    "--build",
    "build",
  ]);
  assert.equal(configured.code, 0, configured.stderr);
  const prepared = await cli(["import", ...common, "--dry-run"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const request = JSON.parse(prepared.stdout);
  assert.equal(request.status, "AWAITING_OPERATOR");
  assert.equal(request.native.activation, "NOT_RUN");
  const repeated = await cli([
    "native",
    "prepare",
    ...common,
    "--action",
    "dry-run",
  ]);
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.equal(
    JSON.parse(repeated.stdout).request_sha256,
    request.request_sha256,
  );
});
test("root executor CLI rejects arbitrary command flags and never offers an external runner override", async () => {
  const result = await child(resolve("scripts/execute-native-handoff.ts"), [
    "--command",
    "anything",
  ]);
  assert.equal(result.code, 5);
  assert.match(result.stderr, /HANDOFF_EXACT_FLAGS_REQUIRED/);
  const fingerprint = await child(
    resolve("scripts/execute-native-handoff.ts"),
    ["--fingerprint"],
  );
  assert.equal(fingerprint.code, 0);
  assert.match(
    JSON.parse(fingerprint.stdout).executor_sha256,
    /^[a-f0-9]{64}$/,
  );
});
