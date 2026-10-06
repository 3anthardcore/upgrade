import urllib.request,json,pathlib,subprocess,time,sqlite3
base='http://127.0.0.1:18441'
def jobs(owner):return json.load(urllib.request.urlopen(urllib.request.Request(base+'/api/jobs',headers={'X-Upgrade-User':owner}),timeout=5))
t=jobs('html-capture-test')[0];assert t['status']=='ready',t['status'];assert t['calls']==0
source=json.loads(pathlib.Path('data/jobs',t['id'],'source.json').read_text());assert len(source['structure']['paragraphs'])>=2;assert len(source['images'])>=1
before=jobs('upgrade');c=sqlite3.connect('file:data/studio.sqlite?mode=ro',uri=True);assert c.execute("select count(*) from jobs where status in ('queued','analyzing','generating','checking')").fetchone()[0]==0;c.close()
subprocess.run(['systemctl','restart','upgrade-studio'],check=True)
for _ in range(30):
 try:after=jobs('upgrade');break
 except Exception:time.sleep(.5)
assert [(j['id'],j['status'],j['calls']) for j in before]==[(j['id'],j['status'],j['calls']) for j in after]
report={'fresh_capture_job':t['id'],'fresh_html_pipeline':True,'dom_paragraphs':len(source['structure']['paragraphs']),'saved_original_images':len(source['images']),'paid_calls':0,'restart_preserved_jobs':True,'png_jobs_preserved':True}
pathlib.Path('data/html-restart-test.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
