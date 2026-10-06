import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.UPGRADE_PYTHON_BIN ?? (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
const php = process.env.UPGRADE_PHP_BIN;
const source = resolve('scripts/verify-demo-http.py');
const pin = 'a'.repeat(64);
const route = '/product/observed?a=1&a=2&empty=';
const pass = 'synthetic-test-password-not-a-real-credential';

function temporary(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'upgrade-demo-http-runner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const policyHarness = String.raw`
import importlib.util, pathlib, sys, unittest, tempfile, os, threading, time, socket, http.server, types, json
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('verifier',sys.argv.pop(1));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Policy(unittest.TestCase):
    def wrap(self,inside):return '<div class="demo-view">'+inside+'</div>'
    def form(self,extra=''):
        return '<form method="post" action="/__upgrade/action" class="demo-action"><input type="hidden" name="action" value="demo.lead"><input type="hidden" name="csrf" value="'+'b'*64+'"><input type="hidden" name="expected_snapshot_id" value="'+'a'*64+'"><input type="hidden" name="idempotency_key" value="demo-safe-key-0001"><input type="hidden" name="synthetic" value="1"><input type="hidden" name="identity" value="demo-customer"><input type="checkbox" name="consent" value="1">'+extra+'</form>'
    def test_only_https_or_literal_loopback_and_tls_host_binding(self):
        for base,host in [('http://source.example','source.example'),('http://localhost','localhost'),('https://good.example','other.example'),('https://user:secret@good.example','good.example'),('https://good.example/path','good.example'),('https://good.example/#x','good.example')]:
            with self.subTest(base=base):self.assertRaises(m.VerifyError,m.validate_base,base,host)
        self.assertEqual(m.validate_base('http://127.0.0.1:8080','demo.example').port,8080)
        self.assertEqual(m.validate_base('https://demo.example','demo.example').scheme,'https')
    def test_exact_raw_target_identity_and_dangerous_aliases(self):
        self.assertEqual(m.request_target('/Path/?a=1&a=2&empty=&'),'/Path/?a=1&a=2&empty=&')
        for target in ['//evil.example','/x#hash','/x\\y','/x\r\nHost:evil','/x%','relative','/сырой']:
            with self.subTest(target=target):self.assertRaises(m.VerifyError,m.request_target,target)
    def test_source_forms_outside_own_view_are_inert(self):
        page='<form action="https://source.example/order"><input name="email" value="source-data"></form>'+self.wrap(self.form())
        view=m.Forms(page);self.assertEqual(len(view.forms),1);form=m.form_fields(view.action('demo.lead'),'a'*64)
        self.assertEqual(form['identity'],'demo-customer');self.assertEqual(form['consent'],'1');self.assertNotIn('email',form)
    def test_foreign_form_and_duplicate_fields_fail_closed(self):
        for inside in ['<form action="https://evil.example/" method="post"></form>', self.form('<input name="csrf" value="x">'), self.form('<input type="hidden" name="email" value="nobody@example.invalid">')]:
            with self.subTest(inside=inside[:60]):
                with self.assertRaises(m.VerifyError):
                    view=m.Forms(self.wrap(inside));m.form_fields(view.forms[0],'a'*64)
    def test_wrong_snapshot_no_personal_input_and_duplicate_attributes(self):
        self.assertRaises(m.VerifyError,m.form_fields,m.Forms(self.wrap(self.form())).forms[0],'c'*64)
        self.assertRaises(m.VerifyError,m.Forms,self.wrap('<input name="x" name="y">'))
        self.assertRaises(m.VerifyError,m.Forms,self.wrap(self.form('<textarea name="message">free</textarea>')))
    def test_resumed_submission_cannot_inject_personal_data_or_real_payment(self):
        form=m.form_fields(m.Forms(self.wrap(self.form())).forms[0],'a'*64);m.validate_submission(form,'a'*64)
        for extra in [{'email':'never@example.invalid'},{'identity':'real-customer'},{'consent':'0'},{'topic':'arbitrary free text'}]:
            with self.subTest(extra=extra):self.assertRaises(m.VerifyError,m.validate_submission,dict(form,**extra),'a'*64)
        checkout=dict(form,action='demo.checkout',delivery='demo-pickup',payment='real-card');checkout.pop('topic')
        self.assertRaises(m.VerifyError,m.validate_submission,checkout,'a'*64)
    def test_quantity_next_honors_observed_bounds_or_explicit_input(self):
        self.assertEqual(m.next_quantity({'min':'2','step':'2','max':'10'},'2'),'4')
        self.assertEqual(m.next_quantity({'min':'2','step':'2','max':'10'},'10'),'8')
        self.assertRaises(m.VerifyError,m.next_quantity,{'min':'2','step':'2','max':'2'},'2')
        self.assertRaises(m.VerifyError,m.next_quantity,{'min':'2','step':'2','max':'10'},'2','3')
    def test_receipt_text_alone_without_own_receipt_marker_fails(self):
        view=m.Forms(self.wrap('<h1>Демо-запись сохранена</h1><p>Тестовое оформление Сообщение не отправлено. Реальный заказ и платёж не создавались.</p>'))
        self.assertRaises(m.VerifyError,m.Runner.receipt_check,view,'Тестовое оформление')
    def test_private_secret_rejects_symlink_and_group_mode_on_posix(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'password';p.write_text('secret');os.chmod(p,0o600);self.assertEqual(m.private_file(p),b'secret')
            if os.name=='posix':
                os.chmod(p,0o644);self.assertRaises(m.VerifyError,m.private_file,p);os.chmod(p,0o600)
                link=pathlib.Path(d)/'link';link.symlink_to(p);self.assertRaises(m.VerifyError,m.private_file,link)
    def transport(self,mode):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                self.server.observed_cookies.append(self.headers.get('Cookie'))
                self.send_response(302 if mode=='redirect' else 200);self.send_header('Cache-Control','no-store');self.send_header('X-Robots-Tag','noindex');self.send_header('Content-Type','text/html')
                if mode=='redirect':self.send_header('Location','https://source.invalid/order');self.send_header('Content-Length','0');self.end_headers();return
                if mode=='cookie':self.send_header('Set-Cookie','upgrade_demo_session='+('a'*64)+'; Path=/; SameSite=Lax');self.send_header('Content-Length','0');self.end_headers();return
                if mode=='vendorcookie':self.send_header('Set-Cookie','PHPSESSID=never-persist-this-token; Path=/');self.send_header('Content-Length','0');self.end_headers();return
                if mode in ['vendor-own','duplicate-own','malformed-own']:
                    self.send_header('Set-Cookie','PHPSESSID=never-persist-this-token; Path=/')
                    own='upgrade_demo_session='+('a'*64)+'; Path=/; HttpOnly; SameSite=Strict'
                    self.send_header('Set-Cookie',own if mode!='malformed-own' else 'upgrade_demo_session; Path=/')
                    if mode=='duplicate-own':self.send_header('Set-Cookie',own)
                    self.send_header('Content-Length','0');self.end_headers();return
                self.send_header('Content-Length','999999999' if mode=='oversize' else '100');self.end_headers()
                if mode=='slow':
                    try:
                        for i in range(100):self.wfile.write(b'x');self.wfile.flush();time.sleep(.1)
                    except (OSError,ValueError):pass
                elif mode=='incomplete':self.wfile.write(b'x');self.close_connection=True
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True;server.observed_cookies=[]
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);folder=pathlib.Path(temp.name)
        p=folder/'pass';p.write_text('fake');os.chmod(p,0o600)
        args=types.SimpleNamespace(base_url='http://127.0.0.1:'+str(server.server_port),trusted_host='127.0.0.1:'+str(server.server_port),auth_user='upgrade',auth_password_file=str(p),snapshot_id='a'*64,product_route='/p',output=str(folder/'run'),resume=False,variant_id=None,quantity=None,update_quantity=None,search_query='',timeout=1,max_seconds=30,max_requests=30,max_body=65536)
        runner=m.Runner(args);runner.observed_cookies=server.observed_cookies;self.addCleanup(runner.lock.close);return runner
    def test_absolute_timeout_defeats_slow_response_drip(self):
        runner=self.transport('slow');start=time.monotonic()
        with self.assertRaisesRegex(m.VerifyError,'HTTP_ABSOLUTE_TIMEOUT'):runner.exchange('GET','/__upgrade/search')
        self.assertLess(time.monotonic()-start,2);self.assertEqual(runner.state['requests'],1)
    def test_oversize_and_incomplete_body_are_not_valid_html(self):
        for mode in ['oversize','incomplete']:
            with self.subTest(mode=mode):
                runner=self.transport(mode)
                with self.assertRaises(m.VerifyError):runner.get('/__upgrade/search')
    def test_budget_is_charged_before_request_and_scope_blocks_foreign_routes(self):
        runner=self.transport('oversize')
        self.assertRaises(m.VerifyError,runner.exchange,'POST','/checkout',{})
        self.assertEqual(runner.state['requests'],0)
        runner.state['requests']=30
        self.assertRaisesRegex(m.VerifyError,'REQUEST_BUDGET',runner.exchange,'GET','/__upgrade/search')
    def test_redirect_never_followed_and_weak_cookie_rejected(self):
        runner=self.transport('redirect')
        self.assertRaisesRegex(m.VerifyError,'GET_STATUS',runner.get,'/__upgrade/search');self.assertEqual(runner.state['requests'],1)
        runner=self.transport('cookie')
        self.assertRaisesRegex(m.VerifyError,'COOKIE_POLICY',runner.get,'/__upgrade/search');self.assertIsNone(runner.state['cookie'])
        runner=self.transport('vendorcookie');self.assertEqual(runner.exchange('GET','/__upgrade/search')[0],200);self.assertIsNone(runner.state['cookie'])
        self.assertNotIn('never-persist-this-token',(runner.output/'checkpoint.json').read_text());self.assertNotIn('PHPSESSID',(runner.output/'receipt.json').read_text())
    def test_resume_keeps_exhausted_budget_and_rejects_corrupt_elapsed(self):
        runner=self.transport('oversize');runner.state['requests']=30;runner.save();runner.lock.close();runner.args.resume=True
        resumed=m.Runner(runner.args);self.addCleanup(resumed.lock.close)
        self.assertRaisesRegex(m.VerifyError,'REQUEST_BUDGET',resumed.exchange,'GET','/__upgrade/search')
        resumed.state['elapsed']=float('nan');m.atomic_json(resumed.output/'checkpoint.json',resumed.state);resumed.lock.close()
        self.assertRaisesRegex(m.VerifyError,'CHECKPOINT_INVALID',m.Runner,runner.args)
    def test_vendor_plus_own_cookie_only_own_replayed_duplicate_and_malformed_reject(self):
        runner=self.transport('vendor-own');runner.exchange('GET','/__upgrade/search');runner.exchange('GET','/__upgrade/search')
        self.assertEqual(runner.observed_cookies,[None,'upgrade_demo_session='+('a'*64)])
        self.assertNotIn('never-persist-this-token',(runner.output/'checkpoint.json').read_text());self.assertNotIn('PHPSESSID',(runner.output/'receipt.json').read_text())
        for mode in ['duplicate-own','malformed-own']:
            with self.subTest(mode=mode):
                runner=self.transport(mode);self.assertRaises(m.VerifyError,runner.exchange,'GET','/__upgrade/search');self.assertIsNone(runner.state['cookie'])
    def test_second_owner_cannot_claim_existing_output_lock(self):
        runner=self.transport('oversize');runner.args.resume=True
        self.assertRaisesRegex(m.VerifyError,'RUNNER_BUSY',m.Runner,runner.args)
unittest.main(argv=['policy'],verbosity=2)
`;

test('Python verifier transport/parser contract: 16 behavioral cases, no source forms or secret output', t => {
  const dir = temporary(t), file = join(dir, 'policy.py'); writeFileSync(file, policyHarness);
  const result = spawnSync(python, ['-I', '-B', file, source], { encoding: 'utf8', timeout: 45000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /Ran 16 tests/); assert.match(result.stderr, /\bOK\b/);
});

function product(id: string, title: string, unknown = false): any {
  return { id, title, body_text: 'Observed fixture text', request_target: id === 'observed' ? route : '/product/' + id,
    is_product: true, category_ids: ['category'], attributes: { brand: ['Fixture observed'] }, variants: [],
    prices: unknown ? [] : [{ id: 'current', role: 'CURRENT', status: 'OBSERVED', raw_text: '2.50 RUB', money: { decimal: '2.50', currency: 'RUB', minor: 250 }, maximum: null, unit: 'piece', conditions: [], totals_eligible: true }],
    purchase: { price_id: unknown ? null : 'current', min_quantity: '1', quantity_step: '1', max_quantity: '10', default_quantity: '1', blockers: unknown ? ['PRICE_UNKNOWN'] : [] } };
}

async function fixture(t: TestContext, options: { lost?: boolean; before?: boolean; unknown?: boolean; unsafe?: boolean } = {}) {
  const dir = temporary(t), stateDir = join(dir, 'private'), webRoot = join(dir, 'web');
  mkdirSync(stateDir, { mode: 0o700 }); mkdirSync(webRoot);
  const passwordFile = join(dir, 'password'); writeFileSync(passwordFile, pass, { mode: 0o600 }); chmodSync(passwordFile, 0o600);
  const items = [product('observed', 'B observed product', options.unknown), product('alpha', 'A observed product', options.unknown), { id: 'category', title: 'Observed category', body_text: '', request_target: '/category', is_product: false, category_ids: [], attributes: {}, variants: [], prices: [], purchase: {} }];
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ schema_version: 1, project_id: 'http-runner', snapshot_id: pin, items }));
  const lost = join(dir, 'lose-response'); if (options.lost || options.before) writeFileSync(lost, '1');
  const p = (path: string) => path.replaceAll('\\', '/').replaceAll("'", "\\'");
  writeFileSync(join(dir, 'server.php'), `<?php
declare(strict_types=1);
if(($_SERVER['PHP_AUTH_USER']??'')!=='upgrade'||($_SERVER['PHP_AUTH_PW']??'')!=='${pass}'){http_response_code(401);header('WWW-Authenticate: Basic realm="Upgrade private demo"');echo 'Authentication required';exit;}
require '${p(resolve('bitrix/module/upgrade.core/lib/demoengine.php'))}';require '${p(resolve('bitrix/module/upgrade.core/lib/demoweb.php'))}';require '${p(resolve('bitrix/module/upgrade.core/lib/demoview.php'))}';
$snapshot=json_decode(file_get_contents('${p(join(dir, 'snapshot.json'))}'),true,128,JSON_THROW_ON_ERROR);$engine=new \\Upgrade\\Core\\DemoEngine($snapshot,'${p(stateDir)}','http-runner');$body=file_get_contents('php://input');
$target=$_SERVER['REQUEST_URI'];$item=null;foreach($snapshot['items'] as $candidate)if($candidate['request_target']===$target)$item=$candidate;
${options.before ? `if(file_exists('${p(lost)}')&&$_SERVER['REQUEST_METHOD']==='POST'&&($_SERVER['HTTP_ORIGIN']??'')==='http://'.$_SERVER['HTTP_HOST']){parse_str($body,$fields);$session=$engine->resumeSession($_COOKIE['upgrade_demo_session']??'');if(($fields['csrf']??'')===($session['csrf']??null)){unlink('${p(lost)}');header('Content-Length: 100');echo 'lost before mutation';exit;}}` : ''}
$response=\\Upgrade\\Core\\DemoWeb::handle($engine,$snapshot,['method'=>$_SERVER['REQUEST_METHOD'],'request_target'=>$target,'host'=>$_SERVER['HTTP_HOST'],'https'=>false,'origin'=>$_SERVER['HTTP_ORIGIN']??null,'cookie'=>$_COOKIE['upgrade_demo_session']??null,'body'=>$body,'content_type'=>$_SERVER['CONTENT_TYPE']??null,'item_id'=>$item['id']??null]);
http_response_code($response['status']);foreach($response['headers'] as $key=>$value)header($key.': '.$value);
if(file_exists('${p(lost)}')&&$_SERVER['REQUEST_METHOD']==='POST'&&$response['status']===303){unlink('${p(lost)}');header('Content-Length: 100');echo 'lost';exit;}
if($response['view']){echo '<form action="https://source.invalid/order" method="post"><input name="email" value="never-submit"></form>'; $html=\\Upgrade\\Core\\DemoView::render($response['view']);${options.unsafe ? `$html=str_replace('action="/__upgrade/action"','action="https://source.invalid/checkout"',$html);` : ''} echo $html;}
`);
  const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
  const server = spawn(php!, ['-n', '-d', `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR ?? resolve('var/tools/php-8.3.35/ext')}`, '-d', 'extension=mbstring', '-S', `127.0.0.1:${port}`, '-t', webRoot, join(dir, 'server.php')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stderr.on('data', value => logs += value.toString());
  t.after(async () => { if (server.exitCode === null && server.signalCode === null) { const stopped = new Promise<void>(done => server.once('exit', () => done())); server.kill(); await stopped; } });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) { try { const response = await fetch(base + '/__upgrade/search'); await response.arrayBuffer(); if (response.status === 401) { ready = true; break; } } catch {} await new Promise(done => setTimeout(done, 50)); }
  assert.ok(ready, logs);
  const output = join(dir, 'proof');
  const args = ['-I', '-B', source, '--base-url', base, '--trusted-host', `127.0.0.1:${port}`, '--auth-password-file', passwordFile, '--snapshot-id', pin, '--product-route', route, '--output', output];
  const run = (more: string[] = []) => spawnSync(python, [...args, ...more], { encoding: 'utf8', timeout: 45000 });
  const read = (name: string) => JSON.parse(readFileSync(join(output, name), 'utf8'));
  const state = () => { const folder = join(stateDir, 'demo-http-runner'); const files = readdirSync(folder).filter(file => file.endsWith('.json')); assert.equal(files.length, 1); return JSON.parse(readFileSync(join(folder, files[0]), 'utf8')).body; };
  return { run, read, state, output, logs: () => logs };
}

test('actual PHP HTTP: auth/search/filter/sort/product/CSRF/Origin/cart/replay/synthetic checkout and lead', { skip: !php }, async t => {
  const f = await fixture(t), result = f.run(); assert.equal(result.status, 0, result.stdout + result.stderr + f.logs());
  assert.equal(result.stderr, ''); const receipt = f.read('receipt.json'), checkpoint = f.read('checkpoint.json');
  assert.equal(receipt.status, 'HTTP_SCENARIOS_VERIFIED'); assert.equal(receipt.unknown_write, false);
  assert.ok(receipt.requests >= 25 && receipt.requests <= 40); assert.equal(receipt.checks.length, 13);
  assert.ok(receipt.checks.every((check: any) => check.status === 'PASS'));
  assert.equal(receipt.native_orders_mail_payments_database_counters, 'NOT_RUN');
  const text = JSON.stringify(receipt) + result.stdout + result.stderr;
  for (const secret of [pass, checkpoint.cookie, checkpoint.context.add.csrf, checkpoint.context.add.idempotency_key]) assert.ok(!text.includes(secret));
  const state = f.state(); assert.equal(Object.keys(state.operations).length, 6); assert.equal(Object.keys(state.synthetic_records).length, 2); assert.equal(Object.keys(state.cart).length, 0);
  const checkout: any = Object.values(state.synthetic_records).find((r: any) => r.kind === 'demo.checkout');
  assert.equal(checkout.total.decimal, '2.50'); assert.equal(checkout.native_order_created, false); assert.equal(checkout.message_sent, false); assert.equal(checkout.payment_attempted, false);
  assert.equal(checkout.identity, 'demo-customer');
  const before = receipt.requests; const resumed = f.run(['--resume']); assert.equal(resumed.status, 0, resumed.stdout); assert.equal(f.read('receipt.json').requests, before);
});

test('actual PHP lost committed response: durable UNKNOWN, new process reconciles before continuing without duplicate add', { skip: !php }, async t => {
  const f = await fixture(t, { lost: true }); const first = f.run(); assert.equal(first.status, 3, first.stdout + first.stderr);
  const before = f.read('checkpoint.json'); assert.equal(before.status, 'UNKNOWN_WRITE'); assert.equal(before.step, 4); assert.equal(before.pending.name, 'add');
  assert.equal(Object.keys(f.state().operations).length, 1);
  const resumed = f.run(['--resume']); assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  const receipt = f.read('receipt.json'), after = f.read('checkpoint.json');
  assert.equal(receipt.status, 'HTTP_SCENARIOS_VERIFIED'); assert.equal(after.context.add.idempotency_key, before.context.add.idempotency_key);
  const firstNew = receipt.exchanges.find((row: any) => row.sequence > before.requests); assert.equal(firstNew.method, 'GET'); assert.equal(firstNew.request_target, before.pending.operation_target);
  assert.equal(Object.keys(f.state().operations).length, 6); assert.equal(Object.keys(f.state().synthetic_records).length, 2);
});

test('actual PHP unknown money remains unknown in synthetic receipt', { skip: !php }, async t => {
  const f = await fixture(t, { unknown: true }); const result = f.run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  const checkout: any = Object.values(f.state().synthetic_records).find((r: any) => r.kind === 'demo.checkout');
  assert.equal(checkout.total, null); assert.equal(checkout.pricing_status, 'REQUIRES_CONFIRMATION');
});

test('actual PHP pre-commit loss: resume observes missing operation then reuses exact saved intent', { skip: !php }, async t => {
  const f = await fixture(t, { before: true }); const first = f.run(); assert.equal(first.status, 3, first.stdout + first.stderr);
  const before = f.read('checkpoint.json'); assert.equal(before.status, 'UNKNOWN_WRITE'); assert.equal(Object.keys(f.state().operations).length, 0);
  const resumed = f.run(['--resume']); assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  const fresh = f.read('receipt.json').exchanges.filter((row: any) => row.sequence > before.requests);
  assert.equal(fresh[0].method, 'GET'); assert.equal(fresh[0].status, 404); assert.equal(fresh[0].request_target, before.pending.operation_target);
  assert.equal(fresh[1].method, 'POST'); assert.equal(f.read('checkpoint.json').context.add.idempotency_key, before.context.add.idempotency_key);
  assert.equal(Object.keys(f.state().operations).length, 6);
});

test('actual PHP foreign action rejection makes zero POSTs and checkpoint cannot silently rebind snapshot', { skip: !php }, async t => {
  const f = await fixture(t, { unsafe: true }); const result = f.run(); assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).error_code, 'FOREIGN_FORM_REJECTED');
  assert.ok(f.read('receipt.json').exchanges.every((row: any) => row.method === 'GET'));
  const resumed = f.run(['--resume', '--snapshot-id', 'b'.repeat(64)]); assert.equal(resumed.status, 3); assert.equal(JSON.parse(resumed.stdout).error_code, 'CHECKPOINT_BINDING_MISMATCH');
});
