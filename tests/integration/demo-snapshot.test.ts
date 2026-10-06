import test from "node:test";
import assert from "node:assert/strict";
import { projectDemoSnapshot } from "../../packages/bitrix-adapter/demo.ts";
import type { CommerceObservation } from "../../packages/contracts/commerce.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function fixture() {
  const source = "https://fixture.example";
  const ev = { source_url: source + "/Exact?x=1&x=2", observed_at: "2026-09-30T00:00:00.000Z", locator: "main", snapshot_sha256: "a".repeat(64), trust: "untrusted-source-data" as const };
  const fact = <T>(value: T) => ({ value, status: "OBSERVED" as const, evidence: ev, reason: null });
  const purchase = {price_id:null,min_quantity:null,quantity_step:null,max_quantity:null,default_quantity:null,quantity_evidence:null,blockers:["UNIT_UNKNOWN"]};
  const category: CommerceObservation = {schema_version:1,entity_source_id:"category-1",source_url:source+"/Category",request_target:"/Category",page_kind:fact("CATEGORY" as const),product:{name:fact("Категория"),brand:fact(null),sku:fact(null),availability:fact(null),attributes:{}},prices:[],purchase,variants:[],selections:[],breadcrumbs:[],links:[],images:[],limitations:[]};
  const product: CommerceObservation = {...category,entity_source_id:"product-1",source_url:ev.source_url,request_target:"/Exact?x=1&x=2",page_kind:fact("PRODUCT" as const),product:{...category.product,name:fact("Нагреватель"),attributes:{Цвет:fact("белый"),Подозрение:{value:"invented",status:"REQUIRES_REVIEW",evidence:ev,reason:"contradiction"}}},breadcrumbs:[{label:"Категория",request_target:"/Category",evidence:ev}],images:[{source_url:source+"/p.png",alt:"Фото",asset_sha256:"b".repeat(64),evidence:ev}]};
  return {projectId:"fixture-demo",entities:[{source_id:"category-1",type:"Page",title:"Категория",source_url:category.source_url,blocks:[]},{source_id:"product-1",type:"Page",title:"Нагреватель",source_url:product.source_url,blocks:[{type:"paragraph",text:"Факт <script>не выполняется</script>"}]}],routes:[{request_target:"/Category",entity_source_id:"category-1",expected_status:200},{request_target:product.request_target,entity_source_id:"product-1",expected_status:200}],commerce:{schema_version:1 as const,entries:[category,product]},assets:[{sha256:"b".repeat(64),mime:"image/png",public_path:"/upload/upgrade/fixture-demo/"+"b".repeat(64)+".png"}]};
}

test("demo projection preserves exact source IDs/routes and unknown commerce",()=>{
  const f=fixture(),s=projectDemoSnapshot(f),p=s.items[1];
  assert.equal(p.id,"product-1");assert.equal(p.request_target,"/Exact?x=1&x=2");assert.equal(p.is_product,true);
  assert.deepEqual(p.prices,[]);assert.equal(p.purchase.min_quantity,null);assert.deepEqual(p.category_ids,["category-1"]);
  assert.deepEqual({...p.attributes},{Цвет:["белый"]});assert.equal(p.thumbnail,f.assets[0].public_path);
  assert.match(p.body_text,/<script>/); // inert text, escaped by view; never executed by projection.
  assert.equal(projectDemoSnapshot(f).snapshot_id,s.snapshot_id);
  f.entities[1].title="Изменённый факт";assert.notEqual(projectDemoSnapshot(f).snapshot_id,s.snapshot_id);
});
test("foreign/stale commerce and collisions cannot create functional controls",()=>{
  let f=fixture();f.commerce.entries[1].source_url="https://foreign.example/";assert.throws(()=>projectDemoSnapshot(f),/BINDING/);
  f=fixture();f.routes[1].entity_source_id="category-1";assert.throws(()=>projectDemoSnapshot(f),/BINDING/);
  f=fixture();f.commerce.entries.push(f.commerce.entries[1]);assert.throws(()=>projectDemoSnapshot(f),/DUPLICATE/);
  f=fixture();f.routes.push({request_target:"/%5f_upgrade/cart",entity_source_id:"product-1",expected_status:200});assert.throws(()=>projectDemoSnapshot(f),/COLLISION/);
});
test("no observation does not infer products from words or entity type",()=>{
  const f=fixture();f.commerce.entries=[];f.entities[1].type="Product";
  const p=projectDemoSnapshot(f).items[1];assert.equal(p.is_product,false);assert.deepEqual(p.prices,[]);assert.deepEqual(p.purchase.blockers,["COMMERCE_NOT_OBSERVED"]);
});
test("reserved observed attribute names survive without prototype setters",()=>{
  const f=fixture(),attributes=f.commerce.entries[1].product.attributes;
  Object.defineProperty(attributes,"__proto__",{value:attributes.Цвет,enumerable:true});
  const projected=projectDemoSnapshot(f).items[1].attributes;
  assert.equal(Object.getPrototypeOf(projected),null);
  assert.deepEqual(JSON.parse(JSON.stringify(projected)),JSON.parse('{"Цвет":["белый"],"__proto__":["белый"]}'));
});
test("real PHP runtime pins private snapshots and counts crash remnants toward quota",{skip:!process.env.UPGRADE_PHP_BIN},t=>{
  const dir=mkdtempSync(join(tmpdir(),"upgrade-runtime-test-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,"private"),{mode:0o700});mkdirSync(join(dir,"web"));mkdirSync(join(dir,"web","private"));
  const harness=String.raw`<?php
require $argv[1].'/demoengine.php';require $argv[1].'/demoweb.php';require $argv[1].'/demoruntime.php';
$base=$argv[2];$_SERVER['DOCUMENT_ROOT']=$base.'/web';putenv('UPGRADE_TARGET_ID=runtime-test');
$errors=[];$expect=static function($fn,$code)use(&$errors){try{$fn();$errors[]='accepted:'.$code;}catch(Throwable $e){if($e->getMessage()!==$code)$errors[]=$e->getMessage().'!='.$code;}};
$expect(fn()=>\Upgrade\Core\DemoRuntime::snapshot('fixture-demo',$base.'/web/private'),'DEMO_PRIVATE_ROOT_REQUIRED');
$state=$base.'/private';$snapshot=['schema_version'=>1,'project_id'=>'fixture-demo','snapshot_id'=>str_repeat('a',64),'items'=>[]];
mkdir($state.'/release/data',0700,true);$bytes=json_encode($snapshot);file_put_contents($state.'/release/data/demo-snapshot.json',$bytes);
$pointer=['schema_version'=>1,'project_id'=>'fixture-demo','target_id'=>'runtime-test','relative_path'=>'release/data/demo-snapshot.json','sha256'=>hash('sha256',$bytes)];
file_put_contents($state.'/demo-active.json',json_encode($pointer));
if(\Upgrade\Core\DemoRuntime::snapshot('fixture-demo',$state)!==$snapshot)$errors[]='readback mismatch';
$expect(fn()=>\Upgrade\Core\DemoRuntime::snapshot('other-project',$state),'DEMO_POINTER_BINDING');
file_put_contents($state.'/release/data/demo-snapshot.json',$bytes.' ');
$expect(fn()=>\Upgrade\Core\DemoRuntime::snapshot('fixture-demo',$state),'DEMO_SNAPSHOT_HASH');
$pointer['relative_path']='../release/data/demo-snapshot.json';file_put_contents($state.'/demo-active.json',json_encode($pointer));
$expect(fn()=>\Upgrade\Core\DemoRuntime::snapshot('fixture-demo',$state),'DEMO_POINTER_BINDING');
$engine=new \Upgrade\Core\DemoEngine($snapshot,$state,'fixture-demo');$pending=$state.'/demo-fixture-demo/orphan.json.pending-dead';$h=fopen($pending,'x+b');ftruncate($h,140*1024*1024);fclose($h);
$request=['method'=>'GET','request_target'=>'/__upgrade/cart','host'=>'fixture.test','https'=>true,'origin'=>null,'cookie'=>null,'body'=>''];
$expect(fn()=>\Upgrade\Core\DemoRuntime::handle($engine,$snapshot,$request,$state),'DEMO_STATE_QUOTA');
if(!is_file($pending)||count(glob($state.'/demo-fixture-demo/*.json')?:[])!==0)$errors[]='remnant removed or session created';
echo json_encode(['errors'=>$errors,'pending_bytes'=>filesize($pending)]);`;
  const script=join(dir,"harness.php");writeFileSync(script,harness);
  const args=["-n"];if(process.env.UPGRADE_PHP_EXT_DIR)args.push("-d","extension_dir="+process.env.UPGRADE_PHP_EXT_DIR,"-d","extension=mbstring");
  args.push(script,resolve("bitrix/module/upgrade.core/lib"),dir);
  const p=spawnSync(process.env.UPGRADE_PHP_BIN!,args,{encoding:"utf8",timeout:15000});
  assert.equal(p.status,0,p.stderr+p.stdout);const result=JSON.parse(p.stdout);assert.deepEqual(result.errors,[]);assert.equal(result.pending_bytes,140*1024*1024);
});
