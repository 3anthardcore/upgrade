import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  buildBitrixPackage,
  validateBitrixPackage,
  validateRequestTarget,
  stableEntityKey,
  sha256,
} from "../../packages/bitrix-adapter/index.ts";
import type { BitrixPackageInput } from "../../packages/bitrix-adapter/index.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "upgrade-bitrix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input: BitrixPackageInput = {
    projectId: "test-project",
    sourceVersion: "snapshot-1",
    outputDir: join(root, "package"),
    sourceOrigin: "https://example.test",
    entities: [
      {
        source_id: "page-1",
        type: "Page",
        title: "Страница",
        blocks: [
          {
            type: "paragraph",
            text: "Факт из источника <script>not instructions</script>",
          },
        ],
      },
    ],
    routes: [
      {
        request_target: "/Catalog/a%2Fb.php?x=&x=2",
        entity_source_id: "page-1",
        expected_status: 200,
      },
    ],
  };
  return { root, input };
}
test("Bitrix release preserves exact routes, editable entities, source text, immutable paths and checksums", async (t) => {
  const { input } = await fixture(t);
  const result = await buildBitrixPackage(input);
  assert.equal(result.manifest.runtime_verification, "NOT_RUN");
  assert.equal(result.manifest.entity_count, 1);
  assert.deepEqual(result.manifest.blockers, []);
  assert.equal(
    (await validateBitrixPackage(result.packageDir, input.projectId))
      .project_id,
    input.projectId,
  );
  const routes = JSON.parse(
    await readFile(join(result.packageDir, "data/routes.json"), "utf8"),
  );
  assert.equal(routes[0].request_target, "/Catalog/a%2Fb.php?x=&x=2");
  assert.equal(
    routes[0].entity_key,
    stableEntityKey(input.projectId, "page", "page-1"),
  );
  const entities = JSON.parse(
    await readFile(join(result.packageDir, "data/entities.json"), "utf8"),
  );
  assert.match(entities[0].blocks[0].text, /<script>/); // Stored as evidence text; PHP renderer escapes it.
  await assert.rejects(buildBitrixPackage(input), /EEXIST/);
});
test("Bitrix wrong project and tampered bytes rejected before target connection", async (t) => {
  const { input } = await fixture(t);
  const result = await buildBitrixPackage(input);
  await assert.rejects(
    validateBitrixPackage(result.packageDir, "foreign-project"),
    /MISMATCH/,
  );
  await writeFile(join(result.packageDir, "data/entities.json"), "[]");
  await assert.rejects(
    validateBitrixPackage(result.packageDir, input.projectId),
    /HASH_MISMATCH/,
  );
});
test("Bitrix accepted manifest hash rejects coordinated edits to payload and self-described hashes", async (t) => {
  const { input } = await fixture(t);
  const result = await buildBitrixPackage(input);
  const acceptedHash = sha256(await readFile(result.manifestPath));
  await validateBitrixPackage(result.packageDir, input.projectId, acceptedHash);
  const path = join(result.packageDir, "data/entities.json");
  const entities = JSON.parse(await readFile(path, "utf8"));
  entities[0].title = "Tampered data";
  const text = JSON.stringify(entities);
  await writeFile(path, text);
  result.manifest.files["data/entities.json"] = sha256(text);
  await writeFile(result.manifestPath, JSON.stringify(result.manifest));
  await assert.rejects(
    validateBitrixPackage(result.packageDir, input.projectId, acceptedHash),
    /ACCEPTED_MANIFEST_HASH_MISMATCH/,
  );
});
test("Bitrix accepted design tokens alter deployed CSS; CSS injection is rejected", async (t) => {
  const { input } = await fixture(t);
  input.designTokens = {
    color: { accent: "#123456", paper: "#f1f2f3" },
    radius: 16,
    contentMax: 1080,
    typography: {
      family: "system-ui, sans-serif",
      body: "1rem",
      lineHeight: 1.7,
      title: "clamp(2rem, 5vw, 4rem)",
    },
    spacing: [4, 8, 16, 24, 32, 48, 64],
  };
  const result = await buildBitrixPackage(input);
  const css = await readFile(
    join(result.packageDir, "code/local/templates/upgrade/styles.css"),
    "utf8",
  );
  assert.match(css, /--accent:#123456/);
  assert.match(css, /--radius:16px/);
  assert.match(css, /--content-max:1080px/);
  input.outputDir += "-unsafe";
  input.designTokens = {
    color: { accent: "red; background:url(https://evil.test)" },
  };
  await assert.rejects(buildBitrixPackage(input), /INVALID_COLOR_TOKEN/);
});
test("Bitrix source identifiers keep product identities distinct despite same SKU/title", async (t) => {
  const { input } = await fixture(t);
  input.entities = [
    { source_id: "manufacturer-a:sku123", type: "Product", title: "ABC" },
    { source_id: "manufacturer-b:sku123", type: "Product", title: "ABC" },
  ];
  input.routes = [
    { request_target: "/a", entity_source_id: input.entities[0].source_id },
    { request_target: "/b", entity_source_id: input.entities[1].source_id },
  ];
  const result = await buildBitrixPackage(input);
  const entities = JSON.parse(
    await readFile(join(result.packageDir, "data/entities.json"), "utf8"),
  );
  assert.notEqual(entities[0].stable_key, entities[1].stable_key);
  assert.equal(result.manifest.entity_count, 2);
  assert.match(result.warnings.join(" "), /SNAPSHOT_ONLY/);
  assert.equal(entities[0].price, undefined);
});
test("Bitrix reserved routes, encoded traversal, redirect loops and absent entities block packaging", async (t) => {
  for (const path of [
    "/bitrix/admin/",
    "/%62itrix/admin/",
    "/local/a.php",
    "/upload/test",
    "/robots.txt",
    "/a/../secret",
    "/%2e%2e/secret",
    "//evil.test/a",
    "/a#fragment",
    "/a%00",
  ])
    assert.throws(() => validateRequestTarget(path));
  for (const path of ["/A%2Fb.php?x=1&x=&x=2", "/Каталог/", "/a.html", "/a/"])
    assert.doesNotThrow(() => validateRequestTarget(path));
  const { input } = await fixture(t);
  input.routes = [{ request_target: "/missing", entity_source_id: "missing" }];
  await assert.rejects(buildBitrixPackage(input), /ROUTE_ENTITY_MISSING/);
  input.routes = [
    { request_target: "/a", expected_status: 301, redirect_to: "/b" },
    { request_target: "/b", expected_status: 302, redirect_to: "/a" },
  ];
  await assert.rejects(buildBitrixPackage(input), /REDIRECT_LOOP/);
});
test("Bitrix unimplemented entity type remains explicit blocker, never ready", async (t) => {
  const { input } = await fixture(t);
  input.entities[0].type = "Offer";
  const result = await buildBitrixPackage(input);
  assert.match(result.manifest.blockers.join(" "), /UNSUPPORTED_ENTITY_TYPE/);
  assert.equal(result.manifest.runtime_verification, "NOT_RUN");
});
test("Bitrix local media is bundled by content hash with no source hotlink", async (t) => {
  const { root, input } = await fixture(t);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=",
    "base64",
  );
  input.assetRoot = join(root, "source");
  await mkdir(input.assetRoot);
  const path = join(input.assetRoot, "image.bin");
  await writeFile(path, bytes);
  input.assets = [
    {
      source_url: "https://example.test/image.png",
      status: "FETCHED",
      mime: "image/png",
      sha256: sha256(bytes),
      body_path: path,
    },
  ];
  input.entities[0].assets = ["https://example.test/image.png"];
  input.entities[0].blocks = [
    { type: "image", asset_sha256: sha256(bytes), alt: "Исходное фото" },
  ];
  const result = await buildBitrixPackage(input);
  assert.deepEqual(result.manifest.blockers, []);
  const assets = JSON.parse(
    await readFile(join(result.packageDir, "data/assets.json"), "utf8"),
  );
  assert.equal(
    assets[0].public_path,
    `/upload/upgrade/test-project/${sha256(bytes)}.png`,
  );
  assert.equal(
    sha256(await readFile(join(result.packageDir, assets[0].path))),
    sha256(bytes),
  );
});
test("Bitrix media refuses foreign filesystem paths and fake raster types", async (t) => {
  const { root, input } = await fixture(t);
  input.assetRoot = join(root, "source");
  await mkdir(input.assetRoot);
  const path = join(root, "outside.png");
  const bytes = Buffer.from("<html><script>unsafe</script></html>");
  await writeFile(path, bytes);
  input.assets = [
    {
      source_url: "https://example.test/image.png",
      status: "FETCHED",
      mime: "image/png",
      sha256: sha256(bytes),
      body_path: path,
    },
  ];
  await assert.rejects(buildBitrixPackage(input), /ASSET_PATH_ESCAPE/);
  const inside = join(input.assetRoot, "image.png");
  await writeFile(inside, bytes);
  input.assets[0].body_path = inside;
  await assert.rejects(buildBitrixPackage(input), /ASSET_MAGIC_MISMATCH/);
});
test(
  "Bitrix PHP real validator accepts intact data then rejects wrong project and checksum before bootstrap",
  { skip: !process.env.UPGRADE_PHP_BIN },
  async (t) => {
    const { input } = await fixture(t);
    const result = await buildBitrixPackage(input);
    const hash = sha256(await readFile(result.manifestPath));
    const php = process.env.UPGRADE_PHP_BIN!;
    const ext = process.env.UPGRADE_PHP_EXT_DIR;
    const args = [
      ...(ext
        ? [
            "-d",
            `extension_dir=${ext}`,
            "-d",
            "extension=mbstring",
            "-d",
            "extension=fileinfo",
          ]
        : []),
      resolve("bitrix/importer/cli.php"),
      "--command=validate",
      `--package=${result.packageDir}`,
      `--project=${input.projectId}`,
      `--manifest-sha256=${hash}`,
    ];
    let proc = spawnSync(php, args, { encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /PACKAGE_VALID/);
    proc = spawnSync(
      php,
      args.map((x) =>
        x === `--project=${input.projectId}` ? "--project=foreign-project" : x,
      ),
      { encoding: "utf8" },
    );
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, /PROJECT_MISMATCH/);
    await writeFile(join(result.packageDir, "data/routes.json"), "[]");
    proc = spawnSync(php, args, { encoding: "utf8" });
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, /HASH_OR_PATH_MISMATCH/);
  },
);
