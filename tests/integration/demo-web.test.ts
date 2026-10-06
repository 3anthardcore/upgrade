import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const php = process.env.UPGRADE_PHP_BIN;
const engine = resolve('bitrix/module/upgrade.core/lib/demoengine.php');
const web = resolve('bitrix/module/upgrade.core/lib/demoweb.php');
const pin = 'a'.repeat(64);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const harness = String.raw`<?php
declare(strict_types=1);
require $argv[1]; require $argv[2];
$input=json_decode(file_get_contents('php://stdin'),true,128,JSON_THROW_ON_ERROR);
$snapshot=json_decode(file_get_contents($argv[3]),true,128,JSON_THROW_ON_ERROR);
$engine=new \Upgrade\Core\DemoEngine($snapshot,$argv[4],'demo-web');
$result=\Upgrade\Core\DemoWeb::handle($engine,$snapshot,$input);
if(getenv('DEMO_WEB_LOST_RESPONSE')==='1')exit(82);
echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
`;
function product(id = 'heat', overrides: any = {}): any {
  return { id, title: 'Тёплый пол <unsafe>', body_text: 'Наблюдаемое описание. Белый цвет.', request_target: '/products/' + id + '?a=1&a=2&empty=', is_product: true,
    category_ids: ['heating'], attributes: { brand: ['Observed'], color: ['белый'] }, variants: [],
    prices: [{ id: 'current', role: 'CURRENT', status: 'OBSERVED', raw_text: '2,50 руб.', money: { decimal: '2.50', currency: 'RUB', minor: 250 }, maximum: null, unit: 'piece', conditions: [], totals_eligible: true }],
    purchase: { price_id: 'current', min_quantity: '1', quantity_step: '1', max_quantity: '10', blockers: [] }, ...overrides };
}
function fixture(t: TestContext, items = [product()]) {
  const directory = mkdtempSync(join(tmpdir(), 'upgrade-demo-web-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const privateDir = join(directory, 'private'); mkdirSync(privateDir, { mode: 0o700 });
  const runner = join(directory, 'runner.php'), snapshotPath = join(directory, 'snapshot.json'); writeFileSync(runner, harness);
  const snapshot: any = { schema_version: 1, project_id: 'demo-web', snapshot_id: pin, items };
  const save = () => writeFileSync(snapshotPath, JSON.stringify(snapshot)); save();
  const args = ['-n', '-d', `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR ?? resolve('var/tools/php-8.3.35/ext')}`, '-d', 'extension=mbstring', '-d', 'disable_functions=mail,exec,shell_exec,system,passthru,popen,proc_open,curl_exec,fsockopen,pfsockopen,stream_socket_client', runner, engine, web, snapshotPath, privateDir];
  const defaults = { method: 'GET', request_target: '/__upgrade/cart', host: 'demo.example:8443', https: true, origin: null, cookie: null, body: '' };
  const raw = (request: any = {}, lost = false) => spawnSync(php!, args, { input: JSON.stringify({ ...defaults, ...request }), encoding: 'utf8', timeout: 20000, env: { ...process.env, DEMO_WEB_LOST_RESPONSE: lost ? '1' : '' } });
  const call = (request: any = {}) => { const result = raw(request); assert.equal(result.status, 0, result.stderr + result.stdout); assert.equal(result.stderr, ''); return JSON.parse(result.stdout); };
  const stateFiles = () => { const path = join(privateDir, 'demo-demo-web'); try { return readdirSync(path); } catch { return []; } };
  const body = (cookie: string) => JSON.parse(readFileSync(join(privateDir, 'demo-demo-web', sha('demo-web\0' + cookie) + '.json'), 'utf8')).body;
  const open = (request: any = {}) => { const response = call(request); assert.equal(response.status, 200, JSON.stringify(response)); const cookie = response.headers['Set-Cookie'].match(/^upgrade_demo_session=([a-f0-9]{64});/)[1]; return { response, cookie, csrf: response.view.csrf }; };
  const form = (opened: any, action = 'cart.add', fields: any = {}, key = 'idempotency-key-add-0001') => ({ action, csrf: opened.csrf, expected_snapshot_id: pin, idempotency_key: key, ...(action === 'cart.add' ? { item_id: 'heat', quantity: '1' } : {}), ...fields });
  const post = (opened: any, fields: any, request: any = {}) => ({ method: 'POST', request_target: '/__upgrade/action', origin: 'https://demo.example:8443', content_type: 'application/x-www-form-urlencoded', cookie: opened.cookie, body: new URLSearchParams(fields).toString(), ...request });
  return { directory, privateDir, snapshot, save, raw, call, stateFiles, body, open, form, post };
}

test('real PHP runtime has the required readonly session and receipt API', { skip: !php }, () => {
  const result = spawnSync(php!, ['-n', '-r', `require $argv[1]; echo json_encode([method_exists(\\Upgrade\\Core\\DemoEngine::class,'resumeSession'),method_exists(\\Upgrade\\Core\\DemoEngine::class,'receipt')]);`, engine], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), [true, true]);
});
test('search is UTF-8, preserves exact source targets and creates no session', { skip: !php }, t => {
  const f = fixture(t), result = f.call({ request_target: '/__upgrade/search?q=' + encodeURIComponent('Тёплый') + '&category=heating&sort=title_asc&page=1&a0=Observed' });
  assert.equal(result.status, 200); assert.equal(result.view.search.total, 1); assert.equal(result.view.search.items[0].request_target, '/products/heat?a=1&a=2&empty=');
  assert.equal(result.view.search.items[0].title, 'Тёплый пол <unsafe>'); assert.equal(result.headers['Set-Cookie'], undefined); assert.deepEqual(f.stateFiles(), []);
  assert.deepEqual(result.view.query.attributes, { a0: 'Observed' }); assert.equal(result.view.filters[1].name, 'color');
  assert.equal(f.call({ request_target: '/__upgrade/search?q=missing' }).view.search.status, 'NO_RESULTS');
});
test('GET scalar parsing rejects duplicates, encoded aliases, arrays, controls and malformed encoding', { skip: !php }, t => {
  const f = fixture(t);
  for (const query of ['q=a&q=b', 'q=a&%71=b', 'q[]=a', 'q=a&', 'q', 'q=%', 'q=%C3', 'q=%00', 'q=%0d%0a', 'sort=arbitrary', 'page=01', 'page=10001', 'a19=x', 'a0=not-observed', 'q=a;page=2&unexpected=1']) {
    const result = f.call({ request_target: '/__upgrade/search?' + query }); assert.equal(result.status, 400, query); assert.equal(result.view.kind, 'error');
  }
  assert.deepEqual(f.stateFiles(), []);
});
test('unknown route and methods return bounded statuses/Allow without a session', { skip: !php }, t => {
  const f = fixture(t);
  for (const path of ['/__upgrade/unknown', '/__upgrade/action/', '/__upgrade', '/__upgrade/%63art']) assert.equal(f.call({ request_target: path }).status, 404, path);
  assert.equal(f.call({ request_target: '/__upgrade/action' }).headers.Allow, 'POST');
  assert.equal(f.call({ method: 'POST', request_target: '/__upgrade/cart' }).headers.Allow, 'GET, HEAD');
  assert.equal(f.call({ method: 'DELETE' }).status, 405); assert.deepEqual(f.stateFiles(), []);
});
test('HEAD provides no body and creates no new session; source non-product returns null view', { skip: !php }, t => {
  const f = fixture(t, [product(), product('info', { is_product: false })]);
  for (const path of ['/__upgrade/search', '/__upgrade/cart', '/__upgrade/lead', '/products/heat']) {
    const result = f.call({ method: 'HEAD', request_target: path, item_id: 'heat' }); assert.equal(result.status, 200); assert.equal(result.view, null); assert.equal(result.headers['Set-Cookie'], undefined);
  }
  assert.equal(f.call({ method: 'HEAD', request_target: '/__upgrade/receipt?operation=' + 'b'.repeat(64) }).status, 404);
  assert.equal(f.call({ request_target: '/info?a=1&a=2', item_id: 'info' }).view, null); assert.deepEqual(f.stateFiles(), []);
});
test('session is server-random, cookie flags follow trusted HTTPS, unknown cookie cannot fixate', { skip: !php }, t => {
  const f = fixture(t), fixed = 'e'.repeat(64), opened = f.open({ cookie: fixed });
  assert.notEqual(opened.cookie, fixed); assert.match(opened.response.headers['Set-Cookie'], /; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
  assert.equal(f.stateFiles().length, 2); assert.ok(!f.stateFiles().some(path => path.startsWith(sha('demo-web\0' + fixed))));
  const resumed = f.call({ cookie: opened.cookie }); assert.equal(resumed.view.csrf, opened.csrf); assert.equal(resumed.headers['Set-Cookie'], undefined);
  const plain = f.open({ https: false, host: 'localhost:8080', cookie: 'x=y; attack=1' }); assert.doesNotMatch(plain.response.headers['Set-Cookie'], /Secure/); assert.notEqual(plain.cookie, opened.cookie);
});
test('invalid or unknown POST cookie does not create state or emit a session cookie', { skip: !php }, t => {
  const f = fixture(t), fake = { cookie: 'e'.repeat(64), csrf: 'b'.repeat(64) };
  for (const cookie of [null, '', 'A'.repeat(64), fake.cookie, 'x=y; x=z']) {
    const result = f.call(f.post(fake, f.form(fake), { cookie })); assert.equal(result.status, 403); assert.equal(result.headers['Set-Cookie'], undefined);
  }
  assert.deepEqual(f.stateFiles(), []);
});
test('POST requires exact Origin, encoding and no query parameters', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), fields = f.form(o);
  for (const origin of [null, 'null', 'https://evil.example', 'http://demo.example:8443', 'https://demo.example:8443/', 'https://demo.example:8443.evil']) assert.equal(f.call(f.post(o, fields, { origin })).status, 403, String(origin));
  for (const content_type of [undefined, 'application/json', 'multipart/form-data; boundary=x', 'application/x-www-form-urlencoded; charset=iso-8859-1']) assert.equal(f.call(f.post(o, fields, { content_type })).status, 415);
  assert.equal(f.call(f.post(o, fields, { request_target: '/__upgrade/action?x=1' })).status, 400); assert.equal(f.body(o.cookie).revision, 0);
});
test('CSRF binds the actual existing session and never accepts client snapshot as authority', { skip: !php }, t => {
  const f = fixture(t), a = f.open(), b = f.open();
  assert.equal(f.call(f.post(a, f.form(a, 'cart.add', { csrf: b.csrf }))).status, 403);
  assert.equal(f.call(f.post(a, f.form(a, 'cart.add', { expected_snapshot_id: 'b'.repeat(64) }))).status, 409);
  assert.equal(f.call(f.post(a, f.form(a, 'cart.add', { expected_snapshot_id: '' }))).status, 400); assert.equal(f.body(a.cookie).revision, 0);
});
test('strict POST key parser rejects pollution, PII and amount injection before mutation', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), request = f.post(o, f.form(o));
  for (const body of [request.body + '&quantity=2', request.body + '&%71uantity=2', request.body + '&price=0.01', request.body + '&email=real%40example.com', request.body + '&quantity%5B%5D=2', request.body + '&csrf=%00', request.body + '&phone=123', request.body + '&return=https%3A%2F%2Fevil.example']) assert.equal(f.call({ ...request, body }).status, 400, body);
  assert.equal(f.body(o.cookie).revision, 0);
});
test('cart add/update/remove use 303 PRG and exact replay does not add twice', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), request = f.post(o, f.form(o)), first = f.call(request), replay = f.call(request);
  assert.equal(first.status, 303); assert.equal(first.view, null); assert.deepEqual(replay, first); assert.match(first.headers.Location, /^\/__upgrade\/cart\?operation=[a-f0-9]{64}$/);
  const page = f.call({ cookie: o.cookie, request_target: first.headers.Location }); assert.equal(page.view.cart.lines[0].quantity, '1'); assert.equal(page.view.cart.total.decimal, '2.50'); assert.equal(f.body(o.cookie).revision, 1);
  const line = page.view.cart.lines[0].line_id;
  assert.equal(f.call(f.post(o, f.form(o, 'cart.update', { line_id: line, quantity: '2' }, 'idempotency-update-0001'))).status, 303);
  assert.equal(f.call({ cookie: o.cookie }).view.cart.total.decimal, '5.00');
  assert.equal(f.call(f.post(o, f.form(o, 'cart.remove', { line_id: line }, 'idempotency-remove-0001'))).status, 303);
  assert.deepEqual(f.call({ cookie: o.cookie }).view.cart.lines, []); assert.equal(f.body(o.cookie).revision, 3);
});
test('idempotency conflict does not mutate and same old intent replays across snapshot changes', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), fields = f.form(o), first = f.call(f.post(o, fields));
  assert.equal(f.call(f.post(o, { ...fields, quantity: '2' })).status, 409);
  f.snapshot.snapshot_id = 'b'.repeat(64); f.save();
  assert.deepEqual(f.call(f.post(o, fields)), first); assert.equal(f.body(o.cookie).revision, 1);
  assert.equal(f.call(f.post(o, { ...fields, idempotency_key: 'idempotency-new-0002' })).status, 409);
});
test('synthetic lead PRG receipt is durable, session-bound, and read-only', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), fields = f.form(o, 'demo.lead', { synthetic: '1', identity: 'demo-customer', consent: '1', topic: 'product-question', item_id: 'heat' });
  const response = f.call(f.post(o, fields)); assert.equal(response.status, 303); assert.match(response.headers.Location, /^\/__upgrade\/receipt\?operation=/);
  const before = f.body(o.cookie), receipt = f.call({ cookie: o.cookie, request_target: response.headers.Location });
  assert.equal(receipt.status, 200); assert.equal(receipt.view.record.kind, 'demo.lead'); assert.equal(receipt.view.record.contact.email, 'demo@example.invalid');
  assert.equal(receipt.view.record.message_sent, false); assert.equal(receipt.view.record.native_order_created, false); assert.equal(receipt.view.record.payment_attempted, false);
  assert.deepEqual(f.body(o.cookie), before); assert.deepEqual(f.call(f.post(o, fields)), response);
  const other = f.open(); assert.equal(f.call({ cookie: other.cookie, request_target: response.headers.Location }).status, 404);
  assert.equal(f.call({ request_target: response.headers.Location }).status, 404); assert.equal(f.call({ cookie: o.cookie, request_target: '/__upgrade/receipt' }).status, 404);
});
test('synthetic consent and allowed identity/topic are enforced without personal-data fields', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), good = f.form(o, 'demo.lead', { synthetic: '1', identity: 'demo-customer', consent: '1', topic: 'general' });
  for (const changes of [{ synthetic: 'true' }, { consent: '0' }, { identity: 'real-name' }, { topic: 'free text' }, { name: 'real name' }, { note: 'anything' }]) assert.equal(f.call(f.post(o, { ...good, ...changes })).status, 400);
  assert.equal(f.body(o.cookie).revision, 0);
});
test('unknown price remains null through checkout and receipt while real effects remain false', { skip: !php }, t => {
  const f = fixture(t, [product('heat', { prices: [], purchase: { price_id: null, min_quantity: null, quantity_step: null, max_quantity: null, blockers: ['UNKNOWN'] } })]), o = f.open();
  f.call(f.post(o, f.form(o))); const cart = f.call({ cookie: o.cookie }).view.cart; assert.equal(cart.total, null); assert.equal(cart.pricing_status, 'REQUIRES_CONFIRMATION');
  const result = f.call(f.post(o, f.form(o, 'demo.checkout', { synthetic: '1', identity: 'demo-customer', consent: '1', delivery: 'demo-pickup', payment: 'demo-none' }, 'checkout-key-000001')));
  assert.equal(result.status, 303); const record = f.call({ cookie: o.cookie, request_target: result.headers.Location }).view.record;
  assert.equal(record.total, null); assert.equal(record.pricing_status, 'REQUIRES_CONFIRMATION'); assert.equal(record.cart.lines[0].unit, null);
  assert.deepEqual([record.native_order_created, record.message_sent, record.payment_attempted], [false, false, false]); assert.deepEqual(f.call({ cookie: o.cookie }).view.cart.lines, []);
});
test('lost HTTP response after real PHP commit returns same receipt without another record', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), fields = f.form(o, 'demo.lead', { synthetic: '1', identity: 'demo-customer', consent: '1', topic: 'general' }), request = f.post(o, fields);
  const lost = f.raw(request, true); assert.equal(lost.status, 82); assert.equal(lost.stdout, ''); assert.equal(lost.stderr, '');
  const response = f.call(request); assert.equal(response.status, 303); const receipt = f.call({ cookie: o.cookie, request_target: response.headers.Location }); assert.equal(receipt.status, 200);
  assert.equal(f.body(o.cookie).revision, 1); assert.equal(Object.keys(f.body(o.cookie).synthetic_records).length, 1); assert.equal(Object.keys(f.body(o.cookie).operations).length, 1);
});
test('product and real observed variant IDs work without inventing combinations', { skip: !php }, t => {
  const variant = { ...product('v'), id: 'observed-size' }, f = fixture(t, [product('heat', { variants: [variant] })]);
  const o = f.open({ request_target: '/products/heat?a=1&a=2&empty=', item_id: 'heat' }); assert.equal(o.response.view.kind, 'product'); assert.equal(o.response.view.item.variants[0].id, 'observed-size');
  assert.equal(f.call(f.post(o, f.form(o))).status, 422); assert.equal(f.call(f.post(o, f.form(o, 'cart.add', { variant_id: 'made-up' }))).status, 422);
  assert.equal(f.call(f.post(o, f.form(o, 'cart.add', { variant_id: 'observed-size' }))).status, 303); assert.equal(f.body(o.cookie).revision, 1);
});
test('corrupt persisted state exposes a fixed safe error and does not reset state', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), path = join(f.privateDir, 'demo-demo-web', sha('demo-web\0' + o.cookie) + '.json');
  const raw = '<script>sourceAttack()</script> secret-path'; writeFileSync(path, raw);
  const result = f.call({ cookie: o.cookie }); assert.equal(result.status, 500); assert.equal(result.view.error_code, 'DEMO_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(result), /sourceAttack|secret-path|STATE_CORRUPT/); assert.equal(readFileSync(path, 'utf8'), raw);
});
test('bounded input/host validation and empty checkout fail without mutation', { skip: !php }, t => {
  const f = fixture(t), o = f.open();
  assert.equal(f.call({ body: 'a'.repeat(8193) }).status, 413); assert.equal(f.call({ request_target: '/__upgrade/search?' + Array.from({ length: 33 }, (_, i) => 'q' + i + '=x').join('&') }).status, 413);
  for (const host of ['evil/user', 'demo.example\r\nInjected: yes', 'a:99999', 'https://demo.example', 'a@evil']) assert.equal(f.call({ host }).status, 400, host);
  assert.equal(f.call({ body: 'action=demo.checkout' }).status, 400);
  assert.equal(f.call(f.post(o, f.form(o, 'demo.checkout', { synthetic: '1', consent: '1', identity: 'demo-customer', delivery: 'demo-pickup', payment: 'demo-none' })) ).status, 422); assert.equal(f.body(o.cookie).revision, 0);
});
test('headers and source guard do not enable external calls or native orders', { skip: !php }, t => {
  const f = fixture(t), response = f.call({ request_target: '/__upgrade/search' });
  assert.equal(response.headers['Cache-Control'], 'no-store'); assert.equal(response.headers['Referrer-Policy'], 'same-origin'); assert.match(response.headers['X-Robots-Tag'], /noindex/);
  const source = readFileSync(web, 'utf8'); assert.doesNotMatch(source, /\b(?:mail|fsockopen|pfsockopen|stream_socket_client|curl_exec|exec|shell_exec|system|proc_open|header|setcookie|session_start)\s*\(/); assert.doesNotMatch(source, /\b(?:CEvent|CUser|CSaleOrder|CSaleBasket)\b|\\Sale\\/);
});
test('facet presentation is deterministic and bounded without removing snapshot facts', { skip: !php }, t => {
  const attributes = Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['observed-' + String(i).padStart(2, '0'), ['value']]));
  const items = Array.from({ length: 202 }, (_, i) => product('p' + i, { category_ids: ['category-' + String(i).padStart(3, '0')], attributes: { ...attributes, 'observed-00': ['value-' + String(i).padStart(3, '0')] } }));
  const f = fixture(t, items), view = f.call({ request_target: '/__upgrade/search' }).view;
  assert.equal(view.facets_limited, true); assert.equal(view.filters.length, 20); assert.equal(view.categories.length, 200); assert.equal(view.filters[0].values.length, 200);
  assert.equal(view.filters[0].key, 'a0'); assert.equal(view.filters[0].name, 'observed-00'); assert.equal(view.filters[19].name, 'observed-19');
  assert.equal(view.search.total, 202); assert.equal(Object.keys(view.items).length, 202); assert.deepEqual(view.items.p201.attributes['observed-20'], ['value']);
  f.snapshot.items.reverse(); f.save(); const reversed = f.call({ request_target: '/__upgrade/search' }).view;
  assert.deepEqual(reversed.filters, view.filters); assert.deepEqual(reversed.categories, view.categories); assert.deepEqual(f.stateFiles(), []);
});
test('receipt lookup rejects malformed IDs and cross-kind receipts without creating records', { skip: !php }, t => {
  const f = fixture(t), o = f.open(), cart = f.call(f.post(o, f.form(o)));
  const operation = cart.headers.Location.split('=')[1], before = f.body(o.cookie);
  assert.equal(f.call({ cookie: o.cookie, request_target: '/__upgrade/receipt?operation=' + operation }).status, 404);
  assert.equal(f.call({ cookie: o.cookie, request_target: '/__upgrade/receipt?operation=' + 'e'.repeat(64) }).status, 404);
  for (const suffix of ['operation=x', 'operation=' + operation + '&operation=' + operation, 'operation%5B%5D=x', 'operation=' + operation + '&email=x']) assert.equal(f.call({ cookie: o.cookie, request_target: '/__upgrade/receipt?' + suffix }).status, 400);
  const head = f.call({ method: 'HEAD', cookie: o.cookie, request_target: cart.headers.Location }); assert.equal(head.status, 200); assert.equal(head.view, null);
  assert.deepEqual(f.body(o.cookie), before);
});
test('lead context and product errors preserve routing and never accept a redirect target', { skip: !php }, t => {
  const f = fixture(t);
  assert.equal(f.call({ request_target: '/__upgrade/lead?item_id=unknown' }).status, 404); assert.deepEqual(f.stateFiles(), []);
  const o = f.open({ request_target: '/__upgrade/lead?item_id=heat' }); assert.equal(o.response.view.item.id, 'heat'); assert.equal(o.response.view.query.item_id, 'heat');
  assert.equal(f.call({ cookie: o.cookie, request_target: '/__upgrade/cart?return=%2F%2Fevil.example' }).status, 400);
  assert.equal(f.call(f.post(o, f.form(o, 'cart.add', { quantity: '0' }))).status, 422); assert.equal(f.body(o.cookie).revision, 0);
});
test('category filter labels use the exact observed category item title', { skip: !php }, t => {
  const category = product('heating', { is_product: false, title: 'Наблюдаемая категория <unsafe>', category_ids: [], attributes: {} });
  const f = fixture(t, [product(), category]);
  const view = f.call({ request_target: '/__upgrade/search?category=heating' }).view;
  assert.deepEqual(view.categories, [{ id: 'heating', label: category.title }]); assert.equal(view.search.total, 1); assert.equal(view.search.items[0].id, 'heat');
});
