import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { load } from "cheerio";
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const php = process.env.UPGRADE_PHP_BIN;
const root = resolve("bitrix").replaceAll("\\", "/");
const viewFile = resolve("bitrix/module/upgrade.core/lib/demoview.php");
const pin = "a".repeat(64),
  csrf = "b".repeat(64);
const common = { csrf, snapshot_id: pin };
const item = (overrides: any = {}): any => ({
  id: "product-one",
  title: "Терморегулятор — тестовая карточка",
  body_text: "Наблюдаемое описание тестового источника",
  request_target: "/products/one?a=1&a=2&empty=",
  thumbnail: null,
  is_product: true,
  category_ids: ["controls"],
  attributes: { brand: ["Test source"] },
  variants: [],
  prices: [
    {
      id: "p1",
      role: "CURRENT",
      status: "OBSERVED",
      raw_text: "2178,50 RUB",
      money: { decimal: "2178.50", minor: 217850, currency: "RUB" },
      maximum: null,
      unit: null,
      totals_eligible: false,
      conditions: [],
    },
  ],
  purchase: {
    price_id: "p1",
    min_quantity: null,
    quantity_step: null,
    max_quantity: null,
    default_quantity: "1",
    blockers: ["UNIT_UNKNOWN", "QUANTITY_POLICY_UNKNOWN"],
  },
  ...overrides,
});
const temporary = (t: TestContext) => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-demo-view-"));
  t.after(() => {
    const target = resolve(dir),
      base = resolve(tmpdir()) + sep;
    assert.ok(
      target.startsWith(base) &&
        target.slice(base.length).startsWith("upgrade-demo-view-"),
    );
    if (process.env.UPGRADE_VIEW_KEEP_EVIDENCE === "1") {
      t.diagnostic(`Temporary view evidence: ${target}`);
      return;
    }
    rmSync(target, { recursive: true, force: true });
  });
  return dir;
};
function render(t: TestContext, view: any) {
  const dir = temporary(t),
    entry = join(dir, "render.php");
  writeFileSync(
    entry,
    "<?php require $argv[1]; $v=json_decode(file_get_contents('php://stdin'),true,128,JSON_THROW_ON_ERROR); echo \\Upgrade\\Core\\DemoView::render($v);",
  );
  const output = spawnSync(php!, ["-n", entry, viewFile], {
    input: JSON.stringify(view),
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(output.status, 0, output.stdout + output.stderr);
  assert.equal(output.stderr, "");
  return { html: output.stdout, $: load(output.stdout) };
}
const forms = ($: ReturnType<typeof load>) =>
  $("form[method=post]")
    .toArray()
    .map((form) => ({
      action: $(form).attr("action"),
      fields: Object.fromEntries(
        $(form)
          .find("input[type=hidden]")
          .toArray()
          .map((input) => [$(input).attr("name")!, $(input).attr("value")!]),
      ),
    }));

test(
  "view escapes source content, rejects external media/navigation and pins every independent form",
  { skip: !php },
  (t) => {
    const malicious = '<img src=x onerror="alert(1)">';
    const product = item({
      title: malicious,
      thumbnail: "https://evil.test/track.png",
      prices: [
        {
          role: "UNKNOWN",
          status: "REQUIRES_REVIEW",
          raw_text: malicious,
          money: null,
          unit: null,
          conditions: [],
        },
      ],
    });
    const { $, html } = render(t, {
      ...common,
      kind: "product",
      item: product,
      message: "<script>attack()</script>",
    });
    assert.equal($("script,img,[onerror],[onclick]").length, 0);
    assert.match($.text(), /<script>attack\(\)<\/script>/);
    assert.match($.text(), /<img src=x/);
    const form = forms($)[0];
    assert.equal(form.action, "/__upgrade/action");
    assert.equal(form.fields.action, "cart.add");
    assert.equal(form.fields.csrf, csrf);
    assert.equal(form.fields.expected_snapshot_id, pin);
    assert.match(form.fields.idempotency_key, /^view-[a-f0-9]{48}$/);
    assert.doesNotMatch(html, /<form[^>]*action="https?:/);
    assert.equal(
      $("input[name=email],input[name=phone],input[name=name]").length,
      0,
    );
  },
);

test(
  "observed variants have exact IDs, independent forms and source quantity controls without Cartesian additions",
  { skip: !php },
  (t) => {
    const variants = [
      "red-small",
      "red-medium",
      "blue-medium",
      "blue-large",
    ].map((id, i) => ({
      ...item(),
      id,
      attributes: { color: { value: id }, size: { value: String(i) } },
      purchase: {
        min_quantity: "0.5",
        quantity_step: "0.5",
        max_quantity: "9",
        default_quantity: "1",
      },
    }));
    const { $ } = render(t, {
      ...common,
      kind: "product",
      item: item({ variants }),
    });
    assert.equal($(".demo-variant").length, 4);
    assert.deepEqual(
      forms($).map((x) => x.fields.variant_id),
      variants.map((x) => x.id),
    );
    assert.equal(
      new Set(forms($).map((x) => x.fields.idempotency_key)).size,
      4,
    );
    assert.equal($("input[name=quantity]").first().attr("min"), "0.5");
    assert.equal($("input[name=quantity]").first().attr("step"), "0.5");
    for (const node of $("input[name=quantity]").toArray())
      assert.equal($("label[for='" + $(node).attr("id") + "']").length, 1);
  },
);

test(
  "unknown quantity policy stays explicit; money is formatted exactly and source range is retained",
  { skip: !php },
  (t) => {
    const p = item();
    p.prices.push({
      ...p.prices[0],
      role: "RANGE",
      maximum: { decimal: "2500", currency: "RUB", minor: 250000 },
    });
    const { $ } = render(t, { ...common, kind: "product", item: p });
    assert.match($.text(), /2\u202f178,50 ₽/);
    assert.match($.text(), /2\u202f178,50 ₽ — 2\u202f500 ₽/);
    assert.match($.text(), /Правила количества источника не установлены/);
    assert.equal($("input[name=quantity]").attr("step"), "any");
    assert.equal($("input[name=quantity]").attr("min"), "0.000001");
    assert.doesNotMatch(
      $.text(),
      /MIN_QUANTITY_UNKNOWN|UNIT_UNKNOWN|totals_eligible/,
    );
  },
);

test(
  "search preserves exact source query links, observed facets and pagination filters",
  { skip: !php },
  (t) => {
    const p = item(),
      row = {
        ...p,
        excerpt: "A <script>unsafe</script> description",
        price: null,
      };
    const { $ } = render(t, {
      kind: "search",
      query: {
        q: "тепло & уют",
        category: "controls",
        sort: "title_asc",
        attributes: { a0: "Точный бренд" },
      },
      search: { total: 42, page: 2, per_page: 20, items: [row] },
      items: { [p.id]: p },
      categories: [{ id: "controls", label: "Терморегуляторы" }],
      filters: [
        { key: "a0", name: "brand", label: "Бренд", values: ["Точный бренд"] },
      ],
    });
    assert.equal($(".demo-result-card h2 a").attr("href"), p.request_target);
    assert.equal($("script").length, 0);
    assert.equal($("select[name=a0] option[selected]").val(), "Точный бренд");
    const next = new URL($("a[rel=next]").attr("href")!, "https://demo.test");
    assert.equal(next.searchParams.get("q"), "тепло & уют");
    assert.equal(next.searchParams.get("a0"), "Точный бренд");
    assert.equal(next.searchParams.get("page"), "3");
    assert.equal($("form[method=post]").length, 0);
  },
);

test(
  "cart unknown total is never zero; update/remove/checkout forms carry independent intents and fixed synthetic identity",
  { skip: !php },
  (t) => {
    const p = item(),
      line = {
        item_id: p.id,
        variant_id: null,
        line_id: "d".repeat(64),
        quantity: "1",
        title: p.title,
        request_target: p.request_target,
        unit: null,
        unit_price: null,
        subtotal: null,
      };
    const { $ } = render(t, {
      ...common,
      kind: "cart",
      items: { [p.id]: p },
      cart: { lines: [line], total: null, checkout_available: true },
    });
    assert.match($(".demo-total").text(), /Требует уточнения/);
    assert.doesNotMatch($(".demo-total").text(), /0[,.]00|0 ₽/);
    const posted = forms($);
    assert.deepEqual(
      posted.map((x) => x.fields.action),
      ["cart.update", "cart.remove", "demo.checkout"],
    );
    assert.equal(new Set(posted.map((x) => x.fields.idempotency_key)).size, 3);
    const checkout = posted[2].fields;
    assert.equal(checkout.identity, "demo-customer");
    assert.equal(checkout.synthetic, "1");
    assert.equal(checkout.payment, "demo-none");
    assert.equal(checkout.delivery, "demo-pickup");
    assert.equal($("input[name=consent][required]").length, 1);
  },
);

test(
  "lead/receipt are explicitly synthetic; missing receipt cannot claim a saved operation",
  { skip: !php },
  (t) => {
    const lead = render(t, { ...common, kind: "lead" });
    assert.equal(lead.$("select[name=topic] option").length, 3);
    assert.equal(
      lead.$("input[type=email],input[type=tel],textarea").length,
      0,
    );
    const invalid = render(t, { kind: "receipt", record: null });
    assert.match(invalid.$.text(), /не подтверждена/);
    assert.doesNotMatch(invalid.$.text(), /Демо-запись сохранена/);
    const receipt = render(t, {
      kind: "receipt",
      record: {
        status: "RECORDED_LOCALLY_SYNTHETIC",
        kind: "demo.checkout",
        total: null,
        cart: { lines: [] },
        native_order_created: false,
        message_sent: false,
        payment_attempted: false,
      },
    });
    assert.match(receipt.$.text(), /Демо-запись сохранена/);
    assert.match(receipt.$.text(), /Сумма требует уточнения/);
    assert.match(receipt.$.text(), /Сообщение не отправлено/);
    assert.equal(receipt.$("form").length, 0);
  },
);

test(
  "missing media and absent results are explicit, with no source network fallback",
  { skip: !php },
  (t) => {
    const p = item({ thumbnail: "/upload/upgrade/demo/../secret.png" });
    const { $, html } = render(t, { ...common, kind: "product", item: p });
    assert.equal($("img").length, 0);
    assert.match($.text(), /Изображение не перенесено/);
    assert.doesNotMatch(html, /secret\.png/);
    const empty = render(t, {
      kind: "search",
      search: { total: 0, items: [] },
      query: {},
      items: {},
    });
    assert.match(empty.$.text(), /Ничего не найдено/);
  },
);

test(
  "real PHP + DemoWeb + browser works without JavaScript at five widths: search, variants, cart, reload, receipt and lead",
  { skip: !php, timeout: 90000 },
  async (t) => {
    const dir = temporary(t),
      privateDir = join(dir, "private"),
      evidence = join(dir, "screenshots");
    mkdirSync(privateDir, { mode: 0o700 });
    mkdirSync(evidence);
    const items = [
      item(),
      item({
        id: "variant-parent",
        title: "Тестовый товар с вариантами",
        request_target: "/products/variant",
        variants: [
          item({
            id: "explicit-red",
            attributes: { color: { value: "Красный" } },
          }),
          item({
            id: "explicit-blue",
            attributes: { color: { value: "Синий" } },
          }),
        ],
      }),
      ...Array.from({ length: 21 }, (_, i) =>
        item({
          id: "extra-" + i,
          title:
            "Тестовая карточка " +
            (i + 1) +
            (i === 0 ? " ОченьДлинноеНазвание".repeat(10) : ""),
          request_target: "/products/extra-" + i,
        }),
      ),
    ];
    // Optional private evidence: exact saved title/raw prices and verified image,
    // never an invented product photograph or an inferred current price.
    let observedPath: string | null = null;
    let mediaRoute = "";
    const captureRoot = resolve(
      "var/pilots/teplypol-operator-capture-20260929",
    );
    const captureFile = join(captureRoot, "operator-capture.json");
    if (existsSync(captureFile)) {
      const capture = JSON.parse(readFileSync(captureFile, "utf8"));
      const sourceUrl =
        "https://teplypol-market.ru/termoregulyatory/grand-meyer-hw-500";
      const observation = capture.observations.find(
        (entry: any) => entry.source_url === sourceUrl,
      );
      const asset = capture.assets.find(
        (entry: any) =>
          entry.source_url ===
          "https://teplypol-market.ru/image/cache/catalog/Grand-Meyer/Grand-Meyer-HW-500-200x200.jpg",
      );
      if (observation && asset) {
        assert.match(
          observation.file.relative_path,
          /^observations\/[a-z0-9-]+\.json$/,
        );
        assert.match(asset.file.relative_path, /^assets\/[a-f0-9]+\.jpg$/);
        const selectedBytes = readFileSync(
          join(captureRoot, observation.file.relative_path),
        );
        const photoBytes = readFileSync(
          join(captureRoot, asset.file.relative_path),
        );
        for (const [bytes, reference] of [
          [selectedBytes, observation.file],
          [photoBytes, asset.file],
        ] as const) {
          assert.equal(bytes.length, reference.size_bytes);
          assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            reference.sha256,
          );
        }
        const selected = JSON.parse(selectedBytes.toString("utf8"));
        const field = (name: string) =>
          selected.fields.find((entry: any) => entry.name === name)?.text ?? "";
        mediaRoute = "/upload/upgrade/demo-view/" + asset.file.sha256 + ".jpg";
        writeFileSync(join(dir, "verified-observed-photo.jpg"), photoBytes);
        observedPath = new URL(sourceUrl).pathname;
        items.push(
          item({
            id: "observed-hw500",
            title: field("title"),
            body_text: field("description_excerpt"),
            request_target: observedPath,
            thumbnail: mediaRoute,
            attributes: {},
            prices: selected.fields
              .filter((entry: any) => /^displayed_price_/.test(entry.name))
              .map((entry: any, index: number) => ({
                id: "raw-" + index,
                role: "UNKNOWN",
                status: "REQUIRES_REVIEW",
                raw_text: entry.text,
                money: null,
                maximum: null,
                unit: null,
                conditions: [],
                totals_eligible: false,
              })),
          }),
        );
        writeFileSync(
          join(evidence, "observed-photo-provenance.json"),
          JSON.stringify(
            {
              source_url: sourceUrl,
              observation_sha256: observation.file.sha256,
              image_sha256: asset.file.sha256,
              normalized_price: "UNKNOWN",
              source_network: "NOT_USED",
            },
            null,
            2,
          ),
        );
      }
    }
    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify({
        schema_version: 1,
        project_id: "demo-view",
        snapshot_id: pin,
        items,
      }),
    );
    const escapedDir = dir.replaceAll("\\", "/").replaceAll("'", "\\'");
    writeFileSync(
      join(dir, "server.php"),
      `<?php
declare(strict_types=1);
require '${root}/module/upgrade.core/lib/demoengine.php';require '${root}/module/upgrade.core/lib/demoweb.php';require '${root}/module/upgrade.core/lib/demoview.php';
if(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)==='/local/templates/upgrade/styles.css'){header('Content-Type:text/css');readfile('${root}/local/templates/upgrade/styles.css');exit;}
if('${mediaRoute}'!==''&&parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)==='${mediaRoute}'){header('Content-Type:image/jpeg');readfile('${escapedDir}/verified-observed-photo.jpg');exit;}
$snapshot=json_decode(file_get_contents('${escapedDir}/snapshot.json'),true,128,JSON_THROW_ON_ERROR);$engine=new \\Upgrade\\Core\\DemoEngine($snapshot,'${escapedDir}/private','demo-view');$target=$_SERVER['REQUEST_URI'];$matched=null;foreach($snapshot['items'] as $item)if(parse_url($item['request_target'],PHP_URL_PATH)===parse_url($target,PHP_URL_PATH))$matched=$item;
$response=\\Upgrade\\Core\\DemoWeb::handle($engine,$snapshot,['method'=>$_SERVER['REQUEST_METHOD'],'request_target'=>$target,'host'=>$_SERVER['HTTP_HOST'],'https'=>false,'origin'=>$_SERVER['HTTP_ORIGIN']??null,'cookie'=>$_COOKIE['upgrade_demo_session']??null,'body'=>file_get_contents('php://input'),'content_type'=>$_SERVER['CONTENT_TYPE']??null,'item_id'=>$matched['id']??null]);
http_response_code($response['status']);foreach($response['headers'] as $key=>$value)header($key.': '.$value);header("Content-Security-Policy: default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'");if(!$response['view'])exit;
define('B_PROLOG_INCLUDED',true);class TestApp{function ShowTitle(){echo 'Upgrade — local view test';}function ShowMeta($name){}}$APPLICATION=new TestApp();$GLOBALS['UPGRADE_NAVIGATION']=[['href'=>'/__upgrade/search','title'=>'Все страницы'],['href'=>'/products/one','title'=>'Тестовая карточка']];require '${root}/local/templates/upgrade/header.php';if($response['view']['kind']==='product')echo '<article class="document"><h1>'.htmlspecialchars($matched['title'],ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</h1>';echo \\Upgrade\\Core\\DemoView::render($response['view']);if($response['view']['kind']==='product')echo '<div class="prose"><h2>Сведения из источника</h2><p>Тестовое описание. Функциональность этого стенда не подтверждает Битрикс.</p></div></article>';require '${root}/local/templates/upgrade/footer.php';`,
    );
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((done) => probe.close(() => done()));
    const server = spawn(
      php!,
      [
        "-n",
        "-d",
        `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR ?? resolve("var/tools/php-8.3.35/ext")}`,
        "-d",
        "extension=mbstring",
        "-S",
        `127.0.0.1:${port}`,
        join(dir, "server.php"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let logs = "";
    server.stderr.on("data", (value) => {
      logs += String(value);
    });
    t.after(async () => {
      if (existsSync(evidence))
        writeFileSync(join(evidence, "server.log"), logs);
      if (server.exitCode === null && server.signalCode === null) {
        const stopped = new Promise<void>((done) =>
          server.once("exit", () => done()),
        );
        server.kill();
        await Promise.race([
          stopped,
          new Promise<void>((done) => setTimeout(done, 3000)),
        ]);
      }
    });
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        const ready = await fetch(origin + "/__upgrade/search", {
          signal: AbortSignal.timeout(3000),
        });
        await ready.arrayBuffer();
        if (ready.ok) break;
      } catch {}
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((done) => setTimeout(done, 100));
    }
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const nativePostOrigins: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") {
        nativePostOrigins.push(request.headers().origin ?? "MISSING");
        t.diagnostic(
          JSON.stringify({
            method: "POST",
            origin: request.headers().origin,
            content_type: request.headers()["content-type"],
          }),
        );
      }
    });
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [
        ["search", "/__upgrade/search"],
        ["product", "/products/one"],
        ["variants", "/products/variant"],
        ["lead", "/__upgrade/lead"],
        ...(observedPath ? [["observed-product", observedPath]] : []),
      ]) {
        const response = await page.goto(origin + path);
        assert.equal(response?.status(), 200, logs);
        assert.equal(response?.headers()["referrer-policy"], "same-origin");
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          `${name} overflow at ${width}`,
        );
        assert.equal(await page.locator("script").count(), 0);
        assert.equal(
          await page
            .locator("input:not([type=hidden]),select")
            .evaluateAll((controls) =>
              controls.every(
                (control) => (control as HTMLInputElement).labels!.length > 0,
              ),
            ),
          true,
          `${name} unlabeled control at ${width}`,
        );
        assert.equal(
          await page
            .locator("[id]")
            .evaluateAll(
              (nodes) =>
                new Set(nodes.map((node) => node.id)).size === nodes.length,
            ),
          true,
          `${name} duplicate element IDs at ${width}`,
        );
        await page.screenshot({
          path: join(evidence, `${name}-${width}.png`),
          fullPage: true,
        });
      }
      await page.locator(".site-menu>summary").click();
      assert.equal(await page.locator(".site-menu nav").isVisible(), true);
    }
    await page.goto(origin + "/__upgrade/search");
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator(".skip-link")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page
      .locator(".demo-filter-panel input[name=q]")
      .fill("НЕСУЩЕСТВУЮЩИЙ");
    await page.getByRole("button", { name: "Показать результаты" }).click();
    assert.match(
      await page.locator(".demo-empty").innerText(),
      /Ничего не найдено/,
    );
    await page.goto(origin + "/products/variant");
    await page.locator(".demo-variant>summary").first().click();
    await page
      .locator(".demo-variant")
      .first()
      .getByRole("button", { name: /Добавить/ })
      .click();
    assert.match(
      page.url(),
      /\/__upgrade\/cart\?operation=/,
      await page.locator("body").innerText(),
    );
    assert.match(await page.locator(".demo-cart-lines").innerText(), /Красный/);
    await page.locator(".demo-cart-lines input[name=quantity]").fill("2");
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await page.reload();
    assert.equal(await page.locator("input[name=quantity]").inputValue(), "2");
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        `cart overflow at ${width}`,
      );
      await page.screenshot({
        path: join(evidence, `cart-${width}.png`),
        fullPage: true,
      });
    }
    assert.match(
      await page.locator(".demo-total").innerText(),
      /Требует уточнения/,
    );
    await page.locator("input[name=consent]").check();
    await page.getByRole("button", { name: "Проверить оформление" }).click();
    assert.match(page.url(), /\/__upgrade\/receipt\?operation=/);
    assert.match(await page.locator("h1").innerText(), /Демо-запись сохранена/);
    await page.reload();
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        `receipt overflow at ${width}`,
      );
      await page.screenshot({
        path: join(evidence, `receipt-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto(origin + "/__upgrade/cart");
    assert.match(
      await page.locator(".demo-empty").innerText(),
      /пока ничего нет/,
    );
    await page.goto(origin + "/__upgrade/lead");
    await page.locator("input[name=consent]").check();
    await page
      .getByRole("button", { name: "Создать тестовое обращение" })
      .click();
    assert.match(await page.locator("h1").innerText(), /Демо-запись сохранена/);
    const stateFiles = readdirSync(join(privateDir, "demo-demo-view")).filter(
      (name) => name.endsWith(".json"),
    );
    assert.equal(stateFiles.length, 1);
    const body = JSON.parse(
      readFileSync(join(privateDir, "demo-demo-view", stateFiles[0]), "utf8"),
    ).body;
    assert.equal(Object.keys(body.synthetic_records).length, 2);
    for (const record of Object.values(body.synthetic_records) as any[]) {
      assert.equal(record.native_order_created, false);
      assert.equal(record.message_sent, false);
      assert.equal(record.payment_attempted, false);
    }
    assert.doesNotMatch(logs, /PHP (?:Warning|Fatal|Notice)/);
    assert.deepEqual(nativePostOrigins, Array(4).fill(origin));
    writeFileSync(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          status: "PASS",
          kind: "OWN_LOCAL_PHP_HTTP_VIEW",
          bitrix: "NOT_RUN",
          javaScriptEnabled: false,
          widths: [360, 390, 768, 1024, 1440],
          screenshots: observedPath ? 35 : 30,
          private_observed_photo: observedPath !== null,
          synthetic_records: 2,
          native_post_origins: nativePostOrigins,
          referrer_policy: "same-origin",
          code_sha256: Object.fromEntries(
            [
              "module/upgrade.core/lib/demoview.php",
              "module/upgrade.core/lib/demoweb.php",
              "module/upgrade.core/lib/demoengine.php",
              "local/templates/upgrade/styles.css",
            ].map((path) => [
              path,
              createHash("sha256")
                .update(readFileSync(join(root, path)))
                .digest("hex"),
            ]),
          ),
        },
        null,
        2,
      ),
    );
  },
);
