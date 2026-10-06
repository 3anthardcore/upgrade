import pathlib,urllib.request,base64,json,re,uuid
base='https://upgrade.help-ai-ru.ru/studio'
pw=pathlib.Path('var/evidence/continuation-20260930/demo-access-password.private').read_text().strip()
auth='Basic '+base64.b64encode(('upgrade:'+pw).encode()).decode()
out=pathlib.Path('var/stage1-design/astra-full-run');out.mkdir(parents=True,exist_ok=True)
def request(route,payload=None,csrf=None):
 headers={'Authorization':auth}
 if payload is not None:headers.update({'Content-Type':'application/json','X-CSRF-Token':csrf})
 return urllib.request.urlopen(urllib.request.Request(base+route,data=json.dumps(payload).encode() if payload else None,headers=headers),timeout=45).read()
jobs=json.loads(request('/api/jobs'))
intent=out/'intent.json'
if intent.exists():payload=json.loads(intent.read_text(encoding="utf-8"))
else:
 if any(j['status'] in ['queued','analyzing','generating','checking'] for j in jobs):raise SystemExit('Active job exists; inspect before starting another')
 original=next(j for j in jobs if j['id']=='b8b573d5-2ea9-40d5-9926-e0a76aac1054')
 payload={**original['payload'],'mode':'image','parent':None,'edit':'','idem':str(uuid.uuid4())}
 intent.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
receipt=out/'submitted.json'
if not receipt.exists():
 html=request('/').decode();csrf=re.search(r"const csrf='([^']+)'",html).group(1)
 result=json.loads(request('/api/jobs',payload,csrf));receipt.write_text(json.dumps(result),encoding='utf-8')
else:result=json.loads(receipt.read_text())
job=next((j for j in json.loads(request('/api/jobs')) if j['id']==result['id']),result)
(out/'latest.json').write_text(json.dumps(job,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(job,ensure_ascii=True))
if job.get('result'):
 for name in ['source.png','concept.png']:(out/name).write_bytes(request('/files/'+job['id']+'/'+name))

