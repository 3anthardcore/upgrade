import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

test(
  "own PHP template contract: safe blocks, responsive layout, keyboard/menu and 404; NOT Bitrix integration",
  { skip: !process.env.UPGRADE_PHP_BIN, timeout: 45000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "upgrade-template-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const source = resolve("bitrix").replaceAll("\\", "/");
    const php = `<?php
define('B_PROLOG_INCLUDED',true);
require '${source}/module/upgrade.core/lib/gateway.php';
if (str_ends_with($_SERVER['REQUEST_URI'],'styles.css')) { header('Content-Type: text/css'); readfile('${source}/local/templates/upgrade/styles.css'); exit; }
class TemplateApplication { public function ShowTitle(){echo 'Тест шаблона — не Битрикс';} public function ShowMeta($name){echo '<meta name="description" content="Template-only test">';} }
$APPLICATION=new TemplateApplication();
$GLOBALS['UPGRADE_NAVIGATION']=[['href'=>'/','title'=>'Главная'],['href'=>'/article/','title'=>'Длинный материал']];
$gateway=(new ReflectionClass(\\Upgrade\\Core\\Gateway::class))->newInstanceWithoutConstructor();
$method=new ReflectionMethod(\\Upgrade\\Core\\Gateway::class,'fields');
$fields=$method->invoke($gateway,['title'=>'Очень длинное название материала '.str_repeat('Важный факт ',14),'description'=>'Описание из публичного источника.','blocks'=>[['type'=>'paragraph','text'=>'Источник говорит <script>window.SOURCE_RAN=true</script>; это текст.'],['type'=>'heading','level'=>2,'text'=>'Фактическая информация'],['type'=>'paragraph','text'=>str_repeat('Артикул',70)],['type'=>'list','items'=>['Факт первый','Факт второй']],['type'=>'table','rows'=>[array_fill(0,15,'Длинная характеристика'),array_fill(0,15,'Подтвержденное значение')]]],'facts'=>[]]);
$content=$fields; $content['UPGRADE_PROPERTIES']=$fields['properties'];
$missing=$_SERVER['REQUEST_URI']==='/missing'; if ($missing) { http_response_code(404); }
$arResult=['CONTENT'=>$missing?null:$content,'ROUTE'=>['ENTITY_KEY'=>str_repeat('a',64),'ENTITY_TYPE'=>'page'],'STATUS'=>$missing?404:200];
require '${source}/local/templates/upgrade/header.php';
require '${source}/local/components/upgrade/page/templates/.default/template.php';
require '${source}/local/templates/upgrade/footer.php';
`;
    const router = join(dir, "router.php");
    await writeFile(router, php);
    // Port 0 is not supported by PHP's built-in server; obtain an unused loopback port immediately before spawning.
    const { createServer } = await import("node:net");
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const server = spawn(
      process.env.UPGRADE_PHP_BIN!,
      ["-n", "-S", `127.0.0.1:${port}`, router],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let logs = "";
    server.stderr.on("data", (chunk) => {
      logs += chunk.toString();
    });
    t.after(async () => {
      if (server.exitCode === null) {
        server.kill();
        await new Promise<void>((resolve) =>
          server.once("exit", () => resolve()),
        );
      }
    });
    const origin = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const r = await fetch(origin);
        if (r.ok) break;
      } catch {}
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const evidence = resolve("var/evidence/bitrix-template");
    await mkdir(evidence, { recursive: true });
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(origin);
      assert.equal(response?.status(), 200, logs);
      await page.waitForSelector("h1");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        `Horizontal overflow at ${width}`,
      );
      assert.equal(
        await page.evaluate(() =>
          Boolean((window as unknown as { SOURCE_RAN?: boolean }).SOURCE_RAN),
        ),
        false,
      );
      assert.match(
        await page.locator(".prose").innerText(),
        /<script>window.SOURCE_RAN=true<\/script>/,
      );
      await page.locator("summary").click();
      assert.equal(await page.locator("nav").isVisible(), true);
      const table = page.getByRole("region", {
        name: "Таблица: используйте стрелки для прокрутки",
      });
      await table.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        () => document.querySelector(".table-scroll")!.scrollLeft > 0,
      );
      await table.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      assert.equal(
        await table.evaluate((el) => el.scrollLeft > 0),
        true,
        `Table horizontal access at ${width}`,
      );
      assert.equal(
        await table.evaluate((el) => {
          const last = el
            .querySelector("tr:last-child td:last-child")!
            .getBoundingClientRect();
          const region = el.getBoundingClientRect();
          return last.right <= region.right + 1;
        }),
        true,
        "Last table cell reachable",
      );
      await page.screenshot({
        path: join(evidence, `template-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto(origin);
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator(".skip-link")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    const missing = await page.goto(origin + "/missing");
    assert.equal(missing?.status(), 404);
    assert.equal(await page.locator("h1").innerText(), "Страница не найдена");
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          status: "PASS",
          kind: "OWN_TEMPLATE_CONTRACT_ONLY",
          bitrix_integration: "NOT_RUN",
          widths: [360, 390, 768, 1024, 1440],
          checks: [
            "safe escaped source blocks",
            "no horizontal document overflow",
            "native mobile menu",
            "keyboard skip-link",
            "real HTTP 404",
          ],
        },
        null,
        2,
      ),
    );
  },
);
