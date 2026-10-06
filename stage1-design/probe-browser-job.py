import pathlib,urllib.request,base64,json,re,uuid
base='https://upgrade.help-ai-ru.ru/studio'
pw=pathlib.Path('var/evidence/continuation-20260930/demo-access-password.private').read_text().strip()
auth='Basic '+base64.b64encode(('upgrade:'+pw).encode()).decode()
out=pathlib.Path('var/stage1-design/browser-fallback');out.mkdir(parents=True,exist_ok=True)
def get(route,payload=None,csrf=''):
 headers={'Authorization':auth,'Content-Type':'application/json','X-CSRF-Token':csrf}
 return urllib.request.urlopen(urllib.request.Request(base+route,headers=headers,data=json.dumps(payload).encode() if payload else None),timeout=30).read()
p=out/'intent.json'
if not p.exists():p.write_text(json.dumps({'url':'https://teplypol-market.ru/','mode':'html','preference':'','direction':'auto','idem':str(uuid.uuid4())}),encoding='utf-8')
receipt=out/'submitted.json'
if not receipt.exists():
 csrf=re.search(r"const csrf='([^']+)'",get('/').decode()).group(1)
 receipt.write_bytes(get('/api/jobs',json.loads(p.read_text(encoding='utf-8')),csrf))
id=json.loads(receipt.read_text(encoding='utf-8'))['id']
j=next(j for j in json.loads(get('/api/jobs')) if j['id']==id)
(out/'latest.json').write_text(json.dumps(j,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:j[k] for k in ['id','status','step','error','calls']},ensure_ascii=True))
