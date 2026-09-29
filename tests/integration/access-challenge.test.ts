import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  crawlSite,
  assertNoStoredAccessChallenge,
  verifyCrawlSnapshots,
} from "../../packages/crawler/index.ts";
import type { CrawlOptions } from "../../packages/crawler/index.ts";
import { extractContent } from "../../packages/extractor/index.ts";

// Synthetic inert fixture, deliberately unrelated to the real provider's JavaScript implementation.
const challenge =
  '<!doctype html><html><head><title>KillBot user verification [127.0.0.1] [fixture]...</title></head><body><h1>Verification</h1><a href="/challenge-only">Verify</a><img src="/challenge-pixel.png"><form method="post" action="/submitted"><button>Continue</button></form><script>fetch("/challenge-executed");fetch("/submitted",{method:"POST"})</script></body></html>';
const normal =
  '<!doctype html><html><head><title>Article about KillBot user verification</title></head><body><main><h1>Real article</h1><p>KillBot user verification and Cloudflare are mentioned as facts.</p><a href="/contact">Contact</a></main></body></html>';

async function fixture() {
  const settings = { robots: "text", page: "normal", homeGets: 0 };
  const requests: { method: string; url: string }[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    requests.push({ method: request.method ?? "", url });
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url === "/robots.txt") {
      if (settings.robots === "challenge") return response.end(challenge);
      if (settings.robots === "fragment") {
        response.setHeader("Content-Type", "text/plain");
        return response.end("<div><h1>Sign in</h1></div>");
      }
      if (settings.robots === "html")
        return response.end(
          '<html><title>Sign in</title><a href="/challenge-only">Enter</a></html>',
        );
      response.setHeader("Content-Type", "text/plain");
      return response.end("User-agent: *\nDisallow:\n");
    }
    if (url === "/sitemap.xml") {
      response.statusCode = 404;
      return response.end("missing");
    }
    if (url === "/") {
      settings.homeGets++;
      if (
        settings.page === "challenge" ||
        (settings.page === "switch" && settings.homeGets > 1)
      )
        return response.end(challenge);
      if (settings.page === "header") {
        response.setHeader("cf-mitigated", "challenge");
        return response.end(
          '<title>Opaque verification page</title><a href="/challenge-only">Go</a>',
        );
      }
      if (settings.page === "dom")
        return response.end(
          '<!doctype html><title>Loading article</title><body><script>document.title="KillBot user verification";document.body.innerHTML="<h1>Verify now</h1>";const link=document.createElement("a");link.href="/challenge-only";link.textContent="Continue";document.body.append(link)</script></body>',
        );
      return response.end(normal);
    }
    if (url === "/contact")
      return response.end(
        '<title>Contact us</title><main><h1>Contact</h1><form><div class="g-recaptcha"></div><button>Send</button></form><p>Our published contact facts.</p></main>',
      );
    response.statusCode = 404;
    response.end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "upgrade-access-"));
  const options: CrawlOptions = {
    sourceUrl: `${origin}/`,
    outputDir,
    projectId: "access-test",
    fixtureOrigins: [origin],
    requestsPerSecond: 100,
  };
  return {
    settings,
    requests,
    options,
    origin,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(options.outputDir, { recursive: true, force: true });
    },
  };
}

test("HTTP 200 challenge is evidence and unresolved scope, never content or browser code", async () => {
  const f = await fixture();
  try {
    f.settings.page = "challenge";
    const result = await crawlSite({
      ...f.options,
      mode: "browser",
      browserExecutablePath: path.join(f.options.outputDir, "does-not-exist"),
    });
    assert.equal(result.state, "PAUSED");
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].status, "REQUIRES_ACCESS");
    assert.equal(result.entries[0].http_status, 200);
    assert.equal(result.entries[0].title, undefined);
    assert.deepEqual(result.entries[0].links, []);
    assert.deepEqual(result.entries[0].media, []);
    assert.equal(result.assets.length, 0);
    assert.equal(result.counters.pages, 0);
    assert.equal(result.completeness.failed, 1);
    const block = result.access!.blocks[0];
    assert.equal(block.stage, "page");
    assert.equal(block.url, `${f.origin}/`);
    assert.equal(block.provider, "KillBot");
    assert.equal(
      await readFile(result.entries[0].body_path!, "utf8"),
      challenge,
    );
    assert.equal(
      block.body_sha256,
      createHash("sha256").update(challenge).digest("hex"),
    );
    await verifyCrawlSnapshots(result);
    assert.equal(
      (await extractContent(result)).entities.length,
      0,
      "blocked entries never become content entities",
    );
    assert.equal(
      f.settings.homeGets,
      1,
      "browser must not launch or refetch a recognized challenge",
    );
    assert.ok(
      f.requests.every(
        (r) =>
          r.method === "GET" &&
          !r.url.startsWith("/challenge") &&
          r.url !== "/submitted",
      ),
    );
  } finally {
    await f.close();
  }
});

for (const robotsMode of ["challenge", "html", "fragment"])
  test(`robots ${robotsMode} cannot silently become allow-all rules`, async () => {
    const f = await fixture();
    try {
      f.settings.robots = robotsMode;
      const result = await crawlSite(f.options);
      assert.equal(result.state, "PAUSED");
      assert.equal(result.discovery.robots_done, false);
      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].status, "DISCOVERED");
      assert.equal(
        result.entries[0].body_path,
        undefined,
        "robots evidence is not a homepage response",
      );
      assert.equal(result.entries[0].http_status, undefined);
      assert.equal(result.completeness.queued, 1);
      assert.equal(result.access!.blocks[0].url, `${f.origin}/robots.txt`);
      assert.equal(result.access!.blocks[0].stage, "robots");
      assert.equal(
        result.access!.blocks[0].reason,
        robotsMode === "challenge" ? "ACCESS_CHALLENGE" : "ROBOTS_HTML",
      );
      assert.deepEqual(
        f.requests.map((r) => r.url),
        ["/robots.txt"],
      );
      await verifyCrawlSnapshots(result);
      const resumed = await crawlSite(f.options);
      assert.equal(resumed.state, "PAUSED");
      assert.equal(
        f.requests.length,
        1,
        "ordinary process restart must not retry access",
      );
      assert.deepEqual(resumed.counters, result.counters);
    } finally {
      await f.close();
    }
  });

test("explicit single-use acknowledgement resumes after access resolution without resetting budgets", async () => {
  const f = await fixture();
  try {
    f.settings.page = "challenge";
    const blocked = await crawlSite(f.options);
    const requestCount = f.requests.length;
    f.settings.page = "normal";
    assert.equal((await crawlSite(f.options)).state, "PAUSED");
    assert.equal(f.requests.length, requestCount);
    await assert.rejects(
      () =>
        crawlSite({
          ...f.options,
          accessResume: {
            blockId: "stale",
            acknowledgementId: "attempt-1",
            reason: "Owner removed the source challenge",
          },
        }),
      { code: "INVALID_ACCESS_RESUME" },
    );
    assert.equal(f.requests.length, requestCount);
    const acknowledgement = {
      blockId: blocked.access!.active_block_id!,
      acknowledgementId: "attempt-1",
      reason: "Owner removed the source challenge",
    };
    const complete = await crawlSite({
      ...f.options,
      accessResume: acknowledgement,
    });
    assert.equal(complete.state, "COMPLETE");
    assert.equal(complete.access!.active_block_id, undefined);
    assert.equal(
      complete.access!.blocks[0].resume?.acknowledgement_id,
      "attempt-1",
    );
    assert.equal(complete.started_at, blocked.started_at);
    assert.ok(complete.counters.requests > blocked.counters.requests);
    assert.ok(complete.counters.bytes > blocked.counters.bytes);
    assert.equal(complete.entries[0].attempts, 2);
    assert.equal(
      complete.entries[0].title,
      "Article about KillBot user verification",
    );
    assert.equal((await extractContent(complete)).entities.length, 2);
    await assertNoStoredAccessChallenge(complete);
    await assert.rejects(
      () => crawlSite({ ...f.options, accessResume: acknowledgement }),
      { code: "INVALID_ACCESS_RESUME" },
    );
  } finally {
    await f.close();
  }
});

test("an acknowledgement cannot turn persistent protection into an automatic retry loop", async () => {
  const f = await fixture();
  try {
    f.settings.robots = "challenge";
    const first = await crawlSite(f.options);
    const second = await crawlSite({
      ...f.options,
      accessResume: {
        blockId: first.access!.active_block_id!,
        acknowledgementId: "attempt-2",
        reason: "Owner reports that access has been granted",
      },
    });
    assert.equal(second.state, "PAUSED");
    assert.notEqual(
      second.access!.active_block_id,
      first.access!.active_block_id,
    );
    assert.equal(second.access!.blocks.length, 2);
    assert.equal(second.counters.requests, first.counters.requests + 1);
    await crawlSite(f.options);
    assert.equal(f.requests.length, 2);
    await assert.rejects(
      () =>
        crawlSite({
          ...f.options,
          accessResume: {
            blockId: second.access!.active_block_id!,
            acknowledgementId: "attempt-2",
            reason: "Reuse of the old acknowledgement is forbidden",
          },
        }),
      { code: "INVALID_ACCESS_RESUME" },
    );
  } finally {
    await f.close();
  }
});

test("browser transport recognizes a newly appearing challenge before fulfillment or script execution", async () => {
  const f = await fixture();
  try {
    f.settings.page = "switch";
    const result = await crawlSite({ ...f.options, mode: "browser" });
    assert.equal(result.state, "PAUSED");
    assert.equal(result.access!.blocks[0].stage, "browser_http");
    assert.equal(result.entries[0].status, "REQUIRES_ACCESS");
    assert.equal(result.entries[0].title, undefined);
    assert.deepEqual(result.entries[0].links, []);
    assert.equal(result.entries.length, 1);
    assert.equal(f.settings.homeGets, 2);
    assert.ok(
      f.requests.every(
        (r) =>
          r.method === "GET" &&
          !r.url.startsWith("/challenge") &&
          r.url !== "/submitted",
      ),
    );
  } finally {
    await f.close();
  }
});

test("a rendered challenge is stopped before content extraction and link discovery", async () => {
  const f = await fixture();
  try {
    f.settings.page = "dom";
    const result = await crawlSite({ ...f.options, mode: "browser" });
    assert.equal(result.state, "PAUSED");
    assert.equal(result.access!.blocks[0].stage, "browser_dom");
    assert.equal(result.access!.blocks[0].evidence_kind, "dom");
    assert.equal(result.entries[0].status, "REQUIRES_ACCESS");
    assert.equal(result.entries[0].title, undefined);
    assert.deepEqual(result.entries[0].links, []);
    assert.equal(result.entries.length, 1);
    assert.match(
      await readFile(result.entries[0].dom_path!, "utf8"),
      /KillBot user verification/,
    );
    assert.ok(
      !f.requests.some(
        (r) => r.url === "/challenge-only" || r.method === "POST",
      ),
    );
  } finally {
    await f.close();
  }
});

test("reliable challenge header is preserved and blocks HTTP 200", async () => {
  const f = await fixture();
  try {
    f.settings.page = "header";
    const result = await crawlSite(f.options);
    assert.equal(result.state, "PAUSED");
    assert.equal(result.access!.blocks[0].provider, "Cloudflare");
    assert.equal(
      result.access!.blocks[0].headers?.["cf-mitigated"],
      "challenge",
    );
  } finally {
    await f.close();
  }
});

test("access evidence and pause survive moving state; corrupted evidence fails closed", async () => {
  const f = await fixture();
  try {
    f.settings.robots = "challenge";
    const first = await crawlSite(f.options);
    const moved = `${f.options.outputDir}-moved`;
    await rename(f.options.outputDir, moved);
    f.options.outputDir = moved;
    const restored = await crawlSite(f.options);
    assert.equal(
      restored.access!.active_block_id,
      first.access!.active_block_id,
    );
    assert.equal(f.requests.length, 1);
    const snapshot = path.join(
      moved,
      "snapshots",
      `${first.access!.blocks[0].body_sha256}.bin`,
    );
    await writeFile(snapshot, "tampered");
    await assert.rejects(() => crawlSite(f.options), {
      code: "SNAPSHOT_CORRUPT",
    });
    assert.equal(f.requests.length, 1);
  } finally {
    await f.close();
  }
});

test("legacy COMPLETE challenge snapshots are rejected offline and converted to a durable gate", async () => {
  const f = await fixture();
  try {
    f.settings.page = "challenge";
    const result = await crawlSite(f.options);
    // Emulate only the old classifier's accepted artifact, retaining real fixture bytes and SHA.
    result.state = "COMPLETE";
    result.entries[0].status = "FETCHED";
    delete result.access;
    await assert.rejects(() => assertNoStoredAccessChallenge(result), {
      code: "STORED_ACCESS_CHALLENGE",
    });
    const count = f.requests.length;
    await writeFile(
      path.join(f.options.outputDir, "crawl.json"),
      JSON.stringify(result),
    );
    const guarded = await crawlSite(f.options);
    assert.equal(guarded.state, "PAUSED");
    assert.equal(guarded.access!.blocks[0].stage, "stored_snapshot");
    assert.equal(guarded.entries[0].status, "REQUIRES_ACCESS");
    assert.equal(guarded.discovery.robots_done, false);
    assert.equal(
      f.requests.length,
      count,
      "stored challenge classification is offline",
    );
  } finally {
    await f.close();
  }
});

test("acknowledgement does not reset an exhausted persisted request budget", async () => {
  const f = await fixture();
  try {
    f.settings.robots = "challenge";
    const first = await crawlSite({ ...f.options, maxRequests: 1 });
    f.settings.robots = "text";
    const result = await crawlSite({
      ...f.options,
      maxRequests: 1,
      accessResume: {
        blockId: first.access!.active_block_id!,
        acknowledgementId: "budget-ack",
        reason: "Owner has removed the access challenge",
      },
    });
    assert.equal(result.state, "PAUSED");
    assert.equal(result.counters.requests, 1);
    assert.equal(f.requests.length, 1);
    assert.ok(
      result.limitations.some((item) => item.startsWith("BUDGET_LIMIT:")),
    );
    assert.equal(result.started_at, first.started_at);
  } finally {
    await f.close();
  }
});
