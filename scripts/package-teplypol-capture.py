"""Build a provenance-preserving local package from explicit browser exports."""
import json, pathlib, hashlib, html, zipfile

root = pathlib.Path('var/pilots/teplypol-local-20261002')
exports = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(root.glob('*.json')) if p.name.startswith(('home-', 'category-', 'listing-', 'page-', 'detail-'))]
products = {}
pages = {}
for export in exports:
    data = export['data']
    key = export['key']
    if isinstance(data, dict) and 'url' in data:
        pages[data['url']] = {'url': data['url'], 'artifact': key+'.json', 'observed_at': export['observed_at'], 'status': 'PARTIAL' if key == 'page-besplatniy-zamer' else 'CAPTURED'}
    cards = data if key == 'home-products' else data.get('products', []) if isinstance(data, dict) else []
    for card in cards:
        url = card['url']
        record = products.setdefault(url, {'url': url, 'name': card['name'], 'observations': [], 'detail_status': 'NOT_CAPTURED'})
        record['observations'].append({'artifact': key+'.json', 'source_url': data.get('url') if isinstance(data, dict) else 'https://teplypol-market.ru/', 'observed_at': export['observed_at'], 'data': card})
    if key.startswith('detail-'):
        record = products.setdefault(data['url'], {'url': data['url'], 'name': data['title'], 'observations': []})
        record['detail_status'] = 'CAPTURED'
        record['detail_artifact'] = key+'.json'

def save(name, value):
    (root/name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

save('products.json', list(products.values()))
inventory = dict(pages)
for record in products.values():
    inventory.setdefault(record['url'], {'url': record['url'], 'status': 'DISCOVERED_ONLY', 'kind': 'product'})
for export in exports:
    if export['key'] == 'home-links':
        for link in export['data']:
            url = link.get('url') or link.get('href')
            if url: inventory.setdefault(url, {'url': url, 'status': 'DISCOVERED_ONLY', 'kind': 'link'})
save('url-inventory.json', list(inventory.values()))
assets = json.loads((root/'assets/manifest.json').read_text(encoding='utf-8'))
mapped = []
for asset in assets['assets']:
    local = root/'assets'/pathlib.Path(asset['path']).name
    assert local.is_file(), str(local)
    mapped.append({**asset, 'path': local.relative_to(root).as_posix()})
save('asset-index.json', mapped)
counts = {'raw_exports': len(exports), 'listing_pages': sum(e['key'].startswith(('category-', 'listing-')) for e in exports), 'unique_product_urls': len(products), 'product_details': sum(p['detail_status']=='CAPTURED' for p in products.values()), 'saved_images': len(mapped), 'inventory_urls': len(inventory)}
save('coverage.json', {'counts': counts, 'scope': 'Homepage, eight main category listings and observed pagination, selected information pages, three product details.', 'full_site_complete': False, 'limitations': ['Other product details, subcategory pages, news, documents and additional review pages not captured.', 'Free measurement page capture is partial.', 'Four homepage image downloads failed.', 'This is a Codex browser-assisted local capture, not proof of unattended server capture.', 'Prices and claims are source observations, not independently verified.']})
rows = ''.join('<tr><td>'+html.escape(p['name'])+'</td><td><a href="'+html.escape(p['url'],quote=True)+'">'+html.escape(p['url'])+'</a></td><td>'+p['detail_status']+'</td></tr>' for p in products.values())
report = '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Теплый Пол Маркет — выгрузка</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;padding:20px;color:#182433}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}a{color:#315ac4}td{overflow-wrap:anywhere}</style><h1>Теплый Пол Маркет: локальная выгрузка</h1><p>Источник: teplypol-market.ru. Дата: 02.10.2026. Данные прочитаны во встроенном браузере.</p><p>'+html.escape(json.dumps(counts,ensure_ascii=False))+'</p><p>Сохранены главная, 20 страниц листингов восьми разделов, информационные страницы и три полные карточки. Остальные товары: название и URL из листинга; часть имеет цену и атрибуты с главной. Это частичная выгрузка, не полный импорт сайта. Страница замера неполная; четыре изображения не загрузились. Автоматический серверный сбор пока не подтверждён.</p><p><a href="products.json">Данные товаров</a> · <a href="url-inventory.json">Реестр URL</a> · <a href="coverage.json">Полнота</a> · <a href="asset-index.json">Изображения</a></p><table><tr><th>Товар</th><th>Исходный URL</th><th>Карточка</th></tr>'+rows+'</table></html>'
(root/'report.html').write_text(report,encoding='utf-8')
hashes = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'checksums.json'}
save('checksums.json', hashes)
assert len(products) == len(set(products))
assert counts['listing_pages'] == 20 and counts['product_details'] == 3
for path, digest in hashes.items(): assert hashlib.sha256((root/path).read_bytes()).hexdigest() == digest
archive = root.with_suffix('.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
print(json.dumps({'counts':counts,'sha256_files_verified':len(hashes),'archive':str(archive),'archive_bytes':archive.stat().st_size},ensure_ascii=False))
