import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const php = process.env.UPGRADE_PHP_BIN;
const engine = resolve("bitrix/module/upgrade.core/lib/demoengine.php");
const pin = "a".repeat(64);
const session = "A".repeat(48);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
// The rename shim injects an actual process death at the persistence boundary;
// production code has no test hooks. All reads/writes otherwise use native PHP.
const harness = String.raw`<?php
declare(strict_types=1);
namespace Upgrade\Core {
    function rename($from,$to) {
        if(getenv('DEMO_TEST_CRASH')==='before')exit(81);
        if(getenv('DEMO_TEST_CRASH')==='hold'){
            file_put_contents($to.'.commit-ready','ready');
            for($wait=0;$wait<500&&!file_exists($to.'.commit-release');$wait++)usleep(10000);
            if(!file_exists($to.'.commit-release'))exit(83);
        }
        $result=\rename($from,$to);
        if(getenv('DEMO_TEST_CRASH')==='after')exit(82);
        return $result;
    }
}
namespace {
    require $argv[1];
    try {
        $input=json_decode(file_get_contents('php://stdin'),true,128,JSON_THROW_ON_ERROR);
        $snapshot=json_decode(file_get_contents($argv[2]),true,128,JSON_THROW_ON_ERROR);
        if(isset($input['document_root']))$_SERVER['DOCUMENT_ROOT']=$input['document_root'];
        $service=new \Upgrade\Core\DemoEngine($snapshot,$argv[3],$input['project']??'demo-engine');
        $value=match($input['method']) {
            'open'=>$service->openSession($input['session']),
            'cart'=>$service->cart($input['session']),
            'resume'=>$service->resumeSession($input['session']),
            'receipt'=>$service->receipt($input['session'],$input['operation_id']),
            'search'=>$service->search($input['query']??'',$input['filters']??[],$input['sort']??'relevance',$input['page']??1,$input['per_page']??20),
            'mutate'=>$service->mutate($input['session'],$input['csrf'],$input['key'],$input['action'],$input['payload']),
            default=>throw new RuntimeException('TEST_METHOD_INVALID')
        };
        echo json_encode(['ok'=>true,'result'=>$value],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    }catch(Throwable $error){echo json_encode(['ok'=>false,'error'=>$error->getMessage()],JSON_THROW_ON_ERROR);exit(2);}
}
`;

function product(id = "heat", overrides: Record<string, unknown> = {}): any {
  return {
    id, title: "Тёплый пол " + id, body_text: "Наблюдаемая мощность 150 Вт. Белый регулятор.",
    request_target: "/products/" + id + "?a=1&a=2&sort=price%20asc", is_product: true,
    category_ids: ["heating"], attributes: { brand: ["Observed"], color: ["белый"] },
    prices: [{ id: "current", role: "CURRENT", status: "OBSERVED", raw_text: "2,50 руб.", money: { decimal: "2.50", currency: "RUB", minor: 250 }, maximum: null, unit: "piece", conditions: [], totals_eligible: true }],
    purchase: { price_id: "current", min_quantity: "1", quantity_step: "1", max_quantity: "10", blockers: [] },
    variants: [], ...overrides,
  };
}

function fixture(t: TestContext, items = [product()]) {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-demo-engine-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = join(directory, "private");
  mkdirSync(state, { mode: 0o700 });
  const entry = join(directory, "runner.php");
  const snapshot = join(directory, "snapshot.json");
  writeFileSync(entry, harness);
  const model: any = { schema_version: 1, project_id: "demo-engine", snapshot_id: pin, items };
  const save = () => writeFileSync(snapshot, JSON.stringify(model));
  save();
  const args = ["-n", "-d", `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR ?? resolve("var/tools/php-8.3.35/ext")}`, "-d", "extension=mbstring", "-d", "disable_functions=mail,exec,shell_exec,system,passthru,popen,proc_open,curl_exec,fsockopen,pfsockopen,stream_socket_client", entry, engine, snapshot, state];
  const raw = (input: any, crash = "") => spawnSync(php!, args, { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, DEMO_TEST_CRASH: crash }, timeout: 20_000 });
  const call = (input: any) => {
    const result = raw(input);
    assert.equal(result.stderr, "", "PHP warning/error output");
    assert.ok(result.status === 0 || result.status === 2, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const ok = (input: any) => { const result = call(input); assert.equal(result.ok, true, JSON.stringify(result)); return result.result; };
  const opened = () => ok({ method: "open", session });
  const mutation = (csrf: string, key: string, action: string, payload: any) => ({ method: "mutate", session, csrf, key: "operation-key-" + key, action, payload: { expected_snapshot_id: pin, ...payload } });
  const file = (sessionId = session, project = "demo-engine") => join(state, "demo-" + project, hash(project + "\0" + sessionId) + ".json");
  const body = () => JSON.parse(readFileSync(file(), "utf8")).body;
  const start = (input: any, crash = "") => {
    const child = spawn(php!, args, { env: { ...process.env, DEMO_TEST_CRASH: crash }, stdio: ["pipe", "pipe", "pipe"] });
    const completed = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
      child.on("error", reject); child.on("close", status => resolveResult({ status, stdout, stderr }));
    });
    child.stdin.end(JSON.stringify(input));
    return { child, completed };
  };
  const concurrent = (inputs: any[]) => Promise.all(inputs.map(input => new Promise<any>((resolveResult, reject) => {
    const child = spawn(php!, args, { env: { ...process.env, DEMO_TEST_CRASH: "" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject);
    child.on("close", code => { try { assert.equal(code, 0, stdout + stderr); assert.equal(stderr, ""); resolveResult(JSON.parse(stdout).result); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify(input));
  })));
  return { directory, state, model, save, raw, call, ok, opened, mutation, file, body, concurrent, start };
}

test("demo engine searches actual UTF-8 text, returns empty results and combines observed facets", { skip: !php }, t => {
  const f = fixture(t, [product(), product("other", { attributes: { brand: ["Other"], color: ["чёрный"] }, category_ids: ["other"] }), product("article", { is_product: false, title: "Монтаж", body_text: "ТЁПЛЫЙ пол: инструкция", prices: [], purchase: {} })]);
  const search = f.ok({ method: "search", query: "наблюдаемая 150", filters: { category_id: "heating", attributes: { brand: ["Observed"], color: ["белый", "серый"] }, products_only: true } });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].request_target, "/products/heat?a=1&a=2&sort=price%20asc");
  assert.equal(f.ok({ method: "search", query: "НЕСУЩЕСТВУЮЩИЙ" }).status, "NO_RESULTS");
  assert.equal(f.ok({ method: "search", query: "тёплый", filters: { products_only: false } }).total, 3);
  assert.equal(f.ok({ method: "search", query: "", page: 2, per_page: 2 }).items.length, 1);
  assert.equal(f.call({ method: "search", query: "", filters: { sql: "ignored?" } }).error, "UNEXPECTED_INPUT");
});

test("price ordering is deterministic, leaves unknown last and refuses incomparable units", { skip: !php }, t => {
  const cheap = product("cheap"), expensive = product("expensive"), unknown = product("unknown");
  expensive.prices[0].money = { decimal: "10", minor: 1000, currency: "RUB" };
  unknown.prices[0].role = "FROM";
  const f = fixture(t, [unknown, expensive, cheap]);
  assert.deepEqual(f.ok({ method: "search", sort: "price_asc" }).items.map((x: any) => x.id), ["cheap", "expensive", "unknown"]);
  expensive.prices[0].unit = "m2"; f.save();
  assert.equal(f.call({ method: "search", sort: "price_asc" }).error, "PRICE_SORT_INCOMPARABLE");
});

test("cart performs exact decimal addition, half-up money rounding, update and remove", { skip: !php }, t => {
  const fractional = product();
  fractional.prices[0].money = { decimal: "0.05", minor: 5, currency: "RUB" };
  fractional.prices[0].unit = "m";
  fractional.purchase = { price_id: "current", min_quantity: "0.1", quantity_step: "0.1", max_quantity: "100", blockers: [] };
  const f = fixture(t, [fractional]), { csrf } = f.opened();
  const a = f.ok(f.mutation(csrf, "add-a", "cart.add", { item_id: "heat", quantity: "0.1" }));
  assert.equal(a.cart.total.minor, 1);
  const b = f.ok(f.mutation(csrf, "add-b", "cart.add", { item_id: "heat", quantity: "0.2" }));
  assert.equal(b.cart.lines[0].quantity, "0.3"); assert.equal(b.cart.total.decimal, "0.02");
  const line = b.cart.lines[0].line_id;
  assert.equal(f.ok(f.mutation(csrf, "update", "cart.update", { line_id: line, quantity: "1.2" })).cart.total.decimal, "0.06");
  assert.deepEqual(f.ok(f.mutation(csrf, "remove", "cart.remove", { line_id: line })).cart.lines, []);
  assert.equal(f.ok({ method: "cart", session }).revision, 4);
});

test("malformed, excessive and source-disallowed quantities never alter persisted cart", { skip: !php }, t => {
  const constrained = product(); constrained.purchase = { price_id: "current", min_quantity: "2", quantity_step: "0.5", max_quantity: "3", blockers: [] };
  const f = fixture(t, [constrained]), { csrf } = f.opened();
  for (const [i, quantity] of [1, "1e3", "NaN", "-1", "0", "01", "1.0000001", "10000.000001", "10001", " 2", "1.5", "2.1", "3.5"].entries()) {
    assert.equal(f.call(f.mutation(csrf, `bad-${i}`, "cart.add", { item_id: "heat", quantity })).ok, false);
  }
  assert.equal(f.body().revision, 0); assert.deepEqual(f.body().cart, []);
  assert.equal(f.ok(f.mutation(csrf, "valid", "cart.add", { item_id: "heat", quantity: "2.5" })).cart.lines[0].quantity, "2.5");
});

test("unknown, ambiguous, conditional, malformed and noncurrent prices are never charged", { skip: !php }, t => {
  const variants = [
    (x: any) => x.prices[0].role = "FROM", (x: any) => x.prices[0].role = "OLD",
    (x: any) => x.prices[0].role = "RANGE", (x: any) => x.prices[0].status = "UNKNOWN",
    (x: any) => x.prices[0].money.minor = 249, (x: any) => x.prices[0].money.decimal = "2,50",
    (x: any) => x.prices[0].money.decimal = "2.501", (x: any) => x.prices[0].unit = null,
    (x: any) => x.prices[0].conditions = ["membership"], (x: any) => x.prices.push({ ...x.prices[0] }),
    (x: any) => x.purchase.min_quantity = null, (x: any) => x.purchase.max_quantity = "oops",
    (x: any) => x.prices[0].maximum = { decimal: "3", minor: 300, currency: "RUB" },
    (x: any) => x.prices[0].money.currency = "XXX", (x: any) => x.purchase.blockers = ["UNIT_UNKNOWN"],
  ];
  const items = variants.map((change, i) => { const p = product("bad-" + i); change(p); return p; });
  const f = fixture(t, items), { csrf } = f.opened();
  for (const [i, item] of items.entries()) {
    const result = f.ok(f.mutation(csrf, "add-" + i, "cart.add", { item_id: item.id, quantity: "1" }));
    const line = result.cart.lines.find((x: any) => x.item_id === item.id);
    assert.equal(line.subtotal, null, item.id); assert.ok(line.blockers.length, item.id);
    assert.equal(result.cart.total, null); assert.equal(result.cart.pricing_status, "REQUIRES_CONFIRMATION"); assert.equal(result.cart.checkout_available, true);
  }
  const checkout = f.mutation(csrf, "checkout", "demo.checkout", { synthetic: true, identity: "demo-customer", consent: true, delivery: "demo-pickup", payment: "demo-none" });
  const recorded = f.ok(checkout);
  assert.equal(recorded.record.status, "RECORDED_LOCALLY_SYNTHETIC");
  assert.equal(recorded.record.total, null); assert.equal(recorded.record.pricing_status, "REQUIRES_CONFIRMATION");
  assert.ok(recorded.record.pricing_blockers.length > 0); assert.equal(recorded.record.payment_attempted, false);
  assert.equal(recorded.record.cart.lines.length, items.length);
  assert.equal(f.ok(checkout).replayed, true); assert.equal(Object.keys(f.body().synthetic_records).length, 1);
});

test("only explicit observed variant IDs can be selected and variant-specific prices are used", { skip: !php }, t => {
  const p = product();
  const v1 = product("variant-a"), v2 = product("variant-b");
  v2.prices[0].money = { decimal: "12", minor: 1200, currency: "RUB" };
  p.variants = [v1, v2];
  const f = fixture(t, [p]), { csrf } = f.opened();
  assert.equal(f.call(f.mutation(csrf, "no-variant", "cart.add", { item_id: "heat", quantity: "1" })).error, "VARIANT_REQUIRED");
  assert.equal(f.call(f.mutation(csrf, "fake-variant", "cart.add", { item_id: "heat", variant_id: "invented-cartesian-combination", quantity: "1" })).error, "VARIANT_NOT_FOUND");
  const result = f.ok(f.mutation(csrf, "real-variant", "cart.add", { item_id: "heat", variant_id: "variant-b", quantity: "2" }));
  assert.equal(result.cart.lines[0].variant_id, "variant-b"); assert.equal(result.cart.total.minor, 2400);
});

test("only explicit synthetic lead and checkout data reach the local sink; no send/payment state", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const lead = { synthetic: true, identity: "demo-customer", consent: true, topic: "general" };
  for (const [i, payload] of [{ ...lead, email: "real@example.test" }, { ...lead, synthetic: false }, { ...lead, consent: false }, { ...lead, identity: "real-customer" }, { ...lead, topic: "arbitrary free text" }].entries()) {
    assert.equal(f.call(f.mutation(csrf, "bad-lead-" + i, "demo.lead", payload)).ok, false);
  }
  const request = f.mutation(csrf, "lead", "demo.lead", lead);
  const recorded = f.ok(request); const replay = f.ok(request);
  assert.equal(recorded.record.status, "RECORDED_LOCALLY_SYNTHETIC"); assert.equal(replay.replayed, true);
  assert.equal(Object.keys(f.body().synthetic_records).length, 1);
  f.ok(f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "2" }));
  const checkout = f.ok(f.mutation(csrf, "checkout", "demo.checkout", { synthetic: true, identity: "demo-customer", consent: true, delivery: "demo-pickup", payment: "demo-none" }));
  assert.deepEqual(checkout.cart.lines, []); assert.equal(checkout.record.cart.total.minor, 500);
  for (const field of ["native_order_created", "message_sent", "payment_attempted"]) assert.equal(checkout.record[field], false);
  assert.equal(checkout.record.contact.email, "demo@example.invalid");
  assert.ok(!readFileSync(f.file(), "utf8").includes("real@example.test"));
});

test("CSRF, project and session boundaries prevent foreign state reuse", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "1" });
  assert.equal(f.call({ ...request, csrf: "0".repeat(64) }).error, "CSRF_INVALID");
  const other = "B".repeat(48);
  const openedB = f.ok({ method: "open", session: other }); assert.notEqual(openedB.csrf, csrf);
  assert.equal(f.call({ ...request, session: other }).error, "CSRF_INVALID");
  f.ok(request); assert.equal(f.ok({ method: "cart", session: other }).lines.length, 0);
  writeFileSync(f.file(other), readFileSync(f.file()));
  assert.equal(f.call({ method: "cart", session: other }).error, "STATE_BINDING_INVALID");
  assert.equal(f.call({ method: "cart", session, project: "foreign" }).error, "SNAPSHOT_INVALID");
  f.model.project_id = "foreign"; f.save();
  const foreign = f.ok({ method: "open", session, project: "foreign" });
  assert.equal(foreign.cart.lines.length, 0); assert.notEqual(foreign.csrf, csrf);
  assert.equal(f.call({ method: "cart", session: "../../anything", project: "foreign" }).error, "SESSION_INVALID");
});

test("idempotency compares semantic object inputs and rejects conflicting reuse", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "1" });
  f.ok(request);
  assert.equal(f.ok({ ...request, payload: { quantity: "1", item_id: "heat", expected_snapshot_id: pin } }).replayed, true);
  assert.equal(f.call({ ...request, payload: { ...request.payload, quantity: "2" } }).error, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.body().revision, 1);
  f.model.snapshot_id = "b".repeat(64); f.model.items[0].prices[0].money = { decimal: "5", minor: 500, currency: "RUB" }; f.save();
  const repeated = f.ok(request); assert.equal(repeated.replayed, true); assert.equal(repeated.cart.total.minor, 250);
  assert.equal(f.call({ ...request, key: "new-operation-key-after-price-change" }).error, "SNAPSHOT_CHANGED");
  assert.equal(f.ok({ method: "cart", session }).total.minor, 500);
});

for (const [timing, expectedCode, expectedReplay] of [["before", 81, false], ["after", 82, true]] as const) {
  test(`process death ${timing} atomic commit reconciles without duplicate cart or synthetic records`, { skip: !php }, t => {
    const f = fixture(t), { csrf } = f.opened();
    const request = f.mutation(csrf, "lead", "demo.lead", { synthetic: true, identity: "demo-customer", consent: true, topic: "delivery" });
    const failed = f.raw(request, timing); assert.equal(failed.status, expectedCode); assert.equal(failed.stdout, "");
    const result = f.ok(request); assert.equal(result.replayed, expectedReplay);
    assert.equal(f.body().revision, 1); assert.equal(Object.keys(f.body().synthetic_records).length, 1); assert.equal(Object.keys(f.body().operations).length, 1);
    assert.equal(f.ok(request).replayed, true);
    if (timing === "before") assert.ok(readdirSync(join(f.state, "demo-demo-engine")).some(x => x.includes(".pending-")));
  });
}

test("real competing PHP processes serialize writes and reconcile identical idempotency keys", { skip: !php }, async t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "same", "cart.add", { item_id: "heat", quantity: "1" });
  const first = await f.concurrent(Array.from({ length: 6 }, () => request));
  assert.equal(first.filter(x => !x.replayed).length, 1);
  assert.equal(f.ok({ method: "cart", session }).lines[0].quantity, "1");
  await f.concurrent(Array.from({ length: 6 }, (_, i) => f.mutation(csrf, "distinct-" + i, "cart.add", { item_id: "heat", quantity: "1" })));
  const cart = f.ok({ method: "cart", session }); assert.equal(cart.lines[0].quantity, "7"); assert.equal(cart.revision, 7);
});

test("a live writer lock has bounded wait and is never stolen or reset", { skip: !php }, async t => {
  const f = fixture(t); f.opened();
  const before = readFileSync(f.file(), "utf8");
  const holder = spawn(php!, ["-n", "-r", '$h=fopen($argv[1],"c+b");if(!flock($h,LOCK_EX))exit(9);echo "LOCKED";fflush(STDOUT);usleep(4500000);', f.file() + ".lock"], { stdio: ["ignore", "pipe", "pipe"] });
  const completed = new Promise<number | null>((resolveExit, reject) => { holder.on("close", resolveExit); holder.on("error", reject); });
  await new Promise<void>((ready, reject) => { holder.stdout.once("data", data => { try { assert.equal(String(data), "LOCKED"); ready(); } catch (error) { reject(error); } }); holder.on("error", reject); });
  const start = Date.now();
  assert.equal(f.call({ method: "cart", session }).error, "STATE_BUSY");
  assert.ok(Date.now() - start >= 2800); assert.ok(Date.now() - start < 4300);
  assert.equal(readFileSync(f.file(), "utf8"), before);
  assert.equal(await completed, 0);
  assert.equal(f.ok({ method: "cart", session }).revision, 0);
});

test("corrupt state is preserved for diagnosis and cannot silently reset a cart", { skip: !php }, t => {
  const f = fixture(t); f.opened();
  const original = readFileSync(f.file(), "utf8");
  const state = JSON.parse(original); state.body.revision = 900;
  writeFileSync(f.file(), JSON.stringify(state));
  assert.equal(f.call({ method: "cart", session }).error, "STATE_CORRUPT");
  assert.equal(JSON.parse(readFileSync(f.file(), "utf8")).body.revision, 900);
  writeFileSync(f.file(), "{broken");
  assert.equal(f.call({ method: "open", session }).error, "STATE_CORRUPT");
  assert.equal(readFileSync(f.file(), "utf8"), "{broken");
  writeFileSync(f.file(), original);
  assert.equal(f.ok({ method: "cart", session }).revision, 0);
});

test("unknown source unit and quantity policy stay unknown through synthetic checkout", { skip: !php }, t => {
  const item = product();
  item.prices[0].unit = null; item.prices[0].totals_eligible = false;
  item.purchase = { price_id: "current", min_quantity: null, quantity_step: null, max_quantity: null, default_quantity: "1", blockers: ["UNIT_UNKNOWN", "QUANTITY_POLICY_UNKNOWN"] };
  const f = fixture(t, [item]), { csrf } = f.opened();
  const added = f.ok(f.mutation(csrf, "unknown-add", "cart.add", { item_id: "heat", quantity: "1" }));
  assert.equal(added.cart.lines[0].unit, null); assert.equal(added.cart.lines[0].unit_price, null);
  assert.equal(added.cart.total, null); assert.deepEqual(added.cart.known_subtotals, []);
  const request = f.mutation(csrf, "unknown-checkout", "demo.checkout", { synthetic: true, identity: "demo-customer", consent: true, delivery: "demo-pickup", payment: "demo-none" });
  assert.equal(f.raw(request, "after").status, 82);
  const result = f.ok(request);
  assert.equal(result.replayed, true); assert.equal(result.record.pricing_status, "REQUIRES_CONFIRMATION");
  assert.equal(result.record.total, null); assert.equal(result.record.cart.lines[0].unit, null);
  assert.deepEqual(result.cart.lines, []); assert.equal(Object.keys(f.body().synthetic_records).length, 1);
  assert.equal(f.body().revision, 2);
});

test("an empty or no-longer-valid cart cannot create a synthetic checkout", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "checkout-empty", "demo.checkout", { synthetic: true, identity: "demo-customer", consent: true, delivery: "demo-pickup", payment: "demo-none" });
  assert.equal(f.call(request).error, "CART_NOT_CHECKOUT_ELIGIBLE");
  f.ok(f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "1" }));
  f.model.items = []; f.model.snapshot_id = "b".repeat(64); f.save();
  const cart = f.ok({ method: "cart", session });
  assert.equal(cart.checkout_available, false); assert.deepEqual(cart.pricing_blockers, ["SELECTION_OR_QUANTITY_NO_LONGER_VALID"]);
  assert.equal(f.call({ ...request, payload: { ...request.payload, expected_snapshot_id: f.model.snapshot_id } }).error, "CART_NOT_CHECKOUT_ELIGIBLE");
  assert.equal(Object.keys(f.body().synthetic_records).length, 0);
});

test("different observed currencies remain separate and synthetic checkout has no invented aggregate", { skip: !php }, t => {
  const usd = product("dollar"); usd.prices[0].money = { decimal: "1", minor: 100, currency: "USD" };
  const f = fixture(t, [product(), usd]), { csrf } = f.opened();
  f.ok(f.mutation(csrf, "ruble", "cart.add", { item_id: "heat", quantity: "1" }));
  const cart = f.ok(f.mutation(csrf, "dollar", "cart.add", { item_id: "dollar", quantity: "1" })).cart;
  assert.equal(cart.total, null); assert.equal(cart.pricing_status, "REQUIRES_CONFIRMATION");
  assert.deepEqual(cart.known_subtotals.map((x: any) => x.currency), ["RUB", "USD"]);
  assert.ok(cart.pricing_blockers.includes("MULTIPLE_CURRENCIES"));
});

test("unexpected user fields, missing snapshot pin and web-root state are rejected", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "bad", "cart.add", { item_id: "heat", quantity: "1", price: "0.01" });
  assert.equal(f.call(request).error, "UNEXPECTED_INPUT");
  assert.equal(f.call({ ...request, payload: { item_id: "heat", quantity: "1" } }).error, "SNAPSHOT_CHANGED");
  assert.equal(f.call({ method: "cart", session, document_root: f.directory }).error, "STATE_INSIDE_WEBROOT");
  assert.equal(f.call(f.mutation(csrf, "huge", "demo.lead", { note: "x".repeat(9000) })).error, "INPUT_LIMIT");
  assert.equal(f.body().revision, 0);
  const source = readFileSync(engine, "utf8");
  assert.doesNotMatch(source, /\b(?:mail|fsockopen|pfsockopen|stream_socket_client|curl_exec|exec|shell_exec|system|proc_open)\s*\(/);
  assert.doesNotMatch(source, /\b(?:CEvent|CUser|CSaleOrder|CSaleBasket)\b|\\Sale\\/);
});

test("existing-only reads return null for unknown sessions without JSON or lock creation", { skip: !php }, t => {
  const f = fixture(t);
  assert.equal(f.ok({ method: "resume", session }), null);
  assert.equal(f.ok({ method: "receipt", session, operation_id: "c".repeat(64) }), null);
  assert.deepEqual(readdirSync(join(f.state, "demo-demo-engine")), []);
  assert.equal(f.call({ method: "receipt", session, operation_id: "not-the-operation-hash" }).error, "OPERATION_ID_INVALID");
  assert.equal(f.call({ method: "resume", session: "../bad" }).error, "SESSION_INVALID");
  assert.deepEqual(readdirSync(join(f.state, "demo-demo-engine")), []);
  // A pre-existing orphan lock does not authorize resurrection of its session.
  writeFileSync(f.file() + ".lock", "retained-lock");
  assert.equal(f.ok({ method: "resume", session }), null);
  assert.equal(readFileSync(f.file() + ".lock", "utf8"), "retained-lock");
  assert.equal(existsSync(f.file()), false);
});

test("resume and receipt preserve exact existing state and receipt across repeated process reads", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const response = f.ok(f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "2" }));
  const bytes = readFileSync(f.file(), "utf8"), before = statSync(f.file()).mtimeMs;
  const files = readdirSync(join(f.state, "demo-demo-engine")).sort();
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(f.ok({ method: "resume", session }), { csrf, cart: response.cart });
    assert.deepEqual(f.ok({ method: "receipt", session, operation_id: response.operation_id }), response);
    assert.equal(f.ok({ method: "receipt", session, operation_id: "0".repeat(64) }), null);
  }
  assert.equal(readFileSync(f.file(), "utf8"), bytes); assert.equal(statSync(f.file()).mtimeMs, before);
  assert.deepEqual(readdirSync(join(f.state, "demo-demo-engine")).sort(), files);
});

test("receipt stays on its committed snapshot while resume reflects current observed cart prices", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const response = f.ok(f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "2" }));
  const bytes = readFileSync(f.file(), "utf8");
  f.model.snapshot_id = "b".repeat(64); f.model.items[0].prices[0].money = { decimal: "9", minor: 900, currency: "RUB" }; f.save();
  const resumed = f.ok({ method: "resume", session });
  assert.equal(resumed.csrf, csrf); assert.equal(resumed.cart.snapshot_id, "b".repeat(64)); assert.equal(resumed.cart.total.minor, 1800);
  const receipt = f.ok({ method: "receipt", session, operation_id: response.operation_id });
  assert.deepEqual(receipt, response); assert.equal(receipt.snapshot_id, pin); assert.equal(receipt.cart.total.minor, 500); assert.equal(receipt.replayed, false);
  assert.equal(readFileSync(f.file(), "utf8"), bytes);
});

test("existing-only read APIs fail closed on corrupt, copied and missing-lock state without repair", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const response = f.ok(f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "1" }));
  const original = readFileSync(f.file(), "utf8");
  writeFileSync(f.file(), "{broken");
  assert.equal(f.call({ method: "resume", session }).error, "STATE_CORRUPT");
  assert.equal(f.call({ method: "receipt", session, operation_id: response.operation_id }).error, "STATE_CORRUPT");
  assert.equal(readFileSync(f.file(), "utf8"), "{broken");
  writeFileSync(f.file(), original);
  const other = "B".repeat(48); f.ok({ method: "open", session: other });
  writeFileSync(f.file(other), original);
  assert.equal(f.call({ method: "resume", session: other }).error, "STATE_BINDING_INVALID");
  assert.equal(f.call({ method: "receipt", session: other, operation_id: response.operation_id }).error, "STATE_BINDING_INVALID");
  rmSync(f.file() + ".lock");
  assert.equal(f.call({ method: "resume", session }).error, "STATE_LOCK_FAILED");
  assert.equal(f.call({ method: "receipt", session, operation_id: response.operation_id }).error, "STATE_LOCK_FAILED");
  assert.equal(existsSync(f.file() + ".lock"), false); assert.equal(readFileSync(f.file(), "utf8"), original);
});

test("receipt IDs do not cross projects or sessions and are not raw idempotency keys", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "1" });
  const response = f.ok(request); assert.equal(response.operation_id, hash(request.key));
  const other = "B".repeat(48); f.ok({ method: "open", session: other });
  const otherBytes = readFileSync(f.file(other), "utf8");
  assert.equal(f.ok({ method: "receipt", session: other, operation_id: response.operation_id }), null);
  assert.equal(readFileSync(f.file(other), "utf8"), otherBytes);
  assert.equal(f.call({ method: "receipt", session, operation_id: request.key }).error, "OPERATION_ID_INVALID");
  f.model.project_id = "foreign"; f.save();
  assert.equal(f.ok({ method: "resume", session, project: "foreign" }), null);
  assert.equal(f.ok({ method: "receipt", session, project: "foreign", operation_id: response.operation_id }), null);
  assert.deepEqual(readdirSync(join(f.state, "demo-foreign")), []);
});

test("receipt validates stored operation binding even when an envelope checksum was recomputed", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const response = f.ok(f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "1" }));
  const state = JSON.parse(readFileSync(f.file(), "utf8"));
  state.body.operations[response.operation_id].response.operation_id = "0".repeat(64);
  state.sha256 = hash(JSON.stringify(state.body));
  const changed = JSON.stringify(state); writeFileSync(f.file(), changed);
  assert.equal(f.call({ method: "receipt", session, operation_id: response.operation_id }).error, "STATE_RECEIPT_INVALID");
  assert.equal(readFileSync(f.file(), "utf8"), changed);
});

test("existing-only reads wait for the committing PHP writer and observe its complete new state", { skip: !php }, async t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "add", "cart.add", { item_id: "heat", quantity: "2" });
  const writer = f.start(request, "hold");
  t.after(() => { if (!writer.child.killed && writer.child.exitCode === null) writer.child.kill(); });
  for (let i = 0; i < 200 && !existsSync(f.file() + ".commit-ready"); i++) await new Promise(resolveWait => setTimeout(resolveWait, 10));
  assert.equal(existsSync(f.file() + ".commit-ready"), true, "writer did not reach commit barrier");
  const reader = f.start({ method: "resume", session });
  const receiptReader = f.start({ method: "receipt", session, operation_id: hash(request.key) });
  let done = false; reader.completed.then(() => { done = true; });
  await new Promise(resolveWait => setTimeout(resolveWait, 150)); assert.equal(done, false);
  writeFileSync(f.file() + ".commit-release", "release");
  const [written, resumed, receipt] = await Promise.all([writer.completed, reader.completed, receiptReader.completed]);
  for (const result of [written, resumed, receipt]) { assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stderr, ""); }
  const response = JSON.parse(written.stdout).result;
  assert.deepEqual(JSON.parse(resumed.stdout).result, { csrf, cart: response.cart });
  assert.deepEqual(JSON.parse(receipt.stdout).result, response);
  assert.equal(f.body().revision, 1); assert.equal(Object.keys(f.body().operations).length, 1);
});

test("receipt reconciles an unknown committed response without replaying the mutation", { skip: !php }, t => {
  const f = fixture(t), { csrf } = f.opened();
  const request = f.mutation(csrf, "lost-lead", "demo.lead", { synthetic: true, identity: "demo-customer", consent: true, topic: "general" });
  assert.equal(f.raw(request, "after").status, 82);
  const before = readFileSync(f.file(), "utf8");
  const receipt = f.ok({ method: "receipt", session, operation_id: hash(request.key) });
  assert.equal(receipt.status, "RECORDED_LOCALLY_SYNTHETIC"); assert.equal(receipt.replayed, false);
  assert.equal(receipt.record.message_sent, false); assert.equal(receipt.record.native_order_created, false);
  assert.equal(readFileSync(f.file(), "utf8"), before); assert.equal(Object.keys(f.body().synthetic_records).length, 1);
});
