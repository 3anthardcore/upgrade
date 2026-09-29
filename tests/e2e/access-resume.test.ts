import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {spawn} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, lstatSync, mkdirSync, writeFileSync} from "node:fs";
import {join, resolve, dirname, basename} from "node:path";
import {tmpdir} from "node:os";
import {Store, hash} from "../../packages/core/index.ts";

function cli(args: string[]) {
  return new Promise<{code: number | null; stdout: string; stderr: string}>((done, reject) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", resolve("packages/cli/index.ts"), ...args], {
      shell: false, windowsHide: true, timeout: 15000,
    });
    let stdout = "", stderr = "";
    p.stdout.on("data", b => stdout += b);
    p.stderr.on("data", b => stderr += b);
    p.on("error", reject);
    p.on("close", code => done({code, stdout, stderr}));
  });
}

test("CLI persists access block across processes; explicit one-use acknowledgement resumes without resetting budgets", {timeout: 45000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-access-cli-"));
  let protectedSource = true, submissions = 0;
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url!);
    if (req.method !== "GET") submissions++;
    if (protectedSource) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><head><title>KillBot user verification</title></head><body><script>window.kbErrors=[];fetch("/verification-side-effect",{method:"POST"})</script><a href="/fake-catalog">Wrong content</a></body></html>');
    } else if (req.url === "/robots.txt") {
      res.setHeader("Content-Type", "text/plain");res.end("User-agent: *\nAllow: /\n");
    } else if (req.url === "/sitemap.xml") {res.writeHead(404);res.end();}
    else {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><head><title>Observed source</title></head><body><h1>Observed source</h1><p>Fact from the authorised fixture.</p></body></html>');
    }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const run = (command: string, extra: string[] = []) => cli([command, "--project", "access-pilot", "--data-dir", dir, ...extra]);
  const snapshot = () => {
    const store = new Store(join(dir, "access-pilot"));
    try {return store.getStatus();} finally {store.close();}
  };
  try {
    const init = await cli(["init", "--id", "access-pilot", "--source", origin, "--data-dir", dir]);
    assert.equal(init.code, 0, init.stderr);
    assert.equal((await run("plan")).code, 0);
    const initial = snapshot();
    const first = await run("run", ["--fixture-origin", origin, "--browser", "--max-pages", "5", "--max-requests", "25", "--max-bytes", "1048576"]);
    assert.equal(first.code, 3, first.stderr);
    const paused = snapshot();
    assert.equal(paused.run!.execution_status, "PAUSED");
    assert.equal(paused.artifacts.some(a => a.type === "content-model.json" || a.type === "release-manifest.json"), false);
    const crawlPath = join(dir, "access-pilot/source/crawl.json");
    const blocked = JSON.parse(readFileSync(crawlPath, "utf8"));
    const blockId = blocked.access.active_block_id;
    assert.ok(blockId);
    assert.equal(blocked.entries.length, 1);
    assert.deepEqual(requests, ["/robots.txt"]);
    const requestCount = requests.length;
    protectedSource = false; // Simulates owner granting legitimate access, not a bypass.
    assert.equal((await run("resume")).code, 0);
    const withoutAck = await run("run", ["--fixture-origin", origin]);
    assert.equal(withoutAck.code, 3, withoutAck.stderr);
    assert.equal(requests.length, requestCount, "No retry until operator acknowledges the specific block");
    assert.equal(JSON.parse(readFileSync(crawlPath, "utf8")).access.active_block_id, blockId);
    assert.equal((await run("resume")).code, 0);
    const badFlag = await run("run", ["--ack-access-block", blockId]);
    assert.equal(badFlag.code, 2, badFlag.stderr);
    assert.equal(requests.length, requestCount);
    const resumed = await run("run", ["--fixture-origin", origin, "--ack-access-block", blockId, "--access-resolution-reason", "Fixture owner granted access before this explicit retry"]);
    assert.equal(resumed.code, 3, resumed.stderr); // Real Bitrix remains NOT_RUN.
    const complete = JSON.parse(readFileSync(crawlPath, "utf8"));
    assert.equal(complete.state, "COMPLETE");
    assert.ok(!complete.access.active_block_id);
    assert.ok(complete.counters.requests > blocked.counters.requests);
    assert.equal(complete.started_at, blocked.started_at);
    assert.equal(complete.access.blocks.length, 1);
    const final = snapshot();
    assert.deepEqual(final.run!.budget, initial.run!.budget);
    assert.equal(final.run!.run_id, initial.run!.run_id);
    assert.equal(final.run!.execution_status, "BLOCKED");
    const configStore = new Store(join(dir, "access-pilot"));
    try {
      const options = configStore.get<any>("crawl-options", "current");
      assert.equal(options.maxPages, 5);
      assert.equal(options.maxRequests, 25);
      assert.equal(options.maxBytes, 1048576);
      assert.equal(options.accessResume, undefined);
    } finally {configStore.close();}
    const modelArtifact = final.artifacts.find(a => a.type === "content-model.json")!;
    const model = JSON.parse(readFileSync(join(dir, "access-pilot", modelArtifact.relative_path), "utf8"));
    assert.equal(model.entities.length, 1);
    assert.equal(model.entities[0].title, "Observed source");
    assert.equal(submissions, 0);
    assert.ok(!requests.includes("/verification-side-effect") && !requests.includes("/fake-catalog"));
    const report = JSON.parse(readFileSync(join(dir, "access-pilot/reports/report.json"), "utf8"));
    assert.equal(report.readiness, "NOT_READY");
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^upgrade-access-cli-[a-zA-Z0-9_-]+$/);
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    rmSync(target, {recursive: true, force: true});
  }
});

test("omitted request limit after restart cannot expand exhausted discovery or build a paused source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-access-cli-"));
  let requests = 0;
  const server = http.createServer((_req, res) => {requests++;res.end("User-agent: *\nAllow: /\n");});
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const run = (command: string, extra: string[] = []) => cli([command, "--project", "limited", "--data-dir", dir, ...extra]);
  try {
    assert.equal((await cli(["init", "--id", "limited", "--source", origin, "--data-dir", dir])).code, 0);
    assert.equal((await run("plan")).code, 0);
    assert.equal((await run("crawl", ["--fixture-origin", origin, "--max-requests", "1"])).code, 3);
    assert.equal(requests, 1);
    assert.equal((await run("resume")).code, 0);
    assert.equal((await run("crawl")).code, 3);
    assert.equal(requests, 1);
    assert.equal((await run("resume")).code, 0);
    const expanded = await run("crawl", ["--max-requests", "10"]);
    assert.equal(expanded.code, 2);
    assert.match(expanded.stderr, /separately recorded budget decision/);
    assert.equal(requests, 1);
    const build = await run("build");
    assert.equal(build.code, 3);
    assert.match(build.stderr, /Crawl incomplete/);
    const store = new Store(join(dir, "limited"));
    try {
      assert.equal(store.currentRun().execution_status, "PAUSED");
      assert.equal(store.list<any>("artifact").some(a => a.type === "release-manifest.json"), false);
      store.put("crawl-options", "current", {mode: "http", fixtureOrigins: [origin]}); // Pre-upgrade on-disk format.
    } finally {store.close();}
    assert.equal((await run("resume")).code, 0);
    const legacy = await run("crawl");
    assert.equal(legacy.code, 3);
    assert.match(legacy.stderr, /Legacy crawl limits were not recorded/);
    assert.equal(requests, 1);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^upgrade-access-cli-[a-zA-Z0-9_-]+$/);
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    rmSync(target, {recursive: true, force: true});
  }
});

test("separate CLI processes reject legacy COMPLETE evidence before extraction and package build", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-access-cli-"));
  try {
    for (const challenge of [false, true]) {
      const id = challenge ? "old-challenge" : "old-robots";
      const root = join(dir, id);
      const store = new Store(root);
      store.createProject(id, "https://source.example/");
      store.planRun();
      const body = challenge ? "<title>KillBot user verification</title><h1>Not a product</h1>" : "<title>Source</title><h1>A saved page</h1>";
      const digest = hash(body);
      mkdirSync(join(root, "source/snapshots"), {recursive: true});
      const bodyPath = join(root, `source/snapshots/${digest}.bin`);
      writeFileSync(bodyPath, body);
      const artifact = store.publishArtifact("crawl-result.json", JSON.stringify({
        schema_version: 1, project_id: id, source_origin: "https://source.example", state: "COMPLETE",
        output_dir: join(root, "source"), entries: [{status: "FETCHED", crawl_key: "https://source.example/", raw_url: "https://source.example/", body_path: bodyPath, body_sha256: digest}],
        assets: [], limitations: [], counters: {requests: 3, pages: 1, bytes: body.length},
        discovery: {robots_done: true, sitemap_queue: [], sitemap_done: []},
      }));
      store.close();
      for (const stage of ["extract", "build"]) {
        assert.equal((await cli(["resume", "--project", id, "--data-dir", dir])).code, 0);
        const result = await cli([stage, "--project", id, "--data-dir", dir]);
        assert.equal(result.code, 3, result.stderr);
        const reopened = new Store(root);
        try {
          assert.equal(reopened.currentRun().execution_status, "PAUSED");
          const artifacts = reopened.list<any>("artifact");
          assert.equal(artifacts.some(a => ["content-model.json", "release-manifest.json"].includes(a.type)), false);
          const guard = artifacts.filter(a => a.type === "source-access-error.json").at(-1)!;
          const error = JSON.parse(readFileSync(join(root, guard.relative_path), "utf8"));
          assert.equal(error.source_artifact_id, artifact.artifact_id);
          assert.equal(error.code, challenge ? "STORED_ACCESS_CHALLENGE" : "ACCESS_REVALIDATION_REQUIRED");
          const report = JSON.parse(readFileSync(join(root, "reports/report.json"), "utf8"));
          assert.equal(report.readiness, "NOT_READY");
          assert.equal(report.source.state, "PAUSED");
          assert.equal(report.source.recorded_state, "COMPLETE");
        } finally {reopened.close();}
      }
    }
  } finally {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^upgrade-access-cli-[a-zA-Z0-9_-]+$/);
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    rmSync(target, {recursive: true, force: true});
  }
});
