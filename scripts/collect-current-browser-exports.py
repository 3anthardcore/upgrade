"""Persist only explicit, marked DOM exports from this task's tool output.
No browser access, replay, credentials, or execution of source content.
"""
import json,pathlib,re,hashlib,shutil
log=pathlib.Path(r'C:/Users/root/.codex/sessions/2026/09/29/rollout-2026-09-29T02-24-02-01a0ea55-2158-7453-a4da-cad857faef33.jsonl')
out=pathlib.Path('var/pilots/teplypol-local-20261002');out.mkdir(parents=True,exist_ok=True)
decoder=json.JSONDecoder();count=0
for line in log.open(encoding='utf-8'):
 if 'teplypol-20261002' not in line:continue
 event=json.loads(line);p=event.get('payload',{})
 if event.get('type')!='response_item' or p.get('type')!='function_call_output':continue
 for item in p.get('output',[]):
  text=item.get('text','')
  for match in re.finditer(r'\{"upgrade_capture":"teplypol-20261002"',text):
   data,_=decoder.raw_decode(text[match.start():]);key=data['key']
   assert re.fullmatch(r'[a-zA-Z0-9_-]+',key)
   data['observed_at']=event.get('timestamp');raw=json.dumps(data,ensure_ascii=False,indent=2).encode()
   dest=out/(key+'.json')
   if dest.exists():assert dest.read_bytes()==raw, 'Immutable export changed: '+key
   else:dest.write_bytes(raw)
   count+=1
assets=pathlib.Path(r'C:/Users/root/AppData/Local/Temp/browser-use/assets/7784ad75-50b1-4fbd-a09d-0c5390d8594c')
if assets.exists() and not (out/'assets').exists():shutil.copytree(assets,out/'assets')
print(json.dumps({'exports':count,'directory':str(out)}))
