#!/usr/bin/env node
/** Bounded Upgrade demo browser QA. Source sites, CMS administration and the DB are never accessed. */
import { createHash, randomBytes } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { load } from 'cheerio';

const SELF = fileURLToPath(import.meta.url);
const HEX = /^[a-f0-9]{64}$/;
const WIDTHS = [360, 390, 768, 1024, 1440];
const OWN = new Set(['/__upgrade/search', '/__upgrade/cart', '/__upgrade/lead', '/__upgrade/receipt']);
const FIELDS = {
  'cart.add': ['item_id', 'variant_id', 'quantity'], 'cart.update': ['line_id', 'quantity'], 'cart.remove': ['line_id'],
  'demo.checkout': ['synthetic', 'identity', 'consent', 'delivery', 'payment'], 'demo.lead': ['synthetic', 'identity', 'consent', 'topic', 'item_id'],
};
export class VerifyError extends Error { constructor(code) { super(code); this.name = 'VerifyError'; } }
function need(ok, code) { if (!ok) throw new VerifyError(code); }
export const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
function noSymlinks(path) {
  let current = resolve(path);
  while (true) { need(!lstatSync(current).isSymbolicLink(), 'SYMLINK_PATH'); const parent = dirname(current); if (current === parent) break; current = parent; }
}
function privateMode(info, directory = false) {
  if (process.platform !== 'win32') need((info.mode & 0o077) === 0 && info.uid === process.getuid(), directory ? 'PRIVATE_DIRECTORY_REQUIRED' : 'PRIVATE_FILE_REQUIRED');
}
function bytes(path, maximum, secret = false) {
  noSymlinks(path); const info = lstatSync(path);
  need(info.isFile() && info.nlink === 1 && info.size <= maximum, 'INPUT_FILE_INVALID'); if (secret) privateMode(info);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const opened=fstatSync(fd); need(opened.dev===info.dev && opened.ino===info.ino && opened.isFile() && opened.nlink===1,'INPUT_FILE_CHANGED'); const data = readFileSync(fd); need(data.length <= maximum, 'INPUT_FILE_LIMIT'); return data; } finally { closeSync(fd); }
}
function syncDirectory(path) { if (process.platform !== 'win32') { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } }
function durable(path, value, immutable = false) {
  const target = immutable ? path : path + '.' + randomBytes(8).toString('hex') + '.tmp';
  const fd = openSync(target, 'wx', 0o600);
  try { writeFileSync(fd, json(value)); fsyncSync(fd); } finally { closeSync(fd); }
  if (!immutable) renameSync(target, path);
  syncDirectory(dirname(path));
}
export function safeTarget(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 8192 && value.startsWith('/') && !value.startsWith('//') && !/[\x00-\x20\x7f-\uffff\\#]/.test(value) && !/%(?![a-f0-9]{2})/i.test(value), 'TARGET_INVALID');
  const parsed = new URL(value, 'https://upgrade.invalid');
  need(parsed.href === 'https://upgrade.invalid' + value && !/%00/i.test(parsed.pathname), 'TARGET_NORMALIZED');
  return value;
}
export function readInputs(options) {
  need(options && typeof options === 'object', 'OPTIONS_REQUIRED');
  need(typeof options.origin === 'string', 'ORIGIN_REQUIRED'); const url = new URL(options.origin);
  need(url.origin === options.origin && !url.username && !url.password && (url.protocol === 'https:' || (options.allowLoopbackHttp === true && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))), 'ORIGIN_INVALID');
  need(typeof options.user === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(options.user), 'USER_INVALID');
  need(HEX.test(options.snapshotSha256 ?? ''), 'SNAPSHOT_PIN_REQUIRED');
  const raw = bytes(options.snapshot, 16 * 1024 * 1024); need(sha(raw) === options.snapshotSha256, 'SNAPSHOT_HASH_MISMATCH');
  let snapshot; try { snapshot = JSON.parse(raw.toString('utf8')); } catch { throw new VerifyError('SNAPSHOT_JSON_INVALID'); }
  need(snapshot?.schema_version === 1 && /^[a-zA-Z0-9_-]{1,100}$/.test(snapshot.project_id ?? '') && HEX.test(snapshot.snapshot_id ?? '') && Array.isArray(snapshot.items) && snapshot.items.length > 0 && snapshot.items.length <= 10000, 'SNAPSHOT_INVALID');
  need(sha(JSON.stringify({ schema_version: 1, project_id: snapshot.project_id, items: snapshot.items })) === snapshot.snapshot_id, 'SNAPSHOT_ID_MISMATCH');
  const targets = new Set(), ids = new Set();
  for (const item of snapshot.items) {
    need(typeof item.id === 'string' && item.id.length <= 160 && item.id.length > 0 && !ids.has(item.id) && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 10000 && typeof item.is_product === 'boolean' && ['HOME','CATEGORY','PRODUCT','CONTENT'].includes(item.page_kind), 'ITEM_INVALID');
    safeTarget(item.request_target); need(!item.request_target.startsWith('/__upgrade') && !targets.has(item.request_target), 'ITEM_ROUTE_CONFLICT');
    ids.add(item.id); targets.add(item.request_target);
  }
  const product = options.productRoute ? snapshot.items.find((item) => item.request_target === options.productRoute && item.is_product) : snapshot.items.find((item) => item.is_product && !(item.variants?.length));
  need(product, 'PRODUCT_REQUIRED');
  const password = bytes(options.passwordFile, 1024, true).toString('utf8').replace(/\r?\n$/, '');
  need(password.length >= 8 && password.length <= 512 && !/[\r\n\x00]/.test(password), 'PASSWORD_FILE_INVALID');
  need(typeof options.output === 'string' && isAbsolute(options.output), 'ABSOLUTE_OUTPUT_REQUIRED');
  noSymlinks(dirname(options.output));
  return { snapshot, targets, product, password, origin: url.origin, localOnly: url.protocol !== 'https:', binding: { schema_version: 1, verifier_sha256: sha(bytes(SELF, 256 * 1024)), snapshot_sha256: options.snapshotSha256, snapshot_id: snapshot.snapshot_id, project_id: snapshot.project_id, origin: url.origin, user: options.user, product_route: product.request_target, local_only: url.protocol !== 'https:' } };
}
export function readAllowed(target, inputs, resource = 'document') {
  safeTarget(target); const url = new URL(target, inputs.origin);
  if (inputs.targets.has(target)) return resource === 'document';
  if (resource !== 'document') return !url.search && (url.pathname === '/local/templates/upgrade/styles.css' || new RegExp('^/upload/upgrade/' + inputs.snapshot.project_id + '/[a-f0-9]{64}\\.[A-Za-z0-9]{1,8}$').test(url.pathname));
  if (!OWN.has(url.pathname)) return false;
  const pairs = [...url.searchParams], keys = pairs.map(([key]) => key);
  if (new Set(keys).size !== keys.length || keys.length > 25) return false;
  if (url.pathname === '/__upgrade/search') return pairs.every(([key, value]) => /^(q|category|sort|page|a(?:[0-9]|1[0-9]))$/.test(key) && value.length <= 1000);
  if (url.pathname === '/__upgrade/lead') return pairs.length === 0 || (pairs.length === 1 && pairs[0][0] === 'item_id' && inputs.snapshot.items.some((item) => item.id === pairs[0][1]));
  return pairs.length === 0 ? url.pathname === '/__upgrade/cart' : pairs.length === 1 && pairs[0][0] === 'operation' && HEX.test(pairs[0][1]);
}
export function validateForm(form, inputs, action) {
  need(form && form.method?.toLowerCase() === 'post' && form.action === '/__upgrade/action' && Array.isArray(form.fields), 'FORM_BOUNDARY_INVALID');
  const fields = Object.fromEntries(form.fields);
  need(Object.keys(fields).length === form.fields.length && form.fields.length <= 16 && fields.action === action && Object.hasOwn(FIELDS, action), 'FORM_FIELDS_INVALID');
  need(Object.keys(fields).every((key) => ['action', 'csrf', 'expected_snapshot_id', 'idempotency_key', ...FIELDS[action]].includes(key)), 'FORM_UNEXPECTED_FIELD');
  need(form.fields.every(([key,value]) => typeof key === 'string' && typeof value === 'string' && value.length <= 2000 && !/[\x00-\x1f\x7f]/.test(value)), 'FORM_VALUE_INVALID');
  need(HEX.test(fields.csrf ?? '') && fields.expected_snapshot_id === inputs.snapshot.snapshot_id && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(fields.idempotency_key ?? ''), 'FORM_BINDING_INVALID');
  if (action === 'cart.add') {
    need(fields.item_id === inputs.product.id, 'FORM_ITEM_INVALID');
    const variants = inputs.product.variants ?? [];
    need(!variants.length ? !fields.variant_id : variants.some((variant) => variant.id === fields.variant_id), 'FORM_VARIANT_INVALID');
  }
  if (action === 'cart.update' || action === 'cart.remove') need(HEX.test(fields.line_id ?? ''), 'FORM_LINE_INVALID');
  if (action === 'cart.add' || action === 'cart.update') need(/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,6})?$/.test(fields.quantity ?? '') && Number(fields.quantity) > 0 && Number(fields.quantity) <= 10000, 'FORM_QUANTITY_INVALID');
  if (action.startsWith('demo.')) {
    need(fields.synthetic === '1' && fields.identity === 'demo-customer' && fields.consent === '1', 'FORM_SYNTHETIC_REQUIRED');
    if (action === 'demo.checkout') need(fields.delivery === 'demo-pickup' && fields.payment === 'demo-none', 'FORM_CHECKOUT_INVALID');
    else need(['general','product-question','delivery'].includes(fields.topic) && (!fields.item_id || fields.item_id === inputs.product.id), 'FORM_LEAD_INVALID');
  }
  return fields;
}
export function filterSetCookies(values, secure) {
  const own = values.filter((value) => /^\s*upgrade_demo_session(?:\s*=|\s*;|\s*$)/i.test(value));
  need(own.length <= 1, 'COOKIE_DUPLICATE'); if (!own.length) return null;
  const chunks = own[0].split(';').map((part) => part.trim());
  need(/^upgrade_demo_session=[a-f0-9]{64}$/.test(chunks.shift()), 'COOKIE_INVALID');
  const expected = ['path=/','httponly','samesite=strict', ...(secure ? ['secure'] : [])].sort();
  need(JSON.stringify(chunks.map((part) => part.toLowerCase()).sort()) === JSON.stringify(expected), 'COOKIE_ATTRIBUTES_INVALID');
  return own[0];
}
export function forwardedHeaders(headers) {
  need(!/(?:^|;)\s*report-(?:uri|to)\b/i.test(headers['content-security-policy'] ?? ''), 'RESPONSE_REPORTING_BLOCKED');
  const allowed = new Set(['content-type','content-length','content-encoding','cache-control','x-robots-tag','x-content-type-options','content-security-policy','referrer-policy','location']);
  // Drop Link/Refresh/Report-To/NEL/Alt-Svc and every other unsolicited browser
  // transport directive. Cookies are added separately after exact validation.
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.has(key)).map(([key,value]) => [key,Array.isArray(value)?value.join(', '):value]));
}
/** One explicit request; no redirect handling, cookie jar, decompression or retry. */
export function boundedFetch(url, { method, headers, body, timeout = 10000, maximum = 12 * 1024 * 1024 }) {
  return new Promise((resolveResponse, reject) => {
    let finished = false, response, timer;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); if (error) { response?.destroy(); request.destroy(); reject(error); } else resolveResponse(value); };
    const request = (url.startsWith('https:') ? httpsRequest : httpRequest)(url, { method, headers, agent: false }, (incoming) => {
      response = incoming; const length = incoming.headers['content-length'];
      if (length && (!/^[0-9]+$/.test(length) || Number(length) > maximum)) return finish(new VerifyError('RESPONSE_LIMIT'));
      const chunks = []; let size = 0;
      incoming.on('data', (chunk) => { size += chunk.length; if (size > maximum) finish(new VerifyError('RESPONSE_LIMIT')); else chunks.push(chunk); });
      incoming.on('error', () => finish(new VerifyError('TRANSPORT_READ_FAILED')));
      incoming.on('aborted', () => finish(new VerifyError('TRANSPORT_READ_FAILED')));
      incoming.on('end', () => finish(null, { status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', () => finish(new VerifyError('TRANSPORT_REQUEST_FAILED')));
    timer = setTimeout(() => finish(new VerifyError('TRANSPORT_ABSOLUTE_TIMEOUT')), timeout);
    request.end(body ?? undefined);
  });
}
export function openJournal(output, binding, reconcile = false) {
  if (!reconcile) { need(!existsSync(output), 'OUTPUT_ALREADY_EXISTS'); mkdirSync(output, { mode: 0o700 }); syncDirectory(dirname(output)); }
  noSymlinks(output); need(lstatSync(output).isDirectory(), 'OUTPUT_INVALID'); privateMode(lstatSync(output), true);
  const lockPath = join(output, 'writer.sqlite');
  if (existsSync(lockPath)) { need(lstatSync(lockPath).isFile() && lstatSync(lockPath).nlink === 1, 'LOCK_FILE_INVALID'); privateMode(lstatSync(lockPath)); }
  else { const fd = openSync(lockPath, 'wx', 0o600); closeSync(fd); }
  const lock = new DatabaseSync(lockPath); try { lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;'); } catch { lock.close(); throw new VerifyError('OUTPUT_BUSY'); }
  try {
    const path = join(output, 'private-checkpoint.json'); let state;
    if (reconcile) {
      state = JSON.parse(bytes(path, 4 * 1024 * 1024, true)); need(JSON.stringify(state.binding) === JSON.stringify(binding) && Array.isArray(state.operations) && state.operations.length <= 20 && Array.isArray(state.checks), 'CHECKPOINT_BINDING_INVALID');
      const names = new Set();
      for (const operation of state.operations) {
        need(/^[a-z0-9-]{1,60}$/.test(operation.name ?? '') && !names.has(operation.name) && ['UNKNOWN','CONFIRMED','CONFIRMED_BY_READBACK'].includes(operation.status), 'CHECKPOINT_OPERATION_INVALID'); names.add(operation.name);
        const intent = JSON.parse(bytes(join(output, 'intent-' + operation.name + '.json'), 128 * 1024, true));
        for (const key of ['name','action','operation_id','body_sha256','fields','intended_at']) need(JSON.stringify(intent[key]) === JSON.stringify(operation[key]), 'CHECKPOINT_INTENT_MISMATCH');
        need(intent.status === 'UNKNOWN', 'CHECKPOINT_INTENT_MISMATCH');
      }
      const persisted = readdirSync(output).filter((name) => name.startsWith('intent-') && name.endsWith('.json'));
      need(persisted.length === names.size && persisted.every((name) => names.has(name.slice(7,-5))), 'ORPHAN_INTENT_REQUIRES_REVIEW');
    }
    else { state = { schema_version: 1, binding, status: 'RUNNING', operations: [], checks: [], cookie: null }; durable(path, state, true); }
    const save = () => { durable(path, state); };
    const record = (name, value) => { need(/^[a-z0-9-]+\.json$/.test(name), 'RECEIPT_NAME_INVALID'); durable(join(output, name), value, true); };
    return { state, save, record, close() { lock.exec('ROLLBACK'); lock.close(); } };
  } catch (error) { lock.close(); throw error; }
}
function operationTarget(operation) { return '/__upgrade/' + (operation.action.startsWith('cart.') ? 'cart' : 'receipt') + '?operation=' + operation.operation_id; }
function quantityUpdate(value, purchase = {}) {
  const micro = (text) => { const [whole, frac=''] = String(text).split('.'); return BigInt(whole) * 1000000n + BigInt(frac.padEnd(6,'0')); };
  const current = micro(value), step = purchase.quantity_step ? micro(purchase.quantity_step) : 1000000n;
  const maximum = purchase.max_quantity ? micro(purchase.max_quantity) : 10000000000n;
  const next = current + step <= maximum && current + step <= 10000000000n ? current + step : current;
  return String(next / 1000000n) + (next % 1000000n ? '.' + String(next % 1000000n).padStart(6,'0').replace(/0+$/,'') : '');
}

export async function runVerifier(options) {
  const inputs = readInputs(options);
  need(process.platform !== 'win32' || inputs.localOnly, 'POSIX_PRIVATE_OUTPUT_REQUIRED');
  const output = resolve(options.output), journal = openJournal(output, inputs.binding, options.reconcile === true);
  let browser, context, page, permittedPost = null, networkFailure = null;
  const started = Date.now(), counters = { cdp_request_intercepts: 0, browser_requests: 0, browser_responses: 0, mediated_fetches: 0, response_bytes: 0, blocked: 0 }, exchanges = [];
  const tasks = new Set();
  function fail(code) { if (!networkFailure) networkFailure = code; }
  function healthy() { need(Date.now() - started <= 240000, 'RUN_TIME_LIMIT'); need(!networkFailure, networkFailure ?? 'NETWORK_BOUNDARY'); }
  function check(id, details) { journal.state.checks.push({ id, status: 'PASS', details }); journal.save(); }
  async function rememberCookie() {
    const all = await context.cookies(inputs.origin), own = all.filter((cookie) => cookie.name === 'upgrade_demo_session');
    need(own.length === 1 && HEX.test(own[0].value) && own[0].path === '/' && own[0].httpOnly && own[0].sameSite === 'Strict' && own[0].secure === !inputs.localOnly, 'SESSION_COOKIE_INVALID');
    journal.state.cookie = { name: own[0].name, value: own[0].value, url: inputs.origin + '/', httpOnly: true, sameSite: 'Strict', secure: !inputs.localOnly }; journal.save();
  }
  async function go(target, expected = 200) {
    need(readAllowed(target, inputs), 'NAVIGATION_BOUNDARY'); healthy();
    const response = await page.goto(inputs.origin + target, { waitUntil: 'networkidle', timeout: 15000 });
    healthy(); need(response?.status() === expected, 'HTTP_STATUS_INVALID');
    need(page.url() === inputs.origin + target, 'UNEXPECTED_REDIRECT');
    need(/noindex/i.test(response.headers()['x-robots-tag'] ?? ''), 'NOINDEX_MISSING'); return response;
  }
  async function pictures(name) {
    for (const width of WIDTHS) {
      healthy(); await page.setViewportSize({ width, height: 1000 });
      const facts = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        main: document.querySelectorAll('main').length,
        h1: [...document.querySelectorAll('h1')].filter((node) => node.textContent.trim()).length,
        labels: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].every((node) => node.labels?.length || node.getAttribute('aria-label')?.trim() || node.getAttribute('aria-labelledby')?.split(/\s+/).every((id) => document.getElementById(id)?.textContent?.trim())),
        ids: [...document.querySelectorAll('[id]')].map((node) => node.id),
        buttons: [...document.querySelectorAll('button')].every((node) => (node.getAttribute('aria-label') || node.textContent).trim().length > 0),
      }));
      need(!facts.overflow && facts.main === 1 && facts.h1 === 1 && facts.labels && facts.buttons && new Set(facts.ids).size === facts.ids.length, 'LAYOUT_ACCESSIBILITY_CHECK_FAILED');
      const file = `${name}-${width}.png`; need(!existsSync(join(output, file)), 'SCREENSHOT_ALREADY_EXISTS');
      const raw = await page.screenshot({ fullPage: false, timeout: 10000 }); const fd = openSync(join(output,file), 'wx', 0o600); try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
      journal.record(`${name}-${width}.json`, { width, height: 1000, file, sha256: sha(raw), size: raw.length, checks: facts, viewport_only: true });
    }
    check(name + '-responsive', { widths: WIDTHS, viewport_only: true, accessibility: 'bounded DOM label/heading/name checks; not a full WCAG audit' });
  }
  async function getForm(action) {
    const forms = page.locator('.demo-view form').filter({ has: page.locator(`input[name="action"][value="${action}"]`) });
    need(await forms.count() > 0, 'OWN_FORM_MISSING'); const form = forms.first();
    if (await form.locator('input[name=consent]').count()) await form.locator('input[name=consent]').check();
    return form;
  }
  async function mutate(name, action, configure) {
    healthy(); const form = await getForm(action); if (configure) await configure(form);
    const observed = await form.evaluate((node) => ({ method: node.getAttribute('method'), action: node.getAttribute('action'), fields: [...new FormData(node)].map(([key,value]) => [key,String(value)]) }));
    const fields = validateForm(observed, inputs, action); await rememberCookie();
    const operation = { name, action, operation_id: sha(fields.idempotency_key), body_sha256: sha(new URLSearchParams(observed.fields).toString()), fields: observed.fields, status: 'UNKNOWN', intended_at: new Date().toISOString(), location: null };
    need(!journal.state.operations.some((entry) => entry.operation_id === operation.operation_id), 'OPERATION_DUPLICATE');
    journal.record(`intent-${name}.json`, operation); journal.state.operations.push(operation); journal.save();
    permittedPost = operation;
    try {
      const destination = inputs.origin + operationTarget(operation);
      await Promise.all([page.waitForURL(destination, { waitUntil: 'networkidle', timeout: 15000 }), form.locator('button[type=submit]').click({ timeout: 10000 })]);
      healthy(); need(operation.post_status === 303 && operation.location === operationTarget(operation), 'PRG_NOT_CONFIRMED');
      const response = await go(operationTarget(operation)); need(response.status() === 200, 'OPERATION_RECONCILIATION_FAILED');
      if (action.startsWith('demo.')) need(await page.locator('.demo-receipt').count() === 1 && await page.locator('.demo-receipt h1').innerText() === 'Демо-запись сохранена', 'SYNTHETIC_RECEIPT_MISSING');
      operation.status = 'CONFIRMED'; operation.confirmed_at = new Date().toISOString(); journal.save();
      journal.record(`operation-${name}.json`, { operation_id: operation.operation_id, action, status: 'CONFIRMED', location: operation.location });
      return fields;
    } finally { permittedPost = null; }
  }
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false, viewport: { width: 1440, height: 1000 } });
    if (options.reconcile && journal.state.cookie) {
      const cookie = journal.state.cookie;
      need(cookie.name === 'upgrade_demo_session' && HEX.test(cookie.value) && cookie.url === inputs.origin + '/' && cookie.httpOnly === true && cookie.sameSite === 'Strict' && cookie.secure === !inputs.localOnly, 'CHECKPOINT_COOKIE_INVALID');
      await context.addCookies([cookie]);
    }
    await context.routeWebSocket('**/*', (socket) => { fail('WEBSOCKET_BLOCKED'); counters.blocked++; socket.close(); });
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    cdp.on('Fetch.requestPaused', async (event) => {
      const task = (async () => {
        const request = event.request; counters.cdp_request_intercepts++;
        try {
          healthy(); need(counters.cdp_request_intercepts <= 220, 'REQUEST_LIMIT'); const url = new URL(request.url);
          need(url.origin === inputs.origin && !url.username && !url.password, 'FOREIGN_ORIGIN_BLOCKED');
          const target = request.url.slice(inputs.origin.length), method = request.method;
          const requestHeaders = Object.fromEntries(Object.entries(request.headers).map(([key,value]) => [key.toLowerCase(),value]));
          if (method === 'POST') {
            need(target === '/__upgrade/action' && permittedPost && !permittedPost.dispatched, 'UNAUTHORIZED_POST');
            need(sha(request.postData ?? '') === permittedPost.body_sha256 && requestHeaders.origin === inputs.origin, 'POST_INTENT_MISMATCH');
            permittedPost.dispatched = true; journal.save();
          } else need((method === 'GET' || method === 'HEAD') && readAllowed(target, inputs, event.resourceType.toLowerCase()), 'REQUEST_ROUTE_BLOCKED');
          // Browser headers/cookies are untrusted. The independent bounded transport
          // has no cookie jar and never performs an authentication or redirect retry.
          const headers = { 'user-agent': 'Upgrade-native-browser-verifier/1', 'accept': requestHeaders.accept ?? '*/*', 'accept-encoding': 'identity', 'authorization': 'Basic ' + Buffer.from(options.user + ':' + inputs.password).toString('base64') };
          if (method === 'POST') { headers.origin = inputs.origin; headers['content-type'] = 'application/x-www-form-urlencoded'; }
          const cookies = (await context.cookies(inputs.origin)).filter((cookie) => cookie.name === 'upgrade_demo_session');
          need(cookies.length <= 1, 'COOKIE_DUPLICATE'); if (cookies.length) { need(HEX.test(cookies[0].value), 'COOKIE_INVALID'); headers.cookie = 'upgrade_demo_session=' + cookies[0].value; }
          counters.mediated_fetches++;
          const response = await boundedFetch(request.url, { method, headers, body: request.postData });
          const responseHeaders = forwardedHeaders(response.headers);
          const cookie = filterSetCookies(response.headers['set-cookie'] ?? [], !inputs.localOnly);
          if (cookie) responseHeaders['set-cookie'] = cookie;
          if (response.status >= 300 && response.status < 400) {
            need(method === 'POST' && response.status === 303 && responseHeaders.location === operationTarget(permittedPost), 'REDIRECT_BLOCKED');
            permittedPost.post_status = response.status; permittedPost.location = responseHeaders.location; journal.save();
          }
          need(!/attachment/i.test(responseHeaders['content-disposition'] ?? '') && (!responseHeaders['content-length'] || Number(responseHeaders['content-length']) <= 12 * 1024 * 1024), 'RESPONSE_LIMIT');
          const body = response.body; counters.response_bytes += body.length;
          need(body.length <= 12 * 1024 * 1024 && counters.response_bytes <= 100 * 1024 * 1024, 'RESPONSE_LIMIT');
          need(!responseHeaders['content-encoding'] || responseHeaders['content-encoding'] === 'identity', 'ENCODED_RESPONSE_UNSUPPORTED');
          if (/\btext\/html\b/i.test(responseHeaders['content-type'] ?? '')) {
            const $ = load(body.toString('utf8'));
            need($('script,iframe,frame,object,embed,base').length === 0 && !$('meta[http-equiv]').toArray().some((element) => ['refresh','set-cookie'].includes($(element).attr('http-equiv')?.toLowerCase())) && !$('[target]').toArray().some((element) => !['_self',''].includes($(element).attr('target') ?? '')) && !$('link[rel]').toArray().some((element) => /(?:preconnect|dns-prefetch|prefetch|prerender)/i.test($(element).attr('rel') ?? '')), 'ACTIVE_HTML_BLOCKED');
          }
          await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: response.status, responseHeaders: Object.entries(responseHeaders).map(([name,value]) => ({name,value:String(value)})), body: body.toString('base64') });
        } catch (error) { counters.blocked++; fail(error instanceof VerifyError ? error.message : 'MEDIATED_REQUEST_FAILED'); await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(() => {}); }
      })(); tasks.add(task); try { await task; } finally { tasks.delete(task); }
    });
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    page.on('request', () => counters.browser_requests++);
    page.on('response', (response) => { counters.browser_responses++; const request = response.request(); exchanges.push({ method: request.method(), request_target: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status() }); });
    page.on('download', (download) => { fail('DOWNLOAD_BLOCKED'); download.cancel().catch(() => {}); });
    page.on('popup', (popup) => { fail('POPUP_BLOCKED'); popup.close().catch(() => {}); });
    if (options.reconcile) {
      need(journal.state.cookie, 'RECONCILIATION_SESSION_MISSING');
      const unresolved = journal.state.operations.filter((operation) => operation.status === 'UNKNOWN');
      for (const operation of unresolved) {
        const fields = validateForm({ method: 'post', action: '/__upgrade/action', fields: operation.fields }, inputs, operation.action);
        need(sha(fields.idempotency_key) === operation.operation_id && sha(new URLSearchParams(operation.fields).toString()) === operation.body_sha256, 'CHECKPOINT_OPERATION_INVALID');
        await go(operationTarget(operation));
        if (operation.action.startsWith('demo.')) need(await page.locator('.demo-receipt').count() === 1, 'RECONCILIATION_RECEIPT_MISSING');
        operation.status = 'CONFIRMED_BY_READBACK'; operation.confirmed_at = new Date().toISOString(); journal.save();
      }
      journal.state.status = 'INCOMPLETE_RECONCILED'; journal.save();
      const result = { status: 'INCOMPLETE_RECONCILED', confirmed_operations: unresolved.length, binding: inputs.binding, counters, exchanges, repeated_posts: 0, full_readiness: 'NOT_READY', note: 'Readback proves stored operation presence; interrupted scenario is not a completed test run.' };
      journal.record('reconciliation-' + randomBytes(6).toString('hex') + '.json', result); return result;
    }
    const kinds = ['HOME','CONTENT','CATEGORY'];
    for (const kind of kinds) {
      const item = inputs.snapshot.items.find((entry) => entry.page_kind === kind);
      if (!item) { journal.state.checks.push({ id: kind.toLowerCase() + '-responsive', status: 'NOT_APPLICABLE', details: 'No item of this kind in caller-pinned snapshot.' }); journal.save(); continue; }
      await go(item.request_target); await pictures(kind.toLowerCase());
    }
    await go(inputs.product.request_target); await rememberCookie(); await pictures('product');
    await page.keyboard.press('Tab'); need(await page.locator('.skip-link').evaluate((node) => node === document.activeElement), 'SKIP_LINK_KEYBOARD_FAILED');
    await page.keyboard.press('Enter'); need(await page.locator('#main').evaluate((node) => node === document.activeElement), 'SKIP_LINK_DESTINATION_FAILED'); check('keyboard-skip-link', 'Native Tab/Enter reaches main; this is not a full keyboard accessibility audit.');
    await go('/__upgrade/cart'); need(await page.locator('.demo-cart-line').count() === 0, 'SESSION_NOT_EMPTY');
    await go(inputs.product.request_target);
    const added = await mutate('cart-add', 'cart.add');
    need(await page.locator('.demo-cart-line').count() === 1 && await page.locator('.demo-cart-line input[name=quantity]').inputValue() === added.quantity, 'CART_ADD_FAILED'); await pictures('cart');
    const selected = added.variant_id ? inputs.product.variants.find((variant) => variant.id === added.variant_id) : inputs.product;
    const newQuantity = quantityUpdate(added.quantity, selected.purchase);
    await mutate('cart-update', 'cart.update', (form) => form.locator('input[name=quantity]').fill(newQuantity));
    need(await page.locator('.demo-cart-line input[name=quantity]').inputValue() === newQuantity, 'CART_UPDATE_FAILED');
    await page.reload({ waitUntil: 'networkidle' }); healthy(); need(await page.locator('.demo-cart-line input[name=quantity]').inputValue() === newQuantity, 'CART_RELOAD_FAILED');
    check('cart-add-update-reload', { exact_quantities_checked: true, distinct_update: added.quantity !== newQuantity });
    await mutate('checkout', 'demo.checkout'); await pictures('receipt');
    const checkoutText = await page.locator('.demo-receipt').innerText(); await page.reload({ waitUntil: 'networkidle' }); healthy(); need(await page.locator('.demo-receipt').innerText() === checkoutText, 'RECEIPT_RELOAD_CHANGED');
    check('synthetic-checkout-receipt', { exact_visible_receipt_reload: true, native_db_side_effects: 'NOT_RUN_SEPARATE_READBACK_REQUIRED' });
    await go('/__upgrade/cart'); need(await page.locator('.demo-cart-line').count() === 0 && await page.locator('.demo-empty').count() === 1, 'CHECKOUT_CART_NOT_CLEARED');
    await go('/__upgrade/lead'); await pictures('lead'); await mutate('lead', 'demo.lead');
    check('synthetic-lead-receipt', { synthetic_identity_only: true, native_mail_or_order_side_effects: 'NOT_RUN_SEPARATE_READBACK_REQUIRED' });
    await go('/__upgrade/search'); await pictures('search');
    const searchForm = page.locator('.demo-filter-panel form'); need(await searchForm.count() === 1, 'SEARCH_FORM_MISSING');
    await searchForm.locator('input[name=q]').fill('НЕСУЩЕСТВУЮЩИЙ-UPGRADE-' + randomBytes(8).toString('hex'));
    await Promise.all([page.waitForURL((url) => url.pathname === '/__upgrade/search' && url.searchParams.has('q'), { waitUntil: 'networkidle' }), searchForm.locator('button[type=submit]').click()]);
    healthy(); need(await page.locator('.demo-empty').innerText().then((text) => text.includes('Ничего не найдено')), 'SEARCH_EMPTY_FAILED'); await pictures('empty-search');
    await go('/__upgrade/search');
    const filterForm = page.locator('.demo-filter-panel form'); await filterForm.locator('select[name=sort]').selectOption('title_asc');
    const category = (inputs.product.category_ids ?? [])[0];
    let categoryUsed = false;
    if (category && await filterForm.locator('select[name=category]').count()) {
      const values = await filterForm.locator('select[name=category] option').evaluateAll((nodes) => nodes.map((node) => node.value));
      if (values.includes(category)) { await filterForm.locator('select[name=category]').selectOption(category); categoryUsed = true; }
    }
    await Promise.all([page.waitForURL((url) => url.pathname === '/__upgrade/search' && url.searchParams.get('sort') === 'title_asc', { waitUntil: 'networkidle' }), filterForm.locator('button[type=submit]').click()]);
    healthy(); const links = await page.locator('.demo-result-card h2 a').evaluateAll((nodes) => nodes.map((node) => ({ target: node.getAttribute('href'), title: node.textContent.trim() })));
    need(links.length > 0 && links.every((link) => inputs.snapshot.items.some((item) => item.request_target === link.target && (!categoryUsed || item.category_ids.includes(category)))), 'SEARCH_FILTER_FAILED');
    need(await page.locator('.demo-filter-panel select[name=sort]').inputValue() === 'title_asc', 'SEARCH_SORT_NOT_RETAINED');
    const expectedResults = inputs.snapshot.items.filter((item) => !categoryUsed || item.category_ids.includes(category)).sort((a,b) => Buffer.compare(Buffer.from(a.title.toLowerCase()),Buffer.from(b.title.toLowerCase())) || Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(0,20);
    need(JSON.stringify(links.map((link) => link.target)) === JSON.stringify(expectedResults.map((item) => item.request_target)), 'SEARCH_SORT_ORDER_FAILED');
    check('search-empty-filter-sort', { category_filter_exercised: categoryUsed, sort: 'title_asc', exact_first_page_targets: true, result_membership: 'caller-pinned snapshot', sorting_collation: 'Unicode lowercase UTF-8 byte order; unusual Unicode runtime differences fail closed' });
    healthy(); need(journal.state.operations.length === 4 && journal.state.operations.every((operation) => operation.status === 'CONFIRMED'), 'OPERATIONS_INCOMPLETE');
    journal.state.status = 'BROWSER_SCENARIOS_VERIFIED'; journal.save();
    const result = { schema_version: 1, status: inputs.localOnly ? 'LOCAL_BROWSER_SCENARIOS_VERIFIED' : 'BROWSER_SCENARIOS_VERIFIED', binding: inputs.binding, java_script_enabled: false, checks: journal.state.checks, counters, exchanges, operations: journal.state.operations.map(({ name, action, operation_id, status, location }) => ({ name, action, operation_id, status, location })), screenshots: { widths: WIDTHS, height: 1000, viewport_only: true }, native_bitrix: 'CALLER_ATTESTATION_REQUIRED', native_db_side_effects: 'NOT_RUN_SEPARATE_READBACK_REQUIRED', full_source: 'UNKNOWN', full_readiness: 'NOT_READY' };
    journal.record('receipt.json', result); return result;
  } catch (error) {
    journal.state.status = journal.state.operations.some((operation) => operation.status === 'UNKNOWN') ? 'UNKNOWN_REQUIRES_RECONCILIATION' : 'INCOMPLETE'; journal.save();
    const code = networkFailure ?? (error instanceof VerifyError ? error.message : 'BROWSER_CHECK_FAILED');
    journal.record('failure-' + randomBytes(6).toString('hex') + '.json', { status: journal.state.status, code, counters, exchanges, full_readiness: 'NOT_READY', binding: inputs.binding });
    throw new VerifyError(code);
  } finally { await context?.close().catch(() => {}); await Promise.allSettled([...tasks]); await browser?.close().catch(() => {}); journal.close(); }
}

export function parseArgs(argv) {
  const options = {}, mapping = { '--snapshot': 'snapshot', '--snapshot-sha256': 'snapshotSha256', '--origin': 'origin', '--user': 'user', '--password-file': 'passwordFile', '--output': 'output', '--product-route': 'productRoute' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--reconcile' || key === '--allow-loopback-http') { const name = key === '--reconcile' ? 'reconcile' : 'allowLoopbackHttp'; need(!Object.hasOwn(options,name), 'DUPLICATE_OPTION'); options[name] = true; }
    else { need(Object.hasOwn(mapping,key) && i + 1 < argv.length && !Object.hasOwn(options,mapping[key]), 'CLI_ARGUMENT_INVALID'); options[mapping[key]] = argv[++i]; }
  }
  for (const name of ['snapshot','snapshotSha256','origin','user','passwordFile','output']) need(typeof options[name] === 'string', 'CLI_REQUIRED_OPTION');
  return options;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  if (process.argv.includes('--help')) process.stdout.write('Upgrade bounded native-browser verifier\n--snapshot FILE --snapshot-sha256 SHA256 --origin https://demo.example --user USER --password-file PRIVATE_FILE --output NEW_ABSOLUTE_DIRECTORY [--product-route /exact/path] [--reconcile] [--allow-loopback-http]\n--reconcile only reads saved unknown operations; it never retries POST and never upgrades an interrupted run to PASS.\n');
  else Promise.resolve().then(() => runVerifier(parseArgs(process.argv.slice(2)))).then((result) => process.stdout.write(json({ status: result.status, full_readiness: 'NOT_READY', output: resolve(process.argv[process.argv.indexOf('--output') + 1]) }))).catch((error) => { process.stderr.write(json({ status: 'FAILED', code: error instanceof VerifyError ? error.message : 'INPUT_OR_RUNTIME_FAILED' })); process.exitCode = 1; });
}
