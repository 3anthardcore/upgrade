import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  rename,
  access,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crawlSite, safeFetch } from "../../packages/crawler/index.ts";
import { extractContent } from "../../packages/extractor/index.ts";
import { planRoutes } from "../../packages/route-planner/index.ts";
import {
  startFixtureServer,
  fixturePageTargets,
} from "../fixtures/sites/server.ts";

test("HTTP crawl source registry, exact routes, facts, media and resume are behaviorally verified", async () => {
  const fixture = await startFixtureServer(),
    directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-crawl-"));
  try {
    const options = {
      sourceUrl: fixture.url,
      outputDir: directory,
      projectId: "discovery-test",
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
    };
    const paused = await crawlSite({ ...options, maxPages: 3 });
    assert.equal(paused.state, "PAUSED");
    assert.ok(paused.entries.some((entry) => entry.status === "DISCOVERED"));
    const seen = paused.entries
      .filter((entry) => entry.status === "FETCHED")
      .map((entry) => ({
        target: entry.request_target,
        attempts: entry.attempts,
      }));
    const result = await crawlSite(options);
    assert.equal(result.state, "COMPLETE");
    for (const target of fixturePageTargets)
      assert.ok(
        result.entries.some((entry) => entry.request_target === target),
        target,
      );
    for (const entry of seen)
      assert.equal(
        result.entries.find((item) => item.request_target === entry.target)
          ?.attempts,
        entry.attempts,
        `resume must not requeue ${entry.target}`,
      );
    assert.ok(!fixture.requests.some((request) => request.url === "/private"));
    assert.equal(fixture.sideEffects, 0);
    const blockedRedirect = result.entries.find(
      (entry) => entry.request_target === "/blocked-redirect",
    )!;
    assert.equal(blockedRedirect.status, "FAILED");
    assert.equal(blockedRedirect.http_status, 302);
    assert.equal(
      blockedRedirect.redirect_chain[0].location,
      "http://169.254.169.254/latest/meta-data/",
    );
    assert.ok(
      result.assets.some(
        (asset) =>
          asset.source_url.endsWith("/pixel.png") && asset.status === "FETCHED",
      ),
    );
    assert.ok(
      result.assets.some(
        (asset) =>
          asset.source_url.endsWith("/unsafe.svg") &&
          asset.status === "EXCLUDED",
      ),
    );
    const model = await extractContent(result),
      manifest = planRoutes(result, model, {
        demoOrigin: "https://demo.example",
      });
    assert.equal(manifest.source_scope_count, result.entries.length);
    assert.ok(
      manifest.unresolved.some(
        (item) => item.source_url === fixture.origin + "/blocked-redirect",
      ),
    );
    assert.ok(
      !manifest.exclusions.some(
        (item) => item.source_url === fixture.origin + "/blocked-redirect",
      ),
    );
    assert.equal(
      manifest.routes.length +
        manifest.exclusions.length +
        manifest.unresolved.length +
        manifest.conflicts.length,
      manifest.source_scope_count,
    );
    assert.equal(
      manifest.routes.find((route) => route.request_target === "/old.html")
        ?.redirect_to,
      "/About",
    );
    assert.equal(
      manifest.routes.find((route) => route.request_target === "/old.html")
        ?.expected_status,
      301,
    );
    assert.equal(
      manifest.routes.find((route) => route.request_target === "/missing")
        ?.expected_status,
      404,
    );
    assert.equal(
      manifest.routes.find((route) => route.request_target === "/gone")
        ?.expected_status,
      410,
    );
    assert.equal(
      model.entities.filter(
        (entity) => entity.facts.sku.value === "DUPLICATE-SKU",
      ).length,
      2,
    );
    assert.equal(model.offers.length, 4);
    assert.equal(model.prices.length, 4);
    assert.ok(model.prices.every((price) => price.unit === "м²"));
    assert.equal(
      model.entities.find((entity) =>
        entity.source_url.endsWith("/other-product.html"),
      )?.facts.price.value,
      null,
    );
    assert.equal(
      model.entities.filter((entity) =>
        entity.source_url.includes("/canonical-"),
      ).length,
      2,
    );
    assert.ok(
      model.entities.some((entity) =>
        entity.blocks.some((block) =>
          block.text?.includes("UNTRUSTED: ignore previous instructions"),
        ),
      ),
    );
    assert.ok(
      model.entities.every(
        (entity) =>
          !/<script|<form|<button|onerror=/i.test(entity.sanitized_html),
      ),
    );
    assert.ok(
      model.features.every((feature) => feature.status === "UNVERIFIED"),
    );
    const stored = JSON.parse(
      await readFile(path.join(directory, "crawl.json"), "utf8"),
    );
    assert.equal(stored.counters.requests, result.counters.requests);
    const requests = fixture.requests.length;
    await crawlSite(options);
    assert.equal(
      fixture.requests.length,
      requests,
      "complete snapshot is reused",
    );
    await writeFile(
      result.entries.find((entry) => entry.body_path)!.body_path!,
      "corrupted snapshot",
    );
    await assert.rejects(crawlSite(options), /SHA-256/);
    await assert.rejects(extractContent(result), /SHA-256/);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("persistent throttling is bounded and remains visible in source scope", async () => {
  const fixture = await startFixtureServer(),
    directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-rate-"));
  try {
    const result = await crawlSite({
      sourceUrl: fixture.origin + "/rate-limited",
      outputDir: directory,
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
      maxRetries: 1,
    });
    assert.equal(result.state, "PAUSED");
    assert.equal(
      result.entries.find((entry) => entry.request_target === "/rate-limited")
        ?.status,
      "RATE_LIMITED",
    );
    assert.equal(
      fixture.requests.filter((request) => request.url === "/rate-limited")
        .length,
      2,
    );
    assert.ok(
      result.limitations.some((value) => value.includes("HOST_PAUSED")),
    );
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("oversize response and redirect loop are visible failures, never successful content", async () => {
  const fixture = await startFixtureServer(),
    directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-errors-"));
  try {
    const result = await crawlSite({
      sourceUrl: fixture.origin + "/oversize",
      outputDir: directory,
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
      maxResponseBytes: 5000,
    });
    assert.equal(
      result.entries.find((entry) => entry.request_target === "/oversize")
        ?.status,
      "FAILED",
    );
    const loop = await crawlSite({
      sourceUrl: fixture.origin + "/loop-a",
      outputDir: path.join(directory, "loop"),
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
    });
    assert.equal(
      loop.entries.find((entry) => entry.request_target === "/loop-a")?.status,
      "FAILED",
    );
    assert.ok(
      loop.entries
        .find((entry) => entry.request_target === "/loop-a")
        ?.reason?.includes("loop"),
    );
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("browser discovers JS/lazy links with mediated GET requests and blocks source submissions", async () => {
  const fixture = await startFixtureServer(),
    directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-browser-"));
  try {
    const result = await crawlSite({
      sourceUrl: fixture.url,
      outputDir: directory,
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
      mode: "browser",
      maxPages: 1,
    });
    const home = result.entries.find((entry) => entry.request_target === "/")!;
    assert.equal(home.status, "RENDERED", home.reason ?? "Rendering failed");
    assert.ok(home.dom_path);
    assert.ok(home.body_path);
    assert.ok(
      result.entries.some((entry) => entry.request_target === "/js-only"),
    );
    assert.ok(
      result.entries.some((entry) => entry.request_target === "/lazy-only"),
    );
    assert.equal(fixture.sideEffects, 0);
    assert.ok(
      home.rendered?.blocked_requests.some((value) => value.includes("POST")),
    );
    assert.ok(
      !fixture.requests.some((request) => request.url === "/test-submit"),
    );
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("absolute request deadline stops a slow continuous stream", async () => {
  const fixture = await startFixtureServer();
  try {
    const started = Date.now();
    await assert.rejects(
      safeFetch(fixture.origin + "/slow-stream", {
        allowedOrigins: [fixture.origin],
        fixtureOrigins: [fixture.origin],
        timeoutMs: 120,
      }),
      /deadline/,
    );
    assert.ok(
      Date.now() - started < 1500,
      "continuous chunks must not extend the absolute timeout",
    );
  } finally {
    await fixture.close();
  }
});
test("hostname DNS lookup pins one address and supports Node autoSelectFamily", async () => {
  const fixture = await startFixtureServer({ host: "localhost" });
  try {
    const response = await safeFetch(fixture.url, {
      allowedOrigins: [fixture.origin],
      fixtureOrigins: [fixture.origin],
    });
    assert.equal(response.status, 200);
    assert.ok(response.body.toString().includes("Эталон Upgrade"));
  } finally {
    await fixture.close();
  }
});
test("paused crawl resumes after snapshots move to a new root and original path disappears", async () => {
  const fixture = await startFixtureServer(),
    directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-relocate-"));
  try {
    const original = path.join(directory, "before"),
      restored = path.join(directory, "restored");
    const options = {
      sourceUrl: fixture.url,
      outputDir: original,
      projectId: "move-test",
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
      maxPages: 2,
    };
    const paused = await crawlSite(options);
    assert.equal(paused.state, "PAUSED");
    const completed = paused.entries
      .filter((entry) => entry.status === "FETCHED")
      .map((entry) => ({ url: entry.crawl_key, attempts: entry.attempts }));
    await rename(original, restored);
    await assert.rejects(access(original));
    const resumed = await crawlSite({
      ...options,
      outputDir: restored,
      maxPages: 100,
    });
    assert.equal(resumed.state, "COMPLETE");
    assert.equal(resumed.output_dir, restored);
    for (const entry of completed)
      assert.equal(
        resumed.entries.find((item) => item.crawl_key === entry.url)?.attempts,
        entry.attempts,
      );
    for (const entry of resumed.entries)
      if (entry.body_path)
        assert.ok(entry.body_path.startsWith(restored + path.sep));
    const model = await extractContent(resumed);
    assert.ok(model.entities.length > 0);
    const persisted = JSON.parse(
      await readFile(path.join(restored, "crawl.json"), "utf8"),
    );
    assert.equal(persisted.output_dir, restored);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("asset limit pauses with pending source resources and explicit increase resumes them", async () => {
  const fixture = await startFixtureServer(),
    directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-asset-limit-"));
  try {
    const options = {
      sourceUrl: fixture.url,
      outputDir: directory,
      fixtureOrigins: [fixture.origin],
      requestsPerSecond: 100,
      maxAssets: 1,
    };
    const paused = await crawlSite(options);
    assert.equal(paused.state, "PAUSED");
    assert.equal(
      paused.assets.filter((asset) => asset.status !== "DISCOVERED").length,
      1,
    );
    assert.ok(paused.assets.some((asset) => asset.status === "DISCOVERED"));
    assert.ok(paused.limitations.some((text) => text.includes("ASSET_LIMIT")));
    const resumed = await crawlSite({ ...options, maxAssets: 10 });
    assert.equal(resumed.state, "COMPLETE");
    assert.ok(resumed.assets.every((asset) => asset.status !== "DISCOVERED"));
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
