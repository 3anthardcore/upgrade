import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  buildBitrixPackage,
  validateBitrixPackage,
  sha256,
} from "../../packages/bitrix-adapter/index.ts";

async function release(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "upgrade-independent-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await buildBitrixPackage({
    projectId: "review-fixture",
    sourceVersion: "review-1",
    outputDir: join(root, "release"),
    sourceOrigin: "https://source.example",
    entities: [
      {
        source_id: "page-a",
        type: "Page",
        title: "Проверка",
        blocks: [
          { type: "paragraph", text: "<script>sendSecrets()</script>" },
          {
            type: "heading",
            text: "<img src=x onerror=sendSecrets()>",
            level: 2,
          },
        ],
      },
    ],
    routes: [
      {
        request_target: "/Exact/a%2Fb.php?x=&x=1&x=2",
        entity_source_id: "page-a",
      },
    ],
  });
  return { root, ...result, hash: sha256(await readFile(result.manifestPath)) };
}
const php = process.env.UPGRADE_PHP_BIN;
const phpFlags = () => [
  "-n",
  ...(process.env.UPGRADE_PHP_EXT_DIR
    ? [
        "-d",
        `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR}`,
        "-d",
        "extension=mbstring",
        "-d",
        "extension=fileinfo",
      ]
    : []),
];
const phpLiteral = (value: string) =>
  "'" + value.replace(/\\/g, "/").replace(/'/g, "\\'") + "'";

test("independent review: accepted manifest rejects an extra executable file outside its inventory", async (t) => {
  const fixture = await release(t);
  await writeFile(
    join(fixture.packageDir, "code/module/upgrade.core/.settings.php"),
    '<?php throw new RuntimeException("UNREVIEWED CODE");',
  );
  await assert.rejects(
    validateBitrixPackage(fixture.packageDir, "review-fixture", fixture.hash),
    /UNLISTED|INVENTORY|EXTRA|TREE/,
  );
});

test(
  "independent review: PHP validator rejects an extra executable file despite unchanged accepted manifest",
  { skip: !php },
  async (t) => {
    const fixture = await release(t);
    await writeFile(
      join(fixture.packageDir, "code/module/upgrade.core/.settings.php"),
      '<?php throw new RuntimeException("UNREVIEWED CODE");',
    );
    const result = spawnSync(
      php!,
      [
        ...phpFlags(),
        resolve("bitrix/importer/cli.php"),
        "--command=validate",
        `--package=${fixture.packageDir}`,
        "--project=review-fixture",
        `--manifest-sha256=${fixture.hash}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /UNLISTED|INVENTORY|EXTRA|TREE/);
  },
);

test(
  "independent review: environment flags alone cannot execute target bootstrap",
  { skip: !php },
  async (t) => {
    const fixture = await release(t),
      documentRoot = join(fixture.root, "target"),
      state = join(fixture.root, "private-state"),
      marker = join(fixture.root, "bootstrap-executed");
    const prolog = join(documentRoot, "bitrix/modules/main/include");
    await mkdir(prolog, { recursive: true });
    await mkdir(state);
    await writeFile(
      join(prolog, "prolog_before.php"),
      `<?php file_put_contents(${phpLiteral(marker)},'executed'); throw new RuntimeException('SYNTHETIC_BOOTSTRAP_EXECUTED');`,
    );
    const env = {
      ...process.env,
      UPGRADE_DEMO: "1",
      UPGRADE_PROJECT_ID: "review-fixture",
    };
    for (const args of [
      [
        resolve("bitrix/importer/cli.php"),
        "--command=dry-run",
        `--package=${fixture.packageDir}`,
        "--project=review-fixture",
        `--manifest-sha256=${fixture.hash}`,
        `--document-root=${documentRoot}`,
        `--state-dir=${state}`,
      ],
      [
        resolve("bitrix/migrations/install.php"),
        `--document-root=${documentRoot}`,
        "--project=review-fixture",
        "--site=s1",
      ],
      [
        "-r",
        `$_SERVER['DOCUMENT_ROOT']=${phpLiteral(documentRoot)}; require ${phpLiteral(resolve("bitrix/local/upgrade-route.php"))};`,
      ],
    ]) {
      const result = spawnSync(php!, [...phpFlags(), ...args], {
        encoding: "utf8",
        env,
      });
      if (args[0] !== "-r") assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /SYNTHETIC_BOOTSTRAP_EXECUTED/);
      await assert.rejects(
        access(marker),
        "Target prolog must never run before enforced runtime isolation preconditions",
      );
    }
  },
);

test(
  "independent review: actual PHP block renderer escapes source markup as text",
  { skip: !php },
  async (t) => {
    const fixture = await release(t);
    const script = `require ${phpLiteral(resolve("bitrix/module/upgrade.core/lib/gateway.php"))}; $reflection=new ReflectionClass('Upgrade\\Core\\Gateway'); $gateway=$reflection->newInstanceWithoutConstructor(); $entities=json_decode(file_get_contents(${phpLiteral(join(fixture.packageDir, "data/entities.json"))}),true); $method=$reflection->getMethod('fields'); echo json_encode($method->invoke($gateway,$entities[0]),JSON_THROW_ON_ERROR);`;
    const result = spawnSync(php!, [...phpFlags(), "-r", script], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const fields = JSON.parse(result.stdout);
    assert.ok(
      fields.DETAIL_TEXT.includes("&lt;script&gt;sendSecrets()&lt;/script&gt;"),
    );
    assert.ok(
      fields.DETAIL_TEXT.includes("&lt;img src=x onerror=sendSecrets()&gt;"),
    );
    assert.ok(!fields.DETAIL_TEXT.includes("<script>"));
    assert.ok(!fields.DETAIL_TEXT.includes("<img"));
    assert.equal(fields.DETAIL_TEXT_TYPE, "html");
  },
);
