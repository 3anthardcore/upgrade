/** Reproducible bounded localhost workload. Never measures a customer's source. */
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { crawlSite } from "../packages/crawler/index.ts";

const args = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]!;
  if (
    !["--output", "--pages", "--assets", "--seconds"].includes(key) ||
    options[key] ||
    !args[i + 1]
  )
    throw Error(
      "Usage: --output NEW_DIRECTORY --pages 250 --assets 1250 --seconds 120",
    );
  options[key] = args[i + 1]!;
}
const count = (key: string, maximum: number) => {
  const value = Number(options[key]);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw Error(`Invalid finite ${key}`);
  return value;
};
const pages = count("--pages", 10000),
  assets = count("--assets", 50000),
  seconds = count("--seconds", 14400);
if (!options["--output"]) throw Error("New output directory required");
const output = resolve(options["--output"]);
await mkdir(output, { recursive: false, mode: 0o700 }); // Never reuse or delete an earlier measurement.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
  "base64",
);
const served = {
  html: 0,
  assets: 0,
  robots: 0,
  sitemap: 0,
  rejected: 0,
  bytes: 0,
};
const server = createServer((request, response) => {
  const reply = (status: number, mime: string, body: string | Buffer) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    served.bytes += bytes.length;
    response
      .writeHead(status, {
        "content-type": mime,
        "content-length": bytes.length,
      })
      .end(bytes);
  };
  if (request.method !== "GET") {
    served.rejected++;
    reply(405, "text/plain", "GET only");
    return;
  }
  if (request.url === "/robots.txt") {
    served.robots++;
    reply(200, "text/plain", "User-agent: *\nAllow: /\n");
    return;
  }
  if (request.url === "/sitemap.xml") {
    served.sitemap++;
    reply(404, "text/plain", "No sitemap");
    return;
  }
  const image = /^\/image\/(\d+)\.png$/.exec(request.url ?? "");
  if (image && Number(image[1]) < assets) {
    served.assets++;
    reply(200, "image/png", pixel);
    return;
  }
  const page = /^\/page\/(\d+)\.html$/.exec(request.url ?? ""),
    n = request.url === "/" ? 0 : page ? Number(page[1]) : -1;
  if (n < 0 || n >= pages || (page && n === 0)) {
    served.rejected++;
    reply(404, "text/plain", "Missing");
    return;
  }
  served.html++;
  const first = Math.floor((n * assets) / pages),
    last = Math.floor(((n + 1) * assets) / pages);
  let images = "";
  for (let i = first; i < last; i++)
    images += `<img src="/image/${i}.png" alt="Controlled resource ${i}">`;
  reply(
    200,
    "text/html; charset=utf-8",
    `<!doctype html><html lang="en"><head><title>Controlled page ${n}</title></head><body><main><h1>Controlled page ${n}</h1><p>Local scale fixture, no commercial facts.</p>${images}${n + 1 < pages ? `<a href="/page/${n + 1}.html">Next</a>` : ""}</main></body></html>`,
  );
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
const started = performance.now(),
  cpuBefore = process.cpuUsage();
let peakRss = process.memoryUsage().rss;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 250);
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const profile = {
  schema_version: 1,
  kind: "controlled-loopback-crawl-scale",
  origin,
  pages,
  resources: assets,
  seconds,
  requests_per_second: 100,
  max_requests: pages + assets + 2,
  max_bytes: 1000000000,
  image_content: "same valid raster bytes at distinct source URLs",
  scope: "crawl-discovery-persistence-only",
  native_bitrix: "NOT_RUN",
  full_pipeline: "NOT_RUN",
};
await writeFile(
  join(output, "profile.json"),
  JSON.stringify(profile, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
let receipt: Record<string, unknown>;
try {
  const result = await crawlSite({
    sourceUrl: origin + "/",
    projectId: "controlled-scale",
    outputDir: join(output, "source"),
    fixtureOrigins: [origin],
    maxPages: pages,
    maxAssets: assets,
    maxRequests: profile.max_requests,
    maxBytes: profile.max_bytes,
    maxWallTimeMs: seconds * 1000,
    requestsPerSecond: 100,
    maxRetries: 0,
  });
  const fetchedPages = result.entries.filter(
    (e) => e.status === "FETCHED" && e.http_status === 200,
  ).length;
  const fetchedAssets = result.assets.filter(
    (e) => e.status === "FETCHED",
  ).length;
  const complete =
    result.state === "COMPLETE" &&
    fetchedPages === pages &&
    fetchedAssets === assets &&
    served.rejected === 0 &&
    result.completeness.queued === 0 &&
    result.completeness.failed === 0;
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
  await writeFile(join(output, "crawl-result.json"), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  receipt = {
    schema_version: 1,
    status: complete ? "CONTROLLED_CRAWL_PROFILE_PASSED" : "INCOMPLETE",
    profile_sha256: hash(await readFile(join(output, "profile.json"))),
    result_sha256: hash(bytes),
    elapsed_seconds: (performance.now() - started) / 1000,
    cpu_microseconds: process.cpuUsage(cpuBefore),
    peak_rss_bytes: peakRss,
    observed: {
      fetched_pages: fetchedPages,
      fetched_resources: fetchedAssets,
      known_pages: result.entries.length,
      known_resources: result.assets.length,
      counters: result.counters,
      completeness: result.completeness,
      source_served: served,
    },
    result_bytes: (await stat(join(output, "crawl-result.json"))).size,
    limitations: result.limitations,
    full_10000_50000_profile:
      complete && pages === 10000 && assets === 50000
        ? "CRAWL_ONLY_PASSED"
        : "NOT_RUN",
    native_bitrix: "NOT_RUN",
    full_pipeline: "NOT_RUN",
    readiness: "NOT_EVALUATED",
  };
  if (!complete) process.exitCode = 3;
} catch (error) {
  receipt = {
    schema_version: 1,
    status: "FAILED",
    error: error instanceof Error ? error.message : String(error),
    elapsed_seconds: (performance.now() - started) / 1000,
    source_served: served,
    native_bitrix: "NOT_RUN",
    full_pipeline: "NOT_RUN",
  };
  process.exitCode = 1;
} finally {
  clearInterval(sample);
  await new Promise<void>((done, reject) =>
    server.close((e) => (e ? reject(e) : done())),
  );
}
await writeFile(
  join(output, "receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(receipt, null, 2));
