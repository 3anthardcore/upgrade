import getpass,pathlib,paramiko,stat
c=paramiko.SSHClient();c.load_host_keys(str(pathlib.Path.home()/'.ssh/known_hosts'));c.set_missing_host_key_policy(paramiko.RejectPolicy());c.connect('148.135.208.53',username='root',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False)
s=c.open_sftp();remote='/opt/upgrade/stage1-design/';local=pathlib.Path('stage1-design')
def copy_tree(src,dst):
 dst.mkdir(parents=True,exist_ok=True)
 for a in s.listdir_attr(src):
  if a.filename in ['node_modules','ui-syntax-check.mjs','integrate.py','update-ui.py','tree.json']:continue
  if stat.S_ISLNK(a.st_mode):continue
  if stat.S_ISDIR(a.st_mode):copy_tree(src+'/'+a.filename,dst/a.filename)
  elif stat.S_ISREG(a.st_mode):s.get(src+'/'+a.filename,str(dst/a.filename))
copy_tree(remote+'html-kit',local/'html-kit')
for name in ['app.mjs','index.html']:s.get(remote+name,str(local/name))
for name in ['html-live-job.json','html-version-job.json','html-final-test.json','html-capture-test-job.json','html-studio-desktop.png','html-studio-mobile.png']:
 s.get(remote+'data/'+name,'var/stage1-design/'+name)
s.put('docs/stage1/HYPERUI.md',remote+'docs/stage1/HYPERUI.md')
print('HyperUI source, build lock and evidence synchronized; no secrets copied');s.close();c.close()
