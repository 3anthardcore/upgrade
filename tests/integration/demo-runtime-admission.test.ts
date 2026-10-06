import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, openSync, closeSync, ftruncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// These tests run real PHP processes and OS file locks. No CMS/DB/network is involved.
const php = process.env.UPGRADE_PHP_BIN ?? resolve('var/tools/php-8.3.35/php.exe');
const library = resolve('bitrix/module/upgrade.core/lib');
const pin = 'a'.repeat(64), project = 'admission-test';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const harness = String.raw`<?php
declare(strict_types=1);
namespace Upgrade\Core {
    // Observe the real on-disk peak after fsync and before the native atomic rename.
    // The opt-in fault leaves the actual pending file intact; production has no test hooks.
    function rename($from,$to) {
        $GLOBALS['admission_rename_peaks'][]=iterator_count(new \FilesystemIterator(dirname($to),\FilesystemIterator::SKIP_DOTS));
        if(getenv('ADMISSION_FAIL_RENAME')==='1')throw new \RuntimeException('TEST_RENAME_FAILED');
        return \rename($from,$to);
    }
    // Observation only: use the real flock and mark an actual failed session-lock attempt.
    function flock($stream,$operation,&$wouldBlock=null) {
        $result=\flock($stream,$operation,$wouldBlock);
        $marker=getenv('ADMISSION_WAIT_MARKER');
        if(!$result&&$marker&&str_ends_with(stream_get_meta_data($stream)['uri'],'.json.lock'))file_put_contents($marker,'SESSION_LOCK_WAIT');
        $gateMarker=getenv('ADMISSION_GATE_WAIT_MARKER');
        if(!$result&&$gateMarker&&str_ends_with(stream_get_meta_data($stream)['uri'],'admission.lock'))file_put_contents($gateMarker,'ADMISSION_LOCK_WAIT');
        return $result;
    }
}
namespace {
    require $argv[1].'/demoengine.php';require $argv[1].'/demoweb.php';require $argv[1].'/demoruntime.php';
    $input=json_decode(file_get_contents('php://stdin'),true,128,JSON_THROW_ON_ERROR);
    $snapshot=json_decode(file_get_contents($argv[2]),true,128,JSON_THROW_ON_ERROR);
    $_SERVER['DOCUMENT_ROOT']=$argv[3].'/nonexistent-webroot';
    try {
        if(($input['mode']??null)==='hold'){
            $handle=fopen($input['path'],'c+b');if(!flock($handle,LOCK_EX))throw new RuntimeException('TEST_HOLD_FAILED');
            file_put_contents($input['ready'],'LOCKED');
            $deadline=hrtime(true)+10000000000;
            while(!file_exists($input['release'])){if(hrtime(true)>$deadline)throw new RuntimeException('TEST_HOLD_TIMEOUT');usleep(5000);}
            flock($handle,LOCK_UN);fclose($handle);$result='RELEASED';
        }elseif(($input['mode']??null)==='probe'){
            $handle=fopen($input['path'],'c+b');$acquired=flock($handle,LOCK_EX|LOCK_NB);if($acquired)flock($handle,LOCK_UN);fclose($handle);$result=$acquired;
        }else{
            $engine=new \Upgrade\Core\DemoEngine($snapshot,$argv[3],$snapshot['project_id']);
            if(($input['mode']??null)==='readonly'){
                $copy=$engine->readOnlyCopy();$copy=$copy->readOnlyCopy();
                $result=match($input['action']){
                    'open'=>$copy->openSession($input['session']),
                    'cart'=>$copy->cart($input['session']),
                    'resume'=>$copy->resumeSession($input['session']),
                    'receipt'=>$copy->receipt($input['session'],str_repeat('b',64)),
                    'mutate'=>$copy->mutate($input['session'],str_repeat('c',64),'readonly-operation-key','cart.add',['expected_snapshot_id'=>$snapshot['snapshot_id'],'item_id'=>'product','quantity'=>'1']),
                    'search'=>$copy->search('Observed'),
                    default=>throw new RuntimeException('TEST_ACTION_INVALID')
                };
            }else $result=\Upgrade\Core\DemoRuntime::handle($engine,$snapshot,$input,$argv[3]);
        }
        echo json_encode(['ok'=>true,'result'=>$result,'rename_peaks'=>$GLOBALS['admission_rename_peaks']??[]],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    }catch(Throwable $error){echo json_encode(['ok'=>false,'error'=>$error->getMessage(),'class'=>get_class($error)],JSON_THROW_ON_ERROR);}
}
`;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'upgrade-admission-'));
  const privateRoot = join(directory, 'private'), state = join(privateRoot, 'demo-' + project);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const script = join(directory, 'runner.php'), snapshotFile = join(directory, 'snapshot.json');
  writeFileSync(script, harness);
  writeFileSync(snapshotFile, JSON.stringify({ schema_version: 1, project_id: project, snapshot_id: pin, items: [
    { id: 'content', title: 'Observed content', body_text: 'Exact description.', request_target: '/content', is_product: false },
    { id: 'product', title: 'Observed product', body_text: 'Exact factual text.', request_target: '/product', is_product: true, variants: [], category_ids: [], attributes: {}, prices: [], purchase: { blockers: ['PRICE_UNKNOWN'] } },
  ] }));
  const args = ['-n', '-d', `extension_dir=${process.env.UPGRADE_PHP_EXT_DIR ?? resolve('var/tools/php-8.3.35/ext')}`, '-d', 'extension=mbstring', '-d', 'disable_functions=mail,exec,shell_exec,system,passthru,popen,proc_open,curl_exec,fsockopen,pfsockopen,stream_socket_client', script, library, snapshotFile, privateRoot];
  const defaults = { method: 'GET', request_target: '/__upgrade/cart', host: 'demo.example', https: true, origin: null, cookie: null, body: '' };
  const children = new Set<ReturnType<typeof spawn>>();
  t.after(async () => {
    await Promise.all([...children].map(child => new Promise<void>(done => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      child.once('close', () => done()); child.kill();
    })));
    assert.ok(directory.startsWith(join(tmpdir(), 'upgrade-admission-')));
    rmSync(directory, { recursive: true, force: true });
  });
  const parse = (p: { status: number | null; stderr: string; stdout: string }) => {
    assert.equal(p.status, 0, p.stderr + p.stdout); assert.equal(p.stderr, '', p.stderr); return JSON.parse(p.stdout);
  };
  const raw = (input: any = {}, failRename = false) => parse(spawnSync(php, args, { input: JSON.stringify({ ...defaults, ...input }), encoding: 'utf8', timeout: 15000, env: { ...process.env, ADMISSION_FAIL_RENAME: failRename ? '1' : '' } }));
  const call = (input: any = {}) => { const result = raw(input); assert.equal(result.ok, true, JSON.stringify(result)); return result.result; };
  const start = (input: any = {}, marker = '', gateMarker = '') => {
    const child = spawn(php, args, { env: { ...process.env, ADMISSION_WAIT_MARKER: marker, ADMISSION_GATE_WAIT_MARKER: gateMarker, ADMISSION_FAIL_RENAME: '' }, stdio: ['pipe', 'pipe', 'pipe'] }); children.add(child);
    let settled = false;
    const done = new Promise<any>((resolveResult, reject) => {
      let stdout = '', stderr = '';
      child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
      child.on('error', reject); child.on('close', status => { children.delete(child); settled = true; try { resolveResult(parse({ status, stdout, stderr })); } catch (error) { reject(error); } });
    });
    child.stdin.end(JSON.stringify({ ...defaults, ...input }));
    return { child, done, settled: () => settled };
  };
  const waitFile = async (file: string) => {
    const deadline = Date.now() + 3000; while (!existsSync(file)) { assert.ok(Date.now() < deadline, 'Expected marker: ' + file); await new Promise(r => setTimeout(r, 5)); }
  };
  let holds = 0;
  const hold = async (path: string) => {
    const ready = join(directory, 'hold-' + ++holds + '.ready'), release = ready + '.release';
    const process = start({ mode: 'hold', path, ready, release }); await waitFile(ready);
    return { release: async () => { writeFileSync(release, 'RELEASE'); const result = await process.done; assert.equal(result.ok, true); }, process };
  };
  const within = async (pending: Promise<any>, label: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' stalled behind unrelated gate')), 1200); })]); }
    finally { clearTimeout(timer); }
  };
  const file = (cookie: string) => join(state, sha(project + '\0' + cookie) + '.json');
  const open = (input: any = {}) => {
    const response = call(input); assert.equal(response.status, 200, JSON.stringify(response));
    const cookie = response.headers['Set-Cookie'].match(/^upgrade_demo_session=([a-f0-9]{64});/)[1];
    return { cookie, csrf: response.view.csrf };
  };
  const post = (opened: any, key = 'admission-operation-key', overrides: any = {}) => ({ method: 'POST', request_target: '/__upgrade/action', content_type: 'application/x-www-form-urlencoded', origin: 'https://demo.example', cookie: opened.cookie, body: new URLSearchParams({ action: 'cart.add', csrf: opened.csrf, expected_snapshot_id: pin, idempotency_key: key, item_id: 'product', quantity: '1', ...overrides }).toString() });
  const lead = (opened: any) => ({ ...post(opened), body: new URLSearchParams({ action: 'demo.lead', csrf: opened.csrf, expected_snapshot_id: pin, idempotency_key: 'admission-lead-operation', synthetic: '1', identity: 'demo-customer', consent: '1', topic: 'general' }).toString() });
  const fill = (count: number) => { for (let i = 0; i < count; i++) writeFileSync(join(state, 'quota-placeholder-' + i + '.json'), '{}'); };
  const residue = (count: number) => { for (let i = 0; i < count; i++) writeFileSync(join(state, 'retained-' + i + '.pending'), 'retained'); };
  const bytes = (cookie: string) => readFileSync(file(cookie), 'utf8');
  return { directory, privateRoot, state, gate: join(privateRoot, 'admission.lock'), call, raw, start, hold, within, waitFile, file, open, post, lead, fill, residue, bytes };
}

test('read-only engine copies reject every potentially creating API before a file side effect', t => {
  const f = fixture(t), session = 'e'.repeat(64);
  for (const action of ['open', 'cart', 'mutate']) {
    const result = f.raw({ mode: 'readonly', action, session });
    assert.equal(result.ok, false); assert.equal(result.class, 'Upgrade\\Core\\DemoAdmissionRequired'); assert.equal(result.error, 'DEMO_ADMISSION_REQUIRED');
    assert.deepEqual(readdirSync(f.state), []);
  }
  for (const action of ['resume', 'receipt']) assert.equal(f.call({ mode: 'readonly', action, session }), null);
  assert.equal(f.call({ mode: 'readonly', action: 'search' }).total, 2);
  assert.deepEqual(readdirSync(f.state), []); assert.ok(!existsSync(f.gate));
  assert.ok(f.open().cookie); // The original write-capable engine still admits normally.
});

test('pure search/content/errors/HEAD and unknown receipts finish while the global gate remains held', async t => {
  const f = fixture(t), holder = await f.hold(f.gate);
  const requests = [
    [{ request_target: '/__upgrade/search?q=Observed' }, 200],
    [{ request_target: '/content', item_id: 'content' }, 200],
    [{ request_target: '/__upgrade/search?q=x&q=y' }, 400],
    [{ request_target: '/__upgrade/action' }, 405],
    [{ request_target: '/__upgrade/unknown' }, 404],
    [{ method: 'HEAD', request_target: '/product', item_id: 'product', cookie: 'e'.repeat(64) }, 200],
    [{ method: 'HEAD', request_target: '/__upgrade/cart', cookie: 'invalid-duplicate-cookie' }, 200],
    [{ method: 'HEAD', request_target: '/__upgrade/lead' }, 200],
    [{ method: 'HEAD', request_target: '/__upgrade/cart?operation=invalid' }, 400],
    [{ method: 'HEAD', request_target: '/__upgrade/search', body: 'action=cart.add' }, 400],
    [{ request_target: '/__upgrade/receipt?operation=' + 'f'.repeat(64), cookie: 'e'.repeat(64) }, 404],
    [{ request_target: '/__upgrade/cart?operation=' + 'f'.repeat(64), cookie: 'e'.repeat(64) }, 404],
  ] as const;
  try {
    for (const [request, status] of requests) {
      const result = await f.within(f.start(request).done, JSON.stringify(request));
      assert.equal(result.ok, true); assert.equal(result.result.status, status); assert.equal(result.result.headers['Set-Cookie'], undefined);
      if ('method' in request && request.method === 'HEAD') assert.equal(result.result.view, null);
    }
    assert.equal(holder.process.settled(), false); assert.deepEqual(readdirSync(f.state), []);
  } finally { await holder.release(); }
});

test('known-session GET/receipt bypass admission without rewriting exact committed bytes', async t => {
  const f = fixture(t), opened = f.open(), post = f.post(opened), created = f.call(post);
  assert.equal(f.call(f.lead(opened)).status, 303);
  assert.equal(created.status, 303); const before = f.bytes(opened.cookie), holder = await f.hold(f.gate);
  try {
    for (const request of [
      { request_target: '/product', item_id: 'product', cookie: opened.cookie },
      { request_target: '/__upgrade/cart', cookie: opened.cookie },
      { request_target: '/__upgrade/lead', cookie: opened.cookie },
      { request_target: '/__upgrade/receipt?operation=' + sha('admission-lead-operation'), cookie: opened.cookie },
      { method: 'HEAD', request_target: '/__upgrade/cart', cookie: opened.cookie },
    ]) {
      const result = await f.within(f.start(request).done, request.request_target);
      assert.equal(result.ok, true); assert.equal(result.result.status, 200); assert.equal(result.result.headers['Set-Cookie'], undefined);
    }
    assert.equal(f.bytes(opened.cookie), before);
  } finally { await holder.release(); }
  assert.equal(f.call(post).status, 303); assert.equal(f.bytes(opened.cookie), before, 'Exact replay must not rewrite state');
});

test('unknown GET cookie cannot fall back to creation outside the held admission gate', async t => {
  const f = fixture(t), holder = await f.hold(f.gate), unknown = 'd'.repeat(64);
  const pending = f.start({ request_target: '/product', item_id: 'product', cookie: unknown });
  await new Promise(r => setTimeout(r, 180));
  assert.equal(pending.settled(), false); assert.deepEqual(readdirSync(f.state), []);
  await holder.release(); const result = await pending.done;
  assert.equal(result.ok, true); assert.equal(result.result.status, 200);
  assert.doesNotMatch(result.result.headers['Set-Cookie'], new RegExp(unknown));
  assert.ok(!existsSync(f.file(unknown))); assert.equal(readdirSync(f.state).filter(p => p.endsWith('.json')).length, 1);
});

test('POST remains serialized by admission, including invalid cookies and exact retries', async t => {
  const f = fixture(t), opened = f.open(), original = f.bytes(opened.cookie), holder = await f.hold(f.gate);
  const write = f.start(f.post(opened)), unknown = f.start({ ...f.post(opened), cookie: 'f'.repeat(64) });
  await new Promise(r => setTimeout(r, 180));
  assert.equal(write.settled(), false); assert.equal(unknown.settled(), false); assert.equal(f.bytes(opened.cookie), original);
  await holder.release(); const [a, b] = await Promise.all([write.done, unknown.done]);
  assert.equal(a.result.status, 303); assert.equal(b.result.status, 403);
  assert.equal(JSON.parse(f.bytes(opened.cookie)).body.revision, 1);
  const holder2 = await f.hold(f.gate), replay = f.start(f.post(opened));
  await new Promise(r => setTimeout(r, 100)); assert.equal(replay.settled(), false);
  await holder2.release(); assert.equal((await replay.done).result.status, 303);
  assert.equal(JSON.parse(f.bytes(opened.cookie)).body.revision, 1);
});

for (const mutation of [false, true]) test(`a blocked session ${mutation ? 'writer' : 'reader'} cannot stall unrelated pure reads`, async t => {
  const f = fixture(t), opened = f.open(), holder = await f.hold(f.file(opened.cookie) + '.lock');
  const marker = join(f.directory, 'waiting.marker');
  const pending = f.start(mutation ? f.post(opened) : { request_target: '/product', item_id: 'product', cookie: opened.cookie }, marker);
  await f.waitFile(marker); // Proven to be waiting on the actual OS session lock.
  assert.equal(f.call({ mode: 'probe', path: f.gate }), !mutation, 'Only the POST writer should hold admission');
  for (const request of [{ request_target: '/content', item_id: 'content' }, { request_target: '/__upgrade/search?q=Observed' }]) {
    const result = await f.within(f.start(request).done, request.request_target);
    assert.equal(result.ok, true); assert.equal(result.result.status, 200);
  }
  assert.equal(pending.settled(), false); await holder.release();
  assert.equal((await pending.done).result.status, mutation ? 303 : 200);
});

test('two new sessions racing the last quota slot create exactly one and retain all prior files', async t => {
  const f = fixture(t); f.fill(999);
  const results = await Promise.all([f.start().done, f.start().done]);
  assert.equal(results.filter(r => r.ok && r.result.status === 200).length, 1);
  assert.deepEqual(results.filter(r => !r.ok).map(r => r.error), ['DEMO_SESSION_QUOTA']);
  assert.equal(readdirSync(f.state).filter(p => p.endsWith('.json')).length, 1000);
  for (let i = 0; i < 999; i++) assert.equal(readFileSync(join(f.state, 'quota-placeholder-' + i + '.json'), 'utf8'), '{}');
});

test('a disappearing known session must re-enter quota admission, never resurrect outside it', async t => {
  const f = fixture(t), opened = f.open(), holder = await f.hold(f.file(opened.cookie) + '.lock');
  const marker = join(f.directory, 'disappearing.marker');
  const pending = f.start({ cookie: opened.cookie }, marker); await f.waitFile(marker);
  rmSync(f.file(opened.cookie)); f.fill(1000);
  await holder.release(); const result = await pending.done;
  assert.equal(result.ok, false); assert.equal(result.error, 'DEMO_SESSION_QUOTA');
  assert.ok(!existsSync(f.file(opened.cookie))); assert.equal(readdirSync(f.state).filter(p => p.endsWith('.json')).length, 1000);
});

test('a cookie file reappearing during admission wait cannot waive the required creation reservation', async t => {
  const f = fixture(t), opened = f.open(), original = f.bytes(opened.cookie);
  rmSync(f.file(opened.cookie));
  const holder = await f.hold(f.gate), marker = join(f.directory, 'admission-wait.marker');
  const pending = f.start({ cookie: opened.cookie }, '', marker); await f.waitFile(marker);
  writeFileSync(f.file(opened.cookie), original); f.fill(999);
  await holder.release(); const result = await pending.done;
  assert.equal(result.ok, false); assert.equal(result.error, 'DEMO_SESSION_QUOTA');
  assert.equal(f.bytes(opened.cookie), original); assert.equal(readdirSync(f.state).filter(p => p.endsWith('.json')).length, 1000);
});

test('an admitted existing-session mutation remains possible at exactly the session-count quota', t => {
  const f = fixture(t), opened = f.open(); f.fill(999);
  assert.equal(f.call(f.post(opened)).status, 303);
  assert.equal(JSON.parse(f.bytes(opened.cookie)).body.revision, 1);
  assert.equal(readdirSync(f.state).filter(p => p.endsWith('.json')).length, 1000);
  assert.equal(f.raw().error, 'DEMO_SESSION_QUOTA');
});

test('byte quota still rejects mutations and new sessions but preserves readable exact receipts', t => {
  const f = fixture(t), opened = f.open(), committed = f.call(f.post(opened)); assert.equal(committed.status, 303);
  assert.equal(f.call(f.lead(opened)).status, 303);
  const before = f.bytes(opened.cookie), pending = join(f.state, 'retained.json.pending-crash');
  const descriptor = openSync(pending, 'wx'); ftruncateSync(descriptor, 140 * 1024 * 1024); closeSync(descriptor);
  for (const request of [{}, { cookie: 'f'.repeat(64) }, f.post(opened, 'different-operation-key')]) {
    const result = f.raw(request); assert.equal(result.ok, false); assert.equal(result.error, 'DEMO_STATE_QUOTA');
  }
  const receipt = f.call({ cookie: opened.cookie, request_target: '/__upgrade/receipt?operation=' + sha('admission-lead-operation') });
  assert.equal(receipt.status, 200); assert.equal(f.bytes(opened.cookie), before); assert.ok(existsSync(pending));
  assert.equal(f.call({ request_target: '/__upgrade/search' }).status, 200);
});

test('file quota still rejects every write without deleting crash remnants', t => {
  const f = fixture(t), opened = f.open(), before = f.bytes(opened.cookie);
  for (let i = 0; i < 4999; i++) writeFileSync(join(f.state, 'retained.pending-' + i), 'x');
  for (const request of [{}, f.post(opened)]) {
    const result = f.raw(request); assert.equal(result.ok, false); assert.equal(result.error, 'DEMO_STATE_FILE_QUOTA');
  }
  assert.equal(readdirSync(f.state).length, 5001); assert.equal(f.bytes(opened.cookie), before);
});

for (const files of [4998, 4999, 5000]) test(`new-session admission reserves both file slots at ${files} retained entries`, t => {
  const f = fixture(t); f.residue(files);
  const before = readdirSync(f.state), result = f.raw();
  if (files === 4998) {
    assert.equal(result.ok, true); assert.equal(result.result.status, 200);
    assert.deepEqual(result.rename_peaks, [5000]);
    assert.equal(readdirSync(f.state).length, 5000);
  } else {
    assert.equal(result.ok, false); assert.equal(result.error, 'DEMO_STATE_FILE_QUOTA');
    assert.deepEqual(readdirSync(f.state), before);
  }
  for (const path of before) assert.equal(readFileSync(join(f.state, path), 'utf8'), 'retained');
});

for (const files of [4998, 4999, 5000]) test(`existing-session write reserves its pending slot at ${files} retained entries`, t => {
  const f = fixture(t), opened = f.open(); f.residue(files - 2);
  const before = f.bytes(opened.cookie), names = readdirSync(f.state), result = f.raw(f.post(opened));
  if (files < 5000) {
    assert.equal(result.ok, true); assert.equal(result.result.status, 303);
    assert.deepEqual(result.rename_peaks, [files + 1]);
    assert.equal(JSON.parse(f.bytes(opened.cookie)).body.revision, 1);
  } else {
    assert.equal(result.ok, false); assert.equal(result.error, 'DEMO_STATE_FILE_QUOTA');
    assert.equal(f.bytes(opened.cookie), before);
  }
  assert.deepEqual(readdirSync(f.state), names);
  assert.equal(f.call({ cookie: opened.cookie }).status, 200, 'Existing read needs no pending slot');
});

test('three concurrent creators racing the final two file slots admit exactly one session', async t => {
  const f = fixture(t); f.residue(4998);
  const results = await Promise.all(Array.from({ length: 3 }, () => f.start().done));
  assert.equal(results.filter(r => r.ok && r.result.status === 200).length, 1);
  assert.equal(results.filter(r => !r.ok && r.error === 'DEMO_STATE_FILE_QUOTA').length, 2);
  assert.deepEqual(results.flatMap(r => r.rename_peaks ?? []), [5000]);
  assert.equal(readdirSync(f.state).length, 5000);
  assert.equal(readdirSync(f.state).filter(p => p.endsWith('.json')).length, 1);
});

test('failed new-session rename retains lock plus pending file within the ceiling and blocks another creation', t => {
  const f = fixture(t); f.residue(4998);
  const result = f.raw({}, true);
  assert.equal(result.ok, true); assert.equal(result.result.status, 500); assert.equal(result.result.headers['Set-Cookie'], undefined);
  assert.deepEqual(result.rename_peaks, [5000]);
  const names = readdirSync(f.state);
  assert.equal(names.length, 5000); assert.equal(names.filter(p => p.endsWith('.json')).length, 0);
  assert.equal(names.filter(p => p.includes('.json.pending-')).length, 1);
  assert.equal(names.filter(p => p.endsWith('.json.lock')).length, 1);
  assert.equal(f.raw().error, 'DEMO_STATE_FILE_QUOTA'); assert.deepEqual(readdirSync(f.state), names);
  assert.equal(f.call({ request_target: '/__upgrade/search' }).status, 200);
});

test('failed existing-session rename retains pending evidence and exact receipts, then refuses further POSTs', t => {
  const f = fixture(t), opened = f.open(); assert.equal(f.call(f.lead(opened)).status, 303);
  f.residue(4997); const before = f.bytes(opened.cookie);
  const result = f.raw(f.post(opened), true);
  assert.equal(result.ok, true); assert.equal(result.result.status, 500); assert.deepEqual(result.rename_peaks, [5000]);
  const names = readdirSync(f.state);
  assert.equal(names.length, 5000); assert.equal(names.filter(p => p.includes('.json.pending-')).length, 1);
  assert.equal(f.bytes(opened.cookie), before);
  assert.equal(f.raw(f.post(opened)).error, 'DEMO_STATE_FILE_QUOTA');
  assert.equal(f.raw(f.lead(opened)).error, 'DEMO_STATE_FILE_QUOTA', 'Exact replay also reserves conservatively');
  const receipt = f.call({ cookie: opened.cookie, request_target: '/__upgrade/receipt?operation=' + sha('admission-lead-operation') });
  assert.equal(receipt.status, 200); assert.equal(f.bytes(opened.cookie), before); assert.deepEqual(readdirSync(f.state), names);
});

test('corrupt or missing-lock existing state is an error, never a retry/reset/new cookie', t => {
  const f = fixture(t), opened = f.open(), path = f.file(opened.cookie), original = f.bytes(opened.cookie);
  rmSync(f.gate); writeFileSync(path, '{corrupt');
  const corrupt = f.call({ cookie: opened.cookie }); assert.equal(corrupt.status, 500); assert.equal(corrupt.headers['Set-Cookie'], undefined);
  assert.equal(readFileSync(path, 'utf8'), '{corrupt'); assert.ok(!existsSync(f.gate));
  writeFileSync(path, original); rmSync(path + '.lock');
  const missing = f.call({ cookie: opened.cookie }); assert.equal(missing.status, 500); assert.equal(missing.headers['Set-Cookie'], undefined);
  assert.equal(f.bytes(opened.cookie), original); assert.ok(!existsSync(path + '.lock')); assert.ok(!existsSync(f.gate));
});
