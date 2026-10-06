import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CrawlPersistence } from "../../packages/crawler/persistence.ts";
import type { CrawlResult } from "../../packages/crawler/index.ts";

const initial = (): CrawlResult => ({
  schema_version: 1,
  project_id: "persist-test",
  source_origin: "https://source.example",
  output_dir: "/old",
  started_at: "2026-09-30T00:00:00.000Z",
  state: "PAUSED",
  access: { version: 1, blocks: [] },
  entries: [],
  assets: [],
  limitations: [],
  counters: { requests: 0, bytes: 0, pages: 0 },
  discovery: {
    robots_done: false,
    robots: { rules: [], sitemaps: [] },
    sitemap_queue: [],
    sitemap_done: [],
    sitemap_failed: [],
  },
  policy: {
    mode: "http",
    respect_robots: true,
    source_url: "https://source.example/",
    fixture_origins: [],
  },
  completeness: {
    basis: "discovered-source-registry",
    confidence: "bounded",
    queued: 0,
    failed: 0,
    excluded: 0,
    unverified_sources: [],
  },
});
async function fixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), "upgrade-crawl-wal-"));
  const p = await CrawlPersistence.load(root),
    s = p.attach(initial());
  t.after(async () => {
    await p.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("upgrade-crawl-wal-"));
    await rm(root, { recursive: true, force: true });
  });
  await p.flush();
  return {
    root,
    p,
    s,
    async journal() {
      const h = JSON.parse(
        await readFile(path.join(root, "crawl-state/head.json"), "utf8"),
      );
      return path.join(root, "crawl-state", `journal-${h.generation}.jsonl`);
    },
  };
}

test("journal records bounded deltas and restores nested records, metadata deletion and exact URL spelling", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5000; i++)
    f.s.assets.push({
      source_url: `https://source.example/a${i}?x=&x=2`,
      status: "DISCOVERED",
      discovered_from: ["seed"],
    });
  await f.p.flush();
  await f.p.checkpoint();
  const h = JSON.parse(
    await readFile(path.join(f.root, "crawl-state/head.json"), "utf8"),
  );
  assert.ok(h.checkpoint_bytes > 500000);
  for (let i = 0; i < 20; i++) {
    f.s.assets[i].status = "FETCHED";
    f.s.assets[i].discovered_from.push("same exact ? spelling");
    f.s.counters.requests++;
    await f.p.flush();
  }
  f.s.finished_at = "temporary";
  await f.p.flush();
  delete f.s.finished_at;
  await f.p.flush();
  const journal = await f.journal();
  assert.ok(
    (await stat(journal)).size < 20000,
    "20 updates must not serialize 5,000 unchanged assets",
  );
  const resumed = await CrawlPersistence.load(f.root);
  assert.deepEqual(resumed.state, f.p.state);
  assert.equal(resumed.state!.assets.length, 5000);
  assert.equal(
    resumed.state!.assets[0].source_url,
    "https://source.example/a0?x=&x=2",
  );
  assert.equal(resumed.state!.finished_at, undefined);
});

for (const mode of [
  "checksum",
  "reorder",
  "missing-middle",
  "whole-tail",
  "whole-journal",
  "torn-tail",
  "missing-head",
] as const)
  test(`corruption ${mode} cannot fall back to an older crawl.json or release reserved budget`, async (t) => {
    const f = await fixture(t);
    await f.p.project();
    for (let i = 1; i <= 3; i++) {
      f.s.counters.requests = i;
      f.s.counters.bytes += 100;
      f.p.reserve(`https://source.example/${i}`, i);
      await f.p.flush();
    }
    const journal = await f.journal(),
      bytes = await readFile(journal, "utf8"),
      lines = bytes.trimEnd().split("\n");
    if (mode === "checksum")
      lines[1] = lines[1].replace('"bytes":200', '"bytes":201');
    if (mode === "reorder") [lines[0], lines[1]] = [lines[1], lines[0]];
    if (mode === "missing-middle") lines.splice(1, 1);
    if (mode === "whole-tail") lines.pop();
    if (mode === "whole-journal") lines.length = 0;
    if (mode === "missing-head")
      await unlink(path.join(f.root, "crawl-state/head.json"));
    else
      await writeFile(
        journal,
        mode === "torn-tail"
          ? bytes.slice(0, -12)
          : lines.length
            ? lines.join("\n") + "\n"
            : "",
      );
    await assert.rejects(
      CrawlPersistence.load(f.root),
      /checksum|sequence|Torn|Missing journal head|truncated/,
    );
  });

test("durable append with an unknown writer result recovers reservation exactly and poisons old writer", async (t) => {
  const f = await fixture(t);
  f.s.counters.requests = 1;
  f.s.counters.bytes = 8192;
  f.p.reserve("https://source.example/", 1);
  f.p.fault = (point) => {
    if (point === "after_append_sync")
      throw Error("lost append acknowledgement");
  };
  await assert.rejects(f.p.flush(), /lost append/);
  await assert.rejects(f.p.flush(), /poisoned/);
  const reopened = await CrawlPersistence.load(f.root);
  assert.equal(reopened.state!.counters.requests, 1);
  assert.equal(reopened.state!.counters.bytes, 8192);
  assert.equal(reopened.pending!.last_request, 1);
});

for (const point of ["after_checkpoint_sync", "after_head_rename"] as const)
  test(`compaction interruption ${point} has one authoritative prefix`, async (t) => {
    const f = await fixture(t);
    f.s.counters.requests = 7;
    f.s.counters.bytes = 700;
    f.p.reserve("https://source.example/", 7);
    await f.p.flush();
    f.p.fault = (at) => {
      if (at === point) throw Error("checkpoint interruption");
    };
    await assert.rejects(f.p.checkpoint(), /checkpoint interruption/);
    const restored = await CrawlPersistence.load(f.root);
    assert.equal(restored.state!.counters.requests, 7);
    assert.equal(restored.state!.counters.bytes, 700);
    assert.equal(restored.pending!.last_request, 7);
  });

test("mutation during checkpoint IO remains dirty and appears in the next journal prefix", async (t) => {
  const f = await fixture(t);
  f.p.fault = (at) => {
    if (at === "after_checkpoint_sync") f.s.counters.requests = 3;
  };
  await f.p.checkpoint();
  f.p.fault = undefined;
  await f.p.flush();
  assert.equal(
    (await CrawlPersistence.load(f.root)).state!.counters.requests,
    3,
  );
});

test("corrupt checkpoint bytes are rejected even if compatible projection is intact", async (t) => {
  const f = await fixture(t);
  await f.p.project();
  const h = JSON.parse(
    await readFile(path.join(f.root, "crawl-state/head.json"), "utf8"),
  );
  await writeFile(
    path.join(f.root, "crawl-state", `checkpoint-${h.generation}.json`),
    "{}",
  );
  await assert.rejects(CrawlPersistence.load(f.root), /SHA-256/);
});

test("finite delta cap rejects one oversized mutation before writing a partial journal record", async (t) => {
  const f = await fixture(t),
    before = (await stat(await f.journal())).size;
  f.s.limitations.push("x".repeat(16_000_001));
  await assert.rejects(f.p.flush(), /finite line cap/);
  assert.equal((await stat(await f.journal())).size, before);
  assert.deepEqual(
    (await CrawlPersistence.load(f.root)).state!.limitations,
    [],
  );
});

test("failure before reservation append never creates a durable budget authorization", async (t) => {
  const f = await fixture(t);
  f.s.counters.requests = 1;
  f.s.counters.bytes = 100;
  f.p.reserve("https://source.example/", 1);
  f.p.fault = (at) => {
    if (at === "before_append") throw Error("append unavailable");
  };
  await assert.rejects(f.p.flush(), /append unavailable/);
  const prior = await CrawlPersistence.load(f.root);
  assert.equal(prior.pending, null);
  assert.equal(prior.state!.counters.requests, 0);
  await assert.rejects(f.p.flush(), /poisoned/);
});

test("lost watermark acknowledgement retains the exact network reservation", async (t) => {
  const f = await fixture(t);
  f.s.counters.requests = 1;
  f.s.counters.bytes = 4096;
  f.p.reserve("https://source.example/", 1);
  f.p.fault = (at) => {
    if (at === "after_reservation_sync")
      throw Error("watermark acknowledgement lost");
  };
  await assert.rejects(f.p.flush(), /acknowledgement lost/);
  const resumed = await CrawlPersistence.load(f.root);
  assert.equal(resumed.state!.counters.bytes, 4096);
  assert.equal(resumed.pending!.first_request, 1);
});

for (const mode of ["torn", "checksum", "missing-after-checkpoint"] as const)
  test(`reservation watermark ${mode} fails closed`, async (t) => {
    const f = await fixture(t);
    f.s.counters.requests = 1;
    f.s.counters.bytes = 100;
    f.p.reserve("https://source.example/", 1);
    await f.p.flush();
    await f.p.checkpoint();
    await f.p.close();
    const file = path.join(f.root, "crawl-state/reservation.json");
    if (mode === "missing-after-checkpoint") await unlink(file);
    else {
      const bytes = await readFile(file, "utf8");
      await writeFile(
        file,
        mode === "torn"
          ? bytes.slice(0, 99)
          : bytes.replace('"requests":1', '"requests":2'),
      );
    }
    await assert.rejects(
      CrawlPersistence.load(f.root),
      /watermark|reservation/,
    );
  });
