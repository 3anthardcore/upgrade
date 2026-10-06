/** Documented PHP CLI transport; no Codex app or browser internals. */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir, lstat, realpath, readdir, unlink, open } from "node:fs/promises";
import { isAbsolute, resolve, relative, sep, posix } from "node:path";
import { validateBitrixPackage } from "./index.ts";

export interface NativeTargetProfile {
  schema_version: 1;
  environment: "demo";
  project_id: string;
  target_id: string;
  driver: "docker-exec";
  docker_executable: string;
  container: string;
  host_package_root: string;
  container_package_root: string;
  document_root: string;
  state_dir: string;
  backup_receipt: string;
  backup_receipt_sha256: string;
  timeout_seconds: number;
}
export type NativeCommand = "validate" | "dry-run" | "claim" | "apply" | "reconcile";
export type NativeRunner = (command: NativeCommand, args: string[], profile: NativeTargetProfile) => Promise<unknown>;
const digest = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const sha = /^[a-f0-9]{64}$/;
const id = /^[a-z0-9][a-z0-9-]{0,62}$/;
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
async function boundedFile(path: string, cap = 1_048_576) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > cap) throw Error("NATIVE_BOUNDED_FILE_REQUIRED");
  return readFile(path);
}
export async function loadNativeProfile(path: string, pin: string): Promise<NativeTargetProfile> {
  const bytes = await boundedFile(path);
  if (!sha.test(pin) || digest(bytes) !== pin) throw Error("NATIVE_PROFILE_PIN_MISMATCH");
  const p = JSON.parse(bytes.toString()) as NativeTargetProfile;
  const keys = ["schema_version","environment","project_id","target_id","driver","docker_executable","container","host_package_root","container_package_root","document_root","state_dir","backup_receipt","backup_receipt_sha256","timeout_seconds"];
  if (Object.keys(p).some(k=>!keys.includes(k)) || keys.some(k=>!Object.hasOwn(p,k)) || p.schema_version !== 1 || p.environment !== "demo" || p.driver !== "docker-exec" || !id.test(p.project_id) || !id.test(p.target_id) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(p.container) || !sha.test(p.backup_receipt_sha256) || !Number.isInteger(p.timeout_seconds) || p.timeout_seconds < 10 || p.timeout_seconds > 3600) throw Error("INVALID_NATIVE_PROFILE");
  for (const value of [p.docker_executable,p.host_package_root,p.container_package_root,p.document_root,p.state_dir,p.backup_receipt]) if (typeof value !== "string" || !value || /[\x00-\x1f]/.test(value)) throw Error("INVALID_NATIVE_PATH");
  if (!isAbsolute(p.docker_executable) || !isAbsolute(p.host_package_root)) throw Error("NATIVE_ABSOLUTE_HOST_PATH_REQUIRED");
  for (const value of [p.container_package_root,p.document_root,p.state_dir,p.backup_receipt]) if (!value.startsWith("/") || posix.normalize(value)!==value || value==="/") throw Error("NATIVE_NORMALIZED_CONTAINER_PATH_REQUIRED");
  if (p.state_dir===p.document_root || p.state_dir.startsWith(p.document_root+"/") || !p.backup_receipt.startsWith(p.state_dir+"/") || (p.container_package_root!==p.state_dir && !p.container_package_root.startsWith(p.state_dir+"/"))) throw Error("NATIVE_PRIVATE_STATE_REQUIRED");
  return p;
}

export const runNativeProcess: NativeRunner = async (_command,args,profile) => new Promise((resolveResult,reject)=>{
  const child = spawn(profile.docker_executable,args,{shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  const chunks:Buffer[]=[];let bytes=0;let errorBytes=0;let failed=false;
  const fail=(error:Error)=>{if(!failed){failed=true;child.kill();reject(error);}};
  const timer=setTimeout(()=>fail(Error("NATIVE_OUTCOME_UNKNOWN_TIMEOUT")),profile.timeout_seconds*1000);
  child.stdout.on("data",(b:Buffer)=>{bytes+=b.length;if(bytes>32_000_000)fail(Error("NATIVE_OUTPUT_LIMIT"));else chunks.push(b);});
  // CMS stderr can contain private installation paths; persist only the failure class.
  child.stderr.on("data",(b:Buffer)=>{errorBytes+=b.length;if(errorBytes>1_000_000)fail(Error("NATIVE_ERROR_OUTPUT_LIMIT"));});
  child.on("error",()=>{clearTimeout(timer);fail(Error("NATIVE_PROCESS_START_FAILED"));});
  child.on("close",code=>{clearTimeout(timer);if(failed)return;if(code!==0)return reject(Error("NATIVE_PROCESS_FAILED:"+String(code)));try{resolveResult(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Error("NATIVE_RESPONSE_INVALID_JSON"));}});
});

/** The journal lives outside the content Store so a privileged transport never writes SQLite. */
export async function executeNativeTarget(options:{
  profilePath:string; profileSha256:string; packageDir:string; manifestSha256:string;
  journalDir:string; action:"validate"|"dry-run"|"reconcile"|"apply";
}, runner:NativeRunner=runNativeProcess) {
  const profile=await loadNativeProfile(options.profilePath,options.profileSha256);
  if(!sha.test(options.manifestSha256))throw Error("NATIVE_MANIFEST_PIN_REQUIRED");
  const root=await realpath(profile.host_package_root), pkg=await realpath(options.packageDir);
  const rel=relative(root,pkg);
  if(!rel || rel===".." || rel.startsWith(".."+sep) || isAbsolute(rel) || (await lstat(options.packageDir)).isSymbolicLink())throw Error("NATIVE_PACKAGE_OUTSIDE_TARGET");
  const manifest=await validateBitrixPackage(pkg,profile.project_id,options.manifestSha256);
  if(manifest.blockers.length && options.action==="apply")throw Error("NATIVE_PACKAGE_HAS_BLOCKERS");
  const journal=resolve(options.journalDir);
  if(journal===pkg || journal.startsWith(pkg+sep))throw Error("NATIVE_JOURNAL_MUST_BE_PRIVATE");
  await mkdir(journal,{recursive:true,mode:0o700});
  if((await lstat(journal)).isSymbolicLink() || await realpath(journal)!==journal)throw Error("NATIVE_JOURNAL_SYMLINK");
  const target=resolve(journal,profile.target_id);await mkdir(target,{recursive:true,mode:0o700});
  if((await lstat(target)).isSymbolicLink())throw Error("NATIVE_TARGET_JOURNAL_SYMLINK");
  // This database contains no content state. Its OS-owned lock is released on
  // process death, including death during recovery; no PID or stale-file guesses.
  const lockPath=resolve(target,"transport-lock.sqlite");
  try{const f=await open(lockPath,"wx",0o600);await f.close();}catch(error:any){if(error.code!=="EEXIST")throw error;}
  if(!(await lstat(lockPath)).isFile() || (await lstat(lockPath)).isSymbolicLink())throw Error("NATIVE_LOCK_INVALID");
  const lock=new DatabaseSync(lockPath);
  try{lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");}catch{lock.close();throw Error("NATIVE_WRITER_BUSY");}
  try {
    const bind={project_id:profile.project_id,target_id:profile.target_id,container:profile.container,document_root:profile.document_root,state_dir:profile.state_dir,host_package_root:root,container_package_root:profile.container_package_root};
    const bindingPath=resolve(target,"binding.json");
    try{await writeFile(bindingPath,json(bind),{flag:"wx",mode:0o600});}catch(error:any){if(error.code!=="EEXIST")throw error;if(digest(await boundedFile(bindingPath))!==digest(json(bind)))throw Error("NATIVE_TARGET_BINDING_CHANGED");}
    const operation=options.manifestSha256;
    const headPath=resolve(target,operation+".state.json");
    for(const name of await readdir(target)) if(name.endsWith(".state.json") && name!==operation+".state.json"){
      const state=JSON.parse((await boundedFile(resolve(target,name))).toString());
      if(state.status==="UNKNOWN")throw Error("NATIVE_OTHER_PACKAGE_OUTCOME_UNKNOWN:"+state.manifest_sha256);
    }
    let head:any;
    try{head=JSON.parse((await boundedFile(headPath)).toString());}catch(error:any){if(error.code!=="ENOENT")throw error;head={schema_version:1,...bind,manifest_sha256:operation,status:"NEW",attempt:0};}
    if(head.manifest_sha256!==operation || head.project_id!==profile.project_id || head.target_id!==profile.target_id)throw Error("NATIVE_JOURNAL_BINDING_MISMATCH");
    const persist=async()=>{const tmp=headPath+"."+randomUUID()+".tmp";const f=await open(tmp,"wx",0o600);try{await f.writeFile(json(head));await f.sync();}finally{await f.close();}await rename(tmp,headPath);};
    const containerPackage=profile.container_package_root+"/"+rel.split(sep).join("/");
    const common=["exec","-u","33:33",profile.container,"php",containerPackage+"/code/importer/cli.php","--package="+containerPackage,"--project="+profile.project_id,"--target-id="+profile.target_id,"--manifest-sha256="+operation,"--document-root="+profile.document_root,"--state-dir="+profile.state_dir];
    const call=async(command:NativeCommand,extra:string[]=[])=>{
      head.attempt++;head.last_command=command;head.profile_sha256=options.profileSha256;
      if(command==="apply" || command==="claim")head.status="UNKNOWN";
      await persist();
      const receiptBase=resolve(target,operation+"."+String(head.attempt).padStart(5,"0")+"."+command);
      const request={schema_version:1,command,manifest_sha256:operation,target_id:profile.target_id,profile_sha256:options.profileSha256,dispatched_at:new Date().toISOString()};
      await writeFile(receiptBase+".request.json",json(request),{flag:"wx",mode:0o600});
      let value:any;
      try{value=await runner(command,[...common,"--command="+command,...extra],profile);}catch(error){await writeFile(receiptBase+".failure.json",json({status:"OUTCOME_UNCONFIRMED",reason:error instanceof Error?error.message:"UNKNOWN"}),{flag:"wx",mode:0o600});throw error;}
      if(!value || typeof value!=="object" || Array.isArray(value))throw Error("NATIVE_RESPONSE_NOT_OBJECT");
      const bytes=json(value);await writeFile(receiptBase+".response.json",bytes,{flag:"wx",mode:0o600});
      validateNativeResponse(command,value,profile,operation);
      head.last_result={command,file:receiptBase+".response.json",sha256:digest(bytes)};await persist();return value;
    };
    if(options.action==="validate") return {status:"PACKAGE_VALID",target_id:profile.target_id,manifest_sha256:operation,manifest};
    if(options.action==="reconcile"){
      const result=await call("reconcile");
      if(!Array.isArray(result.defects) || !["DATABASE_RECONCILED","FAIL"].includes(result.status) || (result.status==="DATABASE_RECONCILED" && result.defects.length))throw Error("NATIVE_RECONCILE_RESPONSE_INVALID");
      head.status=result.status==="DATABASE_RECONCILED"?"CONFIRMED":"RECONCILED_INCOMPLETE";await persist();return {status:head.status,result,journal:headPath};
    }
    if(options.action==="dry-run")return {status:"TARGET_DRY_RUN",result:await call("dry-run"),journal:headPath};
    let reconciled=false;
    if(head.status!=="NEW"){
      const result=await call("reconcile");reconciled=true;
      if(result.status==="DATABASE_RECONCILED" && Array.isArray(result.defects) && !result.defects.length){head.status="CONFIRMED";await persist();return {status:"TARGET_CONFIRMED",replayed:true,result,journal:headPath};}
      if(result.status!=="FAIL" || !Array.isArray(result.defects))throw Error("NATIVE_RECONCILE_RESPONSE_INVALID");
      head.status="RECONCILED_INCOMPLETE";await persist();
    }
    const dry:any=await call("dry-run");
    if(!Array.isArray(dry.conflicts)||dry.conflicts.length||!Array.isArray(dry.blockers)||dry.blockers.length)throw Error("NATIVE_DRY_RUN_BLOCKED");
    const owner="upgrade-cli-"+profile.project_id;
    const claim:any=await call("claim",["--owner="+owner]);
    if(!Number.isSafeInteger(claim.fence)||claim.fence<1||claim.owner!==owner||claim.lease_until*1000<=Date.now())throw Error("NATIVE_CLAIM_INVALID");
    const applied:any=await call("apply",["--owner="+owner,"--fence="+claim.fence,"--backup-receipt="+profile.backup_receipt,"--backup-receipt-sha256="+profile.backup_receipt_sha256]);
    if(applied.errors!==0 || applied.verification?.status!=="DATABASE_RECONCILED" || applied.verification.defects?.length!==0)throw Error("NATIVE_APPLY_UNCONFIRMED");
    const verified:any=await call("reconcile");
    if(verified.status!=="DATABASE_RECONCILED" || verified.defects?.length!==0)throw Error("NATIVE_POST_APPLY_RECONCILE_FAILED");
    head.status="CONFIRMED";await persist();return {status:"TARGET_CONFIRMED",replayed:false,reconciled_before_write:reconciled,applied,result:verified,journal:headPath};
  } finally {try{lock.exec("ROLLBACK;");}finally{lock.close();}}
}

function validateNativeResponse(command:NativeCommand,value:any,profile:NativeTargetProfile,manifest:string) {
  const validCount=(x:any)=>Number.isSafeInteger(x)&&x>=0;
  const reconciliation=(r:any)=>r&&Array.isArray(r.defects)&&r.defects.every((d:any)=>d&&typeof d==="object"&&!Array.isArray(d))&&((r.status==="DATABASE_RECONCILED"&&r.defects.length===0)||(r.status==="FAIL"&&r.defects.length>0));
  if(value._target?.project_id!==profile.project_id || value._target?.target_id!==profile.target_id || value._target?.manifest_sha256!==manifest)throw Error("NATIVE_RESPONSE_TARGET_BINDING_MISMATCH");
  if(command==="claim" && (!Number.isSafeInteger(value.fence)||value.fence<1||value.owner!=="upgrade-cli-"+profile.project_id||!Number.isSafeInteger(value.lease_until)||value.lease_until*1000<=Date.now()||value.lease_until*1000>Date.now()+3_601_000))throw Error("NATIVE_CLAIM_INVALID");
  if(command==="reconcile"&&!reconciliation(value))throw Error("NATIVE_RECONCILE_RESPONSE_INVALID");
  if(command==="dry-run"&&(!["created","updated","skipped","reconciled"].every(k=>validCount(value[k]))||!Array.isArray(value.conflicts)||!Array.isArray(value.blockers)))throw Error("NATIVE_DRY_RUN_RESPONSE_INVALID");
  if(command==="apply"&&(!["created","updated","skipped","reconciled","routes","errors"].every(k=>validCount(value[k]))||!reconciliation(value.verification)))throw Error("NATIVE_APPLY_RESPONSE_INVALID");
}
