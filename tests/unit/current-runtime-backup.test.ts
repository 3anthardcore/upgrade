import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.UPGRADE_PYTHON_BIN ?? (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
const harness = String.raw`
import copy, contextlib, errno, hashlib, importlib.util, io, json, os, pathlib, sqlite3, subprocess, sys, tarfile, tempfile, unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('backup',sys.argv.pop(1));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SQL=b'-- MySQL dump 10.13\nCREATE DATABASE upgrade;\n-- Dump completed on 2026-09-30\n'

class FakeHost:
    def __init__(self,p,items):self.p=p;self.items=items;self.calls=[];self.fail=None;self.on_dump=None
    def inspect(self,role):self.calls.append(('inspect',role));return copy.deepcopy(self.items[role])
    def network(self):
        n=self.p['network'];return dict(Id=n['id'],Name=n['name'],Driver='bridge',Internal=True,EnableIPv6=False,
            Options={'com.docker.network.bridge.name':n['bridge']},Labels={'upgrade.project':self.p['project_id']},IPAM={'Config':[{'Subnet':n['subnet']}]})
    def guard(self):self.calls.append(('guard','check'))
    def stop(self,role):
        self.calls.append(('stop',role))
        if self.fail==('stop',role):raise m.BackupError('COMMAND_OUTCOME_UNKNOWN')
        self.items[role]['State'].update(Running=False,Status='exited')
        if self.fail==('stop-after',role):raise m.BackupError('COMMAND_OUTCOME_UNKNOWN')
    def start(self,role):
        self.calls.append(('start',role))
        if self.fail==('start',role):raise m.BackupError('COMMAND_OUTCOME_UNKNOWN')
        self.items[role]['State'].update(Running=True,Status='running')
        if self.fail==('start-after',role):raise m.BackupError('COMMAND_OUTCOME_UNKNOWN')
    def database_check(self):self.calls.append(('database','check'))
    def dump(self,path):
        self.calls.append(('dump','upgrade'))
        if self.on_dump:self.on_dump()
        if self.fail==('dump','upgrade'):raise m.BackupError('DUMP_FAILED')
        pathlib.Path(path).write_bytes(SQL);os.chmod(path,0o600)

class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='upgrade-current-backup-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name).resolve();os.chmod(self.root,0o700)
        self.cms=self.root/'cms';self.state=self.root/'state';self.journal=self.root/'target-a'
        for p in [self.cms,self.state,self.journal]:p.mkdir(mode=0o700)
        (self.cms/'index.php').write_bytes(b'<?php // observed own document')
        data=self.state/'release/data';data.mkdir(parents=True)
        (data/'demo-snapshot.json').write_bytes(m.canonical(dict(schema_version=1,project_id='project-a',snapshot_id='7'*64)))
        (self.state/'demo-active.json').write_bytes(m.canonical(dict(schema_version=1,project_id='project-a',target_id='target-a',relative_path='release/data/demo-snapshot.json',sha256=m.digest(data/'demo-snapshot.json'))))
        sessions=self.state/'demo-private';sessions.mkdir();(sessions/'session.json').write_bytes(b'{"cart":"preserved"}')
        (self.state/'upgrade-project-a.lock').touch()
        db=sqlite3.connect(self.journal/'transport-lock.sqlite');db.execute('create table transport(id integer)');db.commit();db.close()
        (self.journal/'binding.json').write_text(json.dumps(dict(project_id='project-a',target_id='target-a',container='php',document_root='/var/www/html',state_dir='/var/lib/upgrade')))
        (self.journal/'unknown.state.json').write_text('{"status":"UNKNOWN"}')
        cnf=self.root/'client.cnf';cnf.write_bytes(b'[client]\nuser=root\npassword=PRIVATE_TEST_SENTINEL\n');os.chmod(cnf,0o600)
        tool=self.root/'tool';tool.write_bytes(b'fixed tool');os.chmod(tool,0o700)
        self.p=dict(schema_version=1,project_id='project-a',target_id='target-a',cms_root=str(self.cms),state_root=str(self.state),
            native_journal_dir=str(self.journal),destination=str(self.root/'backup'),docker=dict(path=str(tool),sha256=m.digest(tool)),guard=dict(path=str(tool),sha256=m.digest(tool)),
            network=dict(name='upgrade-project-a-isolated',id='d'*64,bridge='br-upg-test',subnet='172.30.50.0/24'),containers={},
            database=dict(name='upgrade',cnf_path=str(cnf),cnf_sha256=m.digest(cnf),dump_executable='/usr/bin/mariadb-dump',query_executable='/usr/bin/mariadb'),
            active_pointer_sha256=m.digest(self.state/'demo-active.json'),limits=dict(max_files=1000,max_total_bytes=10000000,max_file_bytes=5000000,command_timeout_seconds=10,stop_timeout_seconds=10))
        self.items={}
        for role,char,ip in [('db','a','2'),('php','b','3'),('nginx','c','4')]:
            mounts=[dict(Destination='/var/lib/mysql',Source='/private/database',RW=True)] if role=='db' else [dict(Destination='/var/www/html',Source=str(self.cms),RW=role=='php')]
            if role=='php':mounts.append(dict(Destination='/var/lib/upgrade',Source=str(self.state),RW=True))
            item=dict(Id=char*64,Name='/'+role,Image='sha256:'+'e'*64,Config={'Labels':{'com.docker.compose.project':'project-a','com.docker.compose.service':role}},HostConfig={'RestartPolicy':{'Name':'no'}},Mounts=mounts,
                State=dict(Running=True,Status='running'),NetworkSettings={'Networks':{self.p['network']['name']:{'NetworkID':'d'*64,'IPAddress':'172.30.50.'+ip}}})
            self.items[role]=item;self.p['containers'][role]=dict(id=item['Id'],image_id=item['Image'],static_sha256=m.sha(m.canonical(m.immutable_container(item))),ip='172.30.50.'+ip,running=True)
        self.host=FakeHost(self.p,self.items);self.plan=m.make_plan(self.p,'f'*64,self.host);self.host.calls=[]
    def execute(self):return m.Executor(self.plan,self.host).execute()
    def profile(self):
        p=self.root/'profile.json';p.write_bytes(m.canonical(self.p));os.chmod(p,0o600);return p
    def resume(self):return m.Executor(self.plan,self.host).resume(m.sha(m.canonical(self.plan)))
    def change(self,role):self.items[role]['Id']='0'*64
    def test_plan_no_write_or_stop(self):
        before=set(self.root.rglob('*'));plan=m.make_plan(self.p,'f'*64,self.host)
        self.assertEqual(before,set(self.root.rglob('*')));self.assertTrue(all(x[0] in ('inspect','database') for x in self.host.calls));self.assertNotIn('PRIVATE_TEST_SENTINEL',str(plan))
    def test_profile_actual_pins(self):
        p=self.profile();self.assertEqual(m.validate_profile(str(p),m.digest(p)),self.p)
        p.write_bytes(p.read_bytes()+b' ')
        with self.assertRaisesRegex(m.BackupError,'FILE_PIN'):m.validate_profile(str(p),'f'*64)
    def test_unknown_profile_field_rejected(self):
        self.p['extra']='secret';p=self.profile()
        with self.assertRaisesRegex(m.BackupError,'PROFILE_SCHEMA'):m.validate_profile(str(p),m.digest(p))
    def test_nested_destination_rejected(self):
        self.p['destination']=str(self.state/'backup');p=self.profile()
        with self.assertRaisesRegex(m.BackupError,'ROOTS_OVERLAP'):m.validate_profile(str(p),m.digest(p))
    def test_profile_pointer_pin_rejected(self):
        (self.state/'demo-active.json').write_text('{}');p=self.profile()
        with self.assertRaisesRegex(m.BackupError,'FILE_PIN'):m.validate_profile(str(p),m.digest(p))
    def test_snapshot_reference_tamper_or_cross_project_refused(self):
        snapshot=self.state/'release/data/demo-snapshot.json';snapshot.write_text('{}');p=self.profile()
        with self.assertRaisesRegex(m.BackupError,'FILE_PIN'):m.validate_profile(str(p),m.digest(p))
        pointer=json.loads((self.state/'demo-active.json').read_bytes());pointer['sha256']=m.digest(snapshot)
        (self.state/'demo-active.json').write_bytes(m.canonical(pointer));self.p['active_pointer_sha256']=m.digest(self.state/'demo-active.json');p=self.profile()
        with self.assertRaisesRegex(m.BackupError,'ACTIVE_SNAPSHOT_BINDING'):m.validate_profile(str(p),m.digest(p))
    def test_combined_scope_limit_restores_before_dump(self):
        self.p['limits']['max_total_bytes']=9000
        (self.cms/'large').write_bytes(b'x'*4000)
        with self.assertRaisesRegex(m.BackupError,'BACKUP_COMBINED_LIMIT'):self.execute()
        self.assertNotIn(('dump','upgrade'),self.host.calls);self.assertTrue(self.items['php']['State']['Running'])
    def test_network_foreign_or_noninternal_refused(self):
        n=self.host.network();n['Internal']=False
        with self.assertRaisesRegex(m.BackupError,'NETWORK_ISOLATION'):m.verify_network(self.p,n)
        n=self.host.network();n['Labels']['upgrade.project']='foreign'
        with self.assertRaisesRegex(m.BackupError,'NETWORK_OWNERSHIP'):m.verify_network(self.p,n)
    def test_mount_order_normalized_but_changed_mount_refused(self):
        item=copy.deepcopy(self.items['php']);item['Mounts'].reverse();self.assertTrue(m.verify_container(self.p,'php',item))
        item['Mounts'][0]['Source']='/foreign'
        with self.assertRaisesRegex(m.BackupError,'IDENTITY_CHANGED'):m.verify_container(self.p,'php',item)
    def test_running_changed_ip_refused(self):
        self.items['php']['NetworkSettings']['Networks'][self.p['network']['name']]['IPAddress']='172.30.50.200'
        with self.assertRaisesRegex(m.BackupError,'NETWORK_IDENTITY'):m.make_plan(self.p,'f'*64,self.host)
    def test_complete_backup_has_all_private_state_and_original_journal(self):
        before={str(p):m.digest(p) for r in [self.cms,self.state,self.journal] for p in r.rglob('*') if p.is_file()}
        receipt=self.execute();dest=self.root/'backup'
        self.assertEqual(receipt['status'],'INTEGRITY_VERIFIED');self.assertEqual(receipt['restore_test'],'NOT_RUN')
        for archive,required in [('private-state.tar.gz','demo-private/session.json'),('native-journal.tar.gz','unknown.state.json'),('site.tar.gz','index.php')]:
            with tarfile.open(dest/archive) as t:self.assertIn(required,t.getnames())
        self.assertEqual(before,{p:m.digest(p) for p in before})
        self.assertEqual([x for x in self.host.calls if x[0] in ('stop','start')],[('stop','nginx'),('stop','php'),('start','php'),('start','nginx')])
        self.assertTrue(all(x['State']['Running'] for x in self.items.values()))
        manifest=m.load_json((dest/'snapshot-manifest.json').read_bytes())
        self.assertEqual(manifest['exclusions'],[]);self.assertEqual(set(manifest['outputs']),{'database','cms_root','state_root','native_journal_dir'})
    def test_initially_stopped_php_never_started(self):
        self.items['php']['State'].update(Running=False,Status='exited');self.p['containers']['php']['running']=False
        self.execute();self.assertNotIn(('start','php'),self.host.calls);self.assertNotIn(('stop','php'),self.host.calls)
    def test_existing_destination_not_adopted(self):
        dest=self.root/'backup';dest.mkdir();(dest/'foreign').write_text('sentinel')
        with self.assertRaisesRegex(m.BackupError,'DESTINATION_EXISTS'):self.execute()
        self.assertEqual((dest/'foreign').read_text(),'sentinel');self.assertFalse(any(x[0]=='stop' for x in self.host.calls))
    def test_dump_failure_restores_runtime_no_receipt(self):
        self.host.fail=('dump','upgrade')
        with self.assertRaisesRegex(m.BackupError,'DUMP_FAILED'):self.execute()
        self.assertTrue(all(x['State']['Running'] for x in self.items.values()));self.assertFalse((self.root/'backup/backup-receipt.json').exists())
    def test_changed_container_not_restarted(self):
        self.host.on_dump=lambda:self.change('php')
        with self.assertRaisesRegex(m.BackupError,'RUNTIME_RECOVERY_REQUIRED'):self.execute()
        self.assertNotIn(('start','php'),self.host.calls);self.assertNotIn(('start','nginx'),self.host.calls)
    def test_unknown_stop_still_running_no_duplicate_mutation(self):
        self.host.fail=('stop','nginx')
        with self.assertRaisesRegex(m.BackupError,'RUNTIME_RECOVERY_REQUIRED'):self.execute()
        with self.assertRaisesRegex(m.BackupError,'STOP_OUTCOME_UNKNOWN'):self.resume()
        self.assertEqual([x for x in self.host.calls if x[0] in ('stop','start')],[('stop','nginx')])
    def test_unknown_stop_observed_stopped_restored(self):
        self.host.fail=('stop-after','nginx')
        with self.assertRaisesRegex(m.BackupError,'COMMAND_OUTCOME_UNKNOWN'):self.execute()
        self.assertTrue(self.items['nginx']['State']['Running']);self.assertEqual(self.host.calls.count(('start','nginx')),1)
    def test_unknown_start_stopped_never_retried(self):
        self.host.fail=('start','php')
        with self.assertRaisesRegex(m.BackupError,'RUNTIME_RECOVERY_REQUIRED'):self.execute()
        with self.assertRaisesRegex(m.BackupError,'START_OUTCOME_UNKNOWN'):self.resume()
        self.assertEqual(self.host.calls.count(('start','php')),1)
    def test_unknown_start_observed_running_reconciles_without_restart(self):
        self.host.fail=('start-after','php')
        with self.assertRaisesRegex(m.BackupError,'RUNTIME_RECOVERY_REQUIRED'):self.execute()
        self.host.fail=None;result=self.resume()
        self.assertTrue(result['runtime_restored']);self.assertEqual(self.host.calls.count(('start','php')),1)
        self.assertEqual(self.host.calls.count(('dump','upgrade')),1);self.assertFalse((self.root/'backup/backup-receipt.json').exists())
    def test_crash_after_durable_stop_intent_restores_without_copy(self):
        e=m.Executor(self.plan,self.host);e.claim();e.stop('nginx');e.stop('php')
        self.host.calls=[];self.resume()
        self.assertNotIn(('dump','upgrade'),self.host.calls);self.assertTrue(all(x['State']['Running'] for x in self.items.values()))
    def test_complete_no_reexecute(self):
        self.execute();before=list(self.host.calls)
        with self.assertRaisesRegex(m.BackupError,'ALREADY_COMPLETE'):self.resume()
        self.assertEqual(self.host.calls,before)
    def test_state_corruption_refuses_resume(self):
        e=m.Executor(self.plan,self.host);e.claim();(self.root/'backup/runtime-state.json').write_text('{')
        with self.assertRaisesRegex(m.BackupError,'JSON_INVALID'):self.resume()
        self.assertFalse(any(x[0]=='start' for x in self.host.calls))
    def test_state_replacement_during_run_refused(self):
        e=m.Executor(self.plan,self.host);e.claim();(self.root/'backup/runtime-state.json').write_text('{}')
        with self.assertRaisesRegex(m.BackupError,'RUNTIME_STATE_CHANGED'):e.save()
    def test_intent_replacement_refuses_writes(self):
        e=m.Executor(self.plan,self.host);e.claim();(self.root/'backup/intent.json').write_text('{}')
        with self.assertRaisesRegex(m.BackupError,'INTENT_REPLACED'):e.save()
    def test_foreign_profile_resume_pin_refused(self):
        e=m.Executor(self.plan,self.host);e.claim();self.plan['profile_sha256']='0'*64
        with self.assertRaisesRegex(m.BackupError,'RESUME_PLAN_MISMATCH'):m.Executor(self.plan,self.host).resume('1'*64)
    def test_archive_corruption_detected(self):
        out=self.root/'x.tar.gz';ledger=m.archive_tree(self.cms,out,self.p['limits']);out.write_bytes(b'broken')
        with self.assertRaises(tarfile.TarError):m.verify_archive(out,ledger)
    def test_source_link_refused(self):
        p=self.cms/'linked'
        try:os.link(self.cms/'index.php',p)
        except OSError:self.fail('Test requires hardlink support on this temp filesystem')
        with self.assertRaisesRegex(m.BackupError,'TREE_LINK_OR_SPECIAL'):m.archive_tree(self.cms,self.root/'x.tar.gz',self.p['limits'])
    def test_archive_bounds(self):
        limits={**self.p['limits'],'max_file_bytes':1}
        with self.assertRaisesRegex(m.BackupError,'TREE_FILE_LIMIT'):m.archive_tree(self.cms,self.root/'x.tar.gz',limits)
    def test_sql_truncation_refused(self):
        p=self.root/'bad.sql';p.write_bytes(b'-- MySQL dump\n'+b'x'*100)
        with self.assertRaisesRegex(m.BackupError,'SQL_DUMP_INCOMPLETE'):m.validate_sql(p,1000)
    def test_credentials_only_stdin_and_fixed_local_database(self):
        host=m.Host(self.p);calls=[]
        host.run=lambda args,stdin=None,**kw:calls.append((args,stdin)) or b'OFF\n1\n'
        host.database_check();args,body=calls[0]
        self.assertNotIn('PRIVATE_TEST_SENTINEL',' '.join(args));self.assertIn(b'PRIVATE_TEST_SENTINEL',body)
        self.assertIn('--host=127.0.0.1',args);self.assertIn('--protocol=TCP',args);self.assertIn('--defaults-extra-file=/dev/stdin',args)
    def test_actual_process_error_redacts_stderr(self):
        host=m.Host(self.p)
        with self.assertRaisesRegex(m.BackupError,'^COMMAND_FAILED$'):host.run([sys.executable,'-c','import sys;sys.stderr.write("PRIVATE_TEST_SENTINEL");sys.exit(7)'])
    def test_actual_process_timeout_unknown(self):
        host=m.Host(self.p)
        with self.assertRaisesRegex(m.BackupError,'COMMAND_OUTCOME_UNKNOWN'):host.run([sys.executable,'-c','import time;time.sleep(3)'],timeout=.05)
    def test_actual_dump_child_stream_and_private_bytes(self):
        original=subprocess.Popen;calls=[]
        def child(args,**kwargs):
            calls.append(args)
            return original([sys.executable,'-c','import sys; auth=sys.stdin.buffer.read(); assert b"PRIVATE_TEST_SENTINEL" in auth; sys.stdout.buffer.write('+repr(SQL)+')'],**kwargs)
        output=self.root/'stream.sql'
        with patch.object(m.subprocess,'Popen',child):m.Host(self.p).dump(output)
        self.assertEqual(output.read_bytes(),SQL);self.assertNotIn('PRIVATE_TEST_SENTINEL',str(calls));self.assertIn('--host=127.0.0.1',calls[0])
        if os.name=='posix':self.assertEqual(output.stat().st_mode&0o777,0o600)
    def test_actual_dump_child_limit_never_writes_over_budget(self):
        original=subprocess.Popen;self.p['limits']['max_file_bytes']=64
        def child(args,**kwargs):return original([sys.executable,'-c','import sys;sys.stdout.buffer.write(b"x"*2000000)'],**kwargs)
        output=self.root/'large.sql'
        with patch.object(m.subprocess,'Popen',child):
            with self.assertRaisesRegex(m.BackupError,'DUMP_SIZE_LIMIT'):m.Host(self.p).dump(output)
        self.assertLessEqual(output.stat().st_size,64)
    def test_source_mutation_during_archive_refused(self):
        original=tarfile.TarFile.addfile
        def mutate(archive,item,fileobj=None):
            result=original(archive,item,fileobj)
            if item.name=='index.php':(self.cms/'index.php').write_bytes(b'changed during backup')
            return result
        with patch.object(tarfile.TarFile,'addfile',mutate):
            with self.assertRaisesRegex(m.BackupError,'SOURCE_CHANGED_DURING_BACKUP'):m.archive_tree(self.cms,self.root/'x.tar.gz',self.p['limits'])
    def nested_scandir_failure(self, fail_at):
        nested=self.cms/'nested';nested.mkdir();important=nested/'private-important.php';important.write_bytes(b'<?php // must never disappear from a complete backup')
        expected=m.digest(important);original=m.os.scandir;visits=0
        def faulty(path):
            nonlocal visits
            if pathlib.Path(path)==nested:
                visits+=1
                if fail_at==0 or visits==fail_at:raise OSError(errno.EIO,'synthetic nested directory I/O failure',str(path))
            return original(path)
        with patch.object(m.os,'scandir',faulty):
            with self.assertRaisesRegex(m.BackupError,'TREE_ENUMERATION_FAILED'):self.execute()
        self.assertEqual(m.digest(important),expected);self.assertTrue(all(x['State']['Running'] for x in self.items.values()))
        self.assertFalse((self.root/'backup/backup-receipt.json').exists());self.assertFalse((self.root/'backup/snapshot-manifest.json').exists())
        state=m.load_json((self.root/'backup/runtime-state.json').read_bytes())
        self.assertEqual(state['phase'],'BACKUP_FAILED_RUNTIME_RESTORED');self.assertTrue(state['runtime_restored'])
    def test_persistent_nested_scandir_eio_never_publishes_full_backup(self):self.nested_scandir_failure(0)
    def test_nested_scandir_eio_before_archive_never_publishes_full_backup(self):self.nested_scandir_failure(2)
    def test_nested_scandir_eio_final_inventory_never_publishes_full_backup(self):self.nested_scandir_failure(3)
    def test_cli_plan_and_wrong_acceptance_never_stop(self):
        p=self.profile();out=io.StringIO()
        with patch.object(m,'Host',lambda _:self.host),contextlib.redirect_stdout(out):
            self.assertEqual(m.main(['--profile',str(p),'--profile-sha256',m.digest(p)]),0)
            with self.assertRaisesRegex(m.BackupError,'PLAN_ACCEPTANCE_MISMATCH'):
                m.main(['--profile',str(p),'--profile-sha256',m.digest(p),'--execute','--accept-plan-sha256','0'*64])
        result=json.loads(out.getvalue());self.assertEqual(result['mode'],'PLAN_ONLY');self.assertNotIn('PRIVATE_TEST_SENTINEL',out.getvalue())
        self.assertFalse(any(x[0] in ('stop','start') for x in self.host.calls));self.assertFalse((self.root/'backup').exists())
    def test_sqlite_busy_refuses_before_runtime_mutation_posix(self):
        if os.name!='posix':self.assertTrue(hasattr(sqlite3,'connect'));return
        db=sqlite3.connect(self.journal/'transport-lock.sqlite',timeout=0,isolation_level=None);db.execute('BEGIN EXCLUSIVE')
        try:
            with self.assertRaises(sqlite3.OperationalError):
                with m.source_locks(self.p):self.fail('busy native writer admitted')
            self.assertFalse(any(x[0]=='stop' for x in self.host.calls))
        finally:db.rollback();db.close()
    def test_sqlite_native_lock_conflicts_with_actual_other_process(self):
        db=sqlite3.connect(self.journal/'transport-lock.sqlite',timeout=0,isolation_level=None);db.execute('BEGIN EXCLUSIVE')
        try:
            code='import sqlite3,sys; c=sqlite3.connect(sys.argv[1],timeout=0,isolation_level=None); c.execute("BEGIN EXCLUSIVE")'
            result=subprocess.run([sys.executable,'-c',code,str(self.journal/'transport-lock.sqlite')],capture_output=True)
            self.assertNotEqual(result.returncode,0);self.assertIn(b'locked',result.stderr)
        finally:db.rollback();db.close()
    def test_posix_source_locks_share_gateway_and_release(self):
        if os.name!='posix':
            self.assertTrue(hasattr(sqlite3,'connect'));return
        with m.source_locks(self.p):
            code='import fcntl,sys; f=open(sys.argv[1],"r+b"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)'
            result=subprocess.run([sys.executable,'-c',code,str(self.state/'upgrade-project-a.lock')],capture_output=True)
            self.assertNotEqual(result.returncode,0)
        with m.source_locks(self.p):pass
unittest.main(verbosity=2)
`;

test('current runtime backup: actual Python archives, process failures, isolation and recovery contracts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'upgrade-current-runtime-backup-'));
  try {
    const script = join(directory, 'check.py');
    writeFileSync(script, harness);
    const result = spawnSync(python, ['-I', script, resolve('scripts/current-runtime-backup.py')], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Ran 42 tests/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
