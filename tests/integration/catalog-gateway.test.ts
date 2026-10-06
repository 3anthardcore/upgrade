import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { projectNativeCatalog } from "../../packages/bitrix-adapter/catalog.ts";
import type {
  CommerceObservation,
  CommerceEvidence,
  CommerceFact,
} from "../../packages/contracts/commerce.ts";
import type {
  CatalogProjection,
  CatalogTargetProfile,
} from "../../packages/contracts/catalog.ts";

const php = process.env.UPGRADE_PHP_BIN;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ev: CommerceEvidence = {
  source_url: "https://catalog.example/item?x=1&x=2",
  observed_at: "2026-09-30T09:00:00Z",
  locator: "#price",
  snapshot_sha256: sha("snapshot"),
  trust: "untrusted-source-data",
};
const fact = <T>(value: T): CommerceFact<T> => ({
  value,
  status: "OBSERVED",
  evidence: ev,
  reason: null,
});
function source(id: string): CommerceObservation {
  return {
    schema_version: 1,
    entity_source_id: id,
    source_url: ev.source_url,
    request_target: "/item?x=1&x=2",
    page_kind: fact("PRODUCT"),
    product: {
      name: fact("Observed item"),
      brand: fact("Brand"),
      sku: fact("SAME-SKU"),
      availability: {
        value: null,
        status: "UNKNOWN",
        evidence: null,
        reason: "not observed",
      },
      attributes: {},
    },
    prices: [
      {
        id: "current",
        role: "CURRENT",
        status: "OBSERVED",
        raw_text: "0.10 RUB/piece",
        money: { decimal: "0.10", currency: "RUB", minor: 10 },
        maximum: null,
        unit: "piece",
        conditions: [],
        totals_eligible: true,
        evidence: ev,
      },
    ],
    purchase: {
      price_id: "current",
      min_quantity: "0.5",
      quantity_step: "0.5",
      max_quantity: "10",
      default_quantity: "1",
      quantity_evidence: ev,
      blockers: [],
    },
    variants: [],
    selections: [],
    breadcrumbs: [],
    links: [],
    images: [],
    limitations: [],
  };
}
function fixture(
  variants = false,
  unknown = false,
): { projection: CatalogProjection; profile: CatalogTargetProfile } {
  const entries = [
    source("legacy-HW500"),
    ...(variants ? [source("other-page")] : []),
  ];
  for (const e of entries) {
    if (unknown) {
      e.prices[0]!.role = "FROM";
      e.purchase.min_quantity = null;
    }
    if (variants)
      e.variants = [
        ["S", "R"],
        ["S", "B"],
        ["M", "G"],
        ["M", "B"],
      ].map(([a, b], i) => ({
        id: "row-" + i,
        source_url: null,
        sku: fact("SAME-SKU"),
        attributes: { size: fact(a!), colour: fact(b!) },
        prices: structuredClone(e.prices),
        purchase: structuredClone(e.purchase),
        evidence: ev,
      }));
  }
  return {
    projection: projectNativeCatalog({
      projectId: "catalog-test",
      targetId: "target-1",
      contentManifestSha256: sha("content"),
      modelSha256: sha("model"),
      entities: entries.map((e) => ({
        source_id: e.entity_source_id,
        stable_key: sha("Page:" + e.entity_source_id),
        payload_sha256: sha("payload:" + e.entity_source_id),
        source_url: e.source_url,
        title: "Original Page",
      })),
      commerce: { schema_version: 1, entries },
    }),
    profile: {
      schema_version: 1,
      project_id: "catalog-test",
      target_id: "target-1",
      product_iblock_id: 10,
      offers_iblock_id: 20,
      sku_property_id: 31,
      product_metadata_property_id: 32,
      offer_metadata_property_id: 33,
      price_group_id: 7,
      measures: { piece: { id: 8, code: 796 } },
      sale_policy: "isolated-demo-no-orders",
    },
  };
}

// These are API/transaction doubles, not a licensed CMS. The production adapter,
// validation, shared flock, filesystem journal and PHP process restarts are real.
const harness = String.raw`<?php
declare(strict_types=1);
namespace {
class Rows {function __construct(private array $rows){}function Fetch(){return array_shift($this->rows)?:false;}}
class Result {function isSuccess(){return true;}}
class State {
 static array $s;static string $path;static string $mode;static bool $thrown=false;static ?array $saved=null;
 static function save(){file_put_contents(self::$path,json_encode(self::$s,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE));}
 static function event($kind,$id,$fields){self::$s['events'][]=[$kind,$id,$fields];}
 static function filter(array $rows,array $f):array{return array_values(array_filter($rows,function($r)use($f){foreach($f as $k=>$v){$k=ltrim((string)$k,'=');if(($r[$k]??null)!=$v)return false;}return true;}));}
}
class Connection {
 function getSqlHelper(){return new class {function forSql($s){return addslashes($s);}};}
 function query($sql){if(str_contains($sql,'FROM ug_project'))return new Rows([State::$s['project']]);if(str_contains($sql,'FROM ug_operation'))return new Rows(State::$s['operation_missing']??false?[]:[['OPERATION_KEY'=>'fixture']]);if(str_contains($sql,'FROM ug_entity')){preg_match("/ENTITY_KEY='([a-f0-9]{64})'/",$sql,$m);return new Rows(isset(State::$s['mapping'][$m[1]??''])?[State::$s['mapping'][$m[1]]]:[]);}throw new \RuntimeException('Unexpected SQL');}
 function queryExecute($sql){if(!str_starts_with($sql,'UPDATE ug_project SET FENCE='))throw new \RuntimeException('System SQL write prohibited');preg_match('/FENCE=(\d+),OWNER=\x27([^\x27]+)\x27,LEASE_UNTIL=(\d+)/',$sql,$m);State::$s['project']['FENCE']=(int)$m[1];State::$s['project']['OWNER']=$m[2];State::$s['project']['LEASE_UNTIL']=(int)$m[3];}
 function startTransaction(){State::$saved=State::$s;}
 function commitTransaction(){State::save();State::$saved=null;if(State::$mode==='commit-unknown'&&!State::$thrown){State::$thrown=true;throw new \RuntimeException('Unknown after commit');}}
 function rollbackTransaction(){if(State::$saved!==null){State::$s=State::$saved;State::$saved=null;}State::save();}
}
class CIBlock {static function GetByID($id){return new Rows($id===10?[['ID'=>10,'XML_ID'=>'upgrade:catalog-test']]:($id===20?[['ID'=>20,'XML_ID'=>'upgrade:offers:catalog-test']]:[]));}}
class CIBlockProperty {static function GetByID($id,$iblock){return new Rows($id===31&&$iblock===20?[['ID'=>31,'CODE'=>'CML2_LINK','PROPERTY_TYPE'=>'E','MULTIPLE'=>'N','LINK_IBLOCK_ID'=>10]]:(($id===32&&$iblock===10)||($id===33&&$iblock===20)?[['ID'=>$id,'CODE'=>'UG_CATALOG_DATA','PROPERTY_TYPE'=>'S','MULTIPLE'=>'N']]:[]));}}
class CCatalog {static function GetByID($id){return State::$s['catalogs'][$id]??false;}static function Add($f){State::event('catalog.add',$f['IBLOCK_ID'],$f);State::$s['catalogs'][$f['IBLOCK_ID']]=$f;return true;}}
class CIBlockSection {static function GetList($o,$f,$count,$select){return new Rows(State::filter(State::$s['sections'],$f));}function Add($f){$id=State::$s['next']++;State::$s['sections'][$id]=['ID'=>$id]+$f;return $id;}function Update($id,$f){State::$s['sections'][$id]=array_replace(State::$s['sections'][$id],$f);return true;}}
class CIBlockElement {
 static function GetByID($id){return new Rows(isset(State::$s['elements'][$id])?[State::$s['elements'][$id]]:[]);}
 static function GetList($o,$f,$g,$nav,$select){$rows=[];foreach(State::$s['elements'] as $r){$candidate=$r;$candidate['PROPERTY_CML2_LINK']=State::$s['properties'][$r['ID']][31]??null;if(State::filter([$candidate],$f))$rows[]=$r;}return new Rows($rows);}
 static function GetElementGroups($id,$b,$select){return new Rows(array_map(fn($s)=>['ID'=>$s],State::$s['element_sections'][$id]??[]));}
 static function SetElementSection($id,$ids){State::event('element.sections',$id,$ids);State::$s['element_sections'][$id]=$ids;}
 static function GetProperty($iblock,$id,$o,$f){return new Rows([['VALUE'=>State::$s['properties'][$id][$f['ID']??$f['CODE']]??null]]);}
 static function SetPropertyValuesEx($id,$iblock,$fields){State::event('element.properties',$id,$fields);State::$s['properties'][$id]=array_replace(State::$s['properties'][$id]??[],$fields);}
 function Add($f){$id=State::$s['next']++;State::event('element.add',$id,$f);State::$s['properties'][$id]=$f['PROPERTY_VALUES']??[];unset($f['PROPERTY_VALUES']);State::$s['elements'][$id]=['ID'=>$id]+$f;return $id;}
 function Update($id,$f){State::event('element.update',$id,$f);State::$s['elements'][$id]=array_replace(State::$s['elements'][$id],$f);return true;}
}
}
namespace Bitrix\Main {class Loader{static function includeModule($name){return in_array($name,['iblock','catalog'],true);}}class Application{static function getConnection(){return new \Connection();}}}
namespace Bitrix\Catalog {
 class ProductTable {const TYPE_PRODUCT=1,TYPE_SKU=3,TYPE_OFFER=4;static function getList($args){return new \Rows(\State::filter(\State::$s['products'],$args['filter']));}}
 class PriceTable {static function getList($args){return new \Rows(\State::filter(\State::$s['prices'],$args['filter']));}}
 class MeasureRatioTable {static function getList($args){return new \Rows(\State::filter(\State::$s['ratios'],$args['filter']));}static function add($f){$id=\State::$s['next']++;\State::event('ratio.add',$id,$f);\State::$s['ratios'][$id]=['ID'=>$id]+$f;return new \Result();}static function update($id,$f){\State::event('ratio.update',$id,$f);\State::$s['ratios'][$id]=array_replace(\State::$s['ratios'][$id],$f);return new \Result();}}
 class GroupTable {static function getList($args){return new \Rows($args['filter']['=ID']===7?[['ID'=>7]]:[]);}}
 class MeasureTable {static function getList($args){return new \Rows($args['filter']['=ID']===8?[['ID'=>8,'CODE'=>796]]:[]);}}
}
namespace Bitrix\Catalog\Model {
 class Product {static function add($f){if(\State::$mode==='before-write')throw new \RuntimeException('Failure before API write');$id=$f['ID'];\State::event('product.add',$id,$f);\State::$s['products'][$id]=$f+['QUANTITY'=>'0.0000','QUANTITY_RESERVED'=>'0.0000','AVAILABLE'=>'N','MEASURE'=>0];\Bitrix\Catalog\MeasureRatioTable::add(['PRODUCT_ID'=>$id,'RATIO'=>'1','IS_DEFAULT'=>'Y']);return new \Result();}static function update($id,$f){\State::event('product.update',$id,$f);\State::$s['products'][$id]=array_replace(\State::$s['products'][$id],$f);return new \Result();}}
 class Price {static function add($f){$id=\State::$s['next']++;\State::event('price.add',$id,$f);\State::$s['prices'][$id]=['ID'=>$id]+$f;return new \Result();}static function update($id,$f){\State::event('price.update',$id,$f);\State::$s['prices'][$id]=array_replace(\State::$s['prices'][$id],$f);return new \Result();}}
}
namespace {
define('UPGRADE_SANDBOX_PREPEND_ACTIVE',true);putenv('UPGRADE_DEMO=1');putenv('UPGRADE_PROJECT_ID=catalog-test');putenv('UPGRADE_TARGET_ID=target-1');
require $argv[1];$dir=$argv[2];$command=$argv[3];State::$mode=$argv[4]??'';State::$path=$dir.'/target.json';$input=json_decode(file_get_contents($dir.'/input.json'),true,128,JSON_THROW_ON_ERROR);$p=$input['projection'];$profile=$input['profile'];
if(is_file(State::$path))State::$s=json_decode(file_get_contents(State::$path),true,128,JSON_THROW_ON_ERROR);
else{State::$s=['next'=>100,'project'=>['IBLOCK_ID'=>10,'FENCE'=>1,'OWNER'=>'worker','LEASE_UNTIL'=>time()+3600],'mapping'=>[],'elements'=>[],'properties'=>[],'products'=>[],'prices'=>[],'ratios'=>[],'sections'=>[],'element_sections'=>[],'events'=>[],'catalogs'=>[10=>['IBLOCK_ID'=>10],20=>['IBLOCK_ID'=>20,'PRODUCT_IBLOCK_ID'=>10,'SKU_PROPERTY_ID'=>31]]];$id=1;foreach(array_merge($p['products'],$p['categories']) as $item){$ref=$item['page'];State::$s['mapping'][$ref['stable_key']]=['PROJECT_ID'=>'catalog-test','ENTITY_KEY'=>$ref['stable_key'],'SOURCE_ID'=>$ref['source_id'],'PAYLOAD_HASH'=>$ref['payload_sha256'],'BITRIX_ID'=>$id];State::$s['elements'][$id]=['ID'=>$id,'IBLOCK_ID'=>10,'XML_ID'=>'upgrade:'.$ref['stable_key'],'NAME'=>'Untouched original Page','ACTIVE'=>'Y','DETAIL_TEXT'=>'Observed <p>content</p>','DETAIL_TEXT_TYPE'=>'html','PREVIEW_TEXT'=>'Original','PREVIEW_TEXT_TYPE'=>'text'];$managed=['NAME'=>'Untouched original Page','DETAIL_TEXT'=>'Observed <p>content</p>','DETAIL_TEXT_TYPE'=>'html','PREVIEW_TEXT'=>'Original','PREVIEW_TEXT_TYPE'=>'text','properties'=>['UG_SEO_TITLE'=>'','UG_DESCRIPTION'=>'','UG_H1'=>'','UG_FACTS'=>'[]']];State::$s['properties'][$id]=$managed['properties'];State::$s['mapping'][$ref['stable_key']]['MANAGED_HASH']=hash('sha256',json_encode($managed,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));$id++;}State::save();}
try{$port=new \Upgrade\Core\NativeCatalogPort($profile,$dir.'/state',$p['content_manifest_sha256']);if($command==='claim')$result=$port->claim('worker');elseif($command==='setup')$result=$port->setup(1,'worker');else{$gateway=new \Upgrade\Core\CatalogGateway($port,$p,$profile,$dir.'/state');$result=match($command){'dry-run'=>$gateway->dryRun(),'reconcile'=>$gateway->reconcile(),'apply'=>$gateway->apply(1,'worker')};}echo json_encode(['kind'=>'OWN_PHP_API_DOUBLES_NOT_BITRIX','result'=>$result,'state'=>State::$s],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);}catch(\Throwable $e){echo json_encode(['error'=>$e->getMessage(),'state'=>State::$s]);exit(1);}
}
`;
function environment(t: TestContext, input = fixture()) {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-catalog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "state"));
  writeFileSync(join(dir, "harness.php"), harness);
  writeFileSync(join(dir, "input.json"), JSON.stringify(input));
  const run = (command = "apply", mode = "") => {
    const p = spawnSync(
      php!,
      [
        join(dir, "harness.php"),
        resolve("bitrix/module/upgrade.core/lib/cataloggateway.php"),
        dir,
        command,
        mode,
      ],
      { encoding: "utf8", env: process.env },
    );
    assert.equal(p.signal, null, p.stderr);
    let output: any;
    try {
      output = JSON.parse(p.stdout);
    } catch {
      assert.fail(p.stdout + "\n" + p.stderr);
    }
    return { status: p.status, ...output };
  };
  const mutate = (fn: (s: any) => void) => {
    const path = join(dir, "target.json"),
      s = JSON.parse(readFileSync(path, "utf8"));
    fn(s);
    writeFileSync(path, JSON.stringify(s));
  };
  return { dir, run, mutate, input };
}
test(
  "native API adapter overlays Page ID 1, exact price/ratio, repeats without native writes",
  { skip: !php },
  (t) => {
    const x = environment(t);
    const first = x.run();
    assert.equal(first.status, 0, JSON.stringify(first));
    assert.equal(first.result.created, 1);
    assert.equal(first.state.elements[1].NAME, "Untouched original Page");
    assert.equal(Object.keys(first.state.elements).length, 1);
    assert.equal(first.state.products[1].TYPE, 1);
    assert.deepEqual(
      Object.values(first.state.prices).map((p: any) => [
        p.PRODUCT_ID,
        p.PRICE,
        p.CURRENCY,
      ]),
      [[1, "0.10", "RUB"]],
    );
    assert.ok(
      first.state.events
        .filter((e: any) => e[0].startsWith("product."))
        .every((e: any) => !("QUANTITY" in e[2]) && !("AVAILABLE" in e[2])),
    );
    const second = x.run();
    assert.equal(second.result.skipped, 1);
    assert.equal(second.state.events.length, first.state.events.length);
    assert.equal(x.run("reconcile").result.status, "CATALOG_RECONCILED");
  },
);
test(
  "eight distinct native offers preserve four observed combinations for each parent and never price parents",
  { skip: !php },
  (t) => {
    const x = environment(t, fixture(true));
    const r = x.run();
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(r.result.created, 2);
    const offers = Object.values(r.state.elements).filter(
      (e: any) => e.IBLOCK_ID === 20,
    ) as any[];
    assert.equal(offers.length, 8);
    assert.equal(new Set(offers.map((e) => e.XML_ID)).size, 8);
    assert.equal(r.state.products[1].TYPE, 3);
    assert.equal(r.state.products[2].TYPE, 3);
    assert.ok(
      Object.values(r.state.prices).every(
        (p: any) => p.PRODUCT_ID !== 1 && p.PRODUCT_ID !== 2,
      ),
    );
    assert.deepEqual(offers.map((e) => e.NAME).slice(0, 4), [
      "colour: R / size: S",
      "colour: B / size: S",
      "colour: G / size: M",
      "colour: B / size: M",
    ]);
    for (const e of offers) {
      assert.equal(r.state.products[e.ID].TYPE, 4);
      assert.equal(JSON.parse(r.state.properties[e.ID][33]).sku, "SAME-SKU");
    }
    assert.equal(x.run().result.skipped, 2);
  },
);
test(
  "unknown/from price stays absent and source stock is not invented",
  { skip: !php },
  (t) => {
    const x = environment(t, fixture(false, true));
    const r = x.run();
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(Object.keys(r.state.prices).length, 0);
    assert.equal(JSON.parse(r.state.properties[1][32]).stock_status, "UNKNOWN");
    assert.equal(JSON.parse(r.state.properties[1][32]).purchase, null);
    assert.equal(x.run().result.skipped, 1);
  },
);
test(
  "unknown commit is reconciled after process restart without duplicate native product/price",
  { skip: !php },
  (t) => {
    const x = environment(t);
    const first = x.run("apply", "commit-unknown");
    assert.equal(first.status, 1);
    assert.match(first.error, /Unknown after commit/);
    const events = first.state.events.length;
    assert.equal(x.run("reconcile").result.status, "FAIL");
    const second = x.run();
    assert.equal(second.status, 0, JSON.stringify(second));
    assert.equal(second.result.reconciled, 1);
    assert.equal(second.state.events.length, events);
    assert.equal(Object.keys(second.state.prices).length, 1);
  },
);
test(
  "rolled-back before-write intent retries only after exact before-state comparison",
  { skip: !php },
  (t) => {
    const x = environment(t);
    assert.equal(x.run("apply", "before-write").status, 1);
    const r = x.run();
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(r.result["recovered-before-write"], 1);
    assert.equal(Object.keys(r.state.products).length, 1);
  },
);
test(
  "manual native price edit, stale fence, source mapping drift and corrupt checkpoint all fail closed",
  { skip: !php },
  (t) => {
    for (const mode of ["price", "fence", "mapping", "checkpoint"]) {
      const x = environment(t);
      assert.equal(x.run().status, 0);
      const before = JSON.parse(
        readFileSync(join(x.dir, "target.json"), "utf8"),
      ).events.length;
      if (mode === "checkpoint") {
        const d = join(x.dir, "state/catalog-catalog-test");
        writeFileSync(
          join(
            d,
            readdirSync(d).find((f) => f.endsWith(".json"))!,
          ),
          "null",
        );
      } else
        x.mutate((s) => {
          if (mode === "price")
            Object.values(s.prices).forEach((p: any) => (p.PRICE = "999"));
          if (mode === "fence") s.project.FENCE = 2;
          if (mode === "mapping")
            Object.values(s.mapping).forEach(
              (p: any) => (p.PAYLOAD_HASH = sha("foreign")),
            );
        });
      const r = x.run();
      assert.equal(r.status, 1, mode);
      assert.equal(r.state.events.length, before);
      if (mode === "price") assert.match(r.error, /USER_EDIT_CONFLICT/);
      if (mode === "fence") assert.match(r.error, /STALE_TARGET_FENCE/);
      if (mode === "mapping") assert.match(r.error, /PAGE_MAPPING_MISMATCH/);
    }
  },
);
test(
  "third-value stock after unknown commit cannot be adopted as own completion",
  { skip: !php },
  (t) => {
    const x = environment(t);
    assert.equal(x.run("apply", "commit-unknown").status, 1);
    x.mutate((s) => (s.products[1].QUANTITY = "7"));
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.error, /UNKNOWN_THIRD_VALUE/);
    assert.equal(r.state.products[1].QUANTITY, "7");
  },
);
test(
  "unknown update refuses replacement native price identity even with identical desired amount",
  { skip: !php },
  (t) => {
    const x = environment(t);
    assert.equal(x.run().status, 0);
    const p = x.input.projection.products[0]!;
    p.price!.decimal = "0.25";
    p.price!.minor = 25;
    p.observation.prices[0]!.money = {
      decimal: "0.25",
      currency: "RUB",
      minor: 25,
    };
    writeFileSync(join(x.dir, "input.json"), JSON.stringify(x.input));
    assert.equal(x.run("apply", "commit-unknown").status, 1);
    x.mutate((s) => {
      const key = Object.keys(s.prices)[0]!;
      const row = s.prices[key];
      delete s.prices[key];
      s.prices[999] = { ...row, ID: 999 };
    });
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.error, /UNKNOWN_THIRD_VALUE/);
  },
);
test(
  "unowned matching native record is never adopted just because desired fields match",
  { skip: !php },
  (t) => {
    const x = environment(t);
    assert.equal(x.run().status, 0);
    const d = join(x.dir, "state/catalog-catalog-test");
    for (const file of readdirSync(d)) rmSync(join(d, file));
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.error, /UNOWNED_NATIVE_DATA/);
  },
);
test(
  "native price update reuses same product/price/ratio IDs and retains page fields",
  { skip: !php },
  (t) => {
    const x = environment(t);
    const first = x.run();
    assert.equal(first.status, 0);
    const priceId = Object.keys(first.state.prices)[0],
      ratioId = Object.keys(first.state.ratios)[0];
    const p = x.input.projection.products[0]!;
    p.observation.prices[0]!.money = {
      decimal: "12.35",
      currency: "RUB",
      minor: 1235,
    };
    p.price!.decimal = "12.35";
    p.price!.minor = 1235;
    writeFileSync(join(x.dir, "input.json"), JSON.stringify(x.input));
    const updated = x.run();
    assert.equal(updated.status, 0, JSON.stringify(updated));
    assert.equal(updated.result.updated, 1);
    assert.deepEqual(Object.keys(updated.state.prices), [priceId]);
    assert.deepEqual(Object.keys(updated.state.ratios), [ratioId]);
    assert.equal(updated.state.prices[priceId!].PRICE, "12.35");
    assert.deepEqual(updated.state.elements[1], first.state.elements[1]);
    assert.equal(x.run().result.skipped, 1);
  },
);
test(
  "content fields, facts codec, import-operation pin and stable XML_ID are checked before overlay",
  { skip: !php },
  (t) => {
    for (const mode of ["content", "facts", "operation", "xml"]) {
      const x = environment(t);
      assert.equal(x.run("dry-run").status, 0);
      x.mutate((s) => {
        if (mode === "content") s.elements[1].NAME = "Human edited title";
        if (mode === "facts") s.properties[1].UG_FACTS = '{"human":"edit"}';
        if (mode === "operation") s.operation_missing = true;
        if (mode === "xml") s.elements[1].XML_ID = "foreign";
      });
      const r = x.run();
      assert.equal(r.status, 1, mode);
      assert.equal(r.state.events.length, 0);
      assert.match(
        r.error,
        /CONTENT_DRIFT|IMPORT_NOT_CONFIRMED|IDENTITY_MISMATCH/,
      );
    }
  },
);
test(
  "category sections arise only from explicit observed mapping and repeated setup is idempotent",
  { skip: !php },
  (t) => {
    const input = fixture();
    const product = source("legacy-HW500"),
      category = source("category");
    category.page_kind = fact("CATEGORY");
    category.source_url = "https://catalog.example/category";
    input.projection = projectNativeCatalog({
      projectId: "catalog-test",
      targetId: "target-1",
      contentManifestSha256: sha("content"),
      modelSha256: sha("model"),
      entities: [product, category].map((e) => ({
        source_id: e.entity_source_id,
        stable_key: sha("Page:" + e.entity_source_id),
        payload_sha256: sha("payload:" + e.entity_source_id),
        source_url: e.source_url,
        title: e === category ? "Observed category" : "Original Page",
      })),
      commerce: { schema_version: 1, entries: [product, category] },
      categoryMappings: [
        {
          category_source_id: "category",
          product_source_ids: [product.entity_source_id],
          evidence: ev,
        },
      ],
    });
    const x = environment(t, input);
    const applied = x.run();
    assert.equal(applied.status, 0, JSON.stringify(applied));
    assert.equal(applied.result.created, 2);
    const section = Object.values(applied.state.sections)[0] as any;
    assert.equal(section.NAME, "Observed category");
    assert.deepEqual(applied.state.element_sections[1], [section.ID]);
    assert.equal(x.run().result.skipped, 2);
    x.mutate((s) => (s.catalogs = {}));
    const setup = x.run("setup");
    assert.equal(setup.status, 0, JSON.stringify(setup));
    assert.equal(
      setup.state.events.filter((e: any) => e[0] === "catalog.add").length,
      2,
    );
    const repeat = x.run("setup");
    assert.equal(repeat.status, 0);
    assert.equal(repeat.state.events.length, setup.state.events.length);
  },
);
test(
  "offer deletion or foreign XML_ID collision cannot silently replace native records",
  { skip: !php },
  (t) => {
    const x = environment(t, fixture(true));
    const first = x.run();
    assert.equal(first.status, 0);
    x.input.projection.products[0]!.offers.pop();
    x.input.projection.products[0]!.observation.variants.pop();
    writeFileSync(join(x.dir, "input.json"), JSON.stringify(x.input));
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.error, /OFFER_REMOVAL_REQUIRES_REVIEW/);
    assert.equal(Object.keys(r.state.elements).length, 10);
    assert.equal(r.state.events.length, first.state.events.length);
    const y = environment(t, fixture(true));
    assert.equal(y.run("dry-run").status, 0);
    y.mutate((s) => {
      s.elements[900] = {
        ID: 900,
        IBLOCK_ID: 20,
        XML_ID:
          "upgrade:offer:" +
          y.input.projection.products[0]!.offers[0]!.offer_key,
        NAME: "Foreign",
        ACTIVE: "Y",
      };
      s.properties[900] = { 31: 999 };
    });
    const collision = y.run();
    assert.equal(collision.status, 1);
    assert.match(collision.error, /EXTERNAL_ID_COLLISION/);
    assert.equal(collision.state.events.length, 0);
  },
);
test(
  "PHP validates observation-level price, offer and target bindings, independently of TS",
  { skip: !php },
  (t) => {
    for (const mutation of [
      (x: ReturnType<typeof fixture>) =>
        (x.projection.products[0]!.observation.prices[0]!.role = "OLD"),
      (x: ReturnType<typeof fixture>) =>
        (x.projection.products[0]!.price!.minor = 11),
      (x: ReturnType<typeof fixture>) =>
        (x.profile.target_id = "foreign-target"),
      (x: ReturnType<typeof fixture>) =>
        (x.projection.products[0]!.page.payload_sha256 = "invalid"),
    ]) {
      const input = fixture();
      mutation(input);
      const x = environment(t, input);
      const r = x.run();
      assert.equal(r.status, 1);
      assert.equal(r.state.events.length, 0);
    }
  },
);
test(
  "same importer flock prevents a second writer before native API calls",
  { skip: !php },
  (t) => {
    const x = environment(t);
    const lock = String.raw`<?php $h=fopen($argv[1],'c');flock($h,LOCK_EX);$cmd=base64_decode($argv[2]);passthru($cmd,$status);exit($status);`;
    writeFileSync(join(x.dir, "lock.php"), lock);
    const args = [
      join(x.dir, "harness.php"),
      resolve("bitrix/module/upgrade.core/lib/cataloggateway.php"),
      x.dir,
      "apply",
    ]
      .map((s) => '"' + s.replaceAll('"', '\\"') + '"')
      .join(" ");
    const cmd = '"' + php + '" ' + args;
    const r = spawnSync(
      php!,
      [
        join(x.dir, "lock.php"),
        join(x.dir, "state/upgrade-catalog-test.lock"),
        Buffer.from(cmd).toString("base64"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /TARGET_WRITER_BUSY/);
  },
);
test(
  "standalone catalog CLI validates exact pins without bootstrap, rejects tampering and native call without isolation",
  { skip: !php },
  (t) => {
    const x = environment(t);
    writeFileSync(
      join(x.dir, "projection.json"),
      JSON.stringify(x.input.projection),
    );
    writeFileSync(join(x.dir, "profile.json"), JSON.stringify(x.input.profile));
    const args = [
      resolve("bitrix/importer/catalog.php"),
      "--catalog-file=" + join(x.dir, "projection.json"),
      "--catalog-sha256=" + sha(JSON.stringify(x.input.projection)),
      "--profile-file=" + join(x.dir, "profile.json"),
      "--profile-sha256=" + sha(JSON.stringify(x.input.profile)),
      "--project=catalog-test",
      "--target-id=target-1",
    ];
    const valid = spawnSync(php!, args, { encoding: "utf8" });
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    assert.equal(JSON.parse(valid.stdout).runtime_verification, "NOT_RUN");
    const blocked = spawnSync(php!, [...args, "--command=apply"], {
      encoding: "utf8",
    });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /PREPEND_REQUIRED_BEFORE_BOOTSTRAP/);
    writeFileSync(join(x.dir, "projection.json"), "{}");
    const tampered = spawnSync(php!, args, { encoding: "utf8" });
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /FILE_HASH_MISMATCH/);
  },
);
test(
  "missing selected products remain reported, and omitted pending intent blocks new writes",
  { skip: !php },
  (t) => {
    const x = environment(t, fixture(true));
    assert.equal(x.run().status, 0);
    x.input.projection.products.pop();
    writeFileSync(join(x.dir, "input.json"), JSON.stringify(x.input));
    const r = x.run("reconcile");
    assert.equal(r.result.status, "CATALOG_RECONCILED");
    assert.equal(r.result.scope.products, 1);
    assert.equal(r.result.scope.retained_outside_projection.length, 1);
    assert.equal(r.result.scope.full_source_denominator, "UNKNOWN");
    assert.equal(r.result.readiness, "PARTIAL");
    const y = environment(t, fixture(true));
    assert.equal(y.run("apply", "commit-unknown").status, 1);
    y.input.projection.products.shift();
    writeFileSync(join(y.dir, "input.json"), JSON.stringify(y.input));
    const before = JSON.parse(readFileSync(join(y.dir, "target.json"), "utf8"))
      .events.length;
    const blocked = y.run();
    assert.equal(blocked.status, 1);
    assert.match(blocked.error, /OUTSIDE_SCOPE_PENDING/);
    assert.equal(blocked.state.events.length, before);
  },
);
test(
  "observed exact zero price is distinct from unknown price and JSON key order does not change offer identity",
  { skip: !php },
  (t) => {
    const input = fixture(true);
    for (const product of input.projection.products) {
      for (const [i, offer] of product.offers.entries()) {
        offer.price!.decimal = "0.00";
        offer.price!.minor = 0;
        product.observation.variants[i]!.prices[0]!.money = {
          decimal: "0.00",
          currency: "RUB",
          minor: 0,
        };
      }
    }
    const x = environment(t, input);
    const r = x.run();
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(Object.keys(r.state.prices).length, 8);
    assert.ok(
      Object.values(r.state.prices).every((p: any) => p.PRICE === "0.00"),
    );
    for (const p of x.input.projection.products)
      for (const v of p.offers)
        v.attributes = Object.fromEntries(
          Object.entries(v.attributes).reverse(),
        );
    writeFileSync(join(x.dir, "input.json"), JSON.stringify(x.input));
    assert.equal(x.run().result.skipped, 2);
  },
);

test(
  "PHP independently rejects cross-page price evidence and accepts exact UTF8 observed variant keys",
  { skip: !php },
  (t) => {
    const input = fixture();
    const p = input.projection.products[0]!;
    p.price!.evidence = {
      ...ev,
      source_url: "https://catalog.example/foreign",
    };
    p.observation.prices[0]!.evidence = { ...p.price!.evidence };
    const bad = environment(t, input).run();
    assert.equal(bad.status, 1);
    assert.match(bad.error, /PRICE_SOURCE_PAGE_MISMATCH/);
    assert.equal(bad.state.events.length, 0);
    const good = fixture(true);
    const item = good.projection.products[0]!;
    const id = "Наблюдение\u2028вариант";
    item.offers[0]!.observed_variant_id = id;
    item.offers[0]!.offer_key = sha(
      JSON.stringify(["catalog-test", "offer", item.page.source_id, id]),
    );
    item.observation.variants[0]!.id = id;
    const x = environment(t, good);
    const r = x.run();
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(x.run().result.skipped, 2);
  },
);
