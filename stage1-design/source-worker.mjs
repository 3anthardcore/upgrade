import {captureSource} from './source-browser.mjs';
const [id,url]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(id||''))process.exit(2);
try{await captureSource(id,url);console.log(JSON.stringify({ok:true}));}catch(e){console.log(JSON.stringify({ok:false,code:/^[A-Z_]+$/.test(e.message)?e.message:'SOURCE_BROWSER_FAILED'}));process.exitCode=1;}
