/** Offline packaging of explicit operator/browser exports. No network or desktop API. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, lstatSync, realpathSync, renameSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { identifyUrl } from '../packages/crawler/index.ts';
import { validateOperatorCapture, OPERATOR_CAPTURE_LIMITS } from '../packages/crawler/operator.ts';
const rawRoot=resolve(process.argv[2] ?? 'var/pilots/teplypol-catalog-20260929');
const output=resolve(process.argv[3] ?? 'var/pilots/teplypol-catalog-package-20260929');
const captureId=process.argv[4];
// Optional pinned observation scope for an explicitly staged first import.
// Raw observations outside this scope still contribute to the original URL registry.
const scopeFile=process.argv[5],scopePin=process.argv[6];
if(!captureId||!/^[a-zA-Z0-9._-]+$/.test(captureId)||existsSync(output))throw Error('New capture id and unused output directory required');
const legacyRoot=resolve('var/pilots/teplypol-operator-capture-media-20260929');
const legacy=JSON.parse(readFileSync(join(legacyRoot,'operator-capture.json'),'utf8'));
const sourceOrigin=legacy.source_origin;
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const rawFiles=readdirSync(rawRoot).filter(f=>f.endsWith('.raw.json')).sort();
const raws=rawFiles.map(name=>({name,...JSON.parse(readFileSync(join(rawRoot,name),'utf8'))}));
const latest=new Map<string,any>();
for(const raw of raws){const id=identifyUrl(raw.source_url);if(id.origin!==sourceOrigin||raw.document_url!==raw.source_url||typeof raw.html!=='string')throw Error('Raw source binding invalid');if(!latest.has(id.crawl_key)||latest.get(id.crawl_key).observed_at<raw.observed_at)latest.set(id.crawl_key,raw);}
if(latest.size>OPERATOR_CAPTURE_LIMITS.observations)throw Error('Observation cap exceeded; retain raw data and split explicitly');
const staging=output+'.pending-'+randomUUID();mkdirSync(join(staging,'observations'),{recursive:true});mkdirSync(join(staging,'assets'));
let totalBytes=0;const fileHashes=new Set<string>();
const put=(relative:string,bytes:Buffer)=>{if(bytes.length>OPERATOR_CAPTURE_LIMITS.fileBytes)throw Error('File cap exceeded');const digest=hash(bytes);if(!fileHashes.has(relative)){writeFileSync(join(staging,relative),bytes,{flag:'wx'});fileHashes.add(relative);totalBytes+=bytes.length;if(totalBytes>OPERATOR_CAPTURE_LIMITS.totalBytes)throw Error('Total capture cap exceeded');}return {relative_path:relative,sha256:digest,size_bytes:bytes.length};};
const inventory=new Set<string>(legacy.inventory.urls);
const addUrl=(raw:string)=>{try{const id=identifyUrl(raw);if(id.origin===sourceOrigin&&!/\.(?:jpe?g|png|webp|gif|svg|avif|ico|pdf|woff2?|ttf|css|js)(?:[?#]|$)/i.test(id.raw_url))inventory.add(id.crawl_key);}catch{/* Non-HTTP source actions are not page identities. */}};
for(const raw of raws){raw.links.forEach(addUrl);if(raw.requested_url)addUrl(raw.requested_url);addUrl(raw.source_url);}
let observationScope: Set<string>|undefined;
if(scopeFile){const bytes=readFileSync(resolve(scopeFile));if(!scopePin||hash(bytes)!==scopePin)throw Error('Observation scope pin mismatch');const prior=JSON.parse(bytes.toString());if(prior.project_id!==legacy.project_id||prior.source_origin!==sourceOrigin)throw Error('Foreign observation scope');observationScope=new Set(prior.observations.map((o:{source_url:string})=>o.source_url));for(const url of observationScope)if(!latest.has(url))throw Error('Scoped observation unavailable');}
const observations=[...latest.values()].filter(raw=>!observationScope||observationScope.has(raw.source_url)).sort((a,b)=>a.source_url.localeCompare(b.source_url)).map(raw=>({source_url:raw.source_url,document_url:raw.document_url,observed_at:raw.observed_at,format:'dom-html' as const,file:put('observations/'+hash(raw.source_url)+'.html',Buffer.from(raw.html,'utf8'))}));
const assetMap=new Map<string,any>();const omissions:any[]=[];const changes:any[]=[];
const mime=(b:Buffer)=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':/^GIF8[79]a$/.test(b.subarray(0,6).toString())?'image/gif':b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'?'image/webp':b.subarray(0,5).toString()==='%PDF-'?'application/pdf':null;
const ext:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','application/pdf':'pdf'};
const verifiedLocal=(filename:string,allowedRoot:string)=>{const physical=realpathSync(filename),root=realpathSync(allowedRoot);const stat=lstatSync(filename);if(!physical.startsWith(root+sep)||stat.isSymbolicLink()||!stat.isFile()||stat.size>OPERATOR_CAPTURE_LIMITS.fileBytes)throw Error('Exported asset escaped its bounded directory');return readFileSync(physical);};
for(const asset of legacy.assets){const bytes=verifiedLocal(join(legacyRoot,asset.file.relative_path),legacyRoot);if(hash(bytes)!==asset.file.sha256||bytes.length!==asset.file.size_bytes||mime(bytes)!==asset.mime)throw Error('Legacy asset integrity mismatch');assetMap.set(identifyUrl(asset.source_url).crawl_key,{source_url:asset.source_url,observed_on_urls:asset.observed_on_urls.slice(0,1),mime:asset.mime,bytes});}
const browserExportRoot=resolve(tmpdir(),'browser-use','assets');
for(const raw of raws.sort((a,b)=>a.observed_at.localeCompare(b.observed_at))){
 if(!raw.asset_bundle)continue;
 const bundle=raw.asset_bundle;
 const bundleRoot=realpathSync(bundle.directoryPath);
 if(!bundleRoot.startsWith(realpathSync(browserExportRoot)+sep))throw Error('Unexpected browser export root');
 for(const asset of bundle.assets){
  let id;try{id=identifyUrl(asset.url);}catch{continue;}if(id.origin!==sourceOrigin)continue;
  const bytes=verifiedLocal(asset.path,bundleRoot),type=mime(bytes);
  if(!type){omissions.push({source_url:asset.url,page:raw.source_url,reason:'Unsupported or unverified file signature'});continue;}
  const prior=assetMap.get(id.crawl_key);if(prior&&hash(prior.bytes)!==hash(bytes))changes.push({source_url:asset.url,before:hash(prior.bytes),after:hash(bytes),observed_at:raw.observed_at});
  assetMap.set(id.crawl_key,{source_url:asset.url,observed_on_urls:[raw.source_url],mime:type,bytes});
 }
 for(const failure of bundle.failures??[])omissions.push({source_url:failure.url,page:raw.source_url,reason:failure.reason});
}
const downloadedIndex=join(rawRoot,'downloaded-assets.json');
if(existsSync(downloadedIndex))for(const asset of JSON.parse(readFileSync(downloadedIndex,'utf8'))){
 const id=identifyUrl(asset.source_url);
 if(id.origin!==sourceOrigin||!Array.isArray(asset.observed_on_urls)||!asset.observed_on_urls.length||asset.observed_on_urls.some((url:string)=>!latest.has(url)))throw Error('Downloaded asset witness invalid');
 const bytes=verifiedLocal(join(rawRoot,asset.relative_path),rawRoot),type=mime(bytes);
 if(!type||hash(bytes)!==asset.sha256||bytes.length!==asset.size_bytes)throw Error('Downloaded asset byte pin mismatch');
 if(!asset.observed_on_urls.some((url:string)=>latest.get(url).links.includes(asset.source_url)))throw Error('Downloaded file link absent from witnessed DOM');
 assetMap.set(id.crawl_key,{source_url:asset.source_url,observed_on_urls:asset.observed_on_urls.slice(0,1),mime:type,bytes});
}
// Only one explicit witnessing page is needed for each asset; every raw bundle retains all observations.
const assets=[...assetMap.values()].sort((a,b)=>a.source_url.localeCompare(b.source_url)).map(asset=>({source_url:asset.source_url,observed_on_urls:asset.observed_on_urls,mime:asset.mime,file:put('assets/'+hash(asset.source_url)+'.'+ext[asset.mime],asset.bytes)}));
const manifest={schema_version:1,kind:'operator-capture',capture_id:captureId,project_id:'teplypol-market',source_origin:sourceOrigin,captured_at:new Date().toISOString(),inventory:{basis:'operator-observed-urls',urls:[...inventory].sort()},observations,assets};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');if(manifestBytes.length>OPERATOR_CAPTURE_LIMITS.manifestBytes)throw Error('Manifest cap exceeded');writeFileSync(join(staging,'operator-capture.json'),manifestBytes,{flag:'wx'});
const result=await validateOperatorCapture({directory:staging,expectedProjectId:'teplypol-market',expectedSourceUrl:sourceOrigin+'/',expectedManifestSha256:hash(manifestBytes)});
renameSync(staging,output);
const report={capture_id:captureId,manifest_sha256:hash(manifestBytes),source_raw_files:rawFiles,raw_observed_pages:latest.size,observation_scope_manifest_sha256:scopePin??null,deferred_observed_pages:[...latest.keys()].filter(url=>observationScope&&!observationScope.has(url)),observations:observations.length,assets:assets.length,unique_asset_files:new Set(assets.map(a=>a.file.sha256)).size,total_bytes:totalBytes,coverage:result.coverage,missing_asset_urls:result.unverified_asset_urls,omissions,asset_changes:changes,scope:'PARTIAL_OPERATOR_CAPTURE_FULL_SOURCE_UNKNOWN',output};
const reportPath=resolve('var/evidence/catalog-stage',captureId+'-pack-report.json');mkdirSync(resolve('var/evidence/catalog-stage'),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({capture_id:captureId,manifest_sha256:report.manifest_sha256,observations:report.observations,assets:report.assets,total_bytes:totalBytes,coverage:result.coverage,missing_assets:result.unverified_asset_urls.length,omissions:omissions.length,reportPath,output}));
