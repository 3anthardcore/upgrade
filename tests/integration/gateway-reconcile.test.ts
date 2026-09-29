import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const php = process.env.UPGRADE_PHP_BIN;
// Actual own Gateway/Router execution with in-memory CIBlock/Connection doubles.
// This proves the reconciliation contract; no licensed CMS or target DB runs here.
const harness = String.raw`<?php
declare(strict_types=1);
namespace Bitrix\Main\DB {
    class Connection {
        public ?array $mapping=null; public array $expectedMapping=[]; public array $route=[]; public array $writes=[]; private ?array $saved=null;
        public function getSqlHelper() { return new class { function forSql(string $s): string { return addslashes($s); } }; }
        public function query(string $sql) {
            if (str_contains($sql,'FROM ug_project')) return new \Rows([['FENCE'=>1,'OWNER'=>'writer','LEASE_UNTIL'=>time()+300]]);
            if (str_contains($sql,'FROM ug_entity')) return new \Rows($this->mapping?[$this->mapping]:[]);
            if (str_contains($sql,'LEFT JOIN ug_entity')) return new \Rows([array_merge($this->route,['BITRIX_ID'=>$this->mapping['BITRIX_ID']??null,'ENTITY_TYPE'=>$this->mapping['ENTITY_TYPE']??null])]);
            if (str_contains($sql,'FROM ug_route')) return new \Rows([$this->route]);
            throw new \RuntimeException('Unexpected contract query');
        }
        public function queryExecute(string $sql): void {
            $this->writes[]=$sql;
            if (str_starts_with($sql,'INSERT INTO ug_entity ')) { $this->mapping=$this->expectedMapping; return; }
            if (str_starts_with($sql,'INSERT INTO ug_operation ')||str_starts_with($sql,'INSERT INTO ug_route ')) return;
            throw new \RuntimeException('Unexpected contract write');
        }
        public function startTransaction(): void { $this->saved=$this->mapping; }
        public function commitTransaction(): void {}
        public function rollbackTransaction(): void { $this->mapping=$this->saved; }
    }
}
namespace Bitrix\Main { class Application { public static $db; public static function getConnection(){return self::$db;} } }
namespace {
class Rows { public function __construct(private array $rows){} public function Fetch(){return array_shift($this->rows)?:false;} }
class CIBlockElement {
    public static array $row=[]; public static array $properties=[]; public static int $elementWrites=0; public static int $searchWrites=0;
    public static bool $allowWrites=false; public string $LAST_ERROR='';
    public static function GetList($order,$filter,$group,$nav,$select) {
        if (($filter['IBLOCK_ID']??null)!==1 || ($filter['=XML_ID']??null)!==(self::$row['XML_ID']??null)) return new Rows([]);
        return new Rows([array_intersect_key(self::$row,array_fill_keys($select,true))]);
    }
    public static function GetByID($id) { return new Rows($id===7?[self::$row]:[]); }
    public static function GetProperty($iblock,$id,$order,$filter) { if($iblock!==1||$id!==7) throw new RuntimeException('Wrong property binding'); return new Rows([['VALUE'=>self::$properties[$filter['CODE']]]]); }
    public function Add(...$args) { self::$elementWrites++; if(!self::$allowWrites)throw new RuntimeException('Matching recovered element must not be duplicated'); $f=$args[0];self::$properties=array_map(static fn($v)=>substr($v,0,65535),$f['PROPERTY_VALUES']);unset($f['PROPERTY_VALUES']);self::$row=['ID'=>7]+$f;return 7; }
    public function Update(...$args) { self::$elementWrites++; if(!self::$allowWrites)throw new RuntimeException('Matching recovered element must not be rewritten');self::$row=array_replace(self::$row,$args[1]);return true; }
    public static function SetPropertyValuesEx(...$args) { self::$elementWrites++; if(!self::$allowWrites)throw new RuntimeException('Matching recovered properties must not be rewritten');self::$properties=array_map(static fn($v)=>substr($v,0,65535),$args[2]); }
    public static function UpdateSearch(...$args) { self::$searchWrites++; }
}
class CIBlock { public static function clearIblockTagCache($id): void { if($id!==1) throw new RuntimeException('Wrong cache binding'); } }
require $argv[1]; require $argv[2];
$project='gateway-review'; $key=hash('sha256',json_encode([$project,'page','source-1'],JSON_UNESCAPED_SLASHES));
$entity=['source_id'=>'source-1','type'=>'page','stable_key'=>$key,'title'=>'Title & raw','description'=>'Description <raw>','seo'=>['title'=>'SEO & raw','description'=>'Observed description','h1'=>'Observed H1'],'blocks'=>[['type'=>'paragraph','text'=>'Actual <script>source</script> & text']],'facts'=>['price'=>['value'=>null,'status'=>'UNKNOWN']]];
$scenario=$argv[4];
if(str_starts_with($scenario,'codec-'))$entity['facts']['observed_text']=['value'=>str_repeat('Точный факт & <значение> / ',15000),'status'=>'OBSERVED'];
$encode=static fn($value): string=>json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
$fields=['NAME'=>'Title & raw','DETAIL_TEXT'=>'<p>Actual &lt;script&gt;source&lt;/script&gt; &amp; text</p>','DETAIL_TEXT_TYPE'=>'html','PREVIEW_TEXT'=>'Description <raw>','PREVIEW_TEXT_TYPE'=>'text','properties'=>['UG_SEO_TITLE'=>'SEO & raw','UG_DESCRIPTION'=>'Observed description','UG_H1'=>'Observed H1','UG_FACTS'=>$encode($entity['facts'])]];
CIBlockElement::$properties=$fields['properties'];
CIBlockElement::$row=['ID'=>7,'IBLOCK_ID'=>1,'XML_ID'=>'upgrade:'.$key,'ACTIVE'=>'Y']+array_diff_key($fields,['properties'=>true]);
$db=new \Bitrix\Main\DB\Connection(); \Bitrix\Main\Application::$db=$db;
$db->expectedMapping=['ENTITY_KEY'=>$key,'PROJECT_ID'=>$project,'ENTITY_TYPE'=>'page','SOURCE_ID'=>'source-1','BITRIX_ID'=>7,'MANAGED_HASH'=>hash('sha256',$encode($fields)),'PAYLOAD_HASH'=>hash('sha256',$encode($entity))];
$db->mapping=$db->expectedMapping;
$target='/Exact/a%2Fb.php?x=&x=1&x=2';
$route=['route_key'=>hash('sha256',$target),'request_target'=>$target,'entity_key'=>$key,'expected_status'=>200,'redirect_target'=>null];
$db->route=['ROUTE_KEY'=>$route['route_key'],'PROJECT_ID'=>$project,'REQUEST_TARGET'=>$target,'ENTITY_KEY'=>$key,'STATUS'=>200,'REDIRECT_TARGET'=>null];
$r=new ReflectionClass(\Upgrade\Core\Gateway::class); $g=$r->newInstanceWithoutConstructor();
foreach(['db'=>$db,'project'=>$project,'iblock'=>1] as $name=>$value) $r->getProperty($name)->setValue($g,$value);
if($r->getMethod('fields')->invoke($g,$entity)!==$fields) throw new RuntimeException('Raw managed fields differ from independent expected values');
$_SERVER['DOCUMENT_ROOT']=$argv[3];
$package=['manifest'=>['blockers'=>[]],'manifest_hash'=>str_repeat('b',64),'entities'=>[$entity],'routes'=>[$route],'assets'=>[],'asset_index'=>[]];
$scenario=$argv[4]; $output=['kind'=>'OWN_PHP_CONTRACT_NOT_BITRIX','scenario'=>$scenario];
if(str_starts_with($scenario,'codec-')) {
    CIBlockElement::$allowWrites=true;
    if($scenario==='codec-create'){CIBlockElement::$row=[];CIBlockElement::$properties=[];$db->mapping=null;}
    else{CIBlockElement::$row['NAME']='Previous owner-mapped name';CIBlockElement::$properties['UG_FACTS']='[]';$old=$fields;$old['NAME']=CIBlockElement::$row['NAME'];$old['properties']['UG_FACTS']='[]';$db->mapping['MANAGED_HASH']=hash('sha256',$encode($old));}
    $output['dry_run']=$g->dryRun($package);
    $output['apply']=$g->apply($package,1,'writer',$argv[5]);
    $output['raw_facts_match']=\Upgrade\Core\Router::content(7)['UPGRADE_PROPERTIES']['UG_FACTS']===$encode($entity['facts']);
    $output['stored_bytes']=strlen(CIBlockElement::$properties['UG_FACTS']);
    $output['raw_bytes']=strlen($encode($entity['facts']));
    $output['writes_after_first']=CIBlockElement::$elementWrites;
    $output['second_apply']=$g->apply($package,1,'writer',$argv[5]);
    $output['writes_after_second']=CIBlockElement::$elementWrites;
} elseif($scenario==='missing-map') {
    $db->mapping=null;
    $output['before']=$g->reconcile($package);
    $output['router_before']=\Upgrade\Core\Router::resolve($project,$target);
    $output['dry_run']=$g->dryRun($package);
    $output['apply']=$g->apply($package,1,'writer',$argv[5]);
    $output['router_after']=\Upgrade\Core\Router::resolve($project,$target);
    $output['element_writes']=CIBlockElement::$elementWrites;
    $output['mapping_writes']=count(array_filter($db->writes,static fn($sql)=>str_starts_with($sql,'INSERT INTO ug_entity ')));
    $output['second_apply']=$g->apply($package,1,'writer',$argv[5]);
} else {
    if(str_starts_with($scenario,'mapping:')) { $field=substr($scenario,8); $db->mapping[$field]=$field==='BITRIX_ID'?8:($field==='MANAGED_HASH'||$field==='PAYLOAD_HASH'?str_repeat('c',64):'wrong'); }
    if($scenario==='inactive') CIBlockElement::$row['ACTIVE']='N';
    if($scenario==='xml-id') CIBlockElement::$row['XML_ID']='upgrade:foreign';
    if($scenario==='raw-field') CIBlockElement::$row['DETAIL_TEXT']='Owner changed the page';
    if($scenario==='property') CIBlockElement::$properties['UG_H1']='Owner changed the H1';
    if($scenario==='route-key') $db->route['ENTITY_KEY']=str_repeat('d',64);
    if($scenario==='route-query') $db->route['REQUEST_TARGET']='/Exact/a%2Fb.php?x=1&x=&x=2';
    $output['reconcile']=$g->reconcile($package);
    $output['dry_run']=$g->dryRun($package);
    $output['router']=\Upgrade\Core\Router::resolve($project,$target);
    $output['content']=\Upgrade\Core\Router::content(7);
    $output['writes']=count($db->writes);
}
echo $encode($output),PHP_EOL;
}
`;

for (const action of ["create", "update"]) {
  test(`own PHP contract: large factual properties survive ${action}, readback and repeat within the native byte limit`, { skip: !php }, () => {
    const result = execute(`codec-${action}`);
    assert.equal(result.apply[action === "create" ? "created" : "updated"], 1);
    assert.equal(result.apply.verification.status, "DATABASE_RECONCILED");
    assert.ok(result.raw_bytes > 65535);
    assert.ok(result.stored_bytes <= 60000);
    assert.equal(result.raw_facts_match, true);
    assert.equal(result.second_apply.skipped, 1);
    assert.equal(result.second_apply.verification.status, "DATABASE_RECONCILED");
    assert.equal(result.writes_after_second, result.writes_after_first);
  });
}

function execute(scenario: string) {
  assert.ok(php);
  const directory = mkdtempSync(join(tmpdir(), "upgrade-gateway-reconcile-"));
  try {
    const script = join(directory, "contract.php");
    writeFileSync(script, harness);
    const web = join(directory, "web"),
      state = join(directory, "state");
    mkdirSync(web);
    mkdirSync(state);
    const result = spawnSync(
      php,
      [
        "-n",
        script,
        resolve("bitrix/module/upgrade.core/lib/gateway.php"),
        resolve("bitrix/module/upgrade.core/lib/router.php"),
        web,
        scenario,
        state,
      ],
      { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.match(
      basename(directory),
      /^upgrade-gateway-reconcile-[A-Za-z0-9_-]+$/,
    );
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "own PHP contract: exact raw fields, XML_ID and mapped query route reconcile without writing",
  { skip: !php },
  () => {
    const result = execute("positive");
    assert.equal(result.kind, "OWN_PHP_CONTRACT_NOT_BITRIX");
    assert.equal(result.reconcile.status, "DATABASE_RECONCILED");
    assert.deepEqual(result.reconcile.defects, []);
    assert.equal(result.reconcile.http_browser_admin, "NOT_RUN");
    assert.equal(result.dry_run.skipped, 1);
    assert.equal(result.router.BITRIX_ID, 7);
    assert.match(result.content.XML_ID, /^upgrade:[a-f0-9]{64}$/);
    assert.equal(
      result.content.DETAIL_TEXT,
      "<p>Actual &lt;script&gt;source&lt;/script&gt; &amp; text</p>",
    );
    assert.equal(result.content.UPGRADE_PROPERTIES.UG_H1, "Observed H1");
    assert.equal(result.writes, 0);
  },
);

test(
  "own PHP contract: missing mapping fails final reconcile, remains recoverable by apply and never duplicates the matching element",
  { skip: !php },
  () => {
    const result = execute("missing-map");
    assert.equal(result.before.status, "FAIL");
    assert.ok(
      result.before.defects.some(
        (row: any) => row.reason === "ENTITY_MAPPING_MISSING",
      ),
    );
    assert.ok(
      result.before.defects.some(
        (row: any) => row.reason === "ROUTE_ENTITY_MAPPING_UNVERIFIED",
      ),
    );
    assert.equal(result.router_before.BITRIX_ID, null);
    assert.equal(result.dry_run.reconciled, 1);
    assert.deepEqual(result.dry_run.conflicts, []);
    assert.equal(result.apply.reconciled, 1);
    assert.equal(result.apply.created, 0);
    assert.equal(result.apply.verification.status, "DATABASE_RECONCILED");
    assert.equal(result.router_after.BITRIX_ID, 7);
    assert.equal(result.element_writes, 0);
    assert.equal(result.mapping_writes, 1);
    assert.equal(result.second_apply.skipped, 1);
    assert.equal(result.second_apply.created, 0);
  },
);

for (const scenario of [
  "mapping:ENTITY_KEY",
  "mapping:PROJECT_ID",
  "mapping:ENTITY_TYPE",
  "mapping:SOURCE_ID",
  "mapping:BITRIX_ID",
  "mapping:MANAGED_HASH",
  "mapping:PAYLOAD_HASH",
  "inactive",
  "xml-id",
  "raw-field",
  "property",
  "route-key",
  "route-query",
])
  test(
    `own PHP contract: ${scenario} drift cannot return DATABASE_RECONCILED`,
    { skip: !php },
    () => {
      const result = execute(scenario);
      assert.equal(result.reconcile.status, "FAIL");
      assert.ok(result.reconcile.defects.length > 0);
      assert.equal(result.reconcile.http_browser_admin, "NOT_RUN");
      assert.equal(result.writes, 0);
      if (scenario === "inactive") assert.equal(result.content, null);
      if (scenario === "route-query") assert.equal(result.router, null);
    },
  );
