import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../packages/core/index.ts";
import { Pipeline } from "../../packages/core/pipeline.ts";
import { validateBitrixPackage } from "../../packages/bitrix-adapter/index.ts";
import { backupProject, restoreProject } from "../../packages/core/backup.ts";
function cli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--disable-warning=ExperimentalWarning",
          resolve("packages/cli/index.ts"),
          ...args,
        ],
        { windowsHide: true, shell: false },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (b) => (stdout += b));
      child.stderr.on("data", (b) => (stderr += b));
      child.on("error", reject);
      child.on("exit", (code) => resolveResult({ code, stdout, stderr }));
    },
  );
}
test("real CLI source → immutable model → Bitrix package → honest report; restart and offline rebuild", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-cli-"));
  const server = http.createServer((req, res) => {
    const target = req.url ?? "/";
    if (target === "/robots.txt") {
      res.end("User-agent: *\n");
      return;
    }
    if (target === "/sitemap.xml") {
      res.writeHead(404);
      res.end();
      return;
    }
    const title =
      target === "/" ? "Синтетическая компания" : "Услуга из источника";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="ru"><head><title>${title}</title><meta name="description" content="Фактическое описание"></head><body><main><h1>${title}</h1><p>Только подтверждённый текст источника.</p>${target === "/" ? '<a href="/Service.html?x=&x=2">Услуга</a>' : ""}</main></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  const origin = `http://127.0.0.1:${addr.port}`;
  let closed = false;
  try {
    for (const args of [
      ["init", "--id", "pilot", "--source", origin],
      ["plan", "--project", "pilot"],
    ]) {
      const result = await cli([...args, "--data-dir", dir]);
      assert.equal(result.code, 0, result.stderr);
      JSON.parse(result.stdout);
    }
    const configuration = new Store(join(dir, "pilot"));
    const savedProfile = configuration.get<any>("profile", "configured");
    savedProfile.crawl.max_html_pages = 123;
    configuration.put("profile", "configured", savedProfile);
    configuration.close();
    const duplicateInit = await cli([
      "init",
      "--id",
      "pilot",
      "--source",
      origin,
      "--data-dir",
      dir,
    ]);
    assert.equal(duplicateInit.code, 2);
    const unchanged = new Store(join(dir, "pilot"));
    assert.equal(
      unchanged.get<any>("profile", "configured").crawl.max_html_pages,
      123,
    );
    unchanged.close();
    const first = await cli([
      "run",
      "--project",
      "pilot",
      "--data-dir",
      dir,
      "--fixture-origin",
      origin,
    ]);
    assert.equal(first.code, 3, first.stderr);
    const outcome = JSON.parse(first.stdout);
    assert.equal(outcome.status, "BLOCKED");
    assert.equal(outcome.qa.coverage.total_in_scope, 2);
    assert.equal(outcome.qa.coverage.verified_in_scope, 0);
    assert.equal(
      outcome.qa.checks.find((x: any) => x.id === "bitrix-runtime").status,
      "NOT_RUN",
    );
    const blockedBackup = await cli([
      "backup",
      "--project",
      "pilot",
      "--data-dir",
      dir,
      "--to",
      join(dir, "blocked-backup"),
    ]);
    assert.equal(blockedBackup.code, 0, blockedBackup.stderr);
    assert.equal(JSON.parse(blockedBackup.stdout).kind, "upgrade-state-only");
    const stillBlocked = await cli([
      "extract",
      "--project",
      "pilot",
      "--data-dir",
      dir,
    ]);
    assert.equal(stillBlocked.code, 3);
    const status = await cli([
      "status",
      "--project",
      "pilot",
      "--data-dir",
      dir,
      "--json",
    ]);
    const durable = JSON.parse(status.stdout);
    assert.equal(durable.run.execution_status, "BLOCKED");
    const store = new Store(join(dir, "pilot"));
    const pipeline = new Pipeline(store);
    const release = pipeline.latest("release-manifest.json").value;
    const before = await validateBitrixPackage(release.package_dir, "pilot");
    assert.equal(before.entity_count, 2);
    assert.equal(before.route_count, 2);
    const routes = JSON.parse(
      readFileSync(join(release.package_dir, "data/routes.json"), "utf8"),
    );
    assert.ok(
      routes.some((r: any) => r.request_target === "/Service.html?x=&x=2"),
    );
    await new Promise<void>((r) => server.close(() => r()));
    closed = true;
    store.resumeRun();
    const rebuilt = await pipeline.locked(() => pipeline.build());
    assert.equal("reused" in rebuilt && rebuilt.reused, true);
    assert.deepEqual(rebuilt.manifest.files, before.files);
    await backupProject(store, join(dir, "backup"));
    store.close();
    await restoreProject(join(dir, "backup"), join(dir, "restored"));
    const restored = new Store(join(dir, "restored"));
    const restoredPipeline = new Pipeline(restored);
    await restoredPipeline.locked(() => restoredPipeline.extract());
    const rebuiltRestored = await restoredPipeline.locked(() =>
      restoredPipeline.build(),
    );
    assert.equal("reused" in rebuiltRestored && rebuiltRestored.reused, true);
    assert.ok(rebuiltRestored.packageDir.includes("restored"));
    restored.close();
    const report = JSON.parse(
      readFileSync(join(dir, "pilot/reports/report.json"), "utf8"),
    );
    assert.equal(report.readiness, "NOT_READY");
    assert.match(
      readFileSync(join(dir, "pilot/reports/index.html"), "utf8"),
      /NOT_READY/,
    );
  } finally {
    if (!closed) await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
