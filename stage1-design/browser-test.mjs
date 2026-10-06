import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {captureSource,classifySource} from './source-browser.mjs';import {browserFetch} from './browser-network.ts';
const origin='https://fixture.example';
const make=()=>{const id=crypto.randomUUID();fs.mkdirSync('data/jobs/'+id);return id};
const page=body=>({status:200,headers:{'content-type':'text/html; charset=utf-8'},body:Buffer.from(body)});
const text='Verified source catalogue. Building materials, categories and contact details. '.repeat(5);
const results=[];
test('challenge title recognized even with short/empty body; article mention is not challenge',()=>{
 assert.equal(classifySource('KillBot user verification',''),'blocked');assert.equal(classifySource('Article about bots',text+'captcha'),'ok');assert.equal(classifySource('Empty','hi'),'short');
});
test('fresh DNS guard rejects loopback and link-local',async()=>{
 for(const url of ['http://127.0.0.1/','http://169.254.169.254/','http://[::1]/'])await assert.rejects(()=>browserFetch(url,{allowedOrigins:[new URL(url).origin]}),e=>e.code==='SSRF_BLOCKED');
});
test('static source skips dynamic fallback',async()=>{
 const id=make();const s=await captureSource(id,origin+'/',{transport:async()=>page('<h1>Catalogue</h1><p>'+text+'</p>')});assert.equal(s.browser_mode,'javascript-disabled');assert.equal(fs.existsSync('data/jobs/'+id+'/browser-fallback.json'),false);results.push({id,case:'static',pass:true});
});
test('automatic JS fallback supports temporary cookie/reload and blocks writes/websocket/private navigation',async()=>{
 const id=make();let cookies=0,writeHits=0;const visited=[];
 const transport=async(url,options)=>{visited.push(url);if(url===origin+'/write'){writeHits++;throw Error('WRITE_REACHED')};if(url!==origin+'/')return browserFetch(url,options);
 if(options.requestHeaders?.cookie?.includes('fixture_ready=1')){cookies++;return page('<h1>Catalogue</h1><p>'+text+'</p><script>fetch("/write",{method:"POST",body:"not allowed"}).catch(()=>{});new WebSocket("wss://fixture.example/socket");</script><iframe src="http://127.0.0.1/"></iframe>')}
 return page('<title>Loading</title><body><script>document.cookie="fixture_ready=1;path=/";location.reload();</script></body>');};
 const s=await captureSource(id,origin+'/',{transport,waitMs:6000});assert.equal(s.browser_mode,'javascript-isolated');assert.ok(cookies>0);assert.equal(writeHits,0);assert.ok(!visited.includes(origin+'/socket'));assert.ok(!visited.includes('http://127.0.0.1/'));assert.ok(fs.existsSync('data/jobs/'+id+'/browser-fallback.json'));assert.ok(!JSON.stringify(s).includes('fixture_ready'));results.push({id,case:'dynamic-cookie',pass:true});
 // A distinct capture must start with no cookies.
 const fresh=make();let firstBrowser=true,leaked=false;await captureSource(fresh,origin+'/',{transport:async(url,o)=>{if(o.requestHeaders?.['user-agent']&&firstBrowser){firstBrowser=false;leaked=!!o.requestHeaders.cookie;}return transport(url,o)},waitMs:6000});assert.equal(firstBrowser,false);assert.equal(leaked,false);
});
test('persistent challenge stops with explicit result and evidence',async()=>{
 const id=make();await assert.rejects(()=>captureSource(id,origin+'/',{transport:async()=>page('<title>KillBot user verification</title><p>Please wait</p>'),waitMs:1000}),e=>e.message==='SOURCE_BROWSER_CHALLENGE');assert.ok(fs.existsSync('data/jobs/'+id+'/browser-failure.json'));assert.equal(fs.existsSync('data/jobs/'+id+'/source.json'),false);results.push({id,case:'challenge',pass:true});
});
test.after(()=>fs.writeFileSync('data/browser-tests.json',JSON.stringify(results,null,2)));
