import pathlib,urllib.request,base64,json
base='https://upgrade.help-ai-ru.ru/studio'
pw=pathlib.Path('var/evidence/continuation-20260930/demo-access-password.private').read_text().strip()
auth='Basic '+base64.b64encode(('upgrade:'+pw).encode()).decode()
def get(p):
 return urllib.request.urlopen(urllib.request.Request(base+p,headers={'Authorization':auth}),timeout=30).read()
j=json.loads(get('/api/jobs'))[0]
out=pathlib.Path('var/stage1-design/studio-launch');out.mkdir(parents=True,exist_ok=True)
(out/'job.json').write_text(json.dumps(j,ensure_ascii=False,indent=2),encoding='utf-8')
for name in ['source','concept']:
 (out/(name+'.png')).write_bytes(get('/files/'+j['id']+'/'+name+'.png'))
print(json.dumps({'id':j['id'],'status':j['status'],'calls':j['calls'],'review':j['result']['review']},ensure_ascii=False))
