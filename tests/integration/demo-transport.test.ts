import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const php=process.env.UPGRADE_PHP_BIN;
test('actual PHP keeps own exact request while CMS bootstrap sees no auth, query, form, cookie or upload input', {skip:!php}, t=>{
  const dir=mkdtempSync(join(tmpdir(),'upgrade-demo-transport-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const runner=join(dir,'runner.php');
  writeFileSync(runner,String.raw`<?php
require $argv[1];
$input=json_decode(file_get_contents('php://stdin'),true,32,JSON_THROW_ON_ERROR);
$_SERVER=$input['server'];$_GET=['bx_hit_hash'=>'hostile','logout'=>'yes'];$_POST=['AUTH_FORM'=>'Y','TYPE'=>'REGISTRATION','USER_LOGIN'=>'hostile'];
$_REQUEST=array_merge($_GET,$_POST);$_COOKIE=['PHPSESSID'=>'hostile'];$_FILES=['file'=>['tmp_name'=>'hostile']];
$bootstrap=false;
try {
 $captured=\Upgrade\Core\DemoTransport::capture($_SERVER,$input['body']);
 \Upgrade\Core\DemoTransport::isolateGlobals();
 // A synthetic bootstrap witness exercises the same global inputs read by
 // actual Bitrix main/include.php AUTH_FORM and bx_hit_hash handlers.
 $bootstrap=true;$effect=!empty($_POST['AUTH_FORM'])||isset($_REQUEST['bx_hit_hash'])||!empty($_COOKIE['PHPSESSID']);
 echo json_encode(['captured'=>$captured,'cms'=>['get'=>$_GET,'post'=>$_POST,'request'=>$_REQUEST,'cookie'=>$_COOKIE,'files'=>$_FILES,'server'=>$_SERVER],'effect'=>$effect]);
}catch(Throwable $e){echo json_encode(['rejected'=>$e->getCode(),'bootstrap'=>$bootstrap]);}
`);
  const server={REQUEST_METHOD:'POST',REQUEST_URI:'/__upgrade/action',QUERY_STRING:'AUTH_FORM=Y',HTTP_HOST:'demo.example',HTTPS:'on',UPGRADE_ORIGIN:'https://demo.example',CONTENT_TYPE:'application/x-www-form-urlencoded',CONTENT_LENGTH:'999',UPGRADE_COOKIE_HEADER:'PHPSESSID=secret; upgrade_demo_session='+'a'.repeat(64),HTTP_COOKIE:'PHPSESSID=secret',HTTP_AUTHORIZATION:'Basic secret',PHP_AUTH_USER:'secret',PHP_AUTH_PW:'secret',REDIRECT_HTTP_AUTHORIZATION:'Basic secret',DOCUMENT_ROOT:'/safe/cms'};
  const body='AUTH_FORM=Y&TYPE=REGISTRATION&USER_LOGIN=hostile&csrf=unchanged';
  const call=(patch:Record<string,unknown>={},raw=body)=>{
    const result=spawnSync(php!,['-n',runner,resolve('bitrix/module/upgrade.core/lib/demotransport.php')],{input:JSON.stringify({server:{...server,...patch},body:raw}),encoding:'utf8',timeout:20000,windowsHide:true});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');return JSON.parse(result.stdout);
  };
  const result=call();
  assert.equal(result.effect,false);
  assert.equal(result.captured.body,body);assert.equal(result.captured.method,'POST');assert.equal(result.captured.request_target,'/__upgrade/action');
  assert.equal(result.captured.cookie,'a'.repeat(64));
  for(const name of ['get','post','request','cookie','files'])assert.deepEqual(result.cms[name],[]);
  assert.equal(result.cms.server.REQUEST_METHOD,'GET');assert.equal(result.cms.server.QUERY_STRING,'');assert.equal(result.cms.server.REQUEST_URI,'/local/upgrade-route.php');
  assert.equal(result.cms.server.DOCUMENT_ROOT,'/safe/cms');
  assert.ok(!JSON.stringify(result.cms).includes('secret'));
  const exact='/index.php?AUTH_FORM=Y&a=1&a=2&empty=&encoded=%2F';
  const get=call({REQUEST_METHOD:'GET',REQUEST_URI:exact},'');
  assert.equal(get.captured.request_target,exact);assert.equal(get.effect,false);assert.equal(get.cms.server.QUERY_STRING,'');
  for(const [patch,raw,status] of [
    [{UPGRADE_ORIGIN:'https://foreign.example'},body,403],
    [{REQUEST_URI:'/source-action'},body,405],
    [{REQUEST_URI:'/__upgrade/action?x=1'},body,405],
    [{CONTENT_TYPE:'multipart/form-data; boundary=any'},body,415],
    [{REQUEST_METHOD:'DELETE'},'',405],
    [{},'x'.repeat(8193),400],
    [{REQUEST_METHOD:'GET'},body,400],
  ] as const){const rejected=call(patch,raw);assert.equal(rejected.rejected,status);assert.equal(rejected.bootstrap,false);}
  const duplicate=call({UPGRADE_COOKIE_HEADER:'upgrade_demo_session='+ 'a'.repeat(64)+'; upgrade_demo_session='+ 'a'.repeat(64)});
  assert.equal(duplicate.captured.cookie,'invalid-duplicate-cookie');
});

test('deployed own router captures and isolates before its first CMS include and uses retained exact target',()=>{
  const source=readFileSync('bitrix/local/upgrade-route.php','utf8');
  const capture=source.indexOf('DemoTransport::capture('),isolate=source.indexOf('DemoTransport::isolateGlobals()'),bootstrap=source.indexOf("require $_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php'");
  assert.ok(capture>0&&isolate>capture&&bootstrap>isolate);
  assert.ok(source.includes("$request=$demoRequest['request_target'];"));
  assert.ok(source.includes("$demoRequest+['item_id'=>$matched]"));
});
