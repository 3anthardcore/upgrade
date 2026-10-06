import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { buildBitrixPackage, sha256 } from "../../packages/bitrix-adapter/index.ts";
import { executeNativeTarget, loadNativeProfile } from "../../packages/bitrix-adapter/native.ts";
import type { NativeRunner, NativeTargetProfile } from "../../packages/bitrix-adapter/native.ts";

async function fixture(t:TestContext) {
 const root=await mkdtemp(join(tmpdir(),"upgrade-native-"));t.after(()=>rm(root,{recursive:true,force:true}));
 const packages=join(root,"packages");await mkdir(packages);
 const built=await buildBitrixPackage({projectId:"test-project",sourceVersion:"snap",outputDir:join(packages,"release"),sourceOrigin:"https://example.test",entities:[{source_id:"p1",type:"Page",title:"Actual source",blocks:[{type:"paragraph",text:"Evidence"}]}],routes:[{request_target:"/Exact?x=&x=2",entity_source_id:"p1"}]});
 const profile:NativeTargetProfile={schema_version:1,environment:"demo",project_id:"test-project",target_id:"isolated-test",driver:"docker-exec",docker_executable:process.execPath,container:"test-project-php-1",host_package_root:packages,container_package_root:"/var/lib/upgrade/packages",document_root:"/var/www/html",state_dir:"/var/lib/upgrade",backup_receipt:"/var/lib/upgrade/backup.json",backup_receipt_sha256:"a".repeat(64),timeout_seconds:20};
 const profilePath=join(root,"profile.json");await writeFile(profilePath,JSON.stringify(profile));
 const options={profilePath,profileSha256:sha256(await readFile(profilePath)),packageDir:built.packageDir,manifestSha256:sha256(await readFile(built.manifestPath)),journalDir:join(root,"journal"),action:"apply" as const};
 return {root,profile,options};
}
function destination(){
 let created=false;let writes=0;let conflict=false;const calls:string[]=[];
 const raw:NativeRunner=async(command,args)=>{calls.push(command);assert.equal(args[0],"exec");assert.equal(args[2],"33:33");assert.ok(args.includes("--project=test-project"));assert.ok(args.includes("--target-id=isolated-test"));if(command==="dry-run")return{created:created?0:1,updated:0,skipped:created?1:0,reconciled:0,conflicts:conflict?[{reason:"USER_EDIT_CONFLICT"}]:[],blockers:[]};if(command==="claim")return{fence:1,owner:"upgrade-cli-test-project",lease_until:Math.floor(Date.now()/1000)+300};if(command==="apply"){created=true;writes++;return{created:1,updated:0,skipped:0,reconciled:0,routes:1,errors:0,verification:{status:"DATABASE_RECONCILED",defects:[]}};}return created&&!conflict?{status:"DATABASE_RECONCILED",defects:[]}:{status:"FAIL",defects:[{reason:conflict?"USER_EDIT_CONFLICT":"ROUTE_MISMATCH"}]};};
 const runner:NativeRunner=async(c,a,p)=>({...await raw(c,a,p) as object,_target:{project_id:p.project_id,target_id:p.target_id,manifest_sha256:a.find(v=>v.startsWith("--manifest-sha256="))!.split("=")[1]}});
 return {runner,calls,get writes(){return writes;},set conflict(value:boolean){conflict=value;}};
}
test("native transport persists verified replay without a second destination write",async t=>{
 const {options}=await fixture(t),target=destination();
 const first=await executeNativeTarget(options,target.runner);assert.equal(first.status,"TARGET_CONFIRMED");assert.equal(first.replayed,false);
 const second=await executeNativeTarget(options,target.runner);assert.equal(second.replayed,true);assert.equal(target.writes,1);assert.deepEqual(target.calls,["dry-run","claim","apply","reconcile","reconcile"]);
 const names=await readdir(join(options.journalDir,"isolated-test"));assert.equal(names.filter(n=>n.endsWith(".response.json")).length,5);assert.ok(!names.includes("writer.lock"));
});
test("lost response after actual target write reconciles before retry and never duplicates",async t=>{
 const {options}=await fixture(t),target=destination();let lost=false;
 const lossy:NativeRunner=async(c,a,p)=>{const result=await target.runner(c,a,p);if(c==="apply"&&!lost){lost=true;throw Error("CONNECTION_LOST");}return result;};
 await assert.rejects(executeNativeTarget(options,lossy),/CONNECTION_LOST/);
 const stateFile=join(options.journalDir,"isolated-test",options.manifestSha256+".state.json");assert.equal(JSON.parse(await readFile(stateFile,"utf8")).status,"UNKNOWN");
 const result=await executeNativeTarget(options,target.runner);assert.equal(result.replayed,true);assert.equal(target.writes,1);assert.deepEqual(target.calls,["dry-run","claim","apply","reconcile"]);
});
test("failed or malformed reconciliation cannot authorize a new write",async t=>{
 const {options}=await fixture(t),target=destination();
 await assert.rejects(executeNativeTarget(options,async(c,a,p)=>{if(c==="apply")throw Error("TRANSPORT_LOST");return target.runner(c,a,p);}),/TRANSPORT_LOST/);
 await assert.rejects(executeNativeTarget({...options,action:"reconcile"},async(c,a,p)=>({...await target.runner(c,a,p) as object,status:"SUCCESS"})),/RECONCILE_RESPONSE_INVALID/);
 const stateFile=join(options.journalDir,"isolated-test",options.manifestSha256+".state.json");assert.equal(JSON.parse(await readFile(stateFile,"utf8")).status,"UNKNOWN");
 target.conflict=true;await assert.rejects(executeNativeTarget(options,target.runner),/DRY_RUN_BLOCKED/);assert.equal(target.writes,0);
});
test("unknown previous package blocks a different package on the same target",async t=>{
 const {options}=await fixture(t),target=destination();await executeNativeTarget({...options,action:"validate"},target.runner);
 await writeFile(join(options.journalDir,"isolated-test","b".repeat(64)+".state.json"),JSON.stringify({status:"UNKNOWN",manifest_sha256:"b".repeat(64)}));
 await assert.rejects(executeNativeTarget(options,target.runner),/OTHER_PACKAGE_OUTCOME_UNKNOWN/);assert.equal(target.calls.length,0);
});
test("target pins, project binding and private paths fail before process execution",async t=>{
 const {options,profile}=await fixture(t);let calls=0;const noRun:NativeRunner=async()=>{calls++;throw Error("MUST_NOT_RUN");};
 await assert.rejects(executeNativeTarget({...options,profileSha256:"0".repeat(64)},noRun),/PROFILE_PIN_MISMATCH/);
 await assert.rejects(executeNativeTarget({...options,manifestSha256:"0".repeat(64)},noRun),/ACCEPTED_MANIFEST_HASH_MISMATCH/);
 for(const patch of [{environment:"production"},{state_dir:"/var/www/html/state"},{container:"-v"},{document_root:"/"},{extra:true}]){
  const text=JSON.stringify({...profile,...patch});await writeFile(options.profilePath,text);await assert.rejects(loadNativeProfile(options.profilePath,sha256(text)));
 }
 assert.equal(calls,0);
});
test("one native target writer excludes a concurrent importer",async t=>{
 const {options}=await fixture(t),target=destination();let entered!:()=>void;const start=new Promise<void>(r=>entered=r);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const first=executeNativeTarget(options,async(c,a,p)=>{if(c==="dry-run"){entered();await gate;}return target.runner(c,a,p);});await start;
 await assert.rejects(executeNativeTarget(options,target.runner),/WRITER_BUSY/);release();await first;assert.equal(target.writes,1);
});
test("manual destination edits remain a conflict after prior successful import",async t=>{
 const {options}=await fixture(t),target=destination();await executeNativeTarget(options,target.runner);target.conflict=true;
 await assert.rejects(executeNativeTarget(options,target.runner),/DRY_RUN_BLOCKED/);assert.equal(target.writes,1);
});
test("malformed successful responses and foreign target identity never confirm a write",async t=>{
 for(const scenario of ["empty-string-defects","missing-lease","nan-lease","foreign-target","string-counter"]){
  const {options}=await fixture(t),target=destination();
  await assert.rejects(executeNativeTarget(options,async(c,a,p)=>{
   const v:any=await target.runner(c,a,p);
   if(scenario==="empty-string-defects"&&c==="reconcile")v.defects="";
   if(scenario==="missing-lease"&&c==="claim")delete v.lease_until;
   if(scenario==="nan-lease"&&c==="claim")v.lease_until=NaN;
   if(scenario==="foreign-target")v._target.target_id="foreign";
   if(scenario==="string-counter"&&c==="apply")v.created="1";
   return v;
  }),/NATIVE_(?:RECONCILE_RESPONSE_INVALID|CLAIM_INVALID|RESPONSE_TARGET_BINDING_MISMATCH|APPLY_RESPONSE_INVALID)/);
 }
});
test("real process death releases transport lock and preserves UNKNOWN for destination reconciliation",async t=>{
 const {options}=await fixture(t);const module=pathToFileURL(resolve("packages/bitrix-adapter/native.ts")).href;
 const code=`import {executeNativeTarget} from ${JSON.stringify(module)};await executeNativeTarget(${JSON.stringify(options)},async(c,a,p)=>{if(c==='claim'){console.log('CLAIM_PENDING');setInterval(()=>{},1000);return new Promise(()=>{});}return {created:1,updated:0,skipped:0,reconciled:0,conflicts:[],blockers:[],_target:{project_id:p.project_id,target_id:p.target_id,manifest_sha256:${JSON.stringify(options.manifestSha256)}}};});`;
 const child=spawn(process.execPath,["--disable-warning=ExperimentalWarning","--input-type=module","-e",code],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 await new Promise<void>((done,fail)=>{let text="";const timer=setTimeout(()=>fail(Error("child did not enter claim")),10000);child.stdout.on("data",b=>{text+=b.toString();if(text.includes("CLAIM_PENDING")){clearTimeout(timer);done();}});child.on("error",fail);child.on("exit",()=>{clearTimeout(timer);if(!text.includes("CLAIM_PENDING"))fail(Error("child exited too soon"));});});
 const exit=once(child,"exit");child.kill("SIGKILL");await exit;
 const target=destination();const result=await executeNativeTarget(options,target.runner);
 assert.equal(result.status,"TARGET_CONFIRMED");assert.equal(target.calls[0],"reconcile");assert.equal(target.writes,1);
});
