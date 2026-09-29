"""Offline file-restore contract tests. No Bitrix/DB restoration is claimed."""
import hashlib,io,json,pathlib,subprocess,sys,tarfile,tempfile,unittest

class RestoreContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='upgrade-restore-')
        self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
        (self.root/'database.sql').write_text('-- synthetic only\n')
        self.archive('local/templates/upgrade/readme.txt')
    def archive(self,name):
        with tarfile.open(self.root/'site.tar.gz','w:gz') as archive:
            content=b'Synthetic fixture content'
            entry=tarfile.TarInfo(name);entry.size=len(content)
            archive.addfile(entry,io.BytesIO(content))
        data={'project_id':'project-a','status':'INTEGRITY_VERIFIED'}
        for kind,file in [('database','database.sql'),('files','site.tar.gz')]:
            data[kind+'_file']=str(self.root/file)
            data[kind+'_sha256']=hashlib.sha256((self.root/file).read_bytes()).hexdigest()
        (self.root/'receipt.json').write_text(json.dumps(data))
    def run_restore(self,project='project-a'):
        return subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('restore-prepare.py')),'--receipt',str(self.root/'receipt.json'),'--project',project,'--new-root',str(self.root/'new-site')],capture_output=True,text=True)
    def test_extract_to_new_isolated_root(self):
        result=self.run_restore()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((self.root/'new-site/local/templates/upgrade/readme.txt').read_text(),'Synthetic fixture content')
        self.assertEqual(json.loads(result.stdout)['database_import'],'NOT_RUN')
    def test_wrong_project_rejected(self):
        result=self.run_restore('project-b')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((self.root/'new-site').exists())
    def test_existing_destination_rejected(self):
        (self.root/'new-site').mkdir()
        (self.root/'new-site/keep').write_text('retain')
        self.assertNotEqual(self.run_restore().returncode,0)
        self.assertEqual((self.root/'new-site/keep').read_text(),'retain')
    def test_corrupt_database_rejected(self):
        (self.root/'database.sql').write_text('corrupt')
        self.assertNotEqual(self.run_restore().returncode,0)
        self.assertFalse((self.root/'new-site').exists())
    def test_traversal_rejected(self):
        self.archive('../escape.txt')
        self.assertNotEqual(self.run_restore().returncode,0)
        self.assertFalse((self.root/'escape.txt').exists())

if __name__=='__main__':unittest.main(verbosity=2)
