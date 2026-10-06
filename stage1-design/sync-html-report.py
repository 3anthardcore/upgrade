import getpass,pathlib,paramiko
c=paramiko.SSHClient();c.load_host_keys(str(pathlib.Path.home()/'.ssh/known_hosts'));c.set_missing_host_key_policy(paramiko.RejectPolicy());c.connect('148.135.208.53',username='root',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False)
s=c.open_sftp();r='/opt/upgrade/stage1-design/'
for p in ['docs/stage1/HYPERUI.md','docs/stage1/PROGRESS.md','docs/PROGRESS.md','docs/requirements-tests.md']:s.put(p,r+p)
a=pathlib.Path('stage1-design/AGENTS.md').read_text(encoding='utf-8-sig').replace('../docs/','docs/').replace('../.agents/','.agents/')
with s.open(r+'AGENTS.md','w') as f:f.write(a)
s.get(r+'data/html-restart-test.json','var/stage1-design/html-restart-test.json');s.get(r+'html-kit/restart-test.py','stage1-design/html-kit/restart-test.py')
print('Reports and instructions saved on server; recovery evidence synchronized');s.close();c.close()
