import getpass,pathlib,paramiko
c=paramiko.SSHClient();c.load_host_keys(str(pathlib.Path.home()/'.ssh/known_hosts'));c.set_missing_host_key_policy(paramiko.RejectPolicy());c.connect('148.135.208.53',username='root',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False)
s=c.open_sftp();root='/opt/upgrade/stage1-design/'
for name in ['app.mjs','index.html','smoke.mjs','behavior-test.mjs','review-launch.mjs','edit-smoke.mjs','final-smoke.mjs']:
 s.get(root+name,'stage1-design/'+name)
s.get(root+'docs/stage1/LAUNCH.md','docs/stage1/LAUNCH.md')
for name in ['studio-desktop.png','studio-mobile.png','studio-result-desktop.png','studio-result-mobile.png','ui-smoke.json','behavior-test.json','edit-smoke.json','final-smoke.json','restart-smoke.json']:
 s.get(root+'data/'+name,'var/stage1-design/'+name)
for name in ['docs/stage1/PROGRESS.md','docs/requirements-tests.md']:
 s.put(name,root+name)
print('Source, report and evidence synchronized; no secrets copied');s.close();c.close()
