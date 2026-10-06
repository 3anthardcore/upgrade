import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogStructure,catalogPlan,qualityIssues} from './catalog.mjs';
test('image links use the corresponding visible name and preserve source paths',()=>{
 const html='<h2>Популярные категории</h2>'+['Арматура','Труба профильная','Труба круглая'].map((x,i)=>`<article><a href="/catalog/${i}/"><img src="/${i}.webp" alt="${x} изображение"></a><a href="/catalog/${i}/">${x}</a></article>`).join('')+'<a href="javascript:alert(1)"><img src="/x.png" alt="Unsafe"></a>';
 const structure=catalogStructure(html,'https://example.org/');
 assert.equal(structure.categories.length,3);assert.equal(structure.categories[1].name,'Труба профильная');
 assert.equal(catalogPlan({url:'https://example.org/',text:'Популярные категории Арматура Труба профильная Труба круглая',structure}).length,3);
});
test('catalog cannot silently degrade into paragraph cards',()=>{
 assert.throws(()=>catalogPlan({url:'https://example.org/',text:'Популярные категории'}),/HTML_CATALOG_STRUCTURE_MISSING/);
 assert.deepEqual(qualityIssues('<article class="content-card"><h3>О компании</h3></article><article class="content-card"><h3>О компании</h3></article>',{categories:[{url:'https://example.org/a'}]}),['DUPLICATE_CARD_HEADINGS','CATALOG_COVERAGE_LOST','CATALOG_IMAGES_MISSING']);
});
test('product descendants do not replace top-level category cards',()=>{
 const out=catalogStructure('<a href="/catalog/a/"><img src="/a.png" alt="Арматура"></a><a href="/catalog/a/item/"><img src="/b.png" alt="Арматура 12 мм"></a>','https://example.org/');
 assert.equal(out.categories.length,1);
});
