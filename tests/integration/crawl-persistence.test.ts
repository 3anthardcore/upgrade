import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crawlSite } from "../../packages/crawler/index.ts";
import { CrawlPersistence } from "../../packages/crawler/persistence.ts";

async function fixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), "upgrade-crawl-crash-"));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("upgrade-crawl-crash-"));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
test(
  "real child kill during response retains pre-network budget and resume makes no blind GET",
  { timeout: 30000 },
  async (t) => {
    const root = await fixture(t),
      requests: string[] = [];
    let reached!: () => void;
    const observed = new Promise<void>((r) => {
      reached = r;
    });
    const server = createServer((req, res) => {
      requests.push(req.url!);
      if (req.url === "/robots.txt")
        return res.end("User-agent: *\nAllow: /\n");
      if (req.url === "/sitemap.xml") {
        res.statusCode = 404;
        return res.end("missing");
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><main>partial observed response");
      reached();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    });
    const origin = `http://127.0.0.1:${(server.address() as any).port}`,
      options = {
        sourceUrl: origin + "/",
        outputDir: path.join(root, "source"),
        projectId: "kill-test",
        fixtureOrigins: [origin],
        requestsPerSecond: 100,
        maxResponseBytes: 65536,
      };
    const script = `import {crawlSite} from ${JSON.stringify(new URL("../../packages/crawler/index.ts", import.meta.url).href)};await crawlSite(JSON.parse(process.argv[1]));`;
    const child = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "--eval",
        script,
        JSON.stringify(options),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    await Promise.race([
      observed,
      closed.then(() => {
        throw Error(`child exited before source request: ${stderr}`);
      }),
    ]);
    const before = await CrawlPersistence.load(options.outputDir);
    assert.equal(before.pending!.last_url, origin + "/");
    assert.equal(before.state!.counters.requests, 3);
    assert.ok(before.state!.counters.bytes >= 65536);
    child.kill("SIGKILL");
    await closed;
    server.closeAllConnections();
    const count = requests.length,
      budget = structuredClone(before.state!.counters),
      started = before.state!.started_at;
    const resumed = await crawlSite(options);
    assert.equal(resumed.state, "PAUSED");
    assert.deepEqual(resumed.counters, budget);
    assert.equal(resumed.started_at, started);
    assert.equal(requests.length, count);
    assert.ok(
      resumed.limitations.some((x) => x.startsWith("REQUEST_OUTCOME_UNKNOWN:")),
    );
    const again = await crawlSite(options);
    assert.deepEqual(again.counters, budget);
    assert.equal(requests.length, count);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(options.outputDir, "crawl.json"), "utf8"),
      ),
      again,
    );
  },
);

test(
  "legacy no-journal snapshot migrates offline and a modified modern projection cannot override the journal",
  { timeout: 30000 },
  async (t) => {
    const root = await fixture(t),
      requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url!);
      if (req.url === "/robots.txt")
        return res.end("User-agent: *\nAllow: /\n");
      if (req.url === "/sitemap.xml") {
        res.statusCode = 404;
        return res.end("missing");
      }
      res.setHeader("content-type", "text/html");
      res.end("<main><h1>Exact source</h1></main>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    });
    const origin = `http://127.0.0.1:${(server.address() as any).port}`,
      options = {
        sourceUrl: origin + "/",
        outputDir: path.join(root, "modern"),
        projectId: "migration-test",
        fixtureOrigins: [origin],
        requestsPerSecond: 100,
      };
    const result = await crawlSite(options);
    assert.equal(result.state, "COMPLETE");
    const legacy = path.join(root, "legacy");
    await mkdir(legacy);
    await cp(
      path.join(options.outputDir, "snapshots"),
      path.join(legacy, "snapshots"),
      { recursive: true },
    );
    await writeFile(path.join(legacy, "crawl.json"), JSON.stringify(result));
    const count = requests.length,
      migrated = await crawlSite({ ...options, outputDir: legacy });
    assert.equal(requests.length, count);
    assert.deepEqual(migrated.counters, result.counters);
    assert.equal(migrated.output_dir, legacy);
    assert.equal(
      (await CrawlPersistence.load(legacy)).state!.output_dir,
      legacy,
    );
    assert.ok(migrated.entries[0].body_path!.startsWith(legacy));
    const falseProjection = structuredClone(migrated);
    falseProjection.counters.requests = 0;
    falseProjection.access!.active_block_id = "invented";
    await writeFile(
      path.join(legacy, "crawl.json"),
      JSON.stringify(falseProjection),
    );
    const replay = await crawlSite({ ...options, outputDir: legacy });
    assert.deepEqual(replay.counters, result.counters);
    assert.equal(replay.access!.active_block_id, undefined);
    assert.equal(requests.length, count);
  },
);
