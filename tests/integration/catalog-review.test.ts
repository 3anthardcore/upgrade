import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { load } from "cheerio";
import { buildBitrixPackage, stableEntityKey, sha256 } from "../../packages/bitrix-adapter/index.ts";

const php = process.env.UPGRADE_PHP_BIN;
const phpFlags = () => ["-n", ...(process.env.UPGRADE_PHP_EXT_DIR ? ["-d", `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR}`, "-d", "extension=mbstring", "-d", "extension=fileinfo"] : [])];
const literal = (value: string) => "'" + value.replace(/\\/g, "/").replace(/'/g, "\\'") + "'";
const project = "catalog-review";
const target = "/Catalog/a%2Fb.php?x=&x=1&x=2&name=%D0%A2%20%D0%9C";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64");
const imageHash = sha256(png);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const pdfHash = sha256(pdf);
type Block = Record<string, unknown>;

async function fixture(t: TestContext, blocks: Block[]) {
  const root = await mkdtemp(join(tmpdir(), "upgrade-catalog-review-"));
  t.after(async () => { assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^upgrade-catalog-review-/); await rm(root, { recursive: true, force: true }); });
  const packageDir = join(root, "package");
  await mkdir(join(packageDir, "data"), { recursive: true });
  await mkdir(join(packageDir, "assets"));
  const entity = { source_id: "catalog-page", type: "page", title: "Проверка каталога", stable_key: stableEntityKey(project, "page", "catalog-page"), blocks, facts: {} };
  const assets = [
    { source_url: "https://source.example/a.png", sha256: imageHash, mime: "image/png", path: `assets/${imageHash}.png`, public_path: `/upload/upgrade/${project}/${imageHash}.png` },
    { source_url: "https://source.example/a.pdf", sha256: pdfHash, mime: "application/pdf", path: `assets/${pdfHash}.pdf`, public_path: `/upload/upgrade/${project}/${pdfHash}.pdf` },
  ];
  const routes = [{ request_target: target, route_key: sha256(target), expected_status: 200, entity_key: entity.stable_key }];
  const files: Record<string, string> = {};
  for (const [path, body] of Object.entries({ "data/entities.json": JSON.stringify([entity]), "data/routes.json": JSON.stringify(routes), "data/assets.json": JSON.stringify(assets) })) { await writeFile(join(packageDir, path), body); files[path] = sha256(body); }
  await writeFile(join(packageDir, assets[0]!.path), png); files[assets[0]!.path] = imageHash;
  await writeFile(join(packageDir, assets[1]!.path), pdf); files[assets[1]!.path] = pdfHash;
  const manifest = { schema_version: "1.0", project_id: project, mode: "public-demo", target_profile: "editable-content-snapshot", files, blockers: [], entity_count: 1, route_count: 1 };
  const manifestPath = join(packageDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  async function pin() { return sha256(await readFile(manifestPath)); }
  return {
    root, packageDir, assets, entity,
    async rewrite(relative: string, data: unknown) { const raw = JSON.stringify(data); await writeFile(join(packageDir, relative), raw); files[relative] = sha256(raw); await writeFile(manifestPath, JSON.stringify(manifest)); },
    async validate() {
      assert.ok(php);
      const script = `require ${literal(resolve("bitrix/importer/package.php"))}; try { $p=\\Upgrade\\Importer\\Package::read($argv[1],$argv[2],$argv[3]); echo json_encode(['status'=>'VALID','target'=>$p['entities'][0]['blocks'][0]['request_target']??null],JSON_THROW_ON_ERROR); } catch (Throwable $e) { fwrite(STDERR,$e->getMessage());exit(1); }`;
      return spawnSync(php, [...phpFlags(), "-r", script, packageDir, project, await pin()], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000 });
    },
    async render(blocksOverride?: Block[]) {
      assert.ok(php);
      const input = join(root, "render-input.json");
      await writeFile(input, JSON.stringify({ entity: { ...entity, blocks: blocksOverride ?? blocks }, assets }));
      const script = `require ${literal(resolve("bitrix/module/upgrade.core/lib/gateway.php"))}; try {$input=json_decode(file_get_contents($argv[1]),true,512,JSON_THROW_ON_ERROR);$r=new ReflectionClass('Upgrade\\Core\\Gateway');$g=$r->newInstanceWithoutConstructor();$assets=[];foreach($input['assets'] as $a)$assets[$a['sha256']]=$a;$r->getProperty('assetIndex')->setValue($g,$assets);echo json_encode($r->getMethod('fields')->invoke($g,$input['entity']),JSON_THROW_ON_ERROR);}catch(Throwable $e){fwrite(STDERR,$e->getMessage());exit(1);}`;
      return spawnSync(php, [...phpFlags(), "-r", script, input], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000 });
    },
  };
}

test("catalog review: real PHP validates and renders exact repeated query, escaped facts and contiguous card groups", { skip: !php }, async t => {
  const text = '<script>bad()</script> "Название" & факт';
  const blocks: Block[] = [
    { type: "card", text, request_target: target, asset_sha256: imageHash, alt: 'Фото " onerror="bad()', items: ["3350 р.", "2178 р.", "<svg onload=bad()>В наличии</svg>"] },
    { type: "card", text: "Без фото", request_target: "/unobserved?x=&x=1", items: ["Текст источника"] },
    { type: "link", text: "Список & каталог", request_target: target },
    { type: "card", text: "Вторая группа", request_target: target, items: [] },
  ];
  const f = await fixture(t, blocks), valid = await f.validate();
  assert.equal(valid.status, 0, valid.stderr); assert.equal(JSON.parse(valid.stdout).target, target);
  const result = await f.render(); assert.equal(result.status, 0, result.stderr);
  const fields = JSON.parse(result.stdout), $ = load(fields.DETAIL_TEXT);
  assert.equal($(".catalog-grid").length, 2);
  assert.equal($(".catalog-grid").eq(0).children("article").length, 2);
  assert.equal($(".catalog-grid").eq(1).children("article").length, 1);
  assert.equal($(".content-link").parents(".catalog-grid").length, 0);
  assert.equal($(".catalog-card h3").first().text(), text);
  assert.deepEqual($(".catalog-card").first().find(".card-facts p").map((_, el) => $(el).text()).get(), blocks[0]!.items);
  assert.equal($("script,svg,form,button,[onclick],[onerror],[onload]").length, 0);
  assert.equal($("img").first().attr("alt"), 'Фото " onerror="bad()');
  assert.equal($("img").first().attr("src"), `/upload/upgrade/${project}/${imageHash}.png`);
  assert.equal($(".content-link").attr("href"), target);
  assert.equal($(".catalog-card").first().find("a").length, 3);
  $(".catalog-card").first().find("a").each((_, el) => assert.equal($(el).attr("href"), target));
  assert.equal($(".no-image").first().text(), "Нет изображения в снимке");
  assert.equal($("del,s,[itemprop=price]").length, 0);
});

for (const bad of ["javascript:alert(1)", "https://evil.example/", "//evil.example/", "/a#fragment", "/a\\b", "/%2e%2e/x", "/%62itrix/admin/", "/upload/a.png", "/robots.txt", "/bad%2", "/line\nend"]) test(`catalog review: PHP package and renderer reject unsafe link ${JSON.stringify(bad)}`, { skip: !php }, async t => {
  const f = await fixture(t, [{ type: "card", text: "untrusted", request_target: bad }]);
  const valid = await f.validate(); assert.equal(valid.status, 1, valid.stdout); assert.match(valid.stderr, /REQUEST_TARGET|UNSAFE_ROUTE|RESERVED_ROUTE|PERCENT_ENCODING/);
  const rendered = await f.render(); assert.equal(rendered.status, 1); assert.match(rendered.stderr, /UNSAFE_CONTENT_LINK/);
});

for (const asset of ["0".repeat(64), pdfHash]) test(`catalog review: card cannot render a missing or PDF asset (${asset.slice(0, 6)})`, { skip: !php }, async t => {
  const f = await fixture(t, [{ type: "card", text: "Фото", request_target: target, asset_sha256: asset }]);
  const valid = await f.validate(); assert.equal(valid.status, 1); assert.match(valid.stderr, /CONTENT_LINK_IMAGE_MISSING/);
  const rendered = await f.render(); assert.equal(rendered.status, 1); assert.match(rendered.stderr, /CONTENT_LINK_IMAGE_MISSING/);
});

test("catalog review: accepted hashes cannot disguise PDF bytes as a card raster", { skip: !php }, async t => {
  const f = await fixture(t, [{ type: "card", text: "Фото", request_target: target, asset_sha256: imageHash }]);
  const disguised = { ...f.assets[1]!, mime: "image/png", path: `assets/${pdfHash}.png`, public_path: `/upload/upgrade/${project}/${pdfHash}.png` };
  await writeFile(join(f.packageDir, disguised.path), pdf);
  // Reseal all modified metadata: exercise MIME validation, not just a stale hash.
  const manifestPath = join(f.packageDir, "manifest.json"), manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files[disguised.path] = pdfHash; await writeFile(manifestPath, JSON.stringify(manifest));
  await f.rewrite("data/assets.json", [f.assets[0], disguised]);
  // rewrite uses the fixture's original map, so add the new allowed asset once more.
  const resealed = JSON.parse(await readFile(manifestPath, "utf8")); resealed.files[disguised.path] = pdfHash; await writeFile(manifestPath, JSON.stringify(resealed));
  const result = await f.validate(); assert.equal(result.status, 1); assert.match(result.stderr, /ASSET_CONTENT_MIME_MISMATCH/);
});

test("catalog review: PHP rejects non-string card fact items before rendering", { skip: !php }, async t => {
  const f = await fixture(t, [{ type: "card", text: "Товар", request_target: target, items: [{ price: 123 }, 42] }]);
  const result = await f.validate(); assert.equal(result.status, 1); assert.match(result.stderr, /CONTENT_CARD_ITEMS_INVALID/);
});

test("catalog review: image-only card link retains an accessible name when captured image alt is empty", { skip: !php }, async t => {
  const f = await fixture(t, [{ type: "card", text: 'Название " товара & факт', request_target: target, asset_sha256: imageHash, alt: "", items: [] }]);
  const result = await f.render(); assert.equal(result.status, 0, result.stderr);
  const $ = load(JSON.parse(result.stdout).DETAIL_TEXT);
  $(".catalog-card a").each((_, el) => {
    const name = ($(el).attr("aria-label") || $(el).text() || $(el).find("img").attr("alt") || "").trim();
    assert.ok(name, "Every independent focusable card link must have an accessible name");
  });
});

test("catalog review: TS builder retains factual cards/exact links and blocks unsafe links, missing images and invalid items", async t => {
  const f = await fixture(t, []);
  const source = join(f.root, "source"); await mkdir(source); await writeFile(join(source, "photo.png"), png);
  for (const variant of ["valid", "unsafe", "missing", "invalid-items"]) {
    const result = await buildBitrixPackage({
      projectId: project, sourceVersion: "source-one", outputDir: join(f.root, variant), sourceOrigin: "https://source.example", assetRoot: source,
      assets: [{ source_url: "https://source.example/a.png", status: "FETCHED", mime: "image/png", sha256: imageHash, body_path: join(source, "photo.png") }],
      entities: [{ source_id: "page", type: "Page", title: "Source", blocks: [{ type: "card", text: "Наблюдаемый товар", request_target: variant === "unsafe" ? "//evil.example/" : target, asset_sha256: variant === "missing" ? "0".repeat(64) : imageHash, items: variant === "invalid-items" ? [{ price: 123 }, 42] : ["3350 р.", "2178 р.", "В наличии"] }] }],
      routes: [{ request_target: "/", entity_source_id: "page" }],
    });
    if (variant === "valid") { assert.deepEqual(result.manifest.blockers, []); const entities = JSON.parse(await readFile(join(result.packageDir, "data/entities.json"), "utf8")); assert.equal(entities[0].blocks[0].request_target, target); assert.deepEqual(entities[0].blocks[0].items, ["3350 р.", "2178 р.", "В наличии"]); assert.equal(entities[0].price, undefined); }
    else assert.match(result.manifest.blockers.join(" "), variant === "unsafe" ? /UNSAFE_CONTENT_LINK/ : variant === "missing" ? /BLOCK_LINK_IMAGE_MISSING/ : /CONTENT_CARD_ITEMS_INVALID/);
    assert.equal(result.manifest.runtime_verification, "NOT_RUN");
  }
});
