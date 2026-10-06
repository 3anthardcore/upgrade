import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const php = process.env.UPGRADE_PHP_BIN;
const script = resolve('scripts/verify-native-transport.php');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const disabled = 'mail,exec,passthru,shell_exec,system,popen,proc_open';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'upgrade-native-transport-'));
  t.after(() => {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^upgrade-native-transport-[A-Za-z0-9_-]+$/);
    rmSync(target, {recursive:true, force:true});
  });
  const root = join(dir, 'cms');
  const helper = join(root, 'local/modules/upgrade.core/lib/demotransport.php');
  const prolog = join(root, 'bitrix/modules/main/include/prolog_before.php');
  mkdirSync(dirname(helper), {recursive:true}); mkdirSync(dirname(prolog), {recursive:true});
  const helperBytes = readFileSync('bitrix/module/upgrade.core/lib/demotransport.php');
  writeFileSync(helper, helperBytes);
  const prepend = join(dir, 'prepend.php');
  const prependBytes = '<?php define("UPGRADE_SANDBOX_PREPEND_ACTIVE",true);';
  writeFileSync(prepend, prependBytes);
  const marker = join(dir, 'bootstrap.json'), sql = join(dir, 'sql.jsonl');
  writeFileSync(prolog, String.raw`<?php
namespace {
  file_put_contents(getenv('PROBE_MARKER'),json_encode(['get'=>$_GET,'post'=>$_POST,'cookie'=>$_COOKIE,'request'=>$_REQUEST,'files'=>$_FILES,'method'=>$_SERVER['REQUEST_METHOD'],'uri'=>$_SERVER['REQUEST_URI'],'query'=>$_SERVER['QUERY_STRING']]));
  echo 'PRIVATE_BOOTSTRAP_OUTPUT_SENTINEL';
  if(getenv('PROBE_FAILURE')==='throw')throw new \RuntimeException('PRIVATE_SECRET_ERROR_SENTINEL');
  if(getenv('PROBE_FAILURE')==='exit')exit;
}
namespace Bitrix\Main {
  final class Dictionary {public function __construct(private array $value){}public function toArray():array{return $this->value;}}
  final class Request {
    public function getQueryList():Dictionary{return new Dictionary(getenv('PROBE_FAILURE')==='query'?['bx_hit_hash'=>'PRIVATE_QUERY_SENTINEL']:$_GET);}
    public function getPostList():Dictionary{return new Dictionary(getenv('PROBE_FAILURE')==='post'?['AUTH_FORM'=>'Y']:$_POST);}
    public function getCookieList():Dictionary{return new Dictionary(getenv('PROBE_FAILURE')==='cookie'?['PHPSESSID'=>'PRIVATE_COOKIE_SENTINEL']:$_COOKIE);}
    public function getRequestMethod():string{return getenv('PROBE_FAILURE')==='method'?'POST':$_SERVER['REQUEST_METHOD'];}
    public function getRequestUri():string{return getenv('PROBE_FAILURE')==='uri'?'/private?secret=value':$_SERVER['REQUEST_URI'];}
  }
  final class Row {public function fetch():array{return ['C'=>getenv('PROBE_FAILURE')==='count'?'invalid_count':'3'];}}
  final class Connection {
    public function query(string $sql):Row {file_put_contents(getenv('PROBE_SQL'),json_encode($sql)."\n",FILE_APPEND);return new Row;}
  }
  final class Application {
    public static function getInstance():self{return new self;}
    public function getContext():self{return $this;}
    public function getRequest():Request{return new Request;}
    public static function getConnection():Connection{return new Connection;}
  }
}
`);
  const options = {project:'probe-project', target:'probe-target', 'document-root':root,
    'transport-sha256':sha(helperBytes), 'prepend-file':prepend, 'prepend-sha256':sha(prependBytes)};
  const env = {...process.env, UPGRADE_DEMO:'1', UPGRADE_PROJECT_ID:'probe-project', UPGRADE_TARGET_ID:'probe-target', PROBE_MARKER:marker, PROBE_SQL:sql};
  const call = (changes: Record<string,string> = {}, extraEnv: Record<string,string> = {}, ini: string[] = [], tail: string[] = []) => {
    const p = spawnSync(php!, ['-n','-d',`auto_prepend_file=${prepend}`,'-d',`disable_functions=${disabled}`,
      '-d','allow_url_fopen=0','-d','allow_url_include=0',...ini,script,
      ...Object.entries({...options,...changes}).map(([key,value])=>`--${key}=${value}`),...tail],
      {env:{...env,...extraEnv},encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});
    assert.equal(p.error,undefined,String(p.error));
    assert.equal(p.stderr,'');
    assert.ok(!p.stdout.includes('PRIVATE_')&&!p.stdout.includes('AUTH_FORM')&&!p.stdout.includes('USER_LOGIN')&&!p.stdout.includes('synthetic_transport_probe'));
    return {process:p, result:JSON.parse(p.stdout)};
  };
  return {dir, root, helper, prolog, prepend, marker, sql, options, call};
}

test('real PHP probe executes its guarded fixture and only three count SELECTs; not native Bitrix proof', {skip:!php}, t => {
  const f=fixture(t), {process:p,result:r}=f.call();
  assert.equal(p.status,0,JSON.stringify(r));assert.equal(r.status,'CHECKS_PASSED');
  assert.deepEqual(r.context,{query_count:0,post_count:0,cookie_count:0,method:'GET',uri:'/local/upgrade-route.php'});
  assert.equal(r.own_request.exact_preserved,true);
  assert.equal(r.own_request.get_target_sha256,sha('/__upgrade/cart?bx_hit_hash=synthetic_probe&x=1&x=2&empty=&encoded=%2F'));
  assert.equal(r.own_request.post_body_sha256,sha('AUTH_FORM=Y&TYPE=REGISTRATION&USER_LOGIN=synthetic_transport_probe&csrf=synthetic_only'));
  assert.deepEqual(r.counts,{b_user:3,b_sale_order:3,b_event:3});
  assert.equal(r.before_after_comparison,'NOT_PERFORMED');assert.equal(r.native_deployment_attestation,'REQUIRED_SEPARATELY');
  assert.deepEqual(readFileSync(f.sql,'utf8').trim().split('\n').map(x=>JSON.parse(x)),[
    'SELECT COUNT(*) AS C FROM b_user','SELECT COUNT(*) AS C FROM b_sale_order','SELECT COUNT(*) AS C FROM b_event']);
  const observed=JSON.parse(readFileSync(f.marker,'utf8'));
  for(const key of ['get','post','cookie','request','files'])assert.deepEqual(observed[key],[]);
  assert.equal(observed.method,'GET');assert.equal(observed.uri,'/local/upgrade-route.php');assert.equal(observed.query,'');
});

test('real PHP guard failures stop before fixture bootstrap, including exact helper/prepend pin and environment', {skip:!php}, t => {
  const f=fixture(t);
  const cases: [Record<string,string>,Record<string,string>,string[],string[],string][] = [
    [{'transport-sha256':'0'.repeat(64)},{},[],[],'FILE_SHA256_MISMATCH'],
    [{'prepend-sha256':'0'.repeat(64)},{},[],[],'FILE_SHA256_MISMATCH'],
    [{'prepend-file':f.prolog},{},[],[],'PREPEND_REALPATH_GUARD_REQUIRED'],
    [{'project':'../foreign'},{},[],[],'PROJECT_OR_TARGET_INVALID'],
    [{'document-root':f.root+'/.'},{},[],[],'CANONICAL_DOCUMENT_ROOT_REQUIRED'],
    [{},{UPGRADE_PROJECT_ID:'foreign'},[],[],'DEMO_PROJECT_TARGET_BINDING_REQUIRED'],
    [{},{UPGRADE_TARGET_ID:'foreign'},[],[],'DEMO_PROJECT_TARGET_BINDING_REQUIRED'],
    [{},{UPGRADE_DEMO:'0'},[],[],'DEMO_PROJECT_TARGET_BINDING_REQUIRED'],
    [{},{},['-d','disable_functions=mail'],[],'DISABLED_FUNCTION_POLICY_REQUIRED'],
    [{},{},['-d','allow_url_fopen=1'],[],'URL_STREAM_POLICY_REQUIRED'],
    [{},{},['-d','auto_prepend_file='],[],'PREPEND_REALPATH_GUARD_REQUIRED'],
    [{},{},[],['--project=probe-project'],'ARGUMENT_UNKNOWN_OR_DUPLICATE'],
    [{},{},[],['--unexpected=value'],'ARGUMENT_UNKNOWN_OR_DUPLICATE'],
    [{},{},[],['positional'],'ARGUMENT_INVALID'],
  ];
  for(const [changes,env,ini,tail,reason] of cases){const {process:p,result:r}=f.call(changes,env,ini,tail);assert.equal(p.status,1);assert.equal(r.status,'ERROR');assert.equal(r.reason,reason);assert.equal(r.cms_bootstrap_attempted,false);assert.equal(r.counts_status,'NOT_RUN');assert.equal(existsSync(f.marker),false);assert.equal(existsSync(f.sql),false);}
});

test('real PHP rejects nonneutral D7 context and redacts vendor output/errors without any SELECT', {skip:!php}, t => {
  const f=fixture(t);
  for(const failure of ['query','post','cookie','method','uri','throw','exit']){
    const {process:p,result:r}=f.call({}, {PROBE_FAILURE:failure});
    assert.equal(p.status,1);assert.equal(r.status,'ERROR');assert.equal(r.cms_bootstrap_attempted,true);assert.equal(existsSync(f.sql),false);
    assert.equal(r.counts_status,'NOT_RUN');
    assert.equal(r.reason, failure==='throw'?'PROBE_FAILURE_REDACTED':failure==='exit'?'PROCESS_TERMINATED':'CMS_CONTEXT_NOT_NEUTRAL');
  }
});

test('real PHP count failure never emits partial counts or a success claim', {skip:!php}, t => {
  const f=fixture(t), {process:p,result:r}=f.call({}, {PROBE_FAILURE:'count'});
  assert.equal(p.status,1);assert.equal(r.reason,'COUNT_RESULT_INVALID');assert.equal(r.counts_status,'NOT_VERIFIED');assert.equal(r.counts,undefined);
});

test('CLI guard and fixed installed-helper boundary precede first CMS include', () => {
  const code=readFileSync(script,'utf8');
  assert.ok(code.indexOf("PHP_SAPI !== 'cli'") < code.indexOf('require $helper'));
  assert.ok(code.indexOf('DemoTransport::isolateGlobals()') < code.indexOf('require $prolog'));
  assert.ok(code.indexOf('DISABLED_FUNCTION_POLICY_REQUIRED') < code.indexOf('require $helper'));
  assert.ok(!/CUser::|->(?:Add|Update|Delete)\(|INSERT\s+INTO|UPDATE\s+b_|DELETE\s+FROM|\b(?:curl_exec|fsockopen)\(/i.test(code));
});
