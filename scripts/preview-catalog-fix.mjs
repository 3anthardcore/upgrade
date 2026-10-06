import fs from 'node:fs';import * as cheerio from 'cheerio';import {catalogStructure} from '../stage1-design/html-kit/catalog.mjs';import {createHtmlConcept,hash} from '../stage1-design/html-kit/render.mjs';
const html=fs.readFileSync('var/snabmetal-source-20261004.html','utf8'),q=cheerio.load(html);q('script,style,noscript').remove();
const dir='var/design-fix-snabmetal-20261004';fs.mkdirSync(dir,{recursive:true});
const structure={...catalogStructure(html,'https://snabmetal.ru/'),headings:q('h1,h2,h3').map((_,e)=>({level:Number(e.tagName[1]),text:q(e).text().trim()})).get(),paragraphs:q('p').map((_,e)=>({text:q(e).text().trim()})).get()};
const source={url:'https://snabmetal.ru/',title:q('title').text(),text:q('body').text(),observed_at:new Date().toISOString(),structure,images:[]};
for(const c of structure.categories){const r=await fetch(c.image_url);if(!r.ok)continue;const b=Buffer.from(await r.arrayBuffer());const ext=b.subarray(0,4).toString()==='RIFF'?'webp':b.subarray(0,3).toString('hex')==='ffd8ff'?'jpg':'png';const file='source-media-'+source.images.length+'.'+ext;fs.writeFileSync(dir+'/'+file,b);source.images.push({url:c.image_url,file,sha256:hash(b),alt:c.name})}
fs.writeFileSync(dir+'/source.json',JSON.stringify(source,null,2));console.log(JSON.stringify(await createHtmlConcept({source,sourceDir:dir,outputDir:dir,direction:'minimal'})));
