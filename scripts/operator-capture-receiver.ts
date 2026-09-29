/** Local operator handoff UI. No browser control or source-network API. */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root=resolve(process.argv[2] ?? 'var/pilots/teplypol-catalog-20260929');
const port=Number(process.env.UPGRADE_CAPTURE_PORT ?? 18112);
const allowedSourceOrigin=new URL(process.argv[3] ?? 'https://teplypol-market.ru').origin;
const origin='http://127.0.0.1:'+port;
const token=randomBytes(24).toString('hex');
mkdirSync(root,{recursive:true});
const escape=(s:string)=>s.replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]!));
createServer(async(req,res)=>{
 const url=new URL(req.url ?? '/',origin);
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
 res.setHeader('Cache-Control','no-store');
 if(url.searchParams.get('key')!==token){res.writeHead(404);res.end();return;}
 if(req.method==='GET'){
  res.setHeader('Content-Type','text/html; charset=utf-8');
  const queueFile=join(root,'pending-urls.json');
  const queue=existsSync(queueFile)?readFileSync(queueFile,'utf8'):'[]';
  res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Upgrade — сохранить наблюдение</title><h1>Сохранить наблюдение источника</h1><p>Локальная передача DOM в рабочую директорию Upgrade.</p><form method="post"><label>JSON наблюдения<textarea name="capture" rows="12" cols="90"></textarea></label><button type="submit">Сохранить снимок</button></form><details><summary>Очередь ранее наблюдавшихся URL</summary><pre id="observed-url-queue">'+escape(queue)+'</pre></details></html>');return;
 }
 if(req.method!=='POST'||req.headers.origin!==origin){res.writeHead(403);res.end();return;}
 try{
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Error('Capture too large');chunks.push(chunk);}
  const body=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const capture=JSON.parse(body.get('capture')??'');
  const source=new URL(capture.source_url);
  if(source.origin!==allowedSourceOrigin||capture.document_url!==source.href||typeof capture.html!=='string'||!Array.isArray(capture.links)||!Number.isFinite(Date.parse(capture.observed_at)))throw Error('Invalid operator observation');
  const digest=createHash('sha256').update(capture.html).digest('hex');
  const slug=createHash('sha256').update(source.href).digest('hex').slice(0,16);
  const json=JSON.stringify(capture,null,2)+'\n';
  // An identical DOM can have a later successful asset export. Preserve both receipts.
  const basename=slug+'-'+digest.slice(0,16)+'-'+createHash('sha256').update(json).digest('hex').slice(0,12);
  const file=join(root,basename+'.raw.json');
  if(!existsSync(file)){writeFileSync(file,json,{flag:'wx'});writeFileSync(join(root,basename+'.html'),capture.html,{flag:'wx'});}
  const receipt={source_url:source.href,basename,sha256:digest,html_bytes:Buffer.byteLength(capture.html),link_count:capture.links.length,observed_at:capture.observed_at};
  console.log(JSON.stringify(receipt));res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><title>Снимок сохранён</title><h1>Снимок сохранён</h1><pre>'+escape(JSON.stringify(receipt,null,2))+'</pre><a href="?key='+token+'">Следующее наблюдение</a>');
 }catch{res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Наблюдение не принято. Проверьте формат; файл не подтверждён.');}
}).listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:origin+'/?key='+token,root})));
