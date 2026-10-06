import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  planPilotSource,
  writeSourceQueue,
  encodeSourceQueue,
  decodeSourceQueue,
  SOURCE_QUEUE_LIMITS,
} from "../../scripts/plan-pilot-source.ts";
import type { SourceQueueOptions } from "../../scripts/plan-pilot-source.ts";

const origin = "https://queue.example";
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const html = (body: string, head = "") =>
  `<!doctype html><html><head><title>Observed content</title>${head}</head><body>${body}</body></html>`;
async function fixture(
  captureHtml = html(
    '<h1>Home</h1><a href="/inventory-link">Inventory link</a>',
  ),
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "upgrade-source-queue-"),
  );
  const captureRoot = path.join(directory, "capture"),
    first = path.join(directory, "raw-a"),
    second = path.join(directory, "raw-b");
  await Promise.all([mkdir(captureRoot), mkdir(first), mkdir(second)]);
  await writeFile(path.join(captureRoot, "home.html"), captureHtml);
  const manifest = {
    schema_version: 1,
    kind: "operator-capture",
    capture_id: "queue-test",
    project_id: "queue-test",
    source_origin: origin,
    captured_at: "2026-09-30T03:00:00.000Z",
    inventory: {
      basis: "operator-observed-urls",
      urls: [origin + "/", origin + "/inventory-only"],
    },
    observations: [
      {
        source_url: origin + "/",
        document_url: origin + "/",
        observed_at: "2026-09-30T03:00:00.000Z",
        format: "dom-html",
        file: {
          relative_path: "home.html",
          sha256: sha(captureHtml),
          size_bytes: Buffer.byteLength(captureHtml),
        },
      },
    ],
    assets: [],
  };
  const capturePath = path.join(captureRoot, "operator-capture.json");
  let pin = "";
  const updateManifest = async () => {
    const bytes = JSON.stringify(manifest);
    await writeFile(capturePath, bytes);
    pin = sha(bytes);
  };
  await updateManifest();
  const raw = async (
    root: string,
    name: string,
    source: string,
    body: string,
    links: string[] = [],
    at = "2026-09-30T03:01:00.000Z",
    extra: Record<string, unknown> = {},
  ) => {
    await writeFile(
      path.join(root, name + ".raw.json"),
      JSON.stringify({
        source_url: source,
        document_url: source,
        observed_at: at,
        html: body,
        links,
        ...extra,
      }),
    );
    await writeFile(path.join(root, name + ".html"), body);
  };
  const options = (
    changes: Partial<SourceQueueOptions> = {},
  ): SourceQueueOptions => ({
    rawDirs: [first],
    capturePath,
    expectedCaptureSha256: pin,
    ...changes,
  });
  const close = async () => {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.match(path.basename(directory), /^upgrade-source-queue-/);
    await rm(directory, { recursive: true, force: true });
  };
  return {
    directory,
    captureRoot,
    capturePath,
    first,
    second,
    manifest,
    raw,
    options,
    updateManifest,
    close,
  };
}

test("source queue preserves exact path/query identities and duplicate raw witnesses without inventing routes", async () => {
  const f = await fixture();
  try {
    const targets = [
      "/item",
      "/item?",
      "/item/",
      "/Item",
      "/item?x=1&x=2&empty=",
      "/item?x=2&x=1&empty=",
      "/a%2Fb",
      "/a%2fb",
    ];
    const links = targets.map((t) => origin + t);
    await f.raw(
      f.first,
      "page",
      origin + "/source",
      html(
        links
          .map(
            (u) =>
              `<h2><a href="${u.replaceAll("&", "&amp;")}">Observed</a></h2>`,
          )
          .join(""),
      ),
      [...links, links[0]],
    );
    const queue = await planPilotSource(f.options());
    for (const target of targets)
      assert.ok(
        queue.entries.some((e) => e.request_target === target),
        target,
      );
    assert.equal(
      new Set(queue.entries.map((e) => e.id)).size,
      queue.entries.length,
    );
    const one = queue.entries.find((e) => e.url === origin + "/item")!;
    assert.equal(one.witnesses.filter((w) => w.kind === "raw-link").length, 2);
    assert.equal(one.queue_status, "OUTSTANDING");
    assert.equal(
      queue.entries.find((e) => e.request_target === "/item?")!.classification,
      "QUERY_VARIANT_REVIEW",
    );
    assert.ok(
      one.witnesses.every(
        (w) =>
          w.input_sha256.length === 64 && w.source_url === origin + "/source",
      ),
    );
    assert.equal(queue.full_source_denominator, "UNKNOWN");
    assert.equal(queue.source_access, "UNCHANGED_NOT_VERIFIED");
  } finally {
    await f.close();
  }
});

test("queue is byte deterministic across raw directory order, duplicate directories and repeated planning", async () => {
  const f = await fixture();
  try {
    await f.raw(
      f.first,
      "first",
      origin + "/first",
      html('<nav><a href="/category">Category</a></nav>'),
      [origin + "/one"],
    );
    await f.raw(
      f.second,
      "second",
      origin + "/second",
      html('<h2><a href="/product/detail">Detail</a></h2>'),
      [origin + "/two"],
    );
    const a = await planPilotSource(
      f.options({ rawDirs: [f.first, f.second] }),
    );
    const b = await planPilotSource(
      f.options({ rawDirs: [f.second, f.first, f.first] }),
    );
    assert.deepEqual(b, a);
    assert.deepEqual(
      await planPilotSource(f.options({ rawDirs: [f.first, f.second] })),
      a,
    );
    assert.equal(a.next_batch[0].url, origin + "/category");
    assert.ok(a.next_batch.every((e) => e.witness.raw_reference.length > 0));
  } finally {
    await f.close();
  }
});

test("pinned resume unions unresolved URLs and only supplied observations advance selected work", async () => {
  const f = await fixture();
  try {
    await f.raw(
      f.first,
      "first",
      origin + "/first",
      html('<nav><a href="/a">A</a><a href="/b">B</a></nav>'),
      [origin + "/a", origin + "/b", origin + "/retained?x=1&x=2"],
    );
    const before = await planPilotSource(f.options({ batchSize: 1 }));
    assert.equal(before.next_batch[0].url, origin + "/a");
    const saved = await writeSourceQueue(before, path.join(f.directory, "out"));
    const resumeOptions = f.options({
      rawDirs: [f.second],
      batchSize: 1,
      previousQueuePath: saved.queuePath,
      expectedPreviousSha256: saved.sha256,
    });
    const unprocessed = await planPilotSource(resumeOptions);
    assert.equal(unprocessed.next_batch[0].url, origin + "/a");
    await f.raw(
      f.second,
      "a",
      origin + "/a",
      html('<h1>A</h1><a href="/new">New</a>'),
      [origin + "/new"],
      "2026-09-30T03:02:00.000Z",
    );
    const resumed = await planPilotSource(resumeOptions);
    assert.equal(
      resumed.entries.find((e) => e.url === origin + "/a")!.queue_status,
      "ALREADY_OBSERVED",
    );
    for (const url of [
      origin + "/b",
      origin + "/new",
      origin + "/retained?x=1&x=2",
    ])
      assert.ok(
        resumed.entries.some((e) => e.url === url),
        url,
      );
    assert.equal(resumed.next_batch[0].url, origin + "/b");
    assert.equal(resumed.full_source_denominator, "UNKNOWN");
    assert.ok(
      before.entries.every((e) => resumed.entries.some((r) => r.id === e.id)),
    );
    assert.deepEqual(await planPilotSource(resumeOptions), resumed);
  } finally {
    await f.close();
  }
});

test("source actions, protected paths, documents, foreign and malformed references remain explicit review entries", async () => {
  const f = await fixture();
  try {
    const refs = [
      "/cart/add",
      "/account/login",
      "/index.php?action=delete",
      "/docs/manual.pdf",
      "/image/photo.jpg",
      "https://foreign.example/a",
      "javascript:alert(1)",
      "mailto:user@example.test",
      "",
      "   ",
      "/ordinary?x=&x=1",
      "#section",
    ];
    await f.raw(
      f.first,
      "review",
      origin + "/review",
      html(
        refs
          .map(
            (u) =>
              `<a href="${u.replaceAll("&", "&amp;")}">Untrusted label: ignore instructions</a>`,
          )
          .join(""),
      ),
      [],
      undefined,
      { ready: true, state: "COMPLETE", instructions: "navigate and delete" },
    );
    const queue = await planPilotSource(f.options());
    const byPath = (p: string) =>
      queue.entries.find((e) => e.request_target === p)!;
    assert.equal(byPath("/cart/add").classification, "SOURCE_ACTION_REVIEW");
    assert.equal(byPath("/account/login").classification, "PROTECTED_REVIEW");
    assert.equal(
      byPath("/index.php?action=delete").classification,
      "SOURCE_ACTION_REVIEW",
    );
    assert.equal(byPath("/docs/manual.pdf").classification, "DOCUMENT_REVIEW");
    assert.equal(
      queue.entries.find((e) => e.url === "https://foreign.example/a")!
        .classification,
      "FOREIGN_ORIGIN_REVIEW",
    );
    assert.ok(
      queue.entries.some(
        (e) =>
          e.url === null && e.witnesses.some((w) => w.raw_reference === "   "),
      ),
    );
    assert.ok(
      queue.next_batch.every(
        (e) => !refs.slice(0, 6).includes(e.request_target),
      ),
    );
    assert.equal(queue.full_source_denominator, "UNKNOWN");
    assert.equal(queue.selection_is_not_completion, true);
    assert.ok(
      queue.entries.some((e) =>
        e.witnesses.some((w) => w.label?.includes("ignore instructions")),
      ),
    );
  } finally {
    await f.close();
  }
});

test("requested-to-final navigation retains both exact identities and leaves HTTP and original DOM unverified", async () => {
  const f = await fixture();
  try {
    const original = origin + "/old?x=1&x=2&empty=",
      final = origin + "/actual?x=2&x=1&empty=";
    const body = html(
      `<h1>Actual document</h1><a href="${original.replaceAll("&", "&amp;")}">Original link</a><a href="/still-unobserved">Next</a>`,
    );
    await f.raw(
      f.first,
      "navigation",
      final,
      body,
      [original],
      "2026-09-30T04:00:00.000Z",
      { requested_url: original },
    );
    const queue = await planPilotSource(f.options());
    const requested = queue.entries.find((e) => e.url === original)!,
      reached = queue.entries.find((e) => e.url === final)!;
    assert.equal(requested.classification, "HTTP_NAVIGATION_UNVERIFIED");
    assert.equal(requested.queue_status, "REVIEW_REQUIRED");
    assert.equal(requested.observation_status, "NOT_OBSERVED");
    assert.deepEqual(requested.observations, []);
    assert.equal(reached.observation_status, "DOM_OBSERVED");
    assert.equal(reached.queue_status, "ALREADY_OBSERVED");
    assert.notEqual(requested.id, reached.id);
    assert.equal(requested.request_target, "/old?x=1&x=2&empty=");
    const witness = requested.witnesses.find(
      (w) => w.kind === "requested-url",
    )!;
    assert.equal(witness.raw_reference, original);
    assert.equal(witness.source_url, final);
    assert.equal(witness.html_sha256, sha(body));
    assert.equal(witness.observed_at, "2026-09-30T04:00:00.000Z");
    assert.equal(witness.input_id, reached.observations[0].input_id);
    assert.ok(!queue.next_batch.some((e) => e.url === original));
    assert.ok(
      queue.next_batch.some((e) => e.url === origin + "/still-unobserved"),
    );
    for (const forbidden of [
      "http_status",
      "redirect_status",
      "redirect_target",
      "alias_of",
    ])
      assert.ok(!(forbidden in requested));
    assert.equal(queue.full_source_denominator, "UNKNOWN");
    assert.equal(queue.source_access, "UNCHANGED_NOT_VERIFIED");
  } finally {
    await f.close();
  }
});

test("legacy queued navigation is reclassified on offline pinned resume without dropping its witness or denominator", async () => {
  const f = await fixture();
  try {
    const original = origin + "/old",
      final = origin + "/final";
    await f.raw(
      f.first,
      "old",
      final,
      html('<h1>Final</h1><a href="/old">Old</a>'),
      [original],
      "2026-09-30T04:00:00.000Z",
      { requested_url: original },
    );
    const prior = await planPilotSource(f.options());
    const legacy = structuredClone(prior),
      entry = legacy.entries.find((e) => e.url === original)!;
    entry.classification = "CONTENT_CANDIDATE";
    entry.queue_status = "OUTSTANDING";
    entry.review_reasons = [];
    const stored = await writeSourceQueue(
      legacy,
      path.join(f.directory, "legacy"),
    );
    const options = f.options({
      rawDirs: [f.second],
      previousQueuePath: stored.queuePath,
      expectedPreviousSha256: stored.sha256,
    });
    const resumed = await planPilotSource(options),
      current = resumed.entries.find((e) => e.url === original)!;
    assert.equal(current.classification, "HTTP_NAVIGATION_UNVERIFIED");
    assert.equal(current.queue_status, "REVIEW_REQUIRED");
    assert.equal(current.observation_status, "NOT_OBSERVED");
    assert.deepEqual(current.witnesses, entry.witnesses);
    assert.ok(
      legacy.entries.every((e) =>
        resumed.entries.some((next) => next.id === e.id),
      ),
    );
    assert.ok(!resumed.next_batch.some((e) => e.url === original));
    assert.deepEqual(await planPilotSource(options), resumed);
    assert.equal(sha(await readFile(stored.queuePath)), stored.sha256);
  } finally {
    await f.close();
  }
});

test("a later direct original DOM can resolve the queue gate but older DOM cannot override later navigation evidence", async () => {
  const f = await fixture();
  try {
    const original = origin + "/old";
    await f.raw(
      f.first,
      "earlier",
      original,
      html("<h1>Old snapshot</h1>"),
      [],
      "2026-09-30T03:30:00.000Z",
    );
    await f.raw(
      f.first,
      "navigation",
      origin + "/final",
      html('<h1>Final</h1><a href="/old">Old</a>'),
      [original],
      "2026-09-30T04:00:00Z",
      { requested_url: original },
    );
    const before = await planPilotSource(f.options()),
      old = before.entries.find((e) => e.url === original)!;
    assert.equal(old.classification, "HTTP_NAVIGATION_UNVERIFIED");
    assert.equal(old.queue_status, "REVIEW_REQUIRED");
    assert.equal(old.observations.length, 1);
    assert.equal(old.observations[0].observed_at, "2026-09-30T03:30:00.000Z");
    await f.raw(
      f.first,
      "newer",
      original,
      html("<h1>Later original snapshot</h1>"),
      [],
      "2026-09-30T04:00:00.010Z",
      { requested_url: original },
    );
    const after = await planPilotSource(f.options()),
      direct = after.entries.find((e) => e.url === original)!;
    assert.equal(direct.queue_status, "ALREADY_OBSERVED");
    assert.equal(direct.classification, "CONTENT_CANDIDATE");
    assert.equal(direct.observations.length, 2);
    assert.ok(
      direct.witnesses.some(
        (w) => w.kind === "requested-url" && w.source_url === origin + "/final",
      ),
    );
  } finally {
    await f.close();
  }
});

test("query normalization is review evidence and navigation never weakens action or protected classifications", async () => {
  const f = await fixture();
  try {
    for (const [i, requested] of [
      origin + "/guide?m",
      origin + "/cart/add",
      origin + "/account/login",
    ].entries())
      await f.raw(
        f.first,
        "nav-" + i,
        i === 0 ? origin + "/guide?m=" : origin + "/reached-" + i,
        html("<h1>Reached</h1>"),
        [requested],
        "2026-09-30T04:00:00.000Z",
        { requested_url: requested },
      );
    await f.raw(
      f.first,
      "same",
      origin + "/same",
      html("<h1>Same</h1>"),
      [],
      "2026-09-30T04:00:00.000Z",
      { requested_url: origin + "/same" },
    );
    const queue = await planPilotSource(f.options());
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/guide?m")!.classification,
      "HTTP_NAVIGATION_UNVERIFIED",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/guide?m=")!.queue_status,
      "ALREADY_OBSERVED",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/guide?m")!
        .observation_status,
      "NOT_OBSERVED",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/cart/add")!.classification,
      "SOURCE_ACTION_REVIEW",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/account/login")!
        .classification,
      "PROTECTED_REVIEW",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/same")!.queue_status,
      "ALREADY_OBSERVED",
    );
  } finally {
    await f.close();
  }
});

test("challenge snapshots keep source URL unresolved and do not contribute challenge links", async () => {
  const f = await fixture();
  try {
    await f.raw(
      f.first,
      "challenge",
      origin + "/blocked",
      '<title>KillBot user verification [127.0.0.1] [fixture]...</title><a href="/challenge-command">Run</a><script>globalThis.queueExecuted=true</script>',
      [origin + "/challenge-command"],
    );
    const queue = await planPilotSource(f.options());
    const blocked = queue.entries.find((e) => e.url === origin + "/blocked")!;
    assert.equal(blocked.observation_status, "ACCESS_CHALLENGE");
    assert.equal(blocked.queue_status, "REVIEW_REQUIRED");
    assert.ok(
      !queue.entries.some((e) => e.url === origin + "/challenge-command"),
    );
    assert.equal((globalThis as any).queueExecuted, undefined);
  } finally {
    await f.close();
  }
});

test("selected fields do not become complete DOM observations or cleared access", async () => {
  const f = await fixture();
  try {
    const selected = JSON.stringify({
      source_url: origin + "/",
      document_title: "Observed partial title",
      links: [origin + "/partial-linked"],
      fields: [],
      asset_urls: [],
    });
    await writeFile(path.join(f.captureRoot, "home.html"), selected);
    f.manifest.observations[0].format = "selected-fields-json";
    f.manifest.observations[0].file.sha256 = sha(selected);
    f.manifest.observations[0].file.size_bytes = Buffer.byteLength(selected);
    await f.updateManifest();
    const queue = await planPilotSource(f.options());
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/")!.observation_status,
      "SELECTED_FIELDS_ONLY",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/")!.queue_status,
      "REVIEW_REQUIRED",
    );
    assert.equal(
      queue.entries.find((e) => e.url === origin + "/partial-linked")!
        .witnesses[0].html_sha256,
      null,
    );
    assert.equal(queue.counts.observed_dom, 0);
  } finally {
    await f.close();
  }
});

test("caller pins, paired raw bytes and observation hashes fail closed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      planPilotSource(f.options({ expectedCaptureSha256: "0".repeat(64) })),
      { code: "QUEUE_PIN" },
    );
    await f.raw(f.first, "page", origin + "/page", html("<h1>Before</h1>"));
    await writeFile(path.join(f.first, "page.html"), html("<h1>Changed</h1>"));
    await assert.rejects(planPilotSource(f.options()), { code: "QUEUE_PIN" });
    await writeFile(path.join(f.first, "page.html"), html("<h1>Before</h1>"));
    await writeFile(path.join(f.captureRoot, "home.html"), "changed");
    await assert.rejects(planPilotSource(f.options()), { code: "QUEUE_PIN" });
  } finally {
    await f.close();
  }
});

test("traversal and foreign raw source are rejected rather than read or silently discarded", async () => {
  const f = await fixture();
  try {
    f.manifest.observations[0].file.relative_path = "../outside.html";
    await f.updateManifest();
    await assert.rejects(planPilotSource(f.options()), { code: "QUEUE_PATH" });
    f.manifest.observations[0].file.relative_path = "home.html";
    await f.updateManifest();
    await f.raw(
      f.first,
      "foreign",
      "https://foreign.example/",
      html("<h1>Foreign</h1>"),
    );
    await assert.rejects(planPilotSource(f.options()), {
      code: "QUEUE_ORIGIN",
    });
  } finally {
    await f.close();
  }
});

test("immutable queue snapshots are replayable and are never overwritten after tampering", async () => {
  const f = await fixture();
  try {
    const queue = await planPilotSource(f.options());
    const output = path.join(f.directory, "output");
    const first = await writeSourceQueue(queue, output),
      second = await writeSourceQueue(queue, output);
    assert.deepEqual(second, first);
    assert.equal(sha(await readFile(first.queuePath)), first.sha256);
    await writeFile(first.queuePath, "tamper");
    await assert.rejects(writeSourceQueue(queue, output), {
      code: "QUEUE_IMMUTABLE",
    });
    await assert.rejects(
      planPilotSource(
        f.options({
          previousQueuePath: first.queuePath,
          expectedPreviousSha256: first.sha256,
        }),
      ),
      { code: "QUEUE_PIN" },
    );
  } finally {
    await f.close();
  }
});

test("actual CLI creates a pinned offline queue and rejects missing input pins", async () => {
  const f = await fixture();
  try {
    const args = [
      "--disable-warning=ExperimentalWarning",
      "scripts/plan-pilot-source.ts",
      "--raw-dir",
      f.first,
      "--capture",
      f.capturePath,
      "--capture-sha256",
      f.options().expectedCaptureSha256,
      "--output",
      path.join(f.directory, "cli"),
      "--batch-size",
      "2",
    ];
    const first = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(first.status, 0, first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(sha(await readFile(output.queuePath)), output.sha256);
    assert.ok(output.next_batch_count <= 2);
    const failed = spawnSync(
      process.execPath,
      ["scripts/plan-pilot-source.ts", "--raw-dir", f.first],
      { encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stderr).error, "QUEUE_OPTIONS");
  } finally {
    await f.close();
  }
});

test("normalized provenance is lossless, smaller, and malformed context references fail closed", async () => {
  const f = await fixture();
  try {
    const targets = Array.from(
      { length: 80 },
      (_, i) => origin + `/item?position=${i}&position=${i + 1}&empty=`,
    );
    await f.raw(
      f.first,
      "many",
      origin + "/many",
      html(
        targets
          .map((t) => `<a href="${t.replaceAll("&", "&amp;")}">Exact ${t}</a>`)
          .join(""),
      ),
      targets,
    );
    const queue = await planPilotSource(f.options());
    const encoded = encodeSourceQueue(queue);
    assert.deepEqual(
      decodeSourceQueue(JSON.parse(JSON.stringify(encoded))),
      queue,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(encoded)) <
        Buffer.byteLength(JSON.stringify(queue)) * 0.8,
    );
    assert.deepEqual(decodeSourceQueue(queue), queue);
    const malformed = structuredClone(encoded);
    malformed.entries.find((e) => e.witnesses.length)!.witnesses[0].context =
      999999;
    assert.throws(() => decodeSourceQueue(malformed), {
      code: "QUEUE_PREVIOUS",
    });
    const saved = await writeSourceQueue(
      queue,
      path.join(f.directory, "normalized"),
    );
    const resumed = await planPilotSource(
      f.options({
        previousQueuePath: saved.queuePath,
        expectedPreviousSha256: saved.sha256,
      }),
    );
    assert.deepEqual(resumed, queue);
    assert.equal(
      (await writeSourceQueue(resumed, path.join(f.directory, "normalized")))
        .sha256,
      saved.sha256,
    );
  } finally {
    await f.close();
  }
});

test("provenance byte budget fails explicitly before registry output and cannot raise the hard cap", async () => {
  const f = await fixture();
  try {
    await assert.rejects(planPilotSource(f.options({ maxWitnessBytes: 1 })), {
      code: "QUEUE_LIMIT",
    });
    await assert.rejects(
      planPilotSource(f.options({ maxWitnessBytes: 256_000_001 })),
      { code: "QUEUE_OPTIONS" },
    );
    const complete = await planPilotSource(f.options());
    const encoded = encodeSourceQueue(complete);
    const chargedBytes =
      encoded.witness_contexts.reduce(
        (n, context) => n + Buffer.byteLength(JSON.stringify(context)),
        0,
      ) +
      encoded.entries.reduce(
        (n, entry) =>
          n +
          entry.witnesses.reduce((m, witness) => {
            const { context, ...reference } = witness;
            return m + Buffer.byteLength(JSON.stringify(reference)) + 128;
          }, 0),
        0,
      );
    assert.deepEqual(
      await planPilotSource(f.options({ maxWitnessBytes: chargedBytes })),
      complete,
    );
    await assert.rejects(
      planPilotSource(f.options({ maxWitnessBytes: chargedBytes - 1 })),
      { code: "QUEUE_LIMIT" },
    );
    assert.deepEqual(
      await planPilotSource(f.options({ maxWitnessBytes: 256_000_000 })),
      complete,
    );
  } finally {
    await f.close();
  }
});

test("one-million witness cap preserves all occurrences at a lower boundary and never truncates the prior unknown scope", async () => {
  const f = await fixture();
  try {
    assert.equal(SOURCE_QUEUE_LIMITS.witnesses, 1_000_000);
    assert.equal(SOURCE_QUEUE_LIMITS.witnessBytes, 256_000_000);
    assert.equal(SOURCE_QUEUE_LIMITS.previousBytes, 180_000_000);
    assert.equal(SOURCE_QUEUE_LIMITS.totalBytes, 800_000_000);
    await f.raw(
      f.first,
      "repeat",
      origin + "/page",
      html(
        '<a href="/unresolved?q=1&q=2">A</a><a href="/unresolved?q=1&q=2">B</a>',
      ),
      [origin + "/unresolved?q=1&q=2"],
    );
    const full = await planPilotSource(f.options());
    const count = full.entries.reduce(
      (n, item) => n + item.witnesses.length,
      0,
    );
    assert.ok(count > 1);
    assert.deepEqual(
      await planPilotSource(f.options({ maxWitnesses: count })),
      full,
    );
    const saved = await writeSourceQueue(
      full,
      path.join(f.directory, "snapshot"),
    );
    await assert.rejects(
      planPilotSource(
        f.options({
          previousQueuePath: saved.queuePath,
          expectedPreviousSha256: saved.sha256,
          maxWitnesses: count - 1,
        }),
      ),
      { code: "QUEUE_LIMIT" },
    );
    assert.equal(sha(await readFile(saved.queuePath)), saved.sha256);
    assert.equal(full.full_source_denominator, "UNKNOWN");
    assert.ok(
      full.entries.some(
        (entry) =>
          entry.url === origin + "/inventory-only" &&
          entry.queue_status !== "ALREADY_OBSERVED",
      ),
    );
    for (const value of [1_000_001, NaN, 0, 1.5])
      await assert.rejects(
        planPilotSource(f.options({ maxWitnesses: value })),
        { code: "QUEUE_OPTIONS" },
      );
  } finally {
    await f.close();
  }
});
