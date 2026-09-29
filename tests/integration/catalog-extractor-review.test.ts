import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { validateOperatorCapture } from "../../packages/crawler/operator.ts";
import { extractOperatorContent } from "../../packages/extractor/operator.ts";

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const origin = "https://review.example";
async function extract(html: string, source = origin + "/catalog") {
  const directory = await mkdtemp(join(tmpdir(), "upgrade-catalog-review-"));
  try {
    const manifest = {
      schema_version: 1,
      kind: "operator-capture",
      capture_id: "review-capture",
      project_id: "catalog-review",
      source_origin: new URL(source).origin,
      captured_at: "2026-09-29T07:00:00.000Z",
      inventory: {
        basis: "operator-observed-urls",
        urls: [source, new URL(source).origin + "/unobserved"],
      },
      observations: [
        {
          source_url: source,
          document_url: source,
          observed_at: "2026-09-29T07:00:00.000Z",
          format: "dom-html",
          file: {
            relative_path: "page.html",
            sha256: sha(html),
            size_bytes: Buffer.byteLength(html),
          },
        },
      ],
      assets: [],
    };
    const bytes = JSON.stringify(manifest);
    await writeFile(join(directory, "page.html"), html);
    await writeFile(join(directory, "operator-capture.json"), bytes);
    const capture = await validateOperatorCapture({
      directory,
      expectedManifestSha256: sha(bytes),
      expectedProjectId: "catalog-review",
      expectedSourceUrl: source,
      serverAccessBlockId: "review-block-retained",
    });
    return await extractOperatorContent(capture, {
      readFile: (relative) => readFile(join(directory, relative)),
    });
  } finally {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^upgrade-catalog-review-[A-Za-z0-9_-]+$/);
    await rm(target, { recursive: true, force: true });
  }
}
const page = (body: string, head = "") =>
  `<!doctype html><html><head><title>Observed catalog</title>${head}</head><body>${body}</body></html>`;
const card = (target: string, name: string, price: string) =>
  `<article><a href="${target}"><img src="/missing.png" alt="${name}"></a><h2><a href="${target}">${name}</a></h2><p>${price}</p><p>В наличии</p></article>`;

test("review: inactive-only landmark cannot discard a later real content landmark", async () => {
  for (const inactive of [
    "<script>bootstrap()</script>",
    "<p hidden>Placeholder</p>",
    '<div style="display:none">Placeholder</div>',
  ]) {
    const model = await extract(
      page(
        `<main>${inactive}</main><div id="content"><h1>Real catalog</h1><p>Real factual description</p></div>`,
      ),
    );
    assert.equal(
      model.entities[0].facts["dom:primary_content"].value,
      "#content",
    );
    assert.match(
      JSON.stringify(model.entities[0].blocks),
      /Real factual description/,
    );
  }
});

test("review: prior plain link cannot suppress a later card's factual price and availability", async () => {
  const model = await extract(
    page(
      `<main><p><a href="/one">One</a></p><section>${card("/one", "One", "2 178 р.")}${card("/two", "Two", "3 350 р.")}</section></main>`,
    ),
  );
  const cards = model.entities[0].blocks.filter(
    (block) => block.type === "card",
  );
  assert.equal(cards.length, 2);
  assert.match(JSON.stringify(cards), /2 178 р\./);
  assert.deepEqual(model.prices, []);
  assert.deepEqual(model.offers, []);
});

test("review: repeated card label and target cannot discard different observed factual items", async () => {
  const model = await extract(
    page(
      `<main><section>${card("/one", "One", "2 178 р.")}${card("/one", "One", "3 350 р.")}</section></main>`,
    ),
  );
  const cards = model.entities[0].blocks.filter(
    (block) => block.type === "card",
  );
  assert.equal(cards.length, 2);
  assert.match(JSON.stringify(cards), /2 178 р\./);
  assert.match(JSON.stringify(cards), /3 350 р\./);
});

test("review: encoded actions, base and external references do not become target actions", async () => {
  const blocked = [
    "/c%61rt/add",
    "/%62itrix/admin",
    "/index.php?%61ction=add",
    "/index.php?route=checkout%2Fcart",
    "//foreign.example/item",
    "javascript:alert(1)",
    "/item?csrf_token=x",
  ];
  const model = await extract(
    page(
      `<main><h1>Catalog</h1>${blocked.map((href) => `<a href="${href}">Blocked</a>`).join("")}<a href="item?x=1&amp;x=2&amp;empty=">Exact</a></main>`,
      '<base href="/section/">',
    ),
  );
  const links = model.entities[0].blocks.filter(
    (block) => block.type === "link",
  );
  assert.deepEqual(
    links.map((link) => link.request_target),
    ["/section/item?x=1&x=2&empty="],
  );
  const foreign = await extract(
    page(
      '<main><a href="relative">Foreign relative</a><a href="https://review.example/catalog/item">Explicit local</a></main>',
      '<base href="https://foreign.example/">',
    ),
  );
  assert.deepEqual(
    foreign.entities[0].blocks
      .filter((block) => block.type === "link")
      .map((link) => link.request_target),
    ["/catalog/item"],
  );
});

test("review: ambiguous site metadata and unmatched header image cannot manufacture a brand", async () => {
  const model = await extract(
    page(
      '<header><a href="/"><img src="/advert.png" alt="Unrelated advertiser"></a></header><main><h1>Actual heading</h1></main>',
      '<meta property="og:site_name" content="One"><meta property="og:site_name" content="Two"><meta property="og:image" content="/real-logo.png">',
    ),
    origin + "/",
  );
  assert.equal(model.entities[0].facts["dom:site_name"], undefined);
  assert.equal(model.entities[0].facts["dom:home_logo_alt"], undefined);
  assert.equal(model.entities[0].facts.name.value, "Actual heading");
});

test("review: homepage navigation retains exact observed safe labels and rejects controls or hidden actions", async () => {
  const markup = page(`<header><nav>
    <a href="/catalog?x=1&amp;x=2&amp;empty=">  &lt;Catalog&gt;  </a>
    <a href="/catalog?x=1&amp;x=2&amp;empty=">  &lt;Catalog&gt;  </a>
    <a href="/c%61rt/add">Cart</a><a href="/item?%61ction=buy">Action</a>
    <a href="//foreign.example/">External</a><a href="javascript:alert(1)">Script</a>
    <a href="/catalog" onclick="submit()">Handler</a>
    <a href="/catalog" role="button">Button</a>
    <a href="/catalog" data-action="buy">Action marker</a>
    <span hidden><a href="/hidden">Hidden ancestor</a></span>
    <a style="display:none" href="/hidden-style">Hidden style</a>
    <a href="/safe"><span hidden>Secret label</span>Visible<script>notLabel()</script></a>
    </nav></header><main><h1>Catalog</h1></main>`);
  const home = await extract(markup, origin + "/");
  const navigation = home.entities[0].facts["dom:primary_navigation"];
  assert.deepEqual(navigation.value, [
    { label: "  <Catalog>  ", request_target: "/catalog?x=1&x=2&empty=" },
    { label: "Visible", request_target: "/safe" },
  ]);
  assert.equal(
    home.source_capture.server_access_block_id,
    "review-block-retained",
  );
  const inner = await extract(markup, origin + "/catalog");
  assert.equal(inner.entities[0].facts["dom:primary_navigation"], undefined);
  const queriedHome = await extract(markup, origin + "/?view=all");
  assert.equal(
    queriedHome.entities[0].facts["dom:primary_navigation"],
    undefined,
  );
});

test("review: homepage navigation honors foreign base without importing relative external actions", async () => {
  const model = await extract(
    page(
      '<header><nav><a href="relative">Relative foreign</a><a href="https://review.example/catalog?x=1&amp;x=2">Exact local</a></nav></header><main><p>Observed content</p></main>',
      '<base href="https://foreign.example/">',
    ),
    origin + "/",
  );
  assert.deepEqual(model.entities[0].facts["dom:primary_navigation"].value, [
    { label: "Exact local", request_target: "/catalog?x=1&x=2" },
  ]);
});

test("review: repeated structure preserves factual text, missing media and stable Page identity", async () => {
  const html = page(
    `<header><h1>Chrome</h1></header><div id="content"><h1>Catalog</h1><section>${card("/one", "One", "3350 р. 2178 р.")}${card("/two", "Two", "Цена по запросу")}</section></div>`,
  );
  const model = await extract(html);
  const entity = model.entities[0];
  assert.equal(entity.type, "Page");
  assert.equal(entity.source_id, (await extract(html)).entities[0].source_id);
  assert.equal(entity.facts.price.status, "UNKNOWN");
  assert.equal(entity.facts.availability.status, "UNKNOWN");
  assert.equal(
    entity.blocks.filter((block) => block.type === "card").length,
    2,
  );
  assert.equal(
    entity.blocks.some((block) => block.asset_sha256),
    false,
  );
  assert.match(JSON.stringify(entity.blocks), /3350 р\. 2178 р\./);
  assert.doesNotMatch(JSON.stringify(entity.blocks), /Chrome/);
  assert.equal(
    model.source_capture.server_access_block_id,
    "review-block-retained",
  );
  assert.equal(model.source_capture.full_source_denominator, "UNKNOWN");
  assert.ok(
    model.source_inventory.some((entry) =>
      entry.crawl_key.endsWith("/unobserved"),
    ),
  );
});

const savedDirectory = resolve("var/pilots/teplypol-catalog-20260929");
test("review: absent and blank image sources retain evidence without inventing a homepage asset", async () => {
  const html = page(
    '<main><h1>Observed product</h1><img alt="Absent"><img src="" alt="Empty"><img src="   " alt="Whitespace"><a href="">Empty navigation</a></main>',
    '<base href="https://review.example/">',
  );
  const model = await extract(html);
  const entity = model.entities[0];
  assert.deepEqual(model.assets, []);
  assert.deepEqual(model.source_capture.missing_asset_urls, []);
  assert.equal(
    entity.blocks.some(
      (block) => block.type === "image" || block.type === "link",
    ),
    false,
  );
  const fact = entity.facts["dom:missing_image_sources"];
  assert.equal(fact.status, "OBSERVED");
  assert.equal(fact.evidence.snapshot_sha256, sha(html));
  assert.equal(fact.evidence.trust, "untrusted-source-data");
  assert.deepEqual(
    (fact.value as any[]).map(({ raw_src, alt }) => ({ raw_src, alt })),
    [
      { raw_src: null, alt: "Absent" },
      { raw_src: "", alt: "Empty" },
      { raw_src: "   ", alt: "Whitespace" },
    ],
  );
  assert.ok(
    (fact.value as any[]).every((item) => item.locator.endsWith("@src")),
  );
  assert.ok(
    model.limitations.some((limitation) =>
      limitation.includes("no replacement inferred"),
    ),
  );
});

const catalogCapture = resolve("var/pilots/teplypol-catalog-package-20260929");
test(
  "review: pinned real adapter DOM does not turn empty image src into a homepage asset",
  { skip: !existsSync(join(catalogCapture, "operator-capture.json")) },
  async () => {
    const manifest = JSON.parse(
      await readFile(join(catalogCapture, "operator-capture.json"), "utf8"),
    );
    const source = "https://teplypol-market.ru/aksessuary/adapter-welrok-bk";
    const observation = manifest.observations.find(
      (item: any) => item.source_url === source,
    );
    assert.ok(observation, "the declared real adapter observation must exist");
    const input = resolve(catalogCapture, observation.file.relative_path);
    assert.ok(
      input.startsWith(catalogCapture + "/") ||
        input.startsWith(catalogCapture + "\\"),
    );
    const html = await readFile(input, "utf8");
    assert.equal(
      sha(html),
      "57d9feace5b4234e0b819027667dd3d990541e0d795f7fb59a72773c5f90605a",
    );
    const model = await extract(html, source);
    assert.equal(
      model.assets.some(
        (asset) => asset.source_url === "https://teplypol-market.ru/",
      ),
      false,
    );
    const fact = model.entities[0].facts["dom:missing_image_sources"];
    assert.ok(Array.isArray(fact.value) && fact.value.length > 0);
    assert.equal(fact.evidence.snapshot_sha256, sha(html));
    assert.equal(model.entities[0].type, "Page");
    assert.deepEqual(model.prices, []);
    assert.deepEqual(model.offers, []);
  },
);

test(
  "review: saved real catalog, homepage and HW-500 DOM retain Page identity and source content",
  { skip: !existsSync(savedDirectory) },
  async (context) => {
    const latest = new Map<string, { raw: any; name: string }>();
    for (const name of await readdir(savedDirectory)) {
      if (!name.endsWith(".raw.json")) continue;
      const raw = JSON.parse(
        await readFile(join(savedDirectory, name), "utf8"),
      );
      if (
        !["/", "/katalog", "/termoregulyatory/grand-meyer-hw-500"].includes(
          new URL(raw.source_url).pathname,
        )
      )
        continue;
      const prior = latest.get(raw.source_url);
      if (!prior || raw.observed_at > prior.raw.observed_at)
        latest.set(raw.source_url, { raw, name });
    }
    assert.equal(
      latest.size,
      3,
      "all three saved source pages are required for this local diagnostic",
    );
    for (const { raw, name } of latest.values()) {
      assert.equal(
        raw.html,
        await readFile(
          join(savedDirectory, name.replace(/\.raw\.json$/, ".html")),
          "utf8",
        ),
      );
      const model = await extract(raw.html, raw.source_url);
      const entity = model.entities[0];
      assert.equal(entity.type, "Page");
      assert.equal(entity.facts["dom:primary_content"].value, "#content");
      assert.deepEqual(model.prices, []);
      assert.deepEqual(model.offers, []);
      assert.equal(entity.facts.price.status, "UNKNOWN");
      const cards = entity.blocks.filter((block) => block.type === "card");
      if (
        new URL(raw.source_url).pathname ===
        "/termoregulyatory/grand-meyer-hw-500"
      ) {
        assert.match(entity.title, /HW[ -]?500/i);
        assert.equal(cards.length, 0);
      } else assert.ok(cards.length >= 2);
      context.diagnostic(
        JSON.stringify({
          source_url: raw.source_url,
          observed_at: raw.observed_at,
          html_sha256: sha(raw.html),
          type: entity.type,
          blocks: entity.blocks.length,
          cards: cards.length,
          missing_assets: model.source_capture.missing_asset_urls.length,
        }),
      );
    }
  },
);
