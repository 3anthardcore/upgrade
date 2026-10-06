import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const php=process.env.UPGRADE_PHP_BIN;
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const json=(v:unknown)=>JSON.stringify(v);
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'upgrade-native-edit-'));t.after(()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.match(basename(dir),/^upgrade-native-edit-[A-Za-z0-9_-]+$/);rmSync(dir,{recursive:true,force:true});});
 const root=join(dir,'cms'),state=join(dir,'state'),pkg=join(dir,'package'),proof=join(state,'proof-one');
 for(const p of [root,state,pkg])mkdirSync(p);
 const project='edit-project',target='edit-target',route='/termoregulyatory/grand-meyer-hw-500',id='1';
 const entity={source_id:'source:hw500',type:'page',title:'Original heading',stable_key:sha(json([project,'page','source:hw500'])),blocks:[],facts:{},seo:{h1:'Original heading'}};
 const data=join(dir,'fixture.json'),calls=join(dir,'calls.jsonl'),boot=join(dir,'bootstrap.txt');
 const initial={h1:'Original heading',name:'Original name',id:1,xml:'upgrade:'+entity.stable_key,description:'',writes:0};writeFileSync(data,json(initial));
 const sources:Record<string,string|Buffer>={
 'code/importer/package.php':readFileSync('bitrix/importer/package.php'),
 'code/module/upgrade.core/lib/demotransport.php':readFileSync('bitrix/module/upgrade.core/lib/demotransport.php'),
 'code/module/upgrade.core/lib/factsproperty.php':'<?php namespace Upgrade\\Core; final class FactsProperty {}',
 'code/module/upgrade.core/lib/router.php':String.raw`<?php namespace Upgrade\Core;
 final class Router {
  public static function resolve($project,$target){$d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);return ['REQUEST_TARGET'=>$target,'STATUS'=>200,'BITRIX_ID'=>$d['id'],'ENTITY_KEY'=>getenv('EDIT_KEY'),'ENTITY_TYPE'=>'page'];}
  public static function content($id){$d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);return ['ID'=>$d['id'],'IBLOCK_ID'=>7,'XML_ID'=>$d['xml'],'ACTIVE'=>'Y','NAME'=>$d['name'],'DETAIL_TEXT'=>'<p>Original fact</p>','DETAIL_TEXT_TYPE'=>'html','PREVIEW_TEXT'=>'','PREVIEW_TEXT_TYPE'=>'text','UPGRADE_PROPERTIES'=>['UG_SEO_TITLE'=>'Original title','UG_DESCRIPTION'=>'','UG_H1'=>$d['h1'],'UG_FACTS'=>'{}']];}
 }`,
 'code/module/upgrade.core/lib/gateway.php':String.raw`<?php namespace Upgrade\Core;
 final class Gateway {
  private $lock;
  public function __construct($project,$state){$this->lock=fopen($state.'/upgrade-'.$project.'.lock','c');if(!flock($this->lock,LOCK_EX|LOCK_NB))throw new \RuntimeException('LOCK_BUSY');}
  public function __destruct(){flock($this->lock,LOCK_UN);fclose($this->lock);}
  public function dryRun($package){$d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);$edited=$d['h1']!=='Original heading';return ['created'=>0,'updated'=>0,'skipped'=>$edited?0:1,'reconciled'=>0,'conflicts'=>$edited?[['source_id'=>'source:hw500','reason'=>'USER_EDIT_CONFLICT:'.getenv('EDIT_KEY')]]:[],'blockers'=>[]];}
 }`,
 'data/entities.json':json([entity]),'data/routes.json':json([{request_target:route,route_key:sha(route),entity_key:entity.stable_key,expected_status:200,redirect_target:null}]),'data/assets.json':'[]',
 };
 for(const [path,bytes]of Object.entries(sources)){const full=join(pkg,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,bytes);if(path.startsWith('code/module/')){const dest=join(root,'local/modules',path.slice('code/module/'.length));mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes);}}
 const manifest={schema_version:'1.0',project_id:project,source_version:'fixture',mode:'public-demo',target_profile:'editable-content-snapshot',files:Object.fromEntries(Object.entries(sources).map(([p,b])=>[p,sha(b)])),entity_count:1,route_count:1,blockers:[],warnings:[],runtime_verification:'NOT_RUN'};writeFileSync(join(pkg,'manifest.json'),json(manifest));
 const prolog=join(root,'bitrix/modules/main/include/prolog_before.php');mkdirSync(dirname(prolog),{recursive:true});writeFileSync(prolog,String.raw`<?php
 namespace {file_put_contents(getenv('EDIT_BOOT'),'yes');
 class Rows {private $rows;public function __construct($rows){$this->rows=$rows;}public function Fetch(){return array_shift($this->rows)??false;}}
 class CIBlockElement {
  public static function GetList(...$unused){$d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);return new Rows([['ID'=>$d['id']]]);}
  public static function GetProperty(...$unused){$d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);return new Rows([['PROPERTY_TYPE'=>'S','MULTIPLE'=>'N','USER_TYPE'=>'','VALUE'=>$d['h1'],'DESCRIPTION'=>$d['description'],'PROPERTY_VALUE_ID'=>77]]);}
  public static function SetPropertyValuesEx($id,$iblock,$values){
   if(array_keys($values)!==['UG_H1']||$id!==1||$iblock!==7)throw new \RuntimeException('WIDE_WRITE');
   $proof=getenv('EDIT_PROOF');if(!is_file($proof.'/original.json')||!is_file($proof.'/intent.json'))throw new \RuntimeException('NO_DURABLE_INTENT');
   $intent=json_decode(file_get_contents($proof.'/intent.json'),true);if(hash_file('sha256',$proof.'/original.json')!==$intent['original_sha256'])throw new \RuntimeException('ORIGINAL_PIN');
   $d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);$d['h1']=$values['UG_H1'];$d['writes']++;file_put_contents(getenv('EDIT_DATA'),json_encode($d));file_put_contents(getenv('EDIT_CALLS'),json_encode(['id'=>$id,'values'=>$values])."\n",FILE_APPEND);
   if(getenv('EDIT_LOST_ACK')==='1')exit(88);
  }
 }
 class CIBlock {public static function clearIblockTagCache($id){}}
 }
 namespace Bitrix\Main {
 class Application {public static function getConnection(){return new Connection;}}
 class Connection {
  public function getSqlHelper(){return new class {public function forSql($value){return str_replace("'","''",$value);}};}
  public function query($query){
   if(!str_starts_with($query,'SELECT '))throw new \RuntimeException('SQL_WRITE_FORBIDDEN');
   $d=json_decode(file_get_contents(getenv('EDIT_DATA')),true);$entity=json_decode(file_get_contents(getenv('EDIT_PACKAGE').'/data/entities.json'),true)[0];
   if(str_contains($query,'COUNT(*)')){$value=str_contains($query,'ug_operation')?count($d['operations']??[]):(str_contains($query,'b_user')?($d['users']??1):(str_contains($query,'b_event')?($d['events']??0):($d['orders']??0)));return new \Rows([['C'=>(string)$value]]);}
   if(str_contains($query,'FROM ug_operation'))return new \Rows($d['operations']??[]);
   if(str_contains($query,'FROM ug_route'))return new \Rows([['PROJECT_ID'=>getenv('UPGRADE_PROJECT_ID'),'ROUTE_KEY'=>hash('sha256',getenv('EDIT_ROUTE')),'REQUEST_TARGET'=>getenv('EDIT_ROUTE'),'ENTITY_KEY'=>getenv('EDIT_KEY'),'STATUS'=>200,'REDIRECT_TARGET'=>null,'EXTRA'=>$d['route_extra']??'unchanged']]);
   if(str_contains($query,'FROM ug_entity')){$managed=['NAME'=>'Original name','DETAIL_TEXT'=>'<p>Original fact</p>','DETAIL_TEXT_TYPE'=>'html','PREVIEW_TEXT'=>'','PREVIEW_TEXT_TYPE'=>'text','properties'=>['UG_SEO_TITLE'=>'Original title','UG_DESCRIPTION'=>'','UG_H1'=>'Original heading','UG_FACTS'=>'{}']];return new \Rows([['PROJECT_ID'=>getenv('UPGRADE_PROJECT_ID'),'ENTITY_KEY'=>getenv('EDIT_KEY'),'ENTITY_TYPE'=>'page','SOURCE_ID'=>'source:hw500','BITRIX_ID'=>1,'MANAGED_HASH'=>$d['mapping_hash']??hash('sha256',json_encode($managed,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)),'PAYLOAD_HASH'=>hash('sha256',json_encode($entity,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES))]]);}
   throw new \RuntimeException('UNEXPECTED_QUERY');
  }
 }
 class Loader {public static function includeModule($name){if($name==='upgrade.core'){require_once $_SERVER['DOCUMENT_ROOT'].'/local/modules/upgrade.core/lib/gateway.php';require_once $_SERVER['DOCUMENT_ROOT'].'/local/modules/upgrade.core/lib/router.php';}return true;}}}
 `);
 const prepend=join(dir,'prepend.php');writeFileSync(prepend,'<?php define("UPGRADE_SANDBOX_PREPEND_ACTIVE",true);function posix_geteuid(){return (int)getenv("EDIT_UID");}');
 const options={project,target,'document-root':root,package:pkg,'manifest-sha256':sha(json(manifest)),route,'expected-id':id,'state-dir':state,'proof-dir':proof,'prepend-file':prepend,'prepend-sha256':sha(readFileSync(prepend))};
 const call=(command:string,intent?:string,changes:Record<string,string>={},env:Record<string,string>={})=>{
  const args={command,...options,...(intent?{'intent-sha256':intent}:{}),...changes};
  const entries=Object.entries(args);if(env.EDIT_REVERSE_ARGS==='1')entries.reverse();
  const p=spawnSync(php!,['-n','-d',`auto_prepend_file=${prepend}`,'-d','disable_functions=posix_geteuid,mail,exec,passthru,shell_exec,system,popen,proc_open','-d','allow_url_fopen=0','-d','allow_url_include=0',...(process.env.UPGRADE_PHP_EXT_DIR?['-d',`extension_dir=${process.env.UPGRADE_PHP_EXT_DIR}`]:[]),'-d','extension=mbstring',resolve('scripts/verify-native-edit.php'),...entries.map(([k,v])=>`--${k}=${v}`)],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,UPGRADE_DEMO:'1',UPGRADE_PROJECT_ID:project,UPGRADE_TARGET_ID:target,EDIT_UID:'33',EDIT_DATA:data,EDIT_CALLS:calls,EDIT_BOOT:boot,EDIT_KEY:entity.stable_key,EDIT_PROOF:proof,EDIT_ROUTE:route,EDIT_PACKAGE:pkg,...env}});
  assert.equal(p.error,undefined,String(p.error));assert.equal(p.stderr,'');return {process:p,result:JSON.parse(p.stdout)};
 };
 const read=()=>JSON.parse(readFileSync(data,'utf8'));const change=(patch:any)=>writeFileSync(data,json({...read(),...patch}));
 return {call,read,change,proof,data,boot,calls,options};
}
test('PHP prepare/edit/inspect/restore changes only rendered UG_H1, confirms conflict and replays without duplicate writes',{skip:!php},t=>{
 const f=fixture(t);const prepared=f.call('prepare');assert.equal(prepared.process.status,0,json(prepared.result));assert.equal(prepared.result.status,'PREPARED');const pin=prepared.result.intent_sha256;
 const original=readFileSync(join(f.proof,'original.json')),intent=JSON.parse(readFileSync(join(f.proof,'intent.json'),'utf8'));assert.equal(f.read().writes,0);assert.equal(intent.original_sha256,sha(original));
 assert.equal(f.call('prepare').process.status,1);assert.deepEqual(readFileSync(join(f.proof,'original.json')),original);
 const edited=f.call('edit',pin);assert.equal(edited.process.status,0,json(edited.result));assert.equal(edited.result.status,'EDIT_READBACK_CONFLICT_CONFIRMED');assert.equal(f.read().h1,intent.test_value);assert.equal(f.read().name,'Original name');assert.equal(f.read().writes,1);
 assert.equal(f.call('edit',pin).result.replayed,true);assert.equal(f.read().writes,1);const inspection=f.call('inspect',pin);assert.equal(inspection.result.status,'EDITED');assert.match(inspection.result.dry_run.conflicts[0].reason,/^USER_EDIT_CONFLICT:/);
 const restored=f.call('restore',pin);assert.equal(restored.process.status,0,json(restored.result));assert.equal(restored.result.status,'RESTORED_READBACK_CONFIRMED');assert.equal(f.read().h1,'Original heading');assert.equal(f.read().writes,2);assert.equal(f.call('restore',pin).result.replayed,true);assert.equal(f.read().writes,2);assert.equal(f.call('inspect',pin).result.status,'ORIGINAL');
 assert.deepEqual(readFileSync(join(f.proof,'original.json')),original);
 assert.equal(f.call('edit',pin).result.reason,'RESTORE_ALREADY_REQUESTED');assert.equal(f.read().writes,2);
});
test('PHP unknown edit and restore outcomes reconcile current value before repeat',{skip:!php},t=>{
 const f=fixture(t),pin=f.call('prepare').result.intent_sha256;
 const lost=f.call('edit',pin,{}, {EDIT_LOST_ACK:'1'});assert.equal(lost.result.status,'UNKNOWN');assert.equal(f.read().writes,1);
 assert.equal(f.call('edit',pin).result.replayed,true);assert.equal(f.read().writes,1);
 const restore=f.call('restore',pin,{}, {EDIT_LOST_ACK:'1'});assert.equal(restore.result.status,'UNKNOWN');assert.equal(f.read().writes,2);
 assert.equal(f.call('restore',pin).result.replayed,true);assert.equal(f.read().writes,2);
});
test('PHP third-party H1, other field/identity drift and altered intent prohibit writes',{skip:!php},t=>{
 const f=fixture(t),pin=f.call('prepare').result.intent_sha256;assert.equal(f.call('edit',pin).process.status,0);const edited=f.read().h1;
 f.change({h1:'Third party edit'});assert.equal(f.call('restore',pin).result.reason,'RESTORE_CONFLICT');assert.equal(f.read().h1,'Third party edit');assert.equal(f.read().writes,1);
 f.change({h1:edited,name:'Other editorial change'});assert.equal(f.call('restore',pin).result.reason,'OTHER_FIELDS_OR_IDENTITY_CHANGED');assert.equal(f.read().writes,1);
 f.change({name:'Original name',id:2});assert.equal(f.call('restore',pin).result.reason,'ROUTE_ENTITY_BINDING');assert.equal(f.read().writes,1);f.change({id:1});
 writeFileSync(join(f.proof,'intent.json'),'{}');assert.equal(f.call('restore',pin).result.reason,'FILE_PIN_MISMATCH');assert.equal(f.read().writes,1);
});
test('PHP uid/project/target/package guards reject before CMS and missing receipt pin cannot write',{skip:!php},t=>{
 const f=fixture(t);
 for(const [changes,env]of [[{target:'foreign'},{}],[{'manifest-sha256':'0'.repeat(64)},{}],[{}, {EDIT_UID:'0'}],[{}, {UPGRADE_PROJECT_ID:'foreign'}]] as [Record<string,string>,Record<string,string>][]){assert.equal(f.call('prepare',undefined,changes,env).process.status,1);assert.equal(existsSync(f.boot),false);assert.equal(f.read().writes,0);}
 assert.equal(f.call('edit').result.reason,'REQUIRED_ARGUMENT_MISSING');assert.equal(f.read().writes,0);
});

test('PHP service mapping/route/operation and commerce counters drift blocks restore; reordered args replay safely',{skip:!php},t=>{
 const f=fixture(t),pin=f.call('prepare').result.intent_sha256;
 assert.equal(f.call('edit',pin,{}, {EDIT_REVERSE_ARGS:'1'}).process.status,0);
 for(const patch of [{mapping_hash:'a'.repeat(64)},{route_extra:'changed'},{operations:[{OPERATION_KEY:'new'}]},{users:2},{orders:1},{events:1}]){
  f.change(patch);assert.equal(f.call('restore',pin).result.reason,'OTHER_FIELDS_OR_IDENTITY_CHANGED');assert.equal(f.read().writes,1);
  f.change({mapping_hash:undefined,route_extra:undefined,operations:[],users:1,orders:0,events:0});
 }
 const restored=f.call('restore',pin,{}, {EDIT_REVERSE_ARGS:'1'});assert.equal(restored.process.status,0,json(restored.result));assert.equal(f.read().writes,2);
});

test('PHP altered original receipt and unsupported property format fail without writes',{skip:!php},t=>{
 const f=fixture(t);f.change({description:'Editor property description'});assert.equal(f.call('prepare').result.reason,'UG_H1_FORMAT_UNSUPPORTED');assert.equal(existsSync(f.proof),false);
 f.change({description:''});const pin=f.call('prepare').result.intent_sha256;writeFileSync(join(f.proof,'original.json'),'{}');
 assert.equal(f.call('edit',pin).result.reason,'FILE_PIN_MISMATCH');assert.equal(f.read().writes,0);
});
