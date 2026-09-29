import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const php = process.env.UPGRADE_PHP_BIN;
const script = String.raw`
require $argv[1];
use Upgrade\Core\FactsProperty as F;
$raw=json_encode(['title'=>'Фактические данные 😀','body'=>str_repeat('Наличие неизвестно; цена 2178 р.; ',5000)],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
$fail=function(callable $work):bool{try{$work();return false;}catch(Throwable $error){return true;}};
$envelope=function(string $body,int $size,?string $sha=null):string{return 'UPGRADE_FACTS:'.json_encode(['version'=>1,'encoding'=>'gzip+base64','raw_bytes'=>$size,'raw_sha256'=>$sha??hash('sha256',$body),'data'=>base64_encode(gzencode($body,9))],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);};
switch($argv[2]){
case 'legacy':
  $values=['[]','{}','null','  {"x":1,"unicode":"Факт"}  ',json_encode(str_repeat('x',59998),JSON_THROW_ON_ERROR)];
  foreach($values as $value){if(F::encode($value)!==$value||F::decode($value)!==$value)throw new RuntimeException('Legacy bytes changed');}
  echo json_encode(['count'=>count($values),'boundary'=>strlen(end($values))]);break;
case 'roundtrip':
  $stored=F::encode($raw);$decoded=F::decode($stored);
  if($decoded!==$raw)throw new RuntimeException('Roundtrip changed bytes');
  echo json_encode(['raw_bytes'=>strlen($raw),'stored_bytes'=>strlen($stored),'stable'=>F::encode($raw)===$stored,'raw_sha'=>hash('sha256',$raw),'decoded_sha'=>hash('sha256',$decoded)]);break;
case 'legacy-native-limit':
  $unicode=json_encode(str_repeat('я',31000),JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
  $boundary=json_encode(str_repeat('x',65533),JSON_THROW_ON_ERROR);
  if(F::decode($unicode)!==$unicode||F::decode($boundary)!==$boundary||F::decode(F::encode($unicode))!==$unicode)throw new RuntimeException('Native legacy bytes changed');
  echo json_encode(['unicode_bytes'=>strlen($unicode),'boundary_bytes'=>strlen($boundary),'new_encoding_compressed'=>F::encode($unicode)!==$unicode,'oversized_rejected'=>$fail(fn()=>F::decode(json_encode(str_repeat('x',65534),JSON_THROW_ON_ERROR)))]);break;
case 'corruption':
  $stored=F::encode($raw);$p=strlen('UPGRADE_FACTS:');$e=json_decode(substr($stored,$p),true,512,JSON_THROW_ON_ERROR);$cases=[];
  $cases['truncation']=substr($stored,0,-8);
  foreach(['version'=>2,'encoding'=>'gzip','raw_bytes'=>strlen($raw)-1,'raw_sha256'=>str_repeat('0',64),'data'=>'!invalid!','extra'=>true] as $key=>$value){$c=$e;$c[$key]=$value;$cases[$key]='UPGRADE_FACTS:'.json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);}
  $c=$e;$c['data']=substr($c['data'],0,-4);$cases['gzip-truncation']='UPGRADE_FACTS:'.json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
  $c=$e;$c['data'].="\n";$cases['base64-whitespace']='UPGRADE_FACTS:'.json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
  $cases['duplicate-key']=str_replace('"version":1','"version":1,"version":1',$stored);
  $cases['raw-invalid']='{"truncated":';
  $cases['encoded-invalid-json']=$envelope(str_repeat('x',70000),70000);
  $cases['lying-length']=$envelope($raw,60001);
  $results=[];foreach($cases as $name=>$value)$results[$name]=$fail(fn()=>F::decode($value));echo json_encode($results);break;
case 'limits':
  $results=[];
  $results['raw-too-large']=$fail(fn()=>F::encode('"'.str_repeat('x',F::MAX_RAW_BYTES).'"'));
  $results['invalid-json']=$fail(fn()=>F::encode('{not-json}'));
  $results['incompressible']=$fail(fn()=>F::encode(json_encode(base64_encode(random_bytes(70000)),JSON_THROW_ON_ERROR)));
  $results['stored-too-large']=$fail(fn()=>F::decode('UPGRADE_FACTS:'.str_repeat('x',F::MAX_STORED_BYTES)));
  $bomb='"'.str_repeat('x',F::MAX_RAW_BYTES).'"';
  $results['bounded-expansion']=$fail(fn()=>F::decode($envelope($bomb,F::MAX_RAW_BYTES)));
  $results['declared-too-large']=$fail(fn()=>F::decode($envelope($raw,F::MAX_RAW_BYTES+1)));
  echo json_encode($results);break;
default:throw new RuntimeException('Unknown test');
}`;
function run(scenario: string) {
  const result = spawnSync(
    php!,
    [
      "-n",
      "-r",
      script,
      resolve("bitrix/module/upgrade.core/lib/factsproperty.php"),
      scenario,
    ],
    { encoding: "utf8", timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
test(
  "actual PHP facts codec preserves legacy raw JSON including the 60000-byte boundary",
  { skip: !php },
  () => {
    assert.deepEqual(run("legacy"), { count: 5, boundary: 60000 });
  },
);
test(
  "actual PHP facts codec roundtrips large Unicode bytes and raw hash deterministically below property limit",
  { skip: !php },
  () => {
    const result = run("roundtrip");
    assert.ok(result.raw_bytes > 65535);
    assert.ok(result.stored_bytes <= 60000);
    assert.equal(result.stable, true);
    assert.equal(result.raw_sha, result.decoded_sha);
  },
);

test(
  "actual PHP facts codec reads legacy Unicode above 60000 bytes through the native 65535-byte boundary",
  { skip: !php },
  () => {
    assert.deepEqual(run("legacy-native-limit"), {
      unicode_bytes: 62002,
      boundary_bytes: 65535,
      new_encoding_compressed: true,
      oversized_rejected: true,
    });
  },
);
test(
  "actual PHP facts codec fails closed for corruption, envelope schema/version and invalid JSON",
  { skip: !php },
  () => {
    const result = run("corruption");
    for (const [name, rejected] of Object.entries(result))
      assert.equal(rejected, true, name);
    assert.equal(Object.keys(result).length, 13);
  },
);
test(
  "actual PHP facts codec rejects incompressible values and bounded decompression/size violations",
  { skip: !php },
  () => {
    const result = run("limits");
    for (const [name, rejected] of Object.entries(result))
      assert.equal(rejected, true, name);
    assert.equal(Object.keys(result).length, 6);
  },
);
