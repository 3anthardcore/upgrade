import getpass,pathlib,paramiko,json,urllib.request,base64
c=paramiko.SSHClient();c.load_host_keys(str(pathlib.Path.home()/'.ssh/known_hosts'));c.set_missing_host_key_policy(paramiko.RejectPolicy())
c.connect('148.135.208.53',username='root',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False)
s=c.open_sftp();root='/opt/upgrade/stage1-design/'
for name in ['app.mjs','model-config.mjs','astra-probe.mjs']:
 s.get(root+name,'stage1-design/'+name)
out=pathlib.Path('var/stage1-design/astra');out.mkdir(parents=True,exist_ok=True)
probe='data/astra-probes/8b062bd1-48f4-45b0-b589-2dceea3080a4/'
for name in s.listdir(root+probe):
 if name.endswith('.json'):s.get(root+probe+name,str(out/name))
s.get(root+'data/astra-deploy-check.json',str(out/'deploy-check.json'))
for name in ['docs/stage1/ASTRA.md','docs/stage1/PROGRESS.md','docs/PROGRESS.md','docs/requirements-tests.md']:s.put(name,root+name)
s.close();c.close()
pw=pathlib.Path('var/evidence/continuation-20260930/demo-access-password.private').read_text().strip()
auth='Basic '+base64.b64encode(('upgrade:'+pw).encode()).decode()
url='https://upgrade.help-ai-ru.ru/studio/'
for route in ['', 'api/jobs']:
 with urllib.request.urlopen(urllib.request.Request(url+route,headers={'Authorization':auth}),timeout=30) as r:
  print(route or 'Studio',r.status)
print('Source, deployment evidence and reports synchronized')
