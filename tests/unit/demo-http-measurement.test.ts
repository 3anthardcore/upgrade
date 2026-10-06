import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('demo HTTP measurement rejects foreign/unbounded plans and incomplete privacy policy', () => {
  const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = process.env.UPGRADE_PYTHON_BIN ?? (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
  const code = String.raw`
import copy, importlib.util, sys, unittest, tempfile, pathlib, threading, time, http.server, urllib.request
spec=importlib.util.spec_from_file_location('measure',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
    def setUp(self):
        self.plan={'schema_version':1,'project_id':'fixture','target_id':'fixture-target','package_manifest_sha256':'a'*64,'origin':'https://demo.example.test','routes':['/','/Exact%2FPath?a=1&a=2&empty='],'performance_paths':['/'],'clients':10,'rounds':3,'timeout_seconds':10}
        self.headers={'x-robots-tag':'noindex, nofollow, noarchive','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','content-security-policy':"default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}
    def test_exact_query_preserved(self):
        original=copy.deepcopy(self.plan);self.assertEqual(m.validate_plan(self.plan),original)
    def test_foreign_routes(self):
        for route in ['https://source.test/', '//source.test/', '/foo#bar', '/foo\\bar','/foo\r\nX: a']:
            with self.subTest(route=route):
                p=copy.deepcopy(self.plan);p['routes'].append(route)
                with self.assertRaises(ValueError):m.validate_plan(p)
    def test_origin_not_path_or_credentials(self):
        for origin in ['http://demo.test','https://user:pass@demo.test','https://demo.test/path','https://demo.test#x']:
            p=copy.deepcopy(self.plan);p['origin']=origin
            with self.assertRaises(ValueError):m.validate_plan(p)
    def test_bounds(self):
        for key,value in [('clients',11),('clients',True),('rounds',0),('timeout_seconds',31),('performance_paths',['/not-in-scope'])]:
            p=copy.deepcopy(self.plan);p[key]=value
            with self.assertRaises(ValueError):m.validate_plan(p)
    def test_duplicate_route(self):
        self.plan['routes'].append('/')
        with self.assertRaises(ValueError):m.validate_plan(self.plan)
    def test_privacy_pass(self):self.assertTrue(all(m.privacy(self.headers).values()))
    def test_required_header_absent(self):
        for key in self.headers:
            h=self.headers.copy();h.pop(key);self.assertFalse(all(m.privacy(h).values()))
    def test_csp_weakened(self):
        for replacement in ["script-src 'self'", "script-src *", "script-src 'none' https://external.test"]:
            h=self.headers.copy();h['content-security-policy']=h['content-security-policy'].replace("script-src 'none'",replacement)
            self.assertFalse(all(m.privacy(h).values()))
    def test_csp_duplicate(self):
        self.headers['content-security-policy']+="; script-src 'none'";self.assertFalse(all(m.privacy(self.headers).values()))
    def test_redirect_never_follows(self):self.assertIsNone(m.NoRedirect().redirect_request(None,None,302,'',{},'https://foreign.test'))
    def test_bounded_input(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'input';p.write_bytes(b'x'*101)
            with self.assertRaises(ValueError):m.bounded_read(p,100)
    def test_absolute_deadline_and_no_new_request(self):
        class Slow(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.send_header('Content-Length','100');self.end_headers()
                try:
                    for unused in range(100):self.wfile.write(b'x');self.wfile.flush();time.sleep(.02)
                except OSError:pass
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Slow);server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        abort=threading.Event();start=time.monotonic()
        def action():
            with urllib.request.urlopen('http://127.0.0.1:'+str(server.server_port),timeout=1) as response:return response.read()
        try:
            with self.assertRaises(TimeoutError):m.absolute_call(action,.1,abort)
            self.assertLess(time.monotonic()-start,.8);self.assertTrue(abort.is_set())
            with self.assertRaises(ValueError):m.absolute_call(lambda:self.fail('new request after timeout'),1,abort)
        finally:server.shutdown();server.server_close()
unittest.main(argv=['measurement'],verbosity=2)
`;
  const result = spawnSync(python, ['-I', '-B', '-c', code, resolve('scripts/measure-demo-http.py')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 12 tests/);
});
