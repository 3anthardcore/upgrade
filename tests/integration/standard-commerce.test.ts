import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { crawlSite } from "../../packages/crawler/index.ts";
import { extractContent } from "../../packages/extractor/index.ts";
import { planRoutes } from "../../packages/route-planner/index.ts";
import {
  buildBitrixPackage,
  validateBitrixPackage,
} from "../../packages/bitrix-adapter/index.ts";

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const targets = ["/one?size=m&size=s&empty=", "/two", "/unknown", "/foreign"];
async function fixture(wrapPrimary?: (body: string) => string) {
  const directory = await mkdtemp(join(tmpdir(), "upgrade-standard-commerce-"));
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.method + " " + request.url);
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    const target = request.url!,
      origin = "http://" + request.headers.host;
    if (target === "/robots.txt") {
      response
        .writeHead(200, { "content-type": "text/plain" })
        .end("User-agent: *\nAllow: /\n");
      return;
    }
    if (target === "/sitemap.xml") {
      response.writeHead(404).end();
      return;
    }
    if (target === "/pixel.png") {
      response
        .writeHead(200, { "content-type": "image/png" })
        .end(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
            "base64",
          ),
        );
      return;
    }
    const n = targets.indexOf(target);
    if (target !== "/" && n < 0) {
      response.writeHead(404).end();
      return;
    }
    const name =
      n === 0
        ? "Observed one"
        : n === 1
          ? "Observed two"
          : n === 2
            ? "Unknown item"
            : "Unbound item";
    const data =
      n < 0
        ? null
        : {
            "@context": "https://schema.org",
            "@type": "Product",
            url:
              n === 3 ? "https://foreign.example/unrelated" : origin + target,
            name,
            sku: "SAME-SKU",
            brand: {
              "@type": "Brand",
              name: n === 0 ? "Maker one" : "Maker two",
            },
            ...(n === 2
              ? {}
              : {
                  offers: {
                    "@type": "Offer",
                    url:
                      n === 3
                        ? "https://foreign.example/unrelated"
                        : origin + target,
                    price: "90",
                    priceCurrency: "RUB",
                    availability: "https://schema.org/InStock",
                    priceSpecification: { unitText: "piece" },
                    eligibleQuantity: { minValue: "1", stepValue: "1" },
                  },
                }),
          };
    const body =
      n < 0
        ? `<h1>Catalog fixture</h1>${targets.map((t) => `<a href="${t.replaceAll("&", "&amp;")}">${t}</a>`).join("")}`
        : `<h1>${name}</h1><p>Observed factual description</p><img src="/pixel.png" alt="Observed photo">${n < 2 ? '<div id="product"><span class="price_old">100 р. / шт.</span><span class="price_new">90 р. / шт.</span><input name="quantity" min="1" step="1" value="1"></div>' : ""}`;
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        `<!doctype html><html><head><title>${n < 0 ? "Catalog" : name}</title>${data ? `<script type="application/ld+json">${JSON.stringify(data)}</script>` : ""}</head><body>${n === 0 && wrapPrimary ? wrapPrimary(body) : `<main>${body}</main>`}</body></html>`,
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin =
    "http://127.0.0.1:" +
    (server.address() as import("node:net").AddressInfo).port;
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await new Promise<void>((r, reject) =>
        server.close((e) => (e ? reject(e) : r())),
      );
    }
  };
  try {
    const crawl = await crawlSite({
      sourceUrl: origin + "/",
      projectId: "standard-commerce",
      outputDir: join(directory, "source"),
      fixtureOrigins: [origin],
      requestsPerSecond: 100,
    });
    assert.equal(crawl.state, "COMPLETE");
    await close(); // Extraction and build must work with the source offline.
    return {
      directory,
      origin,
      crawl,
      requests,
      cleanup: async () => {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        assert.match(basename(directory), /^upgrade-standard-commerce-[\w-]+$/);
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await close();
    throw e;
  }
}

test("ordinary HTTP crawl feeds observed commerce into a private demo snapshot with source offline", async () => {
  const f = await fixture();
  try {
    const model = await extractContent(f.crawl);
    assert.equal(model.commerce?.entries.length, model.entities.length);
    assert.ok(f.requests.every((s) => s.startsWith("GET ")));
    const one = model.commerce!.entries.find(
      (e) => e.request_target === targets[0],
    )!;
    const two = model.commerce!.entries.find(
      (e) => e.request_target === "/two",
    )!;
    assert.equal(one.page_kind.value, "PRODUCT");
    assert.equal(one.product.sku.value, "SAME-SKU");
    assert.equal(two.product.sku.value, "SAME-SKU");
    assert.notEqual(one.entity_source_id, two.entity_source_id);
    assert.equal(one.product.brand.value, "Maker one");
    assert.equal(two.product.brand.value, "Maker two");
    assert.ok(
      one.prices.some((p) => p.role === "CURRENT" && p.money?.decimal === "90"),
    );
    assert.ok(
      one.prices.some((p) => p.role === "OLD" && p.money?.decimal === "100"),
    );
    assert.equal(one.purchase.min_quantity, "1");
    assert.equal(one.purchase.quantity_step, "1");
    const entry = f.crawl.entries.find((e) => e.request_target === targets[0])!;
    assert.equal(one.prices[0].evidence.snapshot_sha256, entry.body_sha256);
    assert.equal(one.prices[0].evidence.trust, "untrusted-source-data");
    const image = f.crawl.assets.find(
      (a) => a.source_url === f.origin + "/pixel.png",
    )!;
    assert.ok(one.images.some((i) => i.asset_sha256 === image.sha256));
    const routes = planRoutes(f.crawl, model, {
      demoOrigin: "https://demo.example",
    });
    const built = await buildBitrixPackage({
      projectId: model.project_id,
      sourceVersion: sha(JSON.stringify(model)),
      outputDir: join(f.directory, "package"),
      sourceOrigin: model.source_origin,
      entities: model.entities.map((e) => ({ ...e })),
      routes: routes.routes.map((r) => ({ ...r })),
      assets: model.assets,
      assetRoot: f.crawl.output_dir,
      commerce: model.commerce,
    });
    await validateBitrixPackage(built.packageDir, model.project_id);
    const snapshot = JSON.parse(
      await readFile(join(built.packageDir, "data/demo-snapshot.json"), "utf8"),
    );
    const item = snapshot.items.find((i: any) => i.id === one.entity_source_id);
    assert.equal(item.is_product, true);
    assert.equal(item.request_target, targets[0]);
    assert.deepEqual(item.prices, one.prices);
    assert.deepEqual(item.purchase, one.purchase);
    assert.deepEqual(await extractContent(f.crawl), model);
  } finally {
    await f.cleanup();
  }
});

test("ordinary normalized commerce retains unknown facts and cannot borrow a foreign offer", async () => {
  const f = await fixture();
  try {
    const model = await extractContent(f.crawl);
    for (const target of ["/unknown", "/foreign"]) {
      const entry = model.commerce!.entries.find(
        (e) => e.request_target === target,
      )!;
      assert.deepEqual(entry.prices, []);
      assert.deepEqual(entry.variants, []);
      assert.equal(entry.purchase.price_id, null);
      assert.equal(entry.purchase.min_quantity, null);
      assert.equal(entry.product.availability.value, null);
    }
    const foreign = model.commerce!.entries.find(
      (e) => e.request_target === "/foreign",
    )!;
    assert.equal(foreign.product.sku.value, null);
    assert.equal(foreign.product.brand.value, null);
    const observed = f.crawl.entries.filter(
      (e) => e.http_status === 200 && e.mime === "text/html",
    );
    assert.equal(model.commerce!.entries.length, observed.length);
  } finally {
    await f.cleanup();
  }
});

test("changed ordinary source bytes fail before normalizing commerce", async () => {
  const f = await fixture();
  try {
    const row = f.crawl.entries.find((e) => e.request_target === targets[0])!;
    await writeFile(row.body_path!, "<main>Changed price 0</main>");
    await assert.rejects(extractContent(f.crawl), /SHA-256/);
  } finally {
    await f.cleanup();
  }
});

for (const [label, surrounding] of [
  ["header heading", "<header><h1>Unrelated site heading</h1></header>"],
  [
    "inactive main",
    '<main><script>throw new Error("NEVER_EXECUTE_SOURCE")</script></main>',
  ],
  [
    "sidebar article",
    '<aside><article><h1>Wrong promotion</h1><div id="product"><span class="price_new">1 р. / шт.</span></div></article></aside>',
  ],
] as const) {
  test(`ordinary primary landmark ignores ${label}`, async () => {
    const f = await fixture(
      (body) => surrounding + `<div id="content">${body}</div>`,
    );
    try {
      const observed = (await extractContent(f.crawl)).commerce!.entries.find(
        (entry) => entry.request_target === targets[0],
      )!;
      assert.equal(observed.product.name.value, "Observed one");
      assert.equal(observed.page_kind.value, "PRODUCT");
      assert.ok(observed.prices.some((price) => price.money?.decimal === "90"));
      assert.ok(!observed.prices.some((price) => price.money?.decimal === "1"));
    } finally {
      await f.cleanup();
    }
  });
}

test("ordinary FETCHED image metadata without retained bytes remains unverified", async () => {
  const f = await fixture();
  try {
    const image = f.crawl.assets.find(
      (asset) => asset.source_url === f.origin + "/pixel.png",
    )!;
    assert.equal(image.status, "FETCHED");
    assert.ok(image.sha256);
    delete image.body_path;
    const model = await extractContent(f.crawl);
    const observed = model.commerce!.entries.find(
      (entry) => entry.request_target === targets[0],
    )!;
    assert.ok(observed.images.length > 0);
    assert.ok(observed.images.every((asset) => asset.asset_sha256 === null));
    const entity = model.entities.find(
      (entry) => entry.source_url === f.origin + targets[0],
    )!;
    assert.ok(
      entity.blocks
        .filter((block) => block.type === "image")
        .every((block) => block.asset_sha256 === undefined),
    );
  } finally {
    await f.cleanup();
  }
});

test("ordinary rendered entry normalizes the pinned DOM bytes rather than stale HTTP price metadata", async () => {
  const f = await fixture();
  try {
    const row = f.crawl.entries.find((e) => e.request_target === targets[0])!;
    const httpBytes = await readFile(row.body_path!, "utf8");
    const dom = httpBytes
      .replaceAll('"price":"90"', '"price":"95"')
      .replace(">90 р. / шт.</span>", ">95 р. / шт.</span>");
    assert.notEqual(dom, httpBytes);
    row.dom_sha256 = sha(dom);
    row.dom_path = join(
      f.crawl.output_dir,
      "snapshots",
      row.dom_sha256 + ".dom.html",
    );
    row.status = "RENDERED";
    await writeFile(row.dom_path, dom, { flag: "wx" });
    const model = await extractContent(f.crawl),
      observed = model.commerce!.entries.find(
        (e) => e.request_target === targets[0],
      )!;
    assert.ok(
      observed.prices.some(
        (p) => p.role === "CURRENT" && p.money?.decimal === "95",
      ),
    );
    assert.ok(!observed.prices.some((p) => p.money?.decimal === "90"));
    assert.ok(
      observed.prices.every(
        (p) => p.evidence.snapshot_sha256 === row.dom_sha256,
      ),
    );
    assert.equal(sha(await readFile(row.body_path!)), row.body_sha256);
  } finally {
    await f.cleanup();
  }
});
