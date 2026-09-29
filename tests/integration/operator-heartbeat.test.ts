import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as nextTurn } from "node:timers/promises";
import { validateOperatorCapture } from "../../packages/crawler/operator.ts";
import { extractOperatorContent } from "../../packages/extractor/operator.ts";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVwAAAABJRU5ErkJggg==",
  "base64",
);
const origin = "https://heartbeat.example";

test("synchronous accepted byte resolver gives heartbeat timers turns during assets and observations without changing output", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "upgrade-operator-heartbeat-"),
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const files = new Map<string, Buffer>();
    const reference = (name: string, bytes: Buffer) => {
      files.set(name, bytes);
      return {
        relative_path: name,
        sha256: sha(bytes),
        size_bytes: bytes.length,
      };
    };
    const observations = Array.from({ length: 12 }, (_, index) => ({
      source_url: `${origin}/page-${index}`,
      document_url: `${origin}/page-${index}`,
      observed_at: "2026-09-29T07:00:00.000Z",
      format: "dom-html",
      file: reference(
        `page-${index}.html`,
        Buffer.from(
          `<!doctype html><html><head><title>Observed ${index}</title></head><body><main><h1>Page ${index}</h1><p>Exact source fact ${index}: 2 178 р.</p><img src="/image-0.png" alt="Observed image"></main></body></html>`,
        ),
      ),
    }));
    const manifest = {
      schema_version: 1,
      kind: "operator-capture",
      capture_id: "heartbeat-capture",
      project_id: "heartbeat-review",
      source_origin: origin,
      captured_at: "2026-09-29T07:00:00.000Z",
      inventory: {
        basis: "operator-observed-urls",
        urls: [
          ...observations.map((item) => item.source_url),
          `${origin}/unobserved`,
        ],
      },
      observations,
      assets: Array.from({ length: 8 }, (_, index) => ({
        source_url: `${origin}/image-${index}.png`,
        observed_on_urls: [observations[0].source_url],
        mime: "image/png",
        file: reference(`image-${index}.png`, png),
      })),
    };
    for (const [name, bytes] of files)
      await writeFile(join(directory, name), bytes);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(join(directory, "operator-capture.json"), manifestBytes);
    const capture = await validateOperatorCapture({
      directory,
      expectedManifestSha256: sha(manifestBytes),
      expectedProjectId: manifest.project_id,
      expectedSourceUrl: origin + "/",
      serverAccessBlockId: "heartbeat-source-block",
    });
    let reads = 0;
    const ticks: number[] = [];
    timer = setInterval(() => {
      ticks.push(reads);
    }, 1);
    const model = await extractOperatorContent(capture, {
      sourceVersion: "fixed-input-version",
      readFile: (name) => {
        // A bounded CPU delay makes a due timer deterministic, even though the
        // resolver returns bytes synchronously and never yields to native I/O.
        const end = performance.now() + 3;
        while (performance.now() < end) {
          /* intentionally synchronous fixture */
        }
        reads++;
        return files.get(name)!;
      },
    });
    clearInterval(timer);
    timer = undefined;
    assert.equal(reads, 20);
    assert.ok(
      ticks.some((count) => count > 0 && count < 8),
      `No heartbeat during assets: ${JSON.stringify(ticks)}`,
    );
    assert.ok(
      ticks.some((count) => count > 8 && count < 20),
      `No heartbeat during observations: ${JSON.stringify(ticks)}`,
    );
    const asynchronous = await extractOperatorContent(capture, {
      sourceVersion: "fixed-input-version",
      readFile: async (name) => {
        await nextTurn();
        return files.get(name)!;
      },
    });
    assert.deepEqual(
      model,
      asynchronous,
      "Scheduling must not alter facts, order, hashes, source identity or limitations",
    );
    assert.equal(model.entities.length, 12);
    // The validator also retains the source-origin entry URL in the union.
    assert.equal(model.source_capture.known_urls, 14);
    assert.equal(
      model.source_capture.server_access_block_id,
      "heartbeat-source-block",
    );
    assert.equal(model.source_capture.full_source_denominator, "UNKNOWN");
    assert.deepEqual(model.prices, []);
  } finally {
    if (timer) clearInterval(timer);
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(
      basename(target),
      /^upgrade-operator-heartbeat-[A-Za-z0-9_-]+$/,
    );
    await rm(target, { recursive: true, force: true });
  }
});
