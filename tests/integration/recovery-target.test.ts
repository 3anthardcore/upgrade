import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.UPGRADE_PYTHON_BIN ?? (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
const source = resolve('scripts/recovery-target.py');
const harness = String.raw`
import copy, hashlib, importlib.util, io, json, os, pathlib, stat, sys, tarfile, tempfile, types, unittest, concurrent.futures, threading
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('recovery',sys.argv.pop(1)); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TestRecovery(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='upgrade-recovery-contract-');self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name).resolve()
    def archive(self, entries):
        path=self.root/'site.tar.gz'
        with tarfile.open(path,'w:gz') as out:
            for entry in entries:
                name,kind,body,*mode=entry; info=tarfile.TarInfo(name);info.mode=mode[0] if mode else 0o644
                if kind=='dir':info.type=tarfile.DIRTYPE;info.mode=0o755
                elif kind=='link':info.type=tarfile.SYMTYPE;info.linkname=body
                elif kind=='hard':info.type=tarfile.LNKTYPE;info.linkname=body
                elif kind=='fifo':info.type=tarfile.FIFOTYPE
                else:info.size=len(body)
                out.addfile(info,io.BytesIO(body) if kind=='file' else None)
        return path
    def source(self):
        root='/opt/upgrade/targets/project-a'; image='repo@sha256:'+'a'*64
        def bind(source,target,ro=False):return {'type':'bind','source':source,'target':target,'read_only':ro}
        services={key:{'image':image,'networks':{'isolated':None},'restart':'no','entrypoint':None,'command':None} for key in ['php','db','nginx']}
        services['php'].update(environment={'UPGRADE_DEMO':'1','UPGRADE_PROJECT_ID':'project-a','UPGRADE_TARGET_ID':'target-a'},volumes=[bind(root+'/cms-root','/var/www/html'),bind(root+'/state','/var/lib/upgrade'),bind(root+'/config/probe-isolation.php','/opt/upgrade/probe-isolation.php',True),bind(root+'/config/bitrix.ini','/usr/local/etc/php/conf.d/20-upgrade-bitrix.ini',True)])
        services['nginx'].update(networks={'isolated':{'ipv4_address':'172.30.50.4'}},volumes=[bind(root+'/cms-root','/var/www/html',True),bind(root+'/config/install.conf','/etc/nginx/conf.d/default.conf',True),bind('/opt/upgrade/private/bitrix/demo.htpasswd','/etc/nginx/demo.htpasswd',True)])
        services['db'].update(networks={'isolated':{'ipv4_address':'172.30.50.2'}},command=['--event-scheduler=OFF','--local-infile=OFF'],environment={'MYSQL_DATABASE':'upgrade','MYSQL_USER':'upgrade','MYSQL_PASSWORD_FILE':'/run/secrets/db_password','MYSQL_ROOT_PASSWORD_FILE':'/run/secrets/db_root_password'},volumes=[{'type':'volume','source':'database','target':'/var/lib/mysql'}])
        return {'name':'project-a','services':services,'networks':{'isolated':{'name':'upgrade-project-a-isolated','external':True}},'secrets':{'db_password':{'file':'/opt/upgrade/private/bitrix/db-pass'},'db_root_password':{'file':'/opt/upgrade/private/bitrix/db-root'}},'volumes':{'database':{'name':'project-a_database'}}}
    def source_database(self):
        return {'container_id':'c'*64,'image_id':'sha256:'+'b'*64,'network_id':'d'*64,'network_name':'upgrade-project-a-isolated','ip_address':'172.30.50.2'}
    def plan(self, source=None, **kwargs):
        args=dict(source=source or self.source(),source_root='/opt/upgrade/targets/project-a',destination='/opt/upgrade/recovery/copy-a',project='project-a',clone_project='recovery-a',clone_target='recovery-target-a',subnet='172.30.51.0/24',bridge='br-upgrc30',source_database=self.source_database());args.update(kwargs);return m.compose_plan(**args)
    def baseline(self):
        return {'schema_version':1,'project_id':'project-a','target_id':'target-a','source_database':self.source_database(),'trusted_host':'demo.example','php_prepend_sha256':'b'*64,'database_counts':dict(ug_entity=103,ug_route=103,ug_operation=105,b_sale_order=0,b_event=0,b_user=1),'http':[{'request_target':'/path?a=1&a=2&empty=','status':200,'contains':['Observed title']},{'request_target':'/missing','status':404}]}
    def owned_executor(self):
        executor=m.Executor(types.SimpleNamespace(destination=str(self.root/'owned-execution'),clone_project='fixture'),{'fixture':True},{})
        executor.claim_destination(m.digest_bytes(m.canonical(executor.plan)))
        return executor
    def settings(self, connection="['host'=>'db','database'=>'upgrade']"):
        return "<?php return ['connections'=>['value'=>['default'=>"+connection+"]],'utf_mode'=>['value'=>true,'readonly'=>true],'cache'=>['value'=>['type'=>'files']]];"
    def derivation_fixture(self, host='172.30.50.2'):
        original=(self.settings("['host'=>'"+host+"','database'=>'upgrade','password'=>'FAKE_TEST_ONLY']")+'\r\n').encode()
        archive=self.archive([('bitrix','dir',b''),('bitrix/.settings.php','file',original,0o600),('local.txt','file',b'unchanged source bytes')])
        projection=self.plan();plan={'projection':projection,'configuration_derivation':m.settings_derivation_policy(projection),'source_compose_sha256':'a'*64,'files_sha256':m.digest(archive)}
        executor=m.Executor(types.SimpleNamespace(destination=str(self.root/'derived-copy'),clone_project='recovery-a'),plan,{})
        executor.claim_destination(m.digest_bytes(m.canonical(plan)));(executor.root/'private').mkdir(mode=0o700)
        readback=m.extract_files(archive,executor.root/'cms-root',m.archive_inventory(archive),executor.root/'files-readback.jsonl')
        image='sha256:'+'b'*64
        attestation=m.attest_source_db({'id':'c'*64,'service':'db','image':image,'networks':{projection['source_network']:{'IPAddress':'172.30.50.2','NetworkID':'d'*64}}},projection,image)
        return executor,archive,original,readback,attestation
    def test_valid_archive_extracts_exact_bytes_and_readback(self):
        archive=self.archive([('./','dir',b''),('./local','dir',b''),('local/a.txt','file',b'actual bytes',0o600),('local/b.txt','file','observed fact'.encode())]); inventory=m.archive_inventory(archive)
        self.assertEqual(inventory['entries'],3);self.assertEqual(inventory['expanded_bytes'],25)
        proof=m.extract_files(archive,self.root/'copy',inventory,self.root/'readback.jsonl');self.assertEqual((self.root/'copy/local/a.txt').read_bytes(),b'actual bytes')
        rows=[json.loads(x) for x in (self.root/'readback.jsonl').read_text().splitlines()];self.assertEqual(rows[0]['sha256'],hashlib.sha256(b'actual bytes').hexdigest());self.assertEqual(rows[0]['restored_mode'],0o600);self.assertEqual(proof['file_readback_ledger_sha256'],m.digest(self.root/'readback.jsonl'))
    def test_traversal_and_platform_aliases_rejected_before_extract(self):
        for name in ['../escape','a/../../escape','/escape','a\\..\\escape','C:/escape','a\x00bad']:
            with self.subTest(name=name):
                if '\x00' in name:
                    info=tarfile.TarInfo(name);self.assertRaises(m.RecoveryError,m.member_name,info)
                else:self.assertRaises(m.RecoveryError,m.archive_inventory,self.archive([(name,'file',b'x')]))
        self.assertFalse((self.root/'copy').exists())
    def test_links_devices_and_duplicate_paths_rejected(self):
        for kind in ['link','hard','fifo']:
            with self.subTest(kind=kind):self.assertRaises(m.RecoveryError,m.archive_inventory,self.archive([('a',kind,'../outside')]))
        self.assertRaisesRegex(m.RecoveryError,'DUPLICATE',m.archive_inventory,self.archive([('a','file',b'1'),('./a','file',b'2')]))
    def test_parent_file_conflict_and_header_limits(self):
        self.assertRaisesRegex(m.RecoveryError,'PARENT_IS_FILE',m.archive_inventory,self.archive([('a','file',b'1'),('a/b','file',b'2')]))
        info=tarfile.TarInfo('large');info.size=513*1024*1024;self.assertRaisesRegex(m.RecoveryError,'LIMIT',m.member_name,info)
        info=tarfile.TarInfo('sparse');info.sparse=[(0,1)];self.assertRaisesRegex(m.RecoveryError,'SPARSE',m.member_name,info)
    def test_existing_root_and_changed_archive_fail_closed(self):
        archive=self.archive([('a','file',b'original')]);inventory=m.archive_inventory(archive);dest=self.root/'copy';dest.mkdir();(dest/'sentinel').write_text('keep')
        self.assertRaisesRegex(m.RecoveryError,'NEW_WEB_ROOT',m.extract_files,archive,dest,inventory,self.root/'proof');self.assertEqual((dest/'sentinel').read_text(),'keep')
        archive=self.archive([('b','file',b'changed')]);self.assertRaisesRegex(m.RecoveryError,'ARCHIVE_CHANGED',m.extract_files,archive,self.root/'fresh',inventory,self.root/'fresh-proof')
    def test_json_pin_and_duplicate_keys(self):
        path=self.root/'input.json';path.write_text('{"a":1}');self.assertEqual(m.pinned_json(path,m.digest(path)),{'a':1});self.assertRaisesRegex(m.RecoveryError,'PIN_MISMATCH',m.pinned_json,path,'a'*64)
        path.write_text('{"a":1,"a":2}');self.assertRaisesRegex(m.RecoveryError,'DUPLICATE',m.pinned_json,path,m.digest(path))
    def test_projection_is_deterministic_and_only_mounts_new_paths(self):
        source=self.source();before=copy.deepcopy(source);projection=self.plan(source);self.assertEqual(source,before);self.assertEqual(m.canonical(projection),m.canonical(self.plan(source)))
        config=projection['compose'];self.assertEqual(config['volumes']['database']['name'],'recovery-a-database');self.assertEqual(config['services']['php']['environment']['UPGRADE_PROJECT_ID'],'project-a');self.assertEqual(config['services']['php']['environment']['UPGRADE_TARGET_ID'],'recovery-target-a')
        for service in config['services'].values():
            self.assertNotIn('ports',service);self.assertEqual(service['restart'],'no');self.assertEqual(service['dns'],['127.0.0.1'])
            for mount in service['volumes']:
                if mount['type']=='bind':self.assertTrue(mount['source'].startswith('/opt/upgrade/recovery/copy-a/'));self.assertFalse(mount['bind']['create_host_path'])
        self.assertNotIn('/opt/upgrade/targets',json.dumps(config));self.assertEqual(config['services']['nginx']['networks']['isolated']['ipv4_address'],'172.30.51.4')
    def test_source_overlay_or_docker_socket_cannot_be_cloned(self):
        for target in ['/var/www/html/bitrix','/var/run/docker.sock','/var/www','/']:
            source=self.source();source['services']['php']['volumes'].append({'type':'bind','source':'/outside','target':target});self.assertRaises(m.RecoveryError,self.plan,source)
        source=self.source();source['services']['nginx']['volumes'][1]['source']='/etc/shadow';self.assertRaisesRegex(m.RecoveryError,'CONFIG_PATH_NOT_ALLOWLISTED',self.plan,source)
        source=self.source();source['secrets']['db_password']['file']='/root/unrelated-secret';self.assertRaisesRegex(m.RecoveryError,'CONFIG_PATH_NOT_ALLOWLISTED',self.plan,source)
    def test_service_privileges_foreign_networks_and_unpinned_images_rejected(self):
        for field,value in [('privileged',True),('ports',['8090:8080']),('network_mode','host'),('pid','host'),('entrypoint',['evil']),('image','nginx:latest'),('restart','always')]:
            source=self.source();source['services']['nginx'][field]=value;self.assertRaises(m.RecoveryError,self.plan,source)
        source=self.source();source['services']['php']['networks']['foreign']=None;self.assertRaises(m.RecoveryError,self.plan,source)
    def test_project_target_volume_root_and_subnet_binding(self):
        for changes in [{'clone_project':'project-a'},{'clone_target':'target-a'},{'subnet':'172.30.50.0/24'},{'subnet':'8.8.8.0/24'},{'subnet':'172.30.51.0/25'},{'bridge':'overlong-bridge-name'},{'destination':'/opt/upgrade/targets/project-a/overwrite'}]:
            with self.subTest(changes=changes):self.assertRaises(m.RecoveryError,self.plan,**changes)
        source=self.source();source['services']['php']['volumes'][0]['source']='/foreign/root';self.assertRaises(m.RecoveryError,self.plan,source)
    def test_unrelated_environment_is_never_forwarded(self):
        source=self.source();source['services']['php']['environment']['SENSITIVE_VALUE']='SECRET_SENTINEL';source['services']['php']['labels']={'foreign':'ignored'};source['services']['php']['healthcheck']={'test':['CMD-SHELL','danger']}
        config=self.plan(source)['compose'];self.assertNotIn('SECRET_SENTINEL',json.dumps(config));self.assertNotIn('healthcheck',config['services']['php']);self.assertNotIn('labels',config['services']['php'])
    def test_nginx_only_scoped_gateway_token_changes(self):
        raw=b'auth_basic_user_file /etc/nginx/demo.htpasswd; noindex; fastcgi_pass php:9000; "172.30.50.1|https" on; factual source text'; result=m.projected_nginx(raw,'172.30.50.1','172.30.51.1')
        self.assertEqual(result,raw.replace(b'172.30.50.1|https',b'172.30.51.1|https'))
        self.assertRaises(m.RecoveryError,m.projected_nginx,raw+b' "172.30.50.1|https"','172.30.50.1','172.30.51.1');self.assertRaises(m.RecoveryError,m.projected_nginx,b'public nginx','172.30.50.1','172.30.51.1')
    def test_mysql_password_is_option_file_data_not_command(self):
        self.assertEqual(m.mysql_defaults('x"\\y').decode(),'[client]\nuser=root\npassword="x\\"\\\\y"\nhost=127.0.0.1\nprotocol=tcp\n')
        for password in ['', 'x\ny','x\x00y','x'*513]:self.assertRaises(m.RecoveryError,m.mysql_defaults,password)
    def test_baseline_requires_counts_facts_and_positive_negative_http(self):
        baseline=self.baseline();m.validate_baseline(baseline,'project-a','target-a');self.assertEqual(baseline['http'][0]['request_target'],'/path?a=1&a=2&empty=')
        for changes in [{'project_id':'foreign'},{'database_counts':{'b_event':0}},{'http':[{'request_target':'/','status':200}]},{'trusted_host':'evil\r\nHeader:x'},{'php_prepend_sha256':'unknown'}]:
            broken=copy.deepcopy(baseline);broken.update(changes);self.assertRaises(m.RecoveryError,m.validate_baseline,broken,'project-a','target-a')
    def test_sql_identifiers_and_http_redirect_inputs_rejected(self):
        baseline=self.baseline();baseline['database_counts']['b_user;DROP TABLE b_user']=1;self.assertRaises(m.RecoveryError,m.validate_baseline,baseline,'project-a','target-a')
        baseline=self.baseline();baseline['http'][0]['request_target']='//foreign.example';self.assertRaises(m.RecoveryError,m.validate_baseline,baseline,'project-a','target-a')
        baseline=self.baseline();baseline['http'][0]['status']=302;self.assertRaises(m.RecoveryError,m.validate_baseline,baseline,'project-a','target-a')
    def test_entity_readback_preserves_actual_identity(self):
        baseline=self.baseline();baseline['entity']={'id':1,'xml_id':'upgrade:'+'a'*64,'name':'Observed actual title'};m.validate_baseline(baseline,'project-a','target-a')
        baseline['entity']['id']='1 OR 1=1';self.assertRaises(m.RecoveryError,m.validate_baseline,baseline,'project-a','target-a')
    def test_config_binding_reads_inert_bytes_not_php(self):
        directory=self.root/'cms';(directory/'bitrix').mkdir(parents=True);path=directory/'bitrix/.settings.php';path.write_text(self.settings()+" // no execution")
        m.verify_settings(directory);path.write_text(self.settings("['host'=>'production','database'=>'upgrade']"))
        self.assertRaisesRegex(m.RecoveryError,'BINDING_UNSUPPORTED',m.verify_settings,directory)
    def test_command_diagnostics_redact_output_and_bound_timeout(self):
        executor=self.owned_executor();executor.run('LOCAL_FIXTURE',[sys.executable,'-c',"import sys;print('SECRET_SENTINEL');print('PRIVATE_ERROR',file=sys.stderr)"])
        log=(executor.root/'events.jsonl').read_text();self.assertNotIn('SECRET_SENTINEL',log);self.assertNotIn('PRIVATE_ERROR',log);self.assertIn('stdout_sha256',log)
        self.assertRaisesRegex(m.RecoveryError,'OUTCOME_UNKNOWN',executor.run,'DELAY',[sys.executable,'-c','import time;time.sleep(2)'],timeout=0.05)
        self.assertIn('UNKNOWN_TIMEOUT',(executor.root/'events.jsonl').read_text())
    def test_own_probe_does_not_bootstrap_cms_or_send_real_effects(self):
        self.assertNotIn('prolog_before',m.PROBE);self.assertNotIn('CEvent',m.PROBE);self.assertNotIn('Sale',m.PROBE);self.assertIn("fsockopen('db',3306",m.PROBE);self.assertIn("!function_exists($name)",m.PROBE)
        text=pathlib.Path(m.__file__).read_text();self.assertNotIn("['down'",text);self.assertNotIn("['rm'",text);self.assertNotIn('shell=True',text);self.assertIn("'production_recovery': 'NOT_RUN'",text)
    def test_runtime_attestation_rejects_source_volume_foreign_network_and_image(self):
        projection=self.plan();service=projection['compose']['services']['db'];config=projection['compose'];image='sha256:'+'c'*64
        mounts=[{'Type':'volume','Destination':'/var/lib/mysql','Name':'recovery-a-database','RW':True}]
        mounts.extend({'Type':'bind','Destination':'/run/secrets/'+name,'Source':config['secrets'][name]['file'],'RW':False} for name in service['secrets'])
        item={'Config':{'Labels':{'com.docker.compose.project':'recovery-a','com.docker.compose.service':'db'}},'State':{'Running':True},'Image':image,'HostConfig':{'Privileged':False,'RestartPolicy':{'Name':'no'},'PortBindings':{},'Dns':['127.0.0.1'],'SecurityOpt':['no-new-privileges:true']},'NetworkSettings':{'Networks':{projection['network']:{'IPAddress':'172.30.51.3'}}},'Mounts':mounts}
        m.validate_clone_container(item,'db',projection,image)
        for mutate in [lambda x:x['Mounts'][0].update(Name='project-a_database'),lambda x:x['NetworkSettings']['Networks'].update(foreign={'IPAddress':'1.2.3.4'}),lambda x:x.update(Image='sha256:'+'d'*64),lambda x:x['Mounts'][1].update(RW=True),lambda x:x['HostConfig'].update(PortBindings={'3306/tcp':[{'HostPort':'3306'}]})]:
            bad=copy.deepcopy(item);mutate(bad);self.assertRaises(m.RecoveryError,m.validate_clone_container,bad,'db',projection,image)
    def test_run_never_uses_shell_and_streams_sql_as_stdin(self):
        executor=self.owned_executor();path=self.root/'input.sql';path.write_bytes(b'-- actual input bytes\n')
        with path.open('rb') as stream:result=executor.run('STDIN_FIXTURE',[sys.executable,'-c','import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'],input_file=stream)
        self.assertEqual(result.stdout,path.read_bytes());events=[json.loads(line) for line in (executor.root/'events.jsonl').read_text().splitlines()];self.assertEqual(events[0]['status'],'STARTED');self.assertEqual(events[1]['exit_code'],0)
    def test_literal_parser_rejects_review_concat_and_comment_require_witnesses(self):
        directory=self.root/'cms';(directory/'bitrix').mkdir(parents=True);path=directory/'bitrix/.settings.php'
        witnesses=["<?php return ['host'=>'db'.'.foreign','database'=>'upgrade'];", "<?php /* 'host'=>'db','database'=>'upgrade' */ return require '/unrelated/private/config.php';", self.settings("['host'=>'db'.'.foreign','database'=>'upgrade']")]
        for text in witnesses:
            with self.subTest(text=text):
                path.write_text(text);self.assertRaisesRegex(m.RecoveryError,'LITERAL_UNSUPPORTED',m.verify_settings,directory);self.assertEqual(path.read_text(),text)
    def test_literal_parser_accepts_literal_array_forms_comments_and_escaped_strings(self):
        directory=self.root/'cms';(directory/'bitrix').mkdir(parents=True);path=directory/'bitrix/.settings.php'
        text="<?php /* inert 'host'=>'foreign' */ return array('connections'=>array('value'=>array('default'=>array('className'=>'\\Bitrix\\Main\\DB\\MysqliConnection','host'=>'db','database'=>'upgrade','login'=>'upgrade','password'=>'fake\\\'\\\\literal',)),),'flags'=>array(true,false,null,42,-2),'readonly'=>true,); // host is not read here"
        path.write_text(text);m.verify_settings(directory)
        value=m.LiteralPhpSettings('<?php return ["a"=>"line\\ntext", "b"=>[1,2,3],]; ?>\n').parse();self.assertEqual(value['a'],'line\ntext');self.assertEqual(value['b'],{0:1,1:2,2:3})
    def test_literal_parser_rejects_duplicate_dynamic_ambiguous_or_trailing_code(self):
        connections=["['host'=>'db','host'=>'foreign','database'=>'upgrade']", "['host'=>'foreign','host'=>'db','database'=>'upgrade']", "['host'=>getenv('DB_HOST'),'database'=>'upgrade']", "['host'=>$host,'database'=>'upgrade']", "['host'=>\"$host\",'database'=>'upgrade']", "['host'=>'db','database'=>'upgrade','port'=>3306+1]", "['host'=>'db','database'=>'upgrade',...$extra]", "['host'=>'db','database'=>'upgrade','a'=>['0'=>'first',0=>'second']]", "['host'=>'db','database'=>'upgrade','a'=>[1,0=>2]]"]
        for connection in connections:
            with self.subTest(connection=connection):self.assertRaises(m.RecoveryError,m.LiteralPhpSettings(self.settings(connection)).parse)
        for suffix in [" require 'evil.php';", " echo 'x';", " ?>not PHP", " ?>/* output */"]:
            self.assertRaises(m.RecoveryError,m.LiteralPhpSettings(self.settings()+suffix).parse)
        self.assertRaises(m.RecoveryError,m.LiteralPhpSettings("<?php return ['connections'=>[], 'connections'=>[]];").parse)
        self.assertRaises(m.RecoveryError,m.LiteralPhpSettings("<?php return ['a'=>"+'['*66+'0'+']'*66+"];").parse)
    def test_settings_binding_requires_default_only_and_no_flat_decoy_keys(self):
        directory=self.root/'cms';(directory/'bitrix').mkdir(parents=True);path=directory/'bitrix/.settings.php'
        for text in ["<?php return ['host'=>'db','database'=>'upgrade'];", self.settings().replace("'default'=>", "'foreign'=>"), self.settings().replace("'host'=>'db'", "'host'=>'db.foreign'"), self.settings().replace("'default'=>", "'other'=>[],'default'=>")]:
            path.write_text(text);self.assertRaisesRegex(m.RecoveryError,'BINDING_UNSUPPORTED',m.verify_settings,directory)
    def test_preflight_race_never_writes_into_foreign_destination(self):
        root=self.root/'race';args=types.SimpleNamespace(destination=str(root),clone_project='loser');executor=m.Executor(args,{'clone':'loser'},{})
        executor.record('BEFORE_FOREIGN_CREATION',status='STARTED');self.assertFalse(root.exists())
        root.mkdir(mode=0o700);intent=root/'intent.json';intent.write_bytes(b'OTHER_EXECUTOR_INTENT');events=root/'events.jsonl';events.write_bytes(b'OTHER_EVENTS\n')
        executor.run('PREFLIGHT_COMMAND',[sys.executable,'-c','print("read only")'])
        self.assertFalse(executor.created);self.assertEqual(events.read_bytes(),b'OTHER_EVENTS\n');self.assertEqual(intent.read_bytes(),b'OTHER_EXECUTOR_INTENT')
        self.assertRaisesRegex(m.RecoveryError,'NEW_RECOVERY_DESTINATION_REQUIRED',executor.claim_destination,m.digest_bytes(m.canonical(executor.plan)))
        self.assertRaisesRegex(m.RecoveryError,'NOT_OWNED',executor.write_result,{'status':'FAILED'})
        self.assertEqual(events.read_bytes(),b'OTHER_EVENTS\n');self.assertFalse((root/'result.json').exists())
    def test_different_project_threads_have_one_atomic_destination_owner(self):
        root=self.root/'race';barrier=threading.Barrier(2)
        executors=[m.Executor(types.SimpleNamespace(destination=str(root),clone_project='clone-'+str(i)),{'clone':i},{}) for i in range(2)]
        def claim(executor):
            barrier.wait()
            try:executor.claim_destination(m.digest_bytes(m.canonical(executor.plan)));return True
            except m.RecoveryError:return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(claim,executors))
        self.assertEqual(sorted(results),[False,True]);winner=executors[results.index(True)];loser=executors[results.index(False)]
        before=(root/'intent.json').read_bytes();winner.record('OWNER_ONLY');loser.record('FOREIGN_PREFLIGHT')
        self.assertEqual((root/'intent.json').read_bytes(),before);self.assertEqual(len((root/'events.jsonl').read_text().splitlines()),1)
        self.assertRaises(m.RecoveryError,loser.write_result,{'status':'FAILED'});winner.write_result({'status':'fixture-only'});self.assertEqual(json.loads((root/'result.json').read_text())['status'],'fixture-only')
    def test_owned_intent_change_blocks_logs_and_results_without_adoption(self):
        executor=self.owned_executor();executor.record('OWNED');events=executor.root/'events.jsonl';before=events.read_bytes()
        (executor.root/'intent.json').write_bytes(b'FOREIGN_REPLACEMENT')
        self.assertRaisesRegex(m.RecoveryError,'INTENT_OWNERSHIP_CHANGED',executor.record,'DO_NOT_WRITE');self.assertEqual(events.read_bytes(),before)
        self.assertRaises(m.RecoveryError,executor.write_result,{'status':'FAILED'});self.assertFalse((executor.root/'result.json').exists())
    def test_owned_event_file_replacement_is_not_adopted(self):
        executor=self.owned_executor();executor.record('OWNED');events=executor.root/'events.jsonl';events.rename(executor.root/'old-events.jsonl');events.write_bytes(b'FOREIGN_LOG\n')
        self.assertRaisesRegex(m.RecoveryError,'EVENT_FILE_CHANGED',executor.record,'DO_NOT_WRITE');self.assertEqual(events.read_bytes(),b'FOREIGN_LOG\n')
    def test_preflight_events_flush_only_after_owned_intent(self):
        executor=m.Executor(types.SimpleNamespace(destination=str(self.root/'new'),clone_project='fixture'),{},{});executor.record('PREFLIGHT');self.assertFalse(executor.root.exists())
        executor.claim_destination(m.digest_bytes(m.canonical(executor.plan)));executor.record('CLAIMED');executor.record('NEXT')
        self.assertEqual([json.loads(line)['stage'] for line in (executor.root/'events.jsonl').read_text().splitlines()],['PREFLIGHT','CLAIMED','NEXT'])
    def test_source_db_runtime_pin_supports_dynamic_compose_without_modifying_it(self):
        projection=self.plan();self.assertEqual(projection['source_db_ip'],'172.30.50.2')
        self.assertEqual(m.settings_derivation_policy(projection)['allowed_original_hosts'],['db','172.30.50.2'])
        source=self.source();source['services']['db']['networks']['isolated']=None;original=copy.deepcopy(source)
        dynamic=self.plan(source);self.assertEqual(dynamic['source_database_binding'],self.source_database());self.assertEqual(source,original);self.assertEqual(dynamic['source_db_ip'],'172.30.50.2')
        source=self.source();source['services']['db']['networks']['isolated']['ipv4_address']='172.30.99.2';self.assertRaisesRegex(m.RecoveryError,'COMPOSE_BASELINE_IP_MISMATCH',self.plan,source)
        image='sha256:'+'b'*64;actual={'id':'c'*64,'service':'db','image':image,'networks':{projection['source_network']:{'IPAddress':'172.30.50.2','NetworkID':'d'*64}}}
        self.assertEqual(m.attest_source_db(actual,projection,image)['source_db_ip'],'172.30.50.2')
        for mutate in [lambda a:a['networks'][projection['source_network']].update(IPAddress='172.30.50.3'),lambda a:a.update(service='php'),lambda a:a.update(image='sha256:'+'d'*64),lambda a:a['networks'].update(foreign={'IPAddress':'172.30.50.2'})]:
            bad=copy.deepcopy(actual);mutate(bad);self.assertRaises(m.RecoveryError,m.attest_source_db,bad,projection,image)
    def test_source_database_baseline_requires_exact_full_identity_schema(self):
        good=self.source_database();self.assertEqual(m.validate_source_database(good,'project-a'),good)
        bad_values=[None,{},dict(good,extra='not accepted'),dict(good,container_id='c'*12),dict(good,network_id='D'*64),dict(good,image_id='repo@sha256:'+'b'*64),dict(good,network_name='foreign'),dict(good,ip_address='172.030.50.2'),dict(good,ip_address=123)]
        for key in good:
            missing=dict(good);del missing[key];bad_values.append(missing)
        for bad in bad_values:
            with self.subTest(bad=bad):self.assertRaises(m.RecoveryError,m.validate_source_database,bad,'project-a')
        baseline=self.baseline();del baseline['source_database'];self.assertRaisesRegex(m.RecoveryError,'BASELINE_REQUIRED',m.validate_baseline,baseline,'project-a','target-a')
    def test_source_database_runtime_ip_must_fit_source_subnet_and_excluded_addresses(self):
        source=self.source();source['services']['db']['networks']['isolated']=None
        for address in ['172.30.50.0','172.30.50.1','172.30.50.4','172.30.50.255','172.30.99.2','127.0.0.1','169.254.1.1','224.0.0.1','8.8.8.8']:
            with self.subTest(address=address):self.assertRaises(m.RecoveryError,self.plan,source,source_database=dict(self.source_database(),ip_address=address))
        source['services']['php']['networks']['isolated']={'ipv4_address':'172.30.50.2'};self.assertRaisesRegex(m.RecoveryError,'SUBNET_OR_ADDRESS',self.plan,source)
    def test_runtime_pin_rejects_each_identity_and_address_drift_even_same_name(self):
        projection=self.plan();expected=self.source_database();image=expected['image_id'];network=expected['network_name']
        actual={'id':expected['container_id'],'service':'db','image':image,'networks':{network:{'IPAddress':expected['ip_address'],'NetworkID':expected['network_id']}}}
        mutations=[lambda a:a.update(id='e'*64),lambda a:a.update(image='sha256:'+'e'*64),lambda a:a['networks'][network].update(NetworkID='e'*64),lambda a:a['networks'][network].update(IPAddress='172.30.50.3'),lambda a:a.update(networks={'renamed':a['networks'][network]})]
        for change in mutations:
            bad=copy.deepcopy(actual);change(bad);self.assertRaises(m.RecoveryError,m.attest_source_db,bad,projection,image)
        self.assertRaisesRegex(m.RecoveryError,'CONTAINER_BINDING',m.attest_source_db,actual,projection,'sha256:'+'e'*64)
        both=copy.deepcopy(actual);both['image']='sha256:'+'e'*64;self.assertRaisesRegex(m.RecoveryError,'CONTAINER_BINDING',m.attest_source_db,both,projection,both['image'])
        self.assertFalse((self.root/'derived-copy').exists())
    def test_runtime_baseline_changes_plan_bytes_and_literal_compose_image_agrees(self):
        source=self.source();source['services']['db']['networks']['isolated']=None
        original=m.digest_bytes(m.canonical(self.plan(source)))
        for changes in [{'container_id':'e'*64},{'network_id':'e'*64},{'image_id':'sha256:'+'e'*64},{'ip_address':'172.30.50.3'}]:
            changed=self.plan(source,source_database=dict(self.source_database(),**changes));self.assertNotEqual(m.digest_bytes(m.canonical(changed)),original)
        source['services']['db']['image']=self.source_database()['image_id'];self.plan(source)
        source['services']['db']['image']='sha256:'+'e'*64;self.assertRaisesRegex(m.RecoveryError,'COMPOSE_BASELINE_IMAGE_MISMATCH',self.plan,source)
    def test_derivation_rejects_attestation_identity_tampering_before_clone_write(self):
        executor,archive,original,readback,attestation=self.derivation_fixture()
        for key,value in [('container_id','e'*64),('image_id','sha256:'+'e'*64),('network_id','e'*64),('ip_address','172.30.50.3')]:
            self.assertRaisesRegex(m.RecoveryError,'DERIVATION_BINDING',executor.derive_clone_settings,dict(attestation,**{key:value}),readback)
        self.assertEqual((executor.root/'cms-root/bitrix/.settings.php').read_bytes(),original);self.assertFalse((executor.root/'private/settings-derivation-intent.json').exists())
    def test_only_host_token_changes_with_unicode_crlf_comments_and_other_identical_literals(self):
        original=("<?php\r\n/* источник 'host'=>'172.30.50.2' */\r\nreturn array('connections'=>array('value'=>array('default'=>array('host' /* token */ => \"172.30.50.2\",'database'=>'upgrade','password'=>'172.30.50.2',))), 'other'=>'172.30.50.2');\r\n").encode()
        derived,receipt=m.derive_settings_bytes(original,'172.30.50.2')
        self.assertEqual(derived,original.replace(b'/* token */ => "172.30.50.2"',b"/* token */ => 'db'"));self.assertEqual(receipt['host_before'],'172.30.50.2');self.assertEqual(receipt['host_after'],'db');self.assertTrue(receipt['changed'])
        self.assertEqual(receipt['before_sha256'],hashlib.sha256(original).hexdigest());self.assertEqual(receipt['after_sha256'],hashlib.sha256(derived).hexdigest());self.assertNotIn('password',json.dumps(receipt))
    def test_already_db_bytes_unchanged_and_foreign_host_or_database_never_remapped(self):
        original=self.settings().encode();derived,receipt=m.derive_settings_bytes(original,'172.30.50.2');self.assertEqual(derived,original);self.assertFalse(receipt['changed'])
        for connection in ["['host'=>'172.30.50.3','database'=>'upgrade']","['host'=>'foreign.example','database'=>'upgrade']","['host'=>'172.30.50.2','database'=>'production']","['host'=>'172.30.50.2'.'.foreign','database'=>'upgrade']","['host'=>'db','host'=>'172.30.50.2','database'=>'upgrade']"]:
            raw=self.settings(connection).encode();self.assertRaises(m.RecoveryError,m.derive_settings_bytes,raw,'172.30.50.2')
    def test_real_clone_derivation_preserves_archive_and_readback_and_writes_private_hash_only_receipt(self):
        executor,archive,original,readback,attestation=self.derivation_fixture();archive_hash=m.digest(archive);ledger=(executor.root/'files-readback.jsonl').read_bytes();settings=executor.root/'cms-root/bitrix/.settings.php';mode=stat.S_IMODE(settings.stat().st_mode)
        outcome=executor.derive_clone_settings(attestation,readback);self.assertEqual(outcome['status'],'PASS');self.assertTrue(outcome['changed']);m.verify_settings(executor.root/'cms-root')
        self.assertEqual(settings.read_bytes(),original.replace(b"'host'=>'172.30.50.2'",b"'host'=>'db'"));self.assertEqual(m.digest(archive),archive_hash);self.assertEqual((executor.root/'files-readback.jsonl').read_bytes(),ledger);self.assertEqual((executor.root/'cms-root/local.txt').read_bytes(),b'unchanged source bytes');self.assertEqual(stat.S_IMODE(settings.stat().st_mode),mode)
        receipt_path=executor.root/'private/settings-derivation.json';receipt=json.loads(receipt_path.read_text());self.assertEqual(receipt['before_sha256'],hashlib.sha256(original).hexdigest());self.assertEqual(receipt['backup_files_sha256'],archive_hash);self.assertEqual(receipt['files_readback_ledger_sha256'],readback['file_readback_ledger_sha256']);self.assertNotIn('FAKE_TEST_ONLY',receipt_path.read_text());self.assertNotIn('FAKE_TEST_ONLY',(executor.root/'events.jsonl').read_text())
        if os.name=='posix':self.assertEqual(stat.S_IMODE(receipt_path.stat().st_mode),0o600)
        self.assertRaisesRegex(m.RecoveryError,'READBACK_MISMATCH',executor.derive_clone_settings,attestation,readback)
    def test_derivation_requires_original_readback_policy_and_attested_host_before_any_write(self):
        executor,archive,original,readback,attestation=self.derivation_fixture();settings=executor.root/'cms-root/bitrix/.settings.php'
        policy=executor.plan.pop('configuration_derivation');self.assertRaisesRegex(m.RecoveryError,'NOT_IN_PLAN',executor.derive_clone_settings,attestation,readback);executor.plan['configuration_derivation']=policy
        bad=dict(attestation,source_db_ip='172.30.50.3');self.assertRaisesRegex(m.RecoveryError,'DERIVATION_BINDING',executor.derive_clone_settings,bad,readback)
        broken=dict(readback,file_readback_ledger_sha256='f'*64);self.assertRaisesRegex(m.RecoveryError,'LEDGER_CHANGED',executor.derive_clone_settings,attestation,broken)
        settings.write_bytes(original+b' ');self.assertRaisesRegex(m.RecoveryError,'READBACK_MISMATCH',executor.derive_clone_settings,attestation,readback)
        self.assertFalse((executor.root/'private/settings-derivation-intent.json').exists());self.assertFalse((executor.root/'private/settings-derivation.json').exists());self.assertEqual(settings.read_bytes(),original+b' ')
    def test_static_db_derived_failed_copy_is_never_adopted_by_another_executor(self):
        executor,archive,original,readback,attestation=self.derivation_fixture();executor.derive_clone_settings(attestation,readback)
        other=m.Executor(executor.args,executor.plan,{})
        self.assertRaisesRegex(m.RecoveryError,'NEW_RECOVERY_DESTINATION_REQUIRED',other.claim_destination,m.digest_bytes(m.canonical(other.plan)))
        self.assertRaisesRegex(m.RecoveryError,'NOT_OWNED',other.derive_clone_settings,attestation,readback)
    def source_inspect_fixture(self):
        values=[]
        for index,service in enumerate(['db','php','nginx']):
            values.append({'Id':str(index+1)*64,'Config':{'Labels':{'com.docker.compose.project':'project-a','com.docker.compose.service':service}},'State':{'Running':True},'Image':'sha256:'+'b'*64,
                'Mounts':[{'Type':'bind','Source':'/source/z-'+service,'Destination':'/z','Mode':'ro','RW':False,'Propagation':'rprivate','FixtureFutureField':{'value':'preserve-exact'}}, {'Type':'volume','Name':service+'-volume','Source':'/docker/volumes/'+service,'Destination':'/a','Driver':'local','Mode':'z','RW':True,'Propagation':''}],
                'NetworkSettings':{'Networks':{'upgrade-project-a-isolated':{'NetworkID':'d'*64,'IPAddress':'172.30.50.'+str(index+2)}}}})
        return values
    def inspected(self, values):
        executor=m.Executor(types.SimpleNamespace(destination=str(self.root/'not-created'),clone_project='fixture',project='project-a',source_compose='/pinned/source-compose.json'),{},{});calls=[]
        def run(stage,args,**kwargs):
            calls.append(args)
            if stage=='SOURCE_CONTAINER_IDS':return types.SimpleNamespace(stdout=('\n'.join(v['Id'] for v in values)+'\n').encode())
            self.assertEqual(stage,'SOURCE_INSPECT');return types.SimpleNamespace(stdout=m.canonical(values))
        executor.run=run;result=executor.source_inspect();self.assertEqual(len(calls),2);self.assertFalse(executor.created);self.assertFalse(executor.root.exists());return result
    def test_source_inspect_mount_enumeration_order_is_irrelevant_and_all_fields_retained(self):
        values=self.source_inspect_fixture();original=copy.deepcopy(values);before=self.inspected(values)
        reordered=copy.deepcopy(values)
        for item in reordered:item['Mounts'].reverse()
        reordered.reverse();after=self.inspected(reordered)
        self.assertEqual(before,after);self.assertEqual(values,original)
        self.assertEqual(before[0]['mounts'],sorted(original[0]['Mounts'],key=lambda value:value['Destination']))
        self.assertEqual(before[0]['mounts'][1]['FixtureFutureField'],{'value':'preserve-exact'})
    def test_source_inspect_real_mount_image_network_and_container_drift_still_rejected(self):
        values=self.source_inspect_fixture();before=self.inspected(values)
        changes=[lambda v:v[0]['Mounts'][0].update(Source='/foreign'),lambda v:v[0]['Mounts'][0].update(RW=True),lambda v:v[0]['Mounts'][0].update(Destination='/different'),lambda v:v[0]['Mounts'][0].update(Propagation='rshared'),lambda v:v[0]['Mounts'][0]['FixtureFutureField'].update(value='changed'),lambda v:v[0].update(Image='sha256:'+'e'*64),lambda v:v[0].update(Id='e'*64),lambda v:v[0]['NetworkSettings']['Networks']['upgrade-project-a-isolated'].update(IPAddress='172.30.50.99'),lambda v:v[0]['NetworkSettings']['Networks']['upgrade-project-a-isolated'].update(NetworkID='e'*64)]
        for change in changes:
            changed=copy.deepcopy(values);change(changed)
            for item in changed:item['Mounts'].reverse()
            observed=self.inspected(changed);self.assertNotEqual(observed,before)
            self.assertRaisesRegex(m.RecoveryError,'SOURCE_RUNTIME_CHANGED_DURING_RECOVERY',m.need,observed==before,'SOURCE_RUNTIME_CHANGED_DURING_RECOVERY')
    def test_source_inspect_added_or_removed_mount_is_not_hidden_by_sorting(self):
        values=self.source_inspect_fixture();before=self.inspected(values)
        for remove in [True,False]:
            changed=copy.deepcopy(values)
            if remove:changed[0]['Mounts'].pop()
            else:changed[0]['Mounts'].append({'Type':'bind','Source':'/new','Destination':'/new','RW':False})
            self.assertNotEqual(self.inspected(changed),before)
unittest.main(verbosity=2)
`;

test('recovery runner: real Python offline contract suite (no Docker/server/CMS execution)', t => {
  const directory = mkdtempSync(join(tmpdir(), 'upgrade-recovery-python-'));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(basename(directory), /^upgrade-recovery-python-/); rmSync(directory, { recursive: true, force: true }); });
  const script = join(directory, 'test_recovery.py'); writeFileSync(script, harness);
  const result = spawnSync(python, ['-B', script, source], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 44 tests/); assert.match(result.stderr, /\bOK\b/);
  t.diagnostic(result.stderr.trim());
});
