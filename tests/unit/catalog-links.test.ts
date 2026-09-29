import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {load} from 'cheerio';
import {buildBitrixPackage} from '../../packages/bitrix-adapter/index.ts';

test('package header preserves witnessed labels/exact query and excludes unmapped or unsafe navigation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'upgrade-nav-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const target='/catalog?brand=A&brand=B&empty=';
 const result=await buildBitrixPackage({projectId:'nav-test',sourceVersion:'snapshot',outputDir:join(root,'package'),sourceOrigin:'https://source.example',entities:[
  {source_id:'home',source_url:'https://source.example/',type:'Page',title:'Home',facts:{'dom:home_logo_alt':{value:'Маркет <script> & <?php echo 1; ?>'},'dom:primary_navigation':{value:[
   {label:' Каталог & <товары> ',request_target:target},
   {label:'Скрытая страница',request_target:'/unobserved'},
   {label:'Admin',request_target:'/%62itrix/admin/'},
   {label:'External',request_target:'https://evil.example/'},
   {label:'Каталог & <товары>',request_target:'/redirect'},
  ]}}},
  {source_id:'catalog',type:'Page',title:'Catalog'},
 ],routes:[{request_target:'/',entity_source_id:'home'},{request_target:target,entity_source_id:'catalog'},{request_target:'/redirect',expected_status:301,redirect_target:target}]});
 assert.deepEqual(result.manifest.blockers,[]);
 const header=await readFile(join(result.packageDir,'code/local/templates/upgrade/header.php'),'utf8');
 const nav=header.match(/<nav aria-label="Основная навигация">([\s\S]*?)<\/nav>/)?.[1];assert.ok(nav);
 const $=load(nav);assert.equal($('a').length,1);assert.equal($('a').attr('href'),target);assert.equal($('a').text(),'Каталог & <товары>');
 assert.doesNotMatch(nav,/<\?php|<script|evil\.example|unobserved/);
 assert.ok(header.includes('Маркет &lt;script&gt; &amp; &lt;?php echo 1; ?&gt;'));
});
