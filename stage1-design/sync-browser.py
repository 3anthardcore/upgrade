import getpass,pathlib,paramiko
c=paramiko.SSHClient();c.load_host_keys(str(pathlib.Path.home()/'.ssh/known_hosts'));c.set_missing_host_key_policy(paramiko.RejectPolicy())
c.connect('148.135.208.53',username='root',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False)
s=c.open_sftp();r='/opt/upgrade/stage1-design/'
for name in ['app.mjs','source-capture.mjs','source-worker.mjs','source-browser.mjs','browser-network.ts','browser-test.mjs','browser-smoke.mjs']:s.get(r+name,'stage1-design/'+name)
out=pathlib.Path('var/stage1-design/browser-fallback');out.mkdir(parents=True,exist_ok=True)
for name in ['browser-tests.json','browser-deploy.json']:s.get(r+'data/'+name,str(out/name))
job='104983a1-1292-4a83-aaad-7d0998594580'
for name in ['capture-static.json','capture-browser.json','browser-fallback.json','browser-failure.json','failure.json']:
 s.get(r+'data/jobs/'+job+'/'+name,str(out/name))
for name in ['docs/stage1/BROWSER_FALLBACK.md','docs/stage1/PROGRESS.md','docs/PROGRESS.md','docs/requirements-tests.md']:s.put(name,r+name)
s.close();c.close();print('Browser sources, diagnostic evidence and reports synchronized')
