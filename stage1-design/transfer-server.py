import os,getpass,pathlib,paramiko,hashlib,json
client=paramiko.SSHClient();client.load_host_keys(str(pathlib.Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy());client.connect('148.135.208.53',username='root',password=getpass.getpass('Server password: '),timeout=15,look_for_keys=False,allow_agent=False)
sftp=client.open_sftp();local=pathlib.Path('var/stage1-design/server-source-20261001.tar.gz');remote='/opt/upgrade/downloads/stage1-source-20261001.tar.gz'
with sftp.open(remote,'wx') as f:f.write(local.read_bytes())
key=os.environ.get('OPENAI_API_KEY','');key_written=False
if key:
 secret='/opt/upgrade/private/stage1-openai.env'
 with sftp.open(secret,'wx') as f:
  f.chmod(0o600);f.write('OPENAI_API_KEY='+key+'\n')
 key_written=True
print(json.dumps({'archive_uploaded':True,'sha256':hashlib.sha256(local.read_bytes()).hexdigest(),'server_key_configured':key_written}))
sftp.close();client.close()
