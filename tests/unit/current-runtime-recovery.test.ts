import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.UPGRADE_PYTHON_BIN ?? (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
const harness = String.raw`
import copy, contextlib, errno, hashlib, http.server, importlib.util, io, json, os, pathlib, socket, stat, subprocess, sys, tarfile, tempfile, threading, types, unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('current_restore',sys.argv.pop(1));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SQL=b'-- MySQL dump 10.13\nCREATE DATABASE upgrade;\n-- Dump completed on 2026-09-30\n'

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(m.canonical(value) if not isinstance(value,bytes) else value);os.chmod(path,0o600)
    return str(path)

class BackupHost:
    def __init__(self,profile,items):self.p=profile;self.items=items
    def inspect(self,role):return copy.deepcopy(self.items[role])
    def network(self):
        n=self.p['network'];return dict(Id=n['id'],Name=n['name'],Driver='bridge',Internal=True,EnableIPv6=False,
            Options={'com.docker.network.bridge.name':n['bridge']},Labels={'upgrade.project':self.p['project_id']},IPAM={'Config':[{'Subnet':n['subnet']}]})
    def guard(self):pass
    def stop(self,role):self.items[role]['State'].update(Running=False,Status='exited')
    def start(self,role):self.items[role]['State'].update(Running=True,Status='running')
    def database_check(self):pass
    def dump(self,path):save(path,SQL)

class FakeExecutor(m.Executor):
    def __init__(self,*args):super().__init__(*args);self.calls=[];self.failure=None;self.before=[];self.sql_imports=0
    def run(self,label,command,**kwargs):
        self.calls.append((label,list(command)));self.record(label,status='STARTED')
        if label==self.failure:self.record(label,status='UNKNOWN_TIMEOUT');raise m.RecoveryError('COMMAND_OUTCOME_UNKNOWN_'+label)
        data=b'';code=0
        if label=='DOCKER_STORAGE_LOCATION':data=json.dumps(str(self.root.parent)).encode()
        if label in ('NEW_VOLUME_CHECK','NEW_NETWORK_CHECK'):code=1
        if label=='SOURCE_DB_IMAGE':data=m.canonical([{'Id':self.plan['baseline']['source_database']['image_id']}])
        if label=='PRE_CMS_RUNTIME_PROBE':
            data=m.canonical(dict(prepend_active=True,prepend_file='/opt/upgrade/prepend.php',prepend_sha256='8'*64,
                allow_url_fopen=False,own_db_connected=True,source_db_connected=False,external_dns_failed=True,
                disabled={k:True for k in ['mail','exec','passthru','shell_exec','system','popen','proc_open']}))
        self.record(label,exit_code=code,stdout_sha256=m.sha(data),stderr_sha256=m.sha(b''))
        return types.SimpleNamespace(returncode=code,stdout=data,stderr=b'')
    def source_inspect(self):return copy.deepcopy(self.before)
    def attest(self,services):self.calls.append(('ATTEST',services))
    def sql(self,query=None,file=None,**kwargs):
        if file is not None:self.sql_imports+=1;assert file.read()==SQL
        return b''
    def counts(self):return copy.deepcopy(self.plan['baseline']['database_counts'])
    def http(self,target,auth=None):
        if auth is None:return 401,{'www-authenticate':'Basic realm="private"'},b''
        for case in self.plan['baseline']['http']:
            if target==case['request_target']:return case['status'],{},b'Observed native fact'
        return 404,{},b'not found'

class CurrentRestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='upgrade-current-restore-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name).resolve();os.chmod(self.root,0o700)
        self.source=self.root/'source';self.cms=self.source/'cms-root';self.state=self.source/'state';self.journal=self.root/'journal'/'target-a'
        for path in [self.cms,self.state,self.journal]:path.mkdir(parents=True,mode=0o700);os.chmod(path,0o700)
        self.settings=b"<?php return ['connections'=>['value'=>['default'=>['host'=>'172.30.50.2','database'=>'upgrade','password'=>'PRIVATE_TEST_SENTINEL']]]];"
        save(self.cms/'bitrix/.settings.php',self.settings)
        save(self.cms/'bitrix/modules/main/include/prolog_before.php',b'<?php /* inert fake CMS */')
        save(self.cms/'local/upgrade-route.php',b'<?php /* own inert route */')
        save(self.cms/'upload/factual.bin',b'original public evidence')
        self.snapshot={'schema_version':1,'project_id':'project-a','snapshot_id':'7'*64,'items':[]}
        save(self.state/'release/data/demo-snapshot.json',self.snapshot)
        pointer=dict(schema_version=1,project_id='project-a',target_id='target-a',relative_path='release/data/demo-snapshot.json',sha256=m.digest(self.state/'release/data/demo-snapshot.json'))
        save(self.state/'demo-active.json',pointer)
        save(self.state/'old-backup/previous.sql',b'old evidence still retained')
        save(self.state/'upgrade-project-a.lock',b'')
        save(self.journal/'binding.json',dict(project_id='project-a',target_id='target-a',container='b'*64,document_root='/var/www/html',state_dir='/var/lib/upgrade'))
        save(self.journal/'transport-lock.sqlite',b'inert fixture journal lock; not a DB')
        save(self.journal/'unknown.state.json',dict(state='UNKNOWN',fence=17,source_container='b'*64))
        self.cookie='1'*64;self.operation='2'*64
        self.session_hash=m.sha(('project-a\0'+self.cookie).encode())
        self.response=dict(status='RECORDED_LOCALLY_SYNTHETIC',operation_id=self.operation,snapshot_id='7'*64,replayed=False,
            cart={'pricing_status':'REQUIRES_CONFIRMATION','total':None},record={'status':'RECORDED_LOCALLY_SYNTHETIC','native_order_created':False,'message_sent':False,'payment_attempted':False})
        self.body=dict(schema_version=1,project_id='project-a',session_hash=self.session_hash,csrf='3'*64,revision=2,cart=[],operations={self.operation:{'request_sha256':'4'*64,'response':self.response}},synthetic_records=[])
        self.session_path=self.state/'demo-private/demo-project-a'/(self.session_hash+'.json')
        self.session_save()
        self.tool=self.root/'fixed-tool';save(self.tool,b'nonexecuted fixture executable');os.chmod(self.tool,0o700)
        self.cnf=self.root/'mysql.cnf';save(self.cnf,b'[client]\nuser=root\npassword=PRIVATE_TEST_SENTINEL\n')
        self.p=dict(schema_version=1,project_id='project-a',target_id='target-a',cms_root=str(self.cms),state_root=str(self.state),native_journal_dir=str(self.journal),destination=str(self.root/'backup'),
            docker={'path':str(self.tool),'sha256':m.digest(self.tool)},guard={'path':str(self.tool),'sha256':m.digest(self.tool)},
            network=dict(name='upgrade-project-a-isolated',id='d'*64,bridge='br-upg-src',subnet='172.30.50.0/24'),containers={},
            database=dict(name='upgrade',cnf_path=str(self.cnf),cnf_sha256=m.digest(self.cnf),dump_executable='/usr/bin/mysqldump',query_executable='/usr/bin/mysql'),
            limits=dict(max_files=1000,max_total_bytes=10_000_000,max_file_bytes=5_000_000,command_timeout_seconds=10,stop_timeout_seconds=10),active_pointer_sha256=m.digest(self.state/'demo-active.json'))
        self.items={}
        for role,char,ip in [('db','a','2'),('php','b','3'),('nginx','c','4')]:
            mounts=[dict(Destination='/var/lib/mysql',Source='/private/mysql',RW=True)] if role=='db' else [dict(Destination='/var/www/html',Source=str(self.cms),RW=role=='php')]
            if role=='php':mounts.append(dict(Destination='/var/lib/upgrade',Source=str(self.state),RW=True))
            item=dict(Id=char*64,Name='/'+role,Image='sha256:'+'e'*64,Config={'Labels':{'com.docker.compose.project':'project-a','com.docker.compose.service':role}},HostConfig={'RestartPolicy':{'Name':'no'}},Mounts=mounts,
                State=dict(Running=True,Status='running'),NetworkSettings={'Networks':{self.p['network']['name']:{'NetworkID':'d'*64,'IPAddress':'172.30.50.'+ip}}})
            self.items[role]=item;self.p['containers'][role]=dict(id=item['Id'],image_id=item['Image'],static_sha256=m.sha(m.canonical(m.b.immutable_container(item))),ip='172.30.50.'+ip,running=True)
        host=BackupHost(self.p,self.items);backup_plan=m.b.make_plan(self.p,'f'*64,host)
        self.receipt=m.b.Executor(backup_plan,host).execute()
        self.args=types.SimpleNamespace(project='project-a',target_id='target-a',source_root=str(self.source),destination=str(self.root/'clone'),clone_project='recovered-a',subnet='172.30.60.0/24',bridge='br-upg-test',
            receipt=str(self.root/'backup/backup-receipt.json'),receipt_sha256=m.digest(self.root/'backup/backup-receipt.json'),snapshot_manifest_sha256=self.receipt['snapshot_manifest_sha256'],guard=str(self.tool),guard_sha256=m.digest(self.tool),auth_user='upgrade')
        self.manifest=json.loads((self.root/'backup/snapshot-manifest.json').read_bytes())
    def session_save(self):save(self.session_path,m.php_json(dict(schema_version=1,body=self.body,sha256=m.sha(m.php_json(self.body)))))
    def bundle(self):return m.backup_bundle(self.args)
    def repin(self):
        save(self.root/'backup/snapshot-manifest.json',self.manifest);self.receipt['snapshot_manifest_sha256']=m.digest(self.root/'backup/snapshot-manifest.json')
        save(self.root/'backup/backup-receipt.json',self.receipt);self.args.receipt_sha256=m.digest(self.root/'backup/backup-receipt.json');self.args.snapshot_manifest_sha256=self.receipt['snapshot_manifest_sha256']
    def archive(self,entries):
        path=self.root/'bad.tar.gz'
        with tarfile.open(path,'w:gz') as stream:
            for name,kind,body in entries:
                item=tarfile.TarInfo(name);item.mode=0o600;item.uid=item.gid=0
                if kind=='directory':item.type=tarfile.DIRTYPE;item.mode=0o700
                elif kind=='symlink':item.type=tarfile.SYMTYPE;item.linkname=body
                elif kind=='hardlink':item.type=tarfile.LNKTYPE;item.linkname=body
                elif kind=='fifo':item.type=tarfile.FIFOTYPE
                else:item.size=len(body)
                stream.addfile(item,io.BytesIO(body) if kind=='file' else None)
        os.chmod(path,0o600);return path
    def ledger(self,entries):
        return dict(schema_version=1,root='/source',root_metadata=dict(mode=0o700,uid=0,gid=0),entries=entries)
    def row(self,name,body=b'a',kind='file'):
        row=dict(path=name,type=kind,mode=0o600 if kind=='file' else 0o700,uid=0,gid=0)
        if kind=='file':row.update(size=len(body),sha256=m.sha(body))
        return row
    def extract(self,key='state_root',name='restored'):
        entry=self.manifest['outputs'][key];ledger=m.json_file(entry['ledger_file'],entry['ledger_sha256']);dest=self.root/name
        return dest,m.archive_check(entry['file'],entry['sha256'],ledger,self.p[key],self.p['limits'],dest,self.root/(name+'.jsonl'))
    def baseline(self):
        return dict(schema_version=1,project_id='project-a',target_id='target-a',trusted_host='demo.example',php_prepend_sha256='8'*64,
            database_counts=dict(ug_entity=389,ug_route=389,ug_operation=780,b_user=1,b_event=0,b_sale_order=0),
            source_database=dict(container_id='a'*64,image_id='sha256:'+'e'*64,network_id='d'*64,network_name='upgrade-project-a-isolated',ip_address='172.30.50.2'),
            http=[{'request_target':'/item?x=1&x=2&empty=','status':200,'contains':['Observed native fact']},{'request_target':'/missing','status':404}],
            current_state={'active_snapshot':self.manifest['active_snapshot'],'retained_receipt':None})
    def source_compose(self):
        root='/opt/upgrade/targets/project-a';image='sha256:'+'e'*64
        def bind(path,target,ro=False):return dict(type='bind',source=path,target=target,read_only=ro)
        services={role:dict(image=image,networks={'isolated':None},restart='no') for role in ('db','php','nginx')}
        services['php'].update(environment={'UPGRADE_DEMO':'1','UPGRADE_PROJECT_ID':'project-a','UPGRADE_TARGET_ID':'target-a'},volumes=[bind(root+'/cms-root','/var/www/html'),bind(root+'/state','/var/lib/upgrade'),bind(root+'/config/probe-isolation.php','/opt/upgrade/probe-isolation.php',True),bind(root+'/config/bitrix.ini','/usr/local/etc/php/conf.d/20-upgrade-bitrix.ini',True)])
        services['nginx'].update(networks={'isolated':{'ipv4_address':'172.30.50.4'}},volumes=[bind(root+'/cms-root','/var/www/html',True),bind(root+'/config/interactive.conf','/etc/nginx/conf.d/default.conf',True),bind('/opt/upgrade/private/bitrix/demo.htpasswd','/etc/nginx/demo.htpasswd',True)])
        services['db'].update(environment={'MYSQL_DATABASE':'upgrade','MYSQL_USER':'upgrade','MYSQL_PASSWORD_FILE':'/run/secrets/db_password','MYSQL_ROOT_PASSWORD_FILE':'/run/secrets/db_root_password'},volumes=[{'type':'volume','source':'database','target':'/var/lib/mysql'}])
        return dict(name='project-a',services=services,networks={'isolated':{'name':'upgrade-project-a-isolated','external':True}},secrets={name:{'file':'/opt/upgrade/private/bitrix/'+name} for name in ('db_password','db_root_password')})
    def projected(self):
        args=types.SimpleNamespace(source_root='/opt/upgrade/targets/project-a',destination='/opt/upgrade/recovery/current-a',project='project-a',clone_project='recovery-current-a',target_id='target-a',subnet='172.30.60.0/24',bridge='br-upg-cura')
        return m.project_compose(self.source_compose(),args,self.baseline())
    def plan(self):
        bundle=self.bundle();baseline=self.baseline();copy_root=self.root/'config';copy_root.mkdir(exist_ok=True)
        copies={}
        for name,raw in [('nginx.conf',b'auth_basic_user_file /etc/nginx/demo.htpasswd; noindex; fastcgi_pass php:9000; "172.30.50.1|https" on;'),('bitrix.ini',b'short_open_tag=On'),('demo.htpasswd',b'private fake'),('db_password',b'fake-pass'),('db_root_password',b'fake-root')]:copies[name]=save(copy_root/name,raw)
        self.args.auth_password_file=save(self.root/'auth-password',b'fake-auth')
        projection=dict(copies=copies,source_gateway='172.30.50.1',gateway='172.30.60.1',source_network='upgrade-project-a-isolated',source_db_ip='172.30.50.2',source_database_binding=baseline['source_database'],nginx_ip='172.30.60.4',db_ip='172.30.60.3',network='upgrade-recovered-a-isolated',
            compose={'services':{'db':{'image':'sha256:'+'e'*64},'php':{},'nginx':{}}})
        return dict(source_project='project-a',source_target='target-a',backup_profile=self.p,backup_manifest=self.manifest,inventories=bundle['inventories'],
            backup_intent_sha256=bundle['backup_intent_sha256'],backup_state_sha256=bundle['backup_state_sha256'],baseline=baseline,projection=projection,
            configuration_derivation=m.h.settings_derivation_policy(projection),source_compose_sha256='9'*64,files_sha256=self.receipt['files_sha256'],
            config_pins={key:m.digest(path) for key,path in copies.items()},guard_sha256=m.digest(self.tool),auth_password_sha256=m.digest(self.args.auth_password_file))
    def executor(self):
        plan=self.plan();self.args.accept_plan_sha256=m.sha(m.canonical(plan));executor=FakeExecutor(self.args,plan,self.receipt)
        executor.before=[dict(id='a'*64,service='db',image='sha256:'+'e'*64,networks={'upgrade-project-a-isolated':{'NetworkID':'d'*64,'IPAddress':'172.30.50.2'}})]
        return executor
    def execute_fake(self,executor):
        with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',lambda:0,create=True),patch.object(m.socket,'create_connection',lambda *args,**kwargs:contextlib.nullcontext()),patch.object(m.shutil,'disk_usage',lambda p:types.SimpleNamespace(free=100*1024**3)):
            return executor.execute()
    def retained(self,plan):
        file=save(self.root/'cookie-secret',self.cookie.encode());expected=dict(cookie_file=file,cookie_sha256=m.digest(file),operation_id=self.operation,response_sha256=m.sha(m.php_json(self.response)),http_body_sha256=m.sha(b'Local synthetic receipt'))
        plan['baseline']['current_state']['retained_receipt']=expected
        return expected
    def test_real_backup_bundle_all_tree_bytes_and_no_source_write(self):
        before={str(p):m.digest(p) for p in self.source.rglob('*') if p.is_file()};bundle=self.bundle()
        self.assertEqual(set(bundle['inventories']),{'cms_root','state_root','native_journal_dir'})
        self.assertEqual(before,{str(p):m.digest(p) for p in self.source.rglob('*') if p.is_file()});self.assertFalse(pathlib.Path(self.args.destination).exists())
    def test_private_state_roundtrip_keeps_pointer_session_old_backup(self):
        dest,proof=self.extract();self.assertEqual((dest/'demo-active.json').read_bytes(),(self.state/'demo-active.json').read_bytes())
        self.assertEqual((dest/'old-backup/previous.sql').read_bytes(),b'old evidence still retained');self.assertEqual((dest/self.session_path.relative_to(self.state)).read_bytes(),self.session_path.read_bytes());self.assertGreater(proof['entries'],5)
    def test_journal_unknown_and_source_binding_remain_bytes(self):
        dest,_=self.extract('native_journal_dir');self.assertEqual((dest/'unknown.state.json').read_bytes(),(self.journal/'unknown.state.json').read_bytes());self.assertEqual((dest/'binding.json').read_bytes(),(self.journal/'binding.json').read_bytes())
    def test_corrupt_archive_pin_rejected_before_destination(self):
        file=pathlib.Path(self.manifest['outputs']['state_root']['file']);file.write_bytes(file.read_bytes()+b'changed')
        self.assertRaisesRegex(m.RecoveryError,'ARCHIVE_PIN',self.bundle);self.assertFalse(pathlib.Path(self.args.destination).exists())
    def test_missing_or_changed_ledger_rejected(self):
        file=pathlib.Path(self.manifest['outputs']['state_root']['ledger_file']);file.write_bytes(b'{}');self.assertRaisesRegex(m.RecoveryError,'JSON_PIN',self.bundle)
    def test_missing_ledger_pin_never_means_unpinned(self):
        del self.manifest['outputs']['state_root']['ledger_sha256'];self.repin();self.assertRaisesRegex(m.RecoveryError,'LEDGER_PIN',self.bundle)
    def test_relabelled_backup_project_target_and_incomplete_rejected(self):
        for field,value in [('project_id','foreign'),('target_id','other'),('runtime_restored',False),('status','PENDING')]:
            original=dict(self.receipt);self.receipt[field]=value;self.repin();self.assertRaisesRegex(m.RecoveryError,'BACKUP_BINDING',self.bundle);self.receipt=original
        self.repin()
    def test_unknown_or_failed_backup_runtime_cannot_restore(self):
        path=self.root/'backup/runtime-state.json';value=json.loads(path.read_bytes());value['phase']='RUNTIME_RECOVERY_REQUIRED';save(path,value);self.assertRaisesRegex(m.RecoveryError,'BACKUP_NOT_COMPLETED',self.bundle)
    def test_changed_intent_plan_and_unknown_output_rejected(self):
        path=self.root/'backup/intent.json';original=path.read_bytes();value=json.loads(original);value['plan']['profile']['project_id']='foreign';save(path,value);self.assertRaisesRegex(m.RecoveryError,'BACKUP_PLAN_BINDING',self.bundle)
        save(path,original);self.manifest['outputs']['secret']={};self.repin();self.assertRaisesRegex(m.RecoveryError,'OUTPUTS',self.bundle)
    def test_output_alias_and_forged_totals_rejected(self):
        self.manifest['outputs']['state_root']['file']=str(self.state/'unrelated');self.repin();self.assertRaisesRegex(m.RecoveryError,'OUTPUT_PATH',self.bundle)
        self.manifest['outputs']['state_root']['file']=str(self.root/'backup/private-state.tar.gz');self.manifest['total_tree_entries']-=1;self.repin();self.assertRaisesRegex(m.RecoveryError,'TOTAL_MISMATCH',self.bundle)
    def test_sparse_links_devices_duplicates_and_extra_rejected(self):
        ledger=self.ledger([self.row('a')])
        for kind in ['symlink','hardlink','fifo']:
            archive=self.archive([('a',kind,'outside')]);self.assertRaisesRegex(m.RecoveryError,'LINK_OR_SPECIAL',m.archive_check,archive,m.digest(archive),ledger,'/source',self.p['limits'])
        for entries in [[('a','file',b'a'),('a','file',b'a')],[('a','file',b'a'),('extra','file',b'b')]]:
            archive=self.archive(entries);self.assertRaisesRegex(m.RecoveryError,'EXTRA_OR_DUPLICATE',m.archive_check,archive,m.digest(archive),ledger,'/source',self.p['limits'])
    def test_traversal_absolute_and_platform_alias_rejected(self):
        for value in ['../escape','a/../escape','/escape','a\\b','C:/escape','a//b','./a','a/','a\nfile','a\x00file']:
            self.assertRaises(m.RecoveryError,m.safe_relative,value)
    def test_missing_parent_and_file_parent_rejected(self):
        for rows in [[self.row('a/b')],[self.row('a'),self.row('a/b')]]:
            self.assertRaisesRegex(m.RecoveryError,'PARENT_NOT_DIRECTORY',m.ledger_valid,self.ledger(rows),'/source',self.p['limits'])
    def test_unlisted_missing_wrong_bytes_and_mode_rejected(self):
        archive=self.archive([('a','file',b'a')]);ledger=self.ledger([self.row('a'),self.row('missing')]);self.assertRaisesRegex(m.RecoveryError,'MISSING_ENTRIES',m.archive_check,archive,m.digest(archive),ledger,'/source',self.p['limits'])
        ledger=self.ledger([self.row('a',b'b')]);self.assertRaisesRegex(m.RecoveryError,'FILE_HASH',m.archive_check,archive,m.digest(archive),ledger,'/source',self.p['limits'])
        ledger['entries'][0]['mode']=0o777;self.assertRaisesRegex(m.RecoveryError,'LEDGER_MISMATCH',m.archive_check,archive,m.digest(archive),ledger,'/source',self.p['limits'])
    def test_setuid_negative_uid_and_limits_rejected(self):
        for key,value in [('mode',0o4755),('uid',-1),('gid',2**40)]:
            ledger=self.ledger([self.row('a')]);ledger['entries'][0][key]=value;self.assertRaisesRegex(m.RecoveryError,'METADATA',m.ledger_valid,ledger,'/source',self.p['limits'])
        limits=dict(self.p['limits'],max_file_bytes=1);ledger=self.ledger([self.row('a',b'ab')]);self.assertRaisesRegex(m.RecoveryError,'FILE_LIMIT',m.ledger_valid,ledger,'/source',limits)
    def test_existing_extraction_refused_and_no_reset(self):
        dest,_=self.extract();save(dest/'sentinel',b'preserve');self.assertRaisesRegex(m.RecoveryError,'NEW_EXTRACTION',self.extract);self.assertEqual((dest/'sentinel').read_bytes(),b'preserve')
    def test_enumeration_eio_fails_readback(self):
        dest,_=self.extract();entry=self.manifest['outputs']['state_root'];ledger=m.json_file(entry['ledger_file'],entry['ledger_sha256']);real=os.scandir
        def broken(path):
            if pathlib.Path(path)==dest/'old-backup':raise OSError(errno.EIO,'private source error must not leak')
            return real(path)
        with patch.object(os,'scandir',broken):self.assertRaisesRegex(m.RecoveryError,'TREE_ENUMERATION_FAILED',m.verify_tree,dest,ledger,self.p['limits'])
    def test_extracted_byte_and_membership_tamper_rejected(self):
        dest,_=self.extract();ledger=m.json_file(self.manifest['outputs']['state_root']['ledger_file']);save(dest/'old-backup/previous.sql',b'changed');self.assertRaisesRegex(m.RecoveryError,'TREE_BYTES',m.verify_tree,dest,ledger,self.p['limits'])
        save(dest/'extra',b'');self.assertRaisesRegex(m.RecoveryError,'MEMBERSHIP',m.verify_tree,dest,ledger,self.p['limits'])
    def test_full_orchestration_new_copy_guard_before_php_source_unchanged(self):
        executor=self.executor();before={str(p):m.digest(p) for p in self.source.rglob('*') if p.is_file()};result=self.execute_fake(executor)
        self.assertEqual(result['status'],'ISOLATED_CURRENT_COPY_RESTORED_AND_SMOKE_VERIFIED');self.assertEqual(executor.sql_imports,1);self.assertEqual(result['retained_receipt_http'],'NOT_RUN')
        labels=[x[0] for x in executor.calls];self.assertLess(labels.index('GUARD_CHECK_BEFORE_DB'),labels.index('DB_START'));self.assertLess(labels.index('GUARD_CHECK_BEFORE_PHP'),labels.index('PRE_CMS_RUNTIME_PROBE'));self.assertLess(labels.index('PRE_CMS_RUNTIME_PROBE'),labels.index('WEB_START'))
        self.assertFalse(any('stop' in cmd or 'restart' in cmd or 'down' in cmd for _,cmd in executor.calls));self.assertEqual(before,{str(p):m.digest(p) for p in self.source.rglob('*') if p.is_file()})
        self.assertNotEqual((executor.root/'cms-root/bitrix/.settings.php').read_bytes(),self.settings);self.assertEqual((executor.root/'cms-root/bitrix/.settings.php').read_bytes(),self.settings.replace(b"'172.30.50.2'",b"'db'"))
        self.assertEqual((executor.root/'source-journal-audit/unknown.state.json').read_bytes(),(self.journal/'unknown.state.json').read_bytes())
    def test_unknown_sql_failure_stops_before_php_and_no_replay(self):
        executor=self.executor()
        def failed_sql(**kwargs):executor.sql_imports+=1;raise m.RecoveryError('COMMAND_OUTCOME_UNKNOWN_SQL_IMPORT')
        executor.sql=failed_sql
        self.assertRaisesRegex(m.RecoveryError,'UNKNOWN_SQL',self.execute_fake,executor);self.assertEqual(executor.sql_imports,1)
        self.assertFalse(any(label=='WEB_START' for label,_ in executor.calls));self.assertTrue(executor.root.exists());self.assertRaises(Exception,self.execute_fake,executor);self.assertEqual(executor.sql_imports,1)
    def test_guard_failure_never_starts_database_or_php(self):
        executor=self.executor();executor.failure='GUARD_CHECK_BEFORE_DB';self.assertRaisesRegex(m.RecoveryError,'GUARD_CHECK',self.execute_fake,executor);self.assertEqual(executor.sql_imports,0);self.assertFalse(any(label in ('DB_START','WEB_START') for label,_ in executor.calls))
    def test_wrong_acceptance_and_existing_destination_no_commands(self):
        executor=self.executor();self.args.accept_plan_sha256='0'*64;self.assertRaisesRegex(m.RecoveryError,'ACCEPTED_PLAN',self.execute_fake,executor);self.assertEqual(executor.calls,[])
        self.args.accept_plan_sha256=m.sha(m.canonical(executor.plan));executor.root.mkdir();save(executor.root/'foreign',b'preserve');self.assertRaises(Exception,self.execute_fake,executor);self.assertEqual(executor.calls,[]);self.assertEqual((executor.root/'foreign').read_bytes(),b'preserve')
    def test_declared_host_only_and_foreign_host_fail_before_network(self):
        executor=self.executor();original=m.h.derive_settings_bytes
        def foreign(raw,ip):return original(raw.replace(b'172.30.50.2',b'172.30.99.2'),ip)
        with patch.object(m.h,'derive_settings_bytes',foreign):self.assertRaisesRegex(m.RecoveryError,'HOST',self.execute_fake,executor)
        self.assertFalse(any(label=='GUARD_APPLY' for label,_ in executor.calls));self.assertEqual((self.cms/'bitrix/.settings.php').read_bytes(),self.settings)
    def test_settings_dynamic_expression_never_executed(self):
        self.assertRaises(m.RecoveryError,m.h.derive_settings_bytes,b"<?php return array_merge(['connections'=>[]],danger());",'172.30.50.2')
    def test_current_pointer_identity_and_journal_rechecked(self):
        executor=self.executor();self.execute_fake(executor);save(executor.root/'state/demo-active.json',{});self.assertRaises(m.RecoveryError,m.verify_current,executor.root,executor.plan)
    def test_retained_response_checksum_exact_and_readonly(self):
        executor=self.executor();self.execute_fake(executor);self.retained(executor.plan);result=m.retained_receipt(executor.root,executor.plan)
        self.assertEqual(result['response_sha256'],m.sha(m.php_json(self.response)));self.assertEqual(result['file_sha256'],m.digest(self.session_path));self.assertNotIn('PRIVATE_TEST_SENTINEL',str(result))
    def test_retained_unknown_session_operation_and_foreign_binding_rejected(self):
        executor=self.executor();self.execute_fake(executor);expected=self.retained(executor.plan);expected['operation_id']='9'*64;self.assertRaisesRegex(m.RecoveryError,'OPERATION_MISSING',m.retained_receipt,executor.root,executor.plan)
        expected['operation_id']=self.operation;path=executor.root/'state'/self.session_path.relative_to(self.state);envelope=json.loads(path.read_bytes());envelope['body']['project_id']='foreign';envelope['sha256']=m.sha(m.php_json(envelope['body']));save(path,m.php_json(envelope));self.assertRaisesRegex(m.RecoveryError,'SESSION_BINDING',m.retained_receipt,executor.root,executor.plan)
    def test_retained_no_forged_real_sent_record(self):
        executor=self.executor();self.execute_fake(executor);expected=self.retained(executor.plan);path=executor.root/'state'/self.session_path.relative_to(self.state);env=json.loads(path.read_bytes());response=env['body']['operations'][self.operation]['response'];response['record']['message_sent']=True;expected['response_sha256']=m.sha(m.php_json(response));env['sha256']=m.sha(m.php_json(env['body']));save(path,m.php_json(env))
        self.assertRaisesRegex(m.RecoveryError,'SYNTHETIC_BOUNDARY',m.retained_receipt,executor.root,executor.plan)
    def test_retained_file_corruption_and_wrong_response_pin(self):
        executor=self.executor();self.execute_fake(executor);expected=self.retained(executor.plan);expected['response_sha256']='0'*64;self.assertRaisesRegex(m.RecoveryError,'RESPONSE_BINDING',m.retained_receipt,executor.root,executor.plan)
        path=executor.root/'state'/self.session_path.relative_to(self.state);env=json.loads(path.read_bytes());env['sha256']='0'*64;save(path,env);self.assertRaisesRegex(m.RecoveryError,'CHECKSUM',m.retained_receipt,executor.root,executor.plan)
    def test_real_http_receipt_get_only_cookie_private_no_session_mutation(self):
        executor=self.executor();self.execute_fake(executor);self.retained(executor.plan);receipt=m.retained_receipt(executor.root,executor.plan);requests=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.command,self.path,dict(self.headers)));self.send_response(200);self.send_header('Cache-Control','no-store');self.send_header('X-Robots-Tag','noindex');self.end_headers();self.wfile.write(b'Local synthetic receipt')
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        original=m.http.client.HTTPConnection
        try:
            with patch.object(m.http.client,'HTTPConnection',lambda *args,**kwargs:original('127.0.0.1',server.server_port,timeout=5)):executor.http_receipt('Basic private-fixture',receipt)
        finally:server.shutdown();server.server_close();thread.join()
        self.assertEqual(len(requests),1);self.assertEqual(requests[0][0],'GET');self.assertEqual(requests[0][1],'/__upgrade/receipt?operation='+self.operation);self.assertEqual(requests[0][2]['Cookie'],'upgrade_demo_session='+self.cookie)
        events=(executor.root/'events.jsonl').read_text();self.assertNotIn(self.cookie,events);self.assertNotIn('private-fixture',events)
    def test_ownership_replaced_intent_no_log_or_result_write(self):
        executor=self.executor();executor.claim_destination(m.sha(m.canonical(executor.plan)));save(executor.root/'intent.json',b'foreign');self.assertRaisesRegex(m.RecoveryError,'OWNERSHIP_CHANGED',executor.record,'TEST');self.assertRaises(m.RecoveryError,executor.write_result,{'status':'PASS'});self.assertFalse((executor.root/'result.json').exists())
    def test_exclusive_destination_cross_project_race(self):
        executor=self.executor();other=m.Executor(types.SimpleNamespace(destination=str(executor.root),clone_project='other'),executor.plan,{})
        executor.claim_destination(m.sha(m.canonical(executor.plan)));original=(executor.root/'intent.json').read_bytes();self.assertRaisesRegex(m.RecoveryError,'NEW_RECOVERY_DESTINATION',other.claim_destination,m.sha(m.canonical(executor.plan)));self.assertEqual(original,(executor.root/'intent.json').read_bytes())
    def test_disjointness_rejects_ancestor_descendant_and_equal(self):
        for destination in [self.source,self.state/'clone',self.root]:self.assertRaisesRegex(m.RecoveryError,'OVERLAP',m.disjoint,destination,[self.source,self.state,self.journal])
    def test_projection_retains_application_only_new_infrastructure_no_journal_mount(self):
        result=self.projected();services=result['compose']['services'];env=services['php']['environment'];self.assertEqual(env,{'UPGRADE_DEMO':'1','UPGRADE_PROJECT_ID':'project-a','UPGRADE_TARGET_ID':'target-a'})
        self.assertEqual(result['compose']['name'],'recovery-current-a');self.assertEqual(result['compose']['volumes']['database']['name'],'recovery-current-a-database');self.assertEqual(result['network'],'upgrade-recovery-current-a-isolated')
        for service in services.values():
            self.assertNotIn('ports',service);self.assertEqual(service['restart'],'no');self.assertEqual(service['dns'],['127.0.0.1']);self.assertEqual(set(service['networks']),{'isolated'})
            for volume in service['volumes']:
                if volume['type']=='bind':self.assertTrue(volume['source'].startswith('/opt/upgrade/recovery/current-a/'));self.assertNotIn('journal',volume['source']);self.assertFalse(volume['bind']['create_host_path'])
    def test_projection_refuses_overlay_source_target_and_network_conflicts(self):
        source=self.source_compose();args=types.SimpleNamespace(source_root='/opt/upgrade/targets/project-a',destination='/opt/upgrade/recovery/current-a',project='project-a',clone_project='recovery-current-a',target_id='target-a',subnet='172.30.60.0/24',bridge='br-upg-cura')
        source['services']['php']['volumes'].append({'type':'bind','source':'/var/run/docker.sock','target':'/var/run/docker.sock'});self.assertRaises(m.RecoveryError,m.project_compose,source,args,self.baseline())
        source=self.source_compose();source['services']['php']['environment']['UPGRADE_TARGET_ID']='foreign';self.assertRaisesRegex(m.RecoveryError,'SOURCE_TARGET',m.project_compose,source,args,self.baseline())
        source=self.source_compose();args.subnet='172.30.50.0/24';self.assertRaisesRegex(m.RecoveryError,'OVERLAP',m.project_compose,source,args,self.baseline())
    def test_main_default_never_constructs_executor_or_writes(self):
        argv=[]
        for name in ('project','target-id','source-root','source-compose','source-compose-sha256','receipt','receipt-sha256','snapshot-manifest-sha256','baseline','baseline-sha256','destination','clone-project','subnet','bridge','guard','guard-sha256','auth-password-file'):argv.extend(['--'+name,'fixture'])
        before=set(self.root.rglob('*'));output=io.StringIO()
        with patch.object(m,'make_plan',return_value=({'fixture':'plan'},{})),patch.object(m,'Executor',side_effect=AssertionError('must not execute')),contextlib.redirect_stdout(output):self.assertEqual(m.main(argv),0)
        result=json.loads(output.getvalue());self.assertEqual(result['status'],'PLAN_ONLY');self.assertEqual(result['plan_sha256'],m.sha(m.canonical({'fixture':'plan'})));self.assertEqual(before,set(self.root.rglob('*')))
    def test_retained_http_wrong_body_and_set_cookie_fail(self):
        executor=self.executor();self.execute_fake(executor);self.retained(executor.plan);receipt=m.retained_receipt(executor.root,executor.plan)
        class Response:
            status=200
            def read(self,limit):return b'wrong receipt'
            def getheaders(self):return [('Cache-Control','no-store'),('X-Robots-Tag','noindex')]
        class Connection:
            def request(self,*args,**kwargs):pass
            def getresponse(self):return Response()
            def close(self):pass
        with patch.object(m.http.client,'HTTPConnection',return_value=Connection()):self.assertRaisesRegex(m.RecoveryError,'HTTP_BYTES',executor.http_receipt,'private',receipt)
        with patch.object(Response,'getheaders',return_value=[('Cache-Control','no-store'),('X-Robots-Tag','noindex'),('Set-Cookie','replacement')]),patch.object(m.http.client,'HTTPConnection',return_value=Connection()):self.assertRaisesRegex(m.RecoveryError,'HTTP_BOUNDARY',executor.http_receipt,'private',receipt)
    def test_vendor_cookie_narrow_octet_and_attribute_contract(self):
        import itertools
        self.assertFalse(m.discarded_vendor_cookie([('X-Robots-Tag','noindex')]))
        for value in ['fixture_vendor_value','a'*32,'x'*128]:
            for attrs in itertools.permutations(['path=/','HttpOnly','SameSite=Lax']):
                self.assertTrue(m.discarded_vendor_cookie([('sEt-CoOkIe','PHPSESSID='+value+'; '+'; '.join(attrs))]))
        invalid=[
            'PHPSESSID=','PHPSESSID=x','phpsessid=x; path=/; HttpOnly; SameSite=Lax',
            'upgrade_demo_session=x; path=/; HttpOnly; SameSite=Lax','unknown=x; path=/; HttpOnly; SameSite=Lax',
            'PHPSESSID="quoted"; path=/; HttpOnly; SameSite=Lax','PHPSESSID=two values; path=/; HttpOnly; SameSite=Lax',
            'PHPSESSID=x,y; path=/; HttpOnly; SameSite=Lax','PHPSESSID=x\\y; path=/; HttpOnly; SameSite=Lax',
            'PHPSESSID=x\r\nInjected: x; path=/; HttpOnly; SameSite=Lax','PHPSESSID=текст; path=/; HttpOnly; SameSite=Lax',
            'PHPSESSID='+'x'*129+'; path=/; HttpOnly; SameSite=Lax',
            'PHPSESSID=x; path=/; HttpOnly; SameSite=None','PHPSESSID=x; path=/; HttpOnly; SameSite=Strict',
            'PHPSESSID=x; path=/other; HttpOnly; SameSite=Lax','PHPSESSID=x; path=/; HttpOnly=true; SameSite=Lax',
            'PHPSESSID=x; path=/; HttpOnly; SameSite=Lax; Secure','PHPSESSID=x; path=/; HttpOnly; SameSite=Lax;',
            'PHPSESSID=x; path=/; PATH=/; SameSite=Lax','PHPSESSID=x; path=/; HttpOnly; httponly',
            'PHPSESSID=x; path=/; HttpOnly; SameSite=Lax; Domain=example.test',
            'PHPSESSID=x; path=/; HttpOnly; SameSite=Lax, upgrade_demo_session=changed',
            'PHPSESSID=x; '+' '*250+'path=/; HttpOnly; SameSite=Lax']
        for value in invalid:
            with self.subTest(value=value):self.assertRaisesRegex(m.RecoveryError,'HTTP_BOUNDARY',m.discarded_vendor_cookie,[('Set-Cookie',value)])
    def test_raw_cookie_header_duplicates_and_both_orders_refused(self):
        vendor=('Set-Cookie','PHPSESSID=fixture_vendor_value; path=/; HttpOnly; SameSite=Lax')
        own=('set-cookie','upgrade_demo_session=changed; Path=/; HttpOnly; SameSite=Strict')
        malformed=('SET-COOKIE','PHPSESSID=broken')
        for cookies in [[vendor,vendor],[own,vendor],[vendor,own],[malformed,vendor],[vendor,malformed]]:
            self.assertRaisesRegex(m.RecoveryError,'HTTP_BOUNDARY',m.discarded_vendor_cookie,[('Cache-Control','no-store'),*cookies,('X-Robots-Tag','noindex')])
    def test_real_http_discards_vendor_cookie_never_saves_or_replays(self):
        executor=self.executor();self.execute_fake(executor);self.retained(executor.plan);receipt=m.retained_receipt(executor.root,executor.plan);requests=[]
        vendor='fixture_vendor_value'
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(dict(self.headers));self.send_response(200);self.send_header('Cache-Control','no-store');self.send_header('X-Robots-Tag','noindex');self.send_header('Set-Cookie','PHPSESSID='+vendor+'; path=/; HttpOnly; SameSite=Lax');self.end_headers();self.wfile.write(b'Local synthetic receipt')
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();original=m.http.client.HTTPConnection
        try:
            with patch.object(m.http.client,'HTTPConnection',lambda *args,**kwargs:original('127.0.0.1',server.server_port,timeout=5)):
                executor.http_receipt('Basic private-fixture',receipt);executor.http_receipt('Basic private-fixture',receipt)
        finally:server.shutdown();server.server_close();thread.join()
        self.assertEqual(len(requests),2)
        for headers in requests:self.assertEqual(headers['Cookie'],'upgrade_demo_session='+self.cookie);self.assertNotIn('PHPSESSID',headers['Cookie'])
        self.assertEqual(m.digest(receipt['path']),receipt['file_sha256'])
        events=(executor.root/'events.jsonl').read_text();self.assertNotIn(vendor,events);self.assertNotIn(self.cookie,events)
        self.assertEqual([row['ignored_vendor_cookie_names'] for row in executor.events if row['stage']=='RETAINED_RECEIPT_HTTP'],[['PHPSESSID'],['PHPSESSID']])
    def test_real_http_raw_cookie_bad_orders_never_hidden_by_dict(self):
        executor=self.executor();self.execute_fake(executor);self.retained(executor.plan);receipt=m.retained_receipt(executor.root,executor.plan);cookies=[]
        vendor=('Set-Cookie','PHPSESSID=fixture_vendor_value; path=/; HttpOnly; SameSite=Lax')
        own=('Set-Cookie','upgrade_demo_session=changed; Path=/; HttpOnly; SameSite=Strict')
        malformed=('set-cookie','PHPSESSID=bad; Path=/; HttpOnly; SameSite=Lax; SameSite=Lax')
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.send_header('Cache-Control','no-store');self.send_header('X-Robots-Tag','noindex')
                for name,value in cookies:self.send_header(name,value)
                self.end_headers();self.wfile.write(b'Local synthetic receipt')
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();original=m.http.client.HTTPConnection
        try:
            with patch.object(m.http.client,'HTTPConnection',lambda *args,**kwargs:original('127.0.0.1',server.server_port,timeout=5)):
                for value in [[own,vendor],[vendor,own],[malformed,vendor],[vendor,malformed],[vendor,vendor]]:
                    cookies[:]=value;self.assertRaisesRegex(m.RecoveryError,'HTTP_BOUNDARY',executor.http_receipt,'private',receipt)
        finally:server.shutdown();server.server_close();thread.join()
        self.assertEqual(m.digest(receipt['path']),receipt['file_sha256']);self.assertFalse(any(row['stage']=='RETAINED_RECEIPT_HTTP' for row in executor.events))
    def test_actual_process_unknown_has_no_automatic_retry(self):
        executor=m.Executor(types.SimpleNamespace(destination=str(self.root/'process'),clone_project='process'),{'backup_profile':self.p},{})
        self.assertRaisesRegex(m.RecoveryError,'UNKNOWN_TIMEOUT_TEST',executor.run,'TIMEOUT_TEST',[sys.executable,'-c','import time;time.sleep(2)'],timeout=0.05)
        self.assertEqual([e['status'] for e in executor.events],['STARTED','UNKNOWN_TIMEOUT']);self.assertFalse(executor.root.exists())
    def test_changed_tool_cannot_execute(self):
        executor=m.Executor(types.SimpleNamespace(destination=str(self.root/'process'),clone_project='process'),{'backup_profile':self.p},{})
        save(self.tool,b'changed');self.assertRaisesRegex(m.RecoveryError,'DOCKER_EXECUTABLE_CHANGED',executor.run,'TEST',['docker','inspect','source'])
    def test_php_json_keeps_order_and_escapes_line_separators(self):
        self.assertEqual(m.php_json({'z':[], 'a':'текст/\u2028'}),'{"z":[],"a":"текст/\\u2028"}'.encode())
    def test_duplicate_json_key_rejected(self):
        path=self.root/'duplicate';save(path,b'{"x":1,"x":2}');self.assertRaisesRegex(m.RecoveryError,'DUPLICATE',m.json_file,path)

if __name__=='__main__':unittest.main(verbosity=2)
`;

test('current isolated restore: real backup/archive/process/HTTP contracts with fake Docker only', { timeout: 120_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'upgrade-current-restore-tests-'));
  try {
    const script = join(directory, 'contract.py');
    writeFileSync(script, harness);
    const result = spawnSync(python, ['-I', script, resolve('scripts/recovery-current-runtime.py')], { encoding: 'utf8', timeout: 110_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Ran \d+ tests/);
    process.stdout.write(result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
