import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
const modulePath = '../../scripts/verify-native-browser.mjs';
const { readInputs, safeTarget, readAllowed, validateForm, filterSetCookies, openJournal, runVerifier, parseArgs, boundedFetch, forwardedHeaders } = await import(modulePath);
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const php = process.env.UPGRADE_PHP_BIN ?? resolve('var/tools/php-8.3.35/php.exe');
function temporary(t: any) {
  const dir = mkdtempSync(join(tmpdir(),'upgrade-native-browser-'));
  t.after(() => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'upgrade-native-browser-')); rmSync(dir,{recursive:true,force:true}); });
  return dir;
}
function makeSnapshot() {
  const base = { schema_version:1, project_id:'native-browser-test', items:[
    {id:'home',title:'Главная тестового сайта',request_target:'/',page_kind:'HOME',is_product:false,category_ids:[],attributes:{},body_text:'Главная'},
    {id:'information',title:'Информация',request_target:'/information?x=1&x=2&empty=',page_kind:'CONTENT',is_product:false,category_ids:[],attributes:{},body_text:'Проверенное описание'},
    {id:'category',title:'Тестовый каталог',request_target:'/category',page_kind:'CATEGORY',is_product:false,category_ids:[],attributes:{},body_text:'Каталог'},
    {id:'product',title:'Тестовый товар',request_target:'/product',page_kind:'PRODUCT',is_product:true,category_ids:['category'],attributes:{brand:['Test']},body_text:'Факты',thumbnail:null,variants:[],
      prices:[{id:'raw-price',role:'UNKNOWN',status:'REQUIRES_REVIEW',raw_text:'2178 р.',money:null,maximum:null,unit:null,totals_eligible:false,conditions:[]}],
      purchase:{price_id:null,min_quantity:null,quantity_step:null,max_quantity:null,default_quantity:'1',blockers:['PRICE_UNKNOWN']}}
  ]};
  return {...base,snapshot_id:hash(JSON.stringify(base))};
}
function inputs(t: any, origin='https://demo.example') {
  const dir=temporary(t), snapshot=makeSnapshot(), raw=JSON.stringify(snapshot);
  const snapshotPath=join(dir,'snapshot.json'), passwordFile=join(dir,'password');
  writeFileSync(snapshotPath,raw); writeFileSync(passwordFile,'fixture-only-password\n',{mode:0o600});
  return {dir,snapshot,options:{origin,user:'upgrade',passwordFile,snapshot:snapshotPath,snapshotSha256:hash(raw),output:join(dir,'output'),allowLoopbackHttp:origin.startsWith('http:')}};
}
test('pinned snapshot and exact raw URL identities; host, traversal, pin and duplicates fail closed', t=>{
  const f=inputs(t), result=readInputs(f.options);
  assert.ok(result.targets.has('/information?x=1&x=2&empty='));
  assert.equal(readAllowed('/information?x=2&x=1&empty=',result),false);
  assert.equal(safeTarget('/literal?'),'/literal?');
  assert.equal(safeTarget('/Literal%2FPart?x=1&x=2&empty='),'/Literal%2FPart?x=1&x=2&empty=');
  for(const value of ['//other.example/a','/a/../x','/%2e%2e/x','/a\\x','/x#fragment','/a b','/x%zz'])assert.throws(()=>safeTarget(value));
  for(const origin of ['http://demo.example','https://user:pass@demo.example','https://demo.example/','https://demo.example/x']) assert.throws(()=>readInputs({...f.options,origin}));
  assert.throws(()=>readInputs({...f.options,snapshotSha256:'0'.repeat(64)}),/SNAPSHOT_HASH_MISMATCH/);
  const changed={...f.snapshot,snapshot_id:'0'.repeat(64)}, raw=JSON.stringify(changed);writeFileSync(f.options.snapshot,raw);
  assert.throws(()=>readInputs({...f.options,snapshotSha256:hash(raw)}),/SNAPSHOT_ID_MISMATCH/);
});
test('only exact own reads and hash media permitted; source/admin/action GET/duplicate queries blocked',t=>{
  const f=inputs(t), result=readInputs(f.options);
  for(const target of ['/bitrix/admin/','/index.php?route=checkout/cart/add','/__upgrade/action','/__upgrade/receipt','/__upgrade/cart?operation=x','/__upgrade/search?q=x&q=y','/__upgrade/search?unknown=1'])assert.equal(readAllowed(target,result),false,target);
  assert.equal(readAllowed('/__upgrade/search?q=x&category=category&a0=Test&sort=title_asc',result),true);
  assert.equal(readAllowed('/__upgrade/cart?operation='+'a'.repeat(64),result),true);
  assert.equal(readAllowed('/upload/upgrade/native-browser-test/'+'a'.repeat(64)+'.jpg',result,'image'),true);
  assert.equal(readAllowed('/upload/upgrade/other/'+'a'.repeat(64)+'.jpg',result,'image'),false);
  assert.equal(readAllowed('/local/templates/upgrade/styles.css',result,'stylesheet'),true);
  assert.equal(readAllowed('/product',result,'image'),false);
});
test('POST intent checks snapshot, duplicate fields, item, synthetic identity and no extra PII',t=>{
  const f=inputs(t), result=readInputs(f.options), fields=[['action','cart.add'],['csrf','a'.repeat(64)],['expected_snapshot_id',f.snapshot.snapshot_id],['idempotency_key','fixture-key-123456789'],['item_id','product'],['quantity','1']];
  const form={method:'post',action:'/__upgrade/action',fields};assert.equal(validateForm(form,result,'cart.add').quantity,'1');
  assert.throws(()=>validateForm({...form,fields:[...fields,['quantity','2']]},result,'cart.add'),/FORM_FIELDS/);
  assert.throws(()=>validateForm({...form,action:'/checkout'},result,'cart.add'),/FORM_BOUNDARY/);
  assert.throws(()=>validateForm({...form,fields:fields.map(([k,v])=>[k,k==='expected_snapshot_id'?'b'.repeat(64):v])},result,'cart.add'),/FORM_BINDING/);
  assert.throws(()=>validateForm({...form,fields:[...fields,['email','person@example.org']]},result,'cart.add'),/FORM_UNEXPECTED/);
  const demo={...form,fields:[...fields.slice(1,4),['action','demo.lead'],['synthetic','1'],['consent','1'],['identity','demo-customer'],['topic','general']]};
  assert.equal(validateForm(demo,result,'demo.lead').identity,'demo-customer');
  assert.throws(()=>validateForm({...demo,fields:demo.fields.map(([k,v])=>[k,k==='identity'?'real-person':v])},result,'demo.lead'),/SYNTHETIC/);
});
test('vendor cookies discarded; duplicate/malformed/unsafe own cookies rejected',()=>{
  const own='upgrade_demo_session='+'a'.repeat(64)+'; Path=/; HttpOnly; SameSite=Strict; Secure';
  assert.equal(filterSetCookies(['PHPSESSID=do-not-persist; Path=/',own],true),own);
  assert.equal(filterSetCookies(['PHPSESSID=vendor'],true),null);
  assert.throws(()=>filterSetCookies([own,own],true),/COOKIE_DUPLICATE/);
  for(const value of [own.replace('a'.repeat(64),'bad'),own+'; Domain=demo.example',own.replace('; HttpOnly','')])assert.throws(()=>filterSetCookies([value],true));
});
test('unsolicited browser network directives stripped; CSP external reporting rejected',()=>{
  assert.deepEqual(forwardedHeaders({'content-type':'text/html','referrer-policy':'same-origin',link:'<https://source-never.example>; rel=preconnect',refresh:'0;url=https://source-never.example',nel:'{}','report-to':'{}','set-cookie':['VENDOR=secret']}),{'content-type':'text/html','referrer-policy':'same-origin'});
  assert.throws(()=>forwardedHeaders({'content-security-policy':"default-src 'none'; report-uri https://source-never.example"}),/RESPONSE_REPORTING_BLOCKED/);
});
test('durable private journal rejects collision, concurrent writer and binding drift; intent immutable',t=>{
  const f=inputs(t), binding=readInputs(f.options).binding, a=openJournal(f.options.output,binding);
  a.record('intent-test.json',{status:'UNKNOWN'});
  assert.throws(()=>a.record('intent-test.json',{status:'CONFIRMED'}));
  assert.throws(()=>openJournal(f.options.output,binding),/OUTPUT_ALREADY_EXISTS/);
  assert.throws(()=>openJournal(f.options.output,binding,true),/OUTPUT_BUSY/);
  a.close();assert.throws(()=>openJournal(f.options.output,{...binding,snapshot_id:'0'.repeat(64)},true),/CHECKPOINT_BINDING/);
  assert.throws(()=>openJournal(f.options.output,binding,true),/ORPHAN_INTENT_REQUIRES_REVIEW/);
  assert.equal(JSON.parse(readFileSync(join(f.options.output,'intent-test.json'),'utf8')).status,'UNKNOWN');
});
test('checkpoint operation must still match its immutable original intent before reconciliation',t=>{
  const f=inputs(t), binding=readInputs(f.options).binding, journal=openJournal(f.options.output,binding);
  const operation={name:'add',action:'cart.add',operation_id:'a'.repeat(64),body_sha256:'b'.repeat(64),fields:[['quantity','1']],intended_at:'2026-09-30T00:00:00.000Z',status:'UNKNOWN'};
  journal.state.operations.push(operation);journal.record('intent-add.json',operation);journal.save();journal.close();
  const same=openJournal(f.options.output,binding,true);same.state.operations[0].fields=[['quantity','2']];same.save();same.close();
  assert.throws(()=>openJournal(f.options.output,binding,true),/CHECKPOINT_INTENT_MISMATCH/);
});
test('CLI strict duplicate/unknown/missing options',()=>{
  assert.throws(()=>parseArgs(['--password','secret']),/CLI_ARGUMENT_INVALID/);
  assert.throws(()=>parseArgs(['--origin','https://demo.example','--origin','https://other.example']),/CLI_ARGUMENT_INVALID/);
  assert.throws(()=>parseArgs([]),/CLI_REQUIRED/);
});
test('real CLI entrypoint through current directory symlink returns help and fixed validation errors',t=>{
  const dir=temporary(t), link=join(dir,'current');symlinkSync(resolve('scripts'),link,process.platform==='win32'?'junction':'dir');
  const entry=join(link,'verify-native-browser.mjs');
  const help=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',entry,'--help'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/--snapshot-sha256/);assert.match(help.stdout,/never retries POST/);
  const bad=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',entry,'--password','must-not-be-echoed'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(bad.status,1);assert.deepEqual(JSON.parse(bad.stderr),{status:'FAILED',code:'CLI_ARGUMENT_INVALID'});assert.ok(!bad.stderr.includes('must-not-be-echoed'));
});

async function phpFixture(t:any, options:{blockAfterPost?:boolean; foreignImage?:boolean; foreignRedirect?:boolean; redirectAfterPost?:boolean}={}) {
  assert.ok(existsSync(php),'Real PHP required; set UPGRADE_PHP_BIN. A skip is not a passing browser test.');
  const f=inputs(t), base=resolve('bitrix').replaceAll('\\','/'), dir=f.dir.replaceAll('\\','/');mkdirSync(join(f.dir,'private'),{mode:0o700});
  const body=[
    `<?php declare(strict_types=1);`,
    `require '${base}/module/upgrade.core/lib/demoengine.php';require '${base}/module/upgrade.core/lib/demoweb.php';require '${base}/module/upgrade.core/lib/demoview.php';`,
    `$target=$_SERVER['REQUEST_URI'];if($target==='/local/templates/upgrade/styles.css'){header('Content-Type: text/css');readfile('${base}/local/templates/upgrade/styles.css');exit;}`,
    `if(($_SERVER['HTTP_AUTHORIZATION']??'')!=='Basic '.base64_encode('upgrade:fixture-only-password')){http_response_code(401);header('WWW-Authenticate: Basic realm="local-test"');exit;}`,
    `$snapshot=json_decode(file_get_contents('${dir}/snapshot.json'),true,128,JSON_THROW_ON_ERROR);$engine=new \\Upgrade\\Core\\DemoEngine($snapshot,'${dir}/private','native-browser-test');$matched=null;foreach($snapshot['items'] as $item)if($item['request_target']===$target)$matched=$item;`,
    `$response=\\Upgrade\\Core\\DemoWeb::handle($engine,$snapshot,['method'=>$_SERVER['REQUEST_METHOD'],'request_target'=>$target,'host'=>$_SERVER['HTTP_HOST'],'https'=>false,'origin'=>$_SERVER['HTTP_ORIGIN']??null,'cookie'=>$_COOKIE['upgrade_demo_session']??null,'body'=>file_get_contents('php://input'),'content_type'=>$_SERVER['CONTENT_TYPE']??null,'item_id'=>$matched['id']??null]);`,
    `if($_SERVER['REQUEST_METHOD']==='POST')file_put_contents('${dir}/post-count',"1\\n",FILE_APPEND|LOCK_EX);`,
    `http_response_code($response['status']);foreach($response['headers'] as $key=>$value)header($key.': '.$value);header('Set-Cookie: VENDOR=not-to-be-replayed; Path=/',false);`,
    `if(isset($_COOKIE['VENDOR']))file_put_contents('${dir}/vendor-replayed',$_SERVER['REQUEST_URI']."\\n",FILE_APPEND);`,
    `if(${options.foreignRedirect?'true':'false'}&&$target==='/'){http_response_code(302);header('Location: https://source-never.example/checkout');exit;}`,
    `if(${options.redirectAfterPost?'true':'false'}&&str_starts_with($target,'/__upgrade/cart?operation=')){http_response_code(302);header('Location: https://source-never.example/checkout');exit;}`,
    `if(${options.blockAfterPost?'true':'false'}&&$_SERVER['REQUEST_METHOD']==='POST'&&!file_exists('${dir}/allow-response')){http_response_code(503);header_remove('Location');exit;}`,
    `if($_SERVER['REQUEST_METHOD']==='POST')exit;`,
    `define('B_PROLOG_INCLUDED',true);class TestApp{function ShowTitle(){echo 'Upgrade fixture';}function ShowMeta($name){}}$APPLICATION=new TestApp();$GLOBALS['UPGRADE_NAVIGATION']=[['href'=>'/category','title'=>'Каталог']];require '${base}/local/templates/upgrade/header.php';`,
    `if($matched)echo '<h1>'.htmlspecialchars($matched['title'],ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</h1>';`,
    `if($response['view'])echo \\Upgrade\\Core\\DemoView::render($response['view']);elseif($matched)echo '<p>Только тестовые факты. Native Bitrix не проверен.</p>';`,
    `if(${options.foreignImage?'true':'false'}&&$target==='/')echo '<img src="https://source-never.example/image.jpg" alt="forbidden">';`,
    `require '${base}/local/templates/upgrade/footer.php';`
  ].join('\n');
  writeFileSync(join(f.dir,'server.php'),body);
  const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));const port=(probe.address() as any).port;await new Promise<void>(done=>probe.close(()=>done()));
  const server=spawn(php,['-n','-d',`extension_dir=${process.env.UPGRADE_PHP_EXT_DIR??resolve('var/tools/php-8.3.35/ext')}`,'-d','extension=mbstring','-S',`127.0.0.1:${port}`,join(f.dir,'server.php')],{stdio:['ignore','ignore','pipe']});
  let logs='';server.stderr.on('data',v=>{logs=(logs+v).slice(-20000);});
  t.after(async()=>{if(server.exitCode===null&&server.signalCode===null){const done=new Promise<void>(r=>server.once('exit',()=>r()));server.kill();await Promise.race([done,new Promise<void>(r=>setTimeout(r,2000))]);}});
  const origin=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){try{await fetch(origin);break;}catch{await new Promise(r=>setTimeout(r,50));}assert.equal(server.exitCode,null,logs);}
  return {...f,options:{...f.options,origin,allowLoopbackHttp:true},logs:()=>logs};
}
test('real PHP + Chromium JS-disabled scenario at five widths, separate counters and immutable evidence', {timeout:180000}, async t=>{
  const f=await phpFixture(t);const result=await runVerifier(f.options).catch((error:Error)=>{t.diagnostic(f.logs());throw error;});
  assert.equal(result.status,'LOCAL_BROWSER_SCENARIOS_VERIFIED');assert.equal(result.java_script_enabled,false);assert.equal(result.operations.length,4);
  assert.equal(result.exchanges.filter((entry:any)=>entry.method==='POST'&&entry.status===303).length,4);
  assert.equal(result.counters.browser_requests,result.counters.browser_responses);assert.equal(result.counters.browser_responses,result.exchanges.length);
  assert.equal(result.counters.cdp_request_intercepts,result.counters.browser_requests);assert.equal(result.counters.mediated_fetches,result.counters.browser_requests);
  assert.equal(result.counters.blocked,0);assert.equal(readdirSync(f.options.output).filter(name=>name.endsWith('.png')).length,45);
  assert.equal(existsSync(join(f.dir,'vendor-replayed')),false,existsSync(join(f.dir,'vendor-replayed'))?readFileSync(join(f.dir,'vendor-replayed'),'utf8'):'');assert.equal(result.full_readiness,'NOT_READY');
  const publicReceipt=readFileSync(join(f.options.output,'receipt.json'),'utf8');assert.ok(!publicReceipt.includes('fixture-only-password'));assert.ok(!publicReceipt.includes('csrf'));assert.ok(!publicReceipt.includes('VENDOR'));
  assert.throws(()=>openJournal(f.options.output,readInputs(f.options).binding),/OUTPUT_ALREADY_EXISTS/);
});
test('committed POST with lost acknowledgement stays UNKNOWN; restart reconciles GET and never repeats mutation', {timeout:120000},async t=>{
  const f=await phpFixture(t,{blockAfterPost:true});await assert.rejects(()=>runVerifier(f.options));
  const checkpoint=JSON.parse(readFileSync(join(f.options.output,'private-checkpoint.json'),'utf8'));
  assert.equal(checkpoint.status,'UNKNOWN_REQUIRES_RECONCILIATION');assert.equal(checkpoint.operations.length,1);assert.equal(checkpoint.operations[0].status,'UNKNOWN');
  assert.equal(readFileSync(join(f.dir,'post-count'),'utf8'),'1\n');const intent=readFileSync(join(f.options.output,'intent-cart-add.json'));
  writeFileSync(join(f.dir,'allow-response'),'yes');
  const child=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',resolve('scripts/verify-native-browser.mjs'),'--origin',f.options.origin,'--snapshot',f.options.snapshot,'--snapshot-sha256',f.options.snapshotSha256,'--user',f.options.user,'--password-file',f.options.passwordFile,'--output',f.options.output,'--allow-loopback-http','--reconcile'],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).status,'INCOMPLETE_RECONCILED');
  const result=JSON.parse(readFileSync(join(f.options.output,readdirSync(f.options.output).find(name=>name.startsWith('reconciliation-'))!),'utf8'));
  assert.equal(result.status,'INCOMPLETE_RECONCILED');assert.equal(result.confirmed_operations,1);assert.equal(result.repeated_posts,0);assert.ok(result.exchanges.every((entry:any)=>entry.method==='GET'));
  assert.equal(readFileSync(join(f.dir,'post-count'),'utf8'),'1\n');assert.deepEqual(readFileSync(join(f.options.output,'intent-cart-add.json')),intent);assert.equal(existsSync(join(f.options.output,'receipt.json')),false);
});
for(const kind of ['foreignImage','foreignRedirect'] as const)test(`actual browser ${kind} never sends foreign request or POST`,{timeout:45000},async t=>{
  const f=await phpFixture(t,{[kind]:true});await assert.rejects(()=>runVerifier(f.options),/FOREIGN_ORIGIN_BLOCKED|REDIRECT_BLOCKED/);
  assert.equal(existsSync(join(f.dir,'post-count')),false);const failures=readdirSync(f.options.output).filter(name=>name.startsWith('failure-'));assert.equal(failures.length,1);
  const receipt=JSON.parse(readFileSync(join(f.options.output,failures[0]),'utf8'));assert.equal(receipt.status,'INCOMPLETE');assert.equal(receipt.counters.blocked,1);
});
test('redirect GET after actual POST is intercepted; second-hop foreign Location blocked and operation remains UNKNOWN', {timeout:60000},async t=>{
  const f=await phpFixture(t,{redirectAfterPost:true});await assert.rejects(()=>runVerifier(f.options),/REDIRECT_BLOCKED/);
  assert.equal(readFileSync(join(f.dir,'post-count'),'utf8'),'1\n');
  const checkpoint=JSON.parse(readFileSync(join(f.options.output,'private-checkpoint.json'),'utf8'));assert.equal(checkpoint.status,'UNKNOWN_REQUIRES_RECONCILIATION');
  const failure=JSON.parse(readFileSync(join(f.options.output,readdirSync(f.options.output).find(name=>name.startsWith('failure-'))!),'utf8'));
  assert.equal(failure.counters.blocked,1);assert.equal(failure.counters.cdp_request_intercepts,failure.counters.mediated_fetches);
  assert.equal(failure.exchanges.some((entry:any)=>entry.request_target==='/checkout'),false);
});
test('independent HTTP transport enforces absolute slow-stream/size bounds and never follows redirects', {timeout:15000}, async t=>{
  let received=0;const server=createHttpServer((request,response)=>{
    received++;if(request.url==='/redirect'){response.writeHead(302,{Location:'/forbidden'});response.end();return;}
    if(request.url==='/large'){response.writeHead(200,{'Content-Length':'1000'});response.end('x'.repeat(1000));return;}
    response.writeHead(200,{'Content-Length':'100'});const interval=setInterval(()=>response.write('x'),20);response.on('close',()=>clearInterval(interval));
  });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  const response=await boundedFetch(origin+'/redirect',{method:'GET',headers:{}});assert.equal(response.status,302);assert.equal(received,1);
  await assert.rejects(()=>boundedFetch(origin+'/large',{method:'GET',headers:{},maximum:10}),/RESPONSE_LIMIT/);
  const start=Date.now();await assert.rejects(()=>boundedFetch(origin+'/slow',{method:'GET',headers:{},timeout:100}),/ABSOLUTE_TIMEOUT/);assert.ok(Date.now()-start<1000);
});
