import * as cheerio from 'cheerio';
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
// Source markup is data only. Never retain handlers, source classes or executable URLs.
export function catalogStructure(html, base) {
 const $=cheerio.load(html);const origin=new URL(base).origin;const categories=[];const seen=new Set();
 $('script,style,nav,header,footer').remove();
 $('a[href]').each((_,el)=>{
  const a=$(el), img=a.find('img').first();
  const named=$('a[href]').filter((_,x)=>$(x).attr('href')===a.attr('href')&&!$(x).find('img').length).first();
  const name=norm(a.find('h2,h3,h4').first().text()||named.text()||a.text()||img.attr('alt'));
  if(!img.length||name.length<3||name.length>75||/купить|корзин|руб[ .]|₽|подробнее|акци|скидк|логотип/i.test(name))return;
  let url,image;try{url=new URL(a.attr('href'),base);image=new URL(img.attr('src'),base)}catch{return}
  if(url.origin!==origin||!/^https?:$/.test(url.protocol)||!/^https?:$/.test(image.protocol)||url.href===base||seen.has(url.href))return;
  seen.add(url.href);categories.push({name,url:url.href,image_url:image.href});
 });
 const parents=categories.filter(c=>!categories.some(p=>p.url!==c.url&&c.url.startsWith(p.url.endsWith('/')?p.url:p.url+'/')));
 return {categories:parents.slice(0,40),catalog_expected:/каталог|категории товаров|категории продукции/i.test($.text())};
}
export function catalogPlan(source){
 const text=norm(source.text);const seen=new Set();
 const categories=(source.structure?.categories||[]).filter(c=>{
  if(!c.name||!text.includes(norm(c.name)))return false;
  try{const u=new URL(c.url);if(u.origin!==new URL(source.url).origin||!/^https?:$/.test(u.protocol)||seen.has(u.href))return false;seen.add(u.href);return true}catch{return false}
 });
 const expected=source.structure?.catalog_expected||/популярные категории|категории товаров|каталог товаров/i.test(text);
 if(expected&&categories.length<3)throw Error('HTML_CATALOG_STRUCTURE_MISSING');
 return categories;
}
export function qualityIssues(html,model){
 const $=cheerio.load(html),issues=[];
 const titles=$('.content-card h3').map((_,e)=>norm($(e).text()).toLowerCase()).get();
 if(new Set(titles).size!==titles.length)issues.push('DUPLICATE_CARD_HEADINGS');
 if(model.categories?.length){
  const urls=$('[data-source-category]').map((_,e)=>$(e).attr('data-source-category')).get();
  if(model.categories.some(c=>!urls.includes(c.url)))issues.push('CATALOG_COVERAGE_LOST');
  if($('.category-card img').length<Math.min(3,model.categories.length))issues.push('CATALOG_IMAGES_MISSING');
 }
 return issues;
}


