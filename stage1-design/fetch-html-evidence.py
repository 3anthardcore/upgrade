import pathlib,urllib.request,base64,json
base='https://upgrade.help-ai-ru.ru/studio';pw=pathlib.Path('var/evidence/continuation-20260930/demo-access-password.private').read_text().strip();auth='Basic '+base64.b64encode(('upgrade:'+pw).encode()).decode()
def get(p):return urllib.request.urlopen(urllib.request.Request(base+p,headers={'Authorization':auth}),timeout=30).read()
j=next(x for x in json.loads(get('/api/jobs')) if x['id']=='b85d93a2-4020-434c-99cb-2951914cded1')
out=pathlib.Path('var/stage1-design/hyperui/'+j['id']);out.mkdir(parents=True,exist_ok=True)
(out/'job.json').write_text(json.dumps(j,ensure_ascii=False,indent=2),encoding='utf-8')
for name in ['concept.png','concept-mobile.png','concept.html','concept.model.json']:(out/name).write_bytes(get('/files/'+j['id']+'/'+name))
print(json.dumps({'status':j['status'],'calls':j['calls'],'review':j['result']['review']},ensure_ascii=True))

