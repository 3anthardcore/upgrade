import {spawn} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';
const root='/opt/upgrade/stage1-design';
export async function capture(id,url){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('SOURCE_ID');
 return await new Promise((resolve,reject)=>{
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PLAYWRIGHT_BROWSERS_PATH:'/opt/upgrade/shared/browser-cache'};
  const child=spawn(process.execPath,[path.join(root,'source-worker.mjs'),id,url],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});let stdout='',done=false,timedout=false;
  const timer=setTimeout(()=>{timedout=true;try{process.kill(-child.pid,'SIGKILL')}catch{}},150000);
  child.stdout.on('data',b=>{if(stdout.length<8192)stdout+=b.toString()});child.stderr.on('data',()=>{});
  child.on('error',()=>{done=true;clearTimeout(timer);reject(Error('SOURCE_BROWSER_FAILED'))});
  child.on('close',code=>{if(done)return;clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL')}catch{};if(timedout){reject(Error('SOURCE_BROWSER_TIMEOUT'));return;}let result;try{result=JSON.parse(stdout.trim().split('\n').at(-1))}catch{}if(code!==0||!result?.ok){reject(Error(result?.code||'SOURCE_BROWSER_FAILED'));return;}try{resolve(JSON.parse(fs.readFileSync(path.join(root,'data/jobs',id,'source.json'),'utf8')))}catch{reject(Error('SOURCE_BROWSER_FAILED'))}});
 });
}
