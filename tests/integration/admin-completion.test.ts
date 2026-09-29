import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const php = process.env.UPGRADE_PHP_BIN;
const password = "FIXTURE_SECRET_PASSWORD_123456789";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// Executes the unmodified own helper in real PHP processes. Only vendor APIs and
// Linux metadata/runtime-policy observations are doubles; no real CMS/network.
const harness = String.raw`<?php
declare(strict_types=1);
namespace {
class Ledger {
    static array $data=[];
    static string $path;
    static string $mode;
    static string $state;
    static function save(){file_put_contents(self::$path,json_encode(self::$data,JSON_THROW_ON_ERROR));}
}
class Rows {
    function __construct(private array $rows){}
    function Fetch(){return array_shift($this->rows)?:false;}
}
class CUser {
    public string $LAST_ERROR='';
    static function GetCount(){return count(Ledger::$data['users']);}
    static function GetByLogin($login){return new Rows(array_values(array_filter(Ledger::$data['users'],fn($row)=>$row['LOGIN']===$login)));}
    static function GetUserGroup($id){return Ledger::$data['groups'][(string)$id]??[];}
    function Add($fields){
        Ledger::$data['add_calls']++;
        $record=json_decode(file_get_contents(Ledger::$state.'/admin-bootstrap/receipt.json'),true,32,JSON_THROW_ON_ERROR);
        if(($record['state']??'')!=='PENDING')throw new RuntimeException('Add occurred before durable intent');
        Ledger::$data['pending_seen_by_add']=true;
        Ledger::$data['password_fields_match']=$fields['PASSWORD']===$fields['CONFIRM_PASSWORD'];
        $password=$fields['PASSWORD'];
        unset($fields['PASSWORD'],$fields['CONFIRM_PASSWORD']);
        Ledger::$data['added_fields']=$fields;
        if(Ledger::$mode==='add-error'){$this->LAST_ERROR=$password;echo 'VENDOR_HTML '.$password;return false;}
        if(Ledger::$mode==='vendor-exception'){echo 'VENDOR_HTML '.$password;throw new RuntimeException('Vendor exception '.$password);}
        if(Ledger::$mode==='uppercase-exception'){throw new RuntimeException($password);}
        $id=count(Ledger::$data['users'])+1;
        Ledger::$data['users'][]=['ID'=>(string)$id,'EXTERNAL_AUTH_ID'=>'']+$fields;
        Ledger::$data['groups'][(string)$id]=$fields['GROUP_ID'];
        Ledger::$data['password_hash']=hash('sha256',$password);
        if(Ledger::$mode==='readback-drift'){Ledger::$data['users'][0]['EMAIL']='foreign@example.test';}
        Ledger::save(); // Actual fixture destination survives abrupt process exit.
        if(Ledger::$mode==='hold-add'){
            file_put_contents(Ledger::$path.'.locked','ready');
            for($wait=0;$wait<1000&&!file_exists(Ledger::$path.'.release');$wait++)usleep(10000);
            if(!file_exists(Ledger::$path.'.release'))exit(74);
        }
        if(Ledger::$mode==='unknown-add'){exit(75);}
        if(Ledger::$mode==='throw-after-add'){throw new RuntimeException('Uncertain destination outcome');}
        return $id;
    }
    function Login($login,$password,$remember,$original){
        Ledger::$data['login_calls']++;
        Ledger::$data['login_options']=[$login,$remember,$original];
        if(Ledger::$mode==='login-array')return ['TYPE'=>'ERROR','MESSAGE'=>$password];
        if(Ledger::$mode==='login-integer')return 1;
        if(Ledger::$mode==='login-string')return 'true';
        if(Ledger::$mode==='login-false')return false;
        return hash('sha256',$password)===(Ledger::$data['password_hash']??'');
    }
    function IsAuthorized(){return Ledger::$mode!=='not-authorized';}
    function IsAdmin(){return Ledger::$mode!=='not-admin';}
    function GetID(){return Ledger::$mode==='wrong-auth-id'?999:1;}
    function Update(...$args){Ledger::$data['forbidden_calls'][]='Update';throw new RuntimeException('FORBIDDEN_UPDATE');}
    function Delete(...$args){Ledger::$data['forbidden_calls'][]='Delete';throw new RuntimeException('FORBIDDEN_DELETE');}
    function Register(...$args){Ledger::$data['forbidden_calls'][]='Register';throw new RuntimeException('FORBIDDEN_REGISTER');}
    function SendPassword(...$args){Ledger::$data['forbidden_calls'][]='SendPassword';throw new RuntimeException('FORBIDDEN_SEND');}
    function SendUserInfo(...$args){Ledger::$data['forbidden_calls'][]='SendUserInfo';throw new RuntimeException('FORBIDDEN_SEND');}
}
class CEvent {static function Send(...$args){Ledger::$data['forbidden_calls'][]='Send';throw new RuntimeException('FORBIDDEN_SEND');}static function SendImmediate(...$args){self::Send(...$args);}}
Ledger::$path=$argv[2];Ledger::$mode=$argv[6];Ledger::$state=str_replace('\\','/',$argv[4]);
Ledger::$data=json_decode(file_get_contents(Ledger::$path),true,512,JSON_THROW_ON_ERROR);
register_shutdown_function(static function(){Ledger::save();});
set_exception_handler(static function($error){echo 'VENDOR_UNCAUGHT_ERROR';exit(0);});
if(Ledger::$mode!=='missing-prepend')define('UPGRADE_SANDBOX_PREPEND_ACTIVE',true);
$GLOBALS['admin_options']=['document-root'=>str_replace('\\','/',$argv[3]),'state-dir'=>Ledger::$state,'intent'=>Ledger::$state.'/admin-bootstrap/intent.json','intent-sha256'=>$argv[5]];
$USER=new CUser();
require $argv[1];
}
namespace Upgrade\AdminCompletion {
    function getopt($short,$long){return $GLOBALS['admin_options'];}
    function posix_geteuid(){return 1000;}
    function realpath($path){if($path==='/opt/upgrade/prepend.php')return $path;$result=\realpath($path);return $result===false?false:str_replace('\\','/',$result);}
    function lstat($path){
        $stat=\lstat($path);if($stat===false)return false;
        $stat['uid']=1000;$stat['nlink']=1;
        $stat['mode']=(\is_dir($path)?0040000|0700:0100000|0600);
        if(\Ledger::$mode==='insecure-secret'&&str_ends_with($path,'credentials.json'))$stat['mode']=0100000|0644;
        if(\Ledger::$mode==='foreign-intent-owner'&&str_ends_with($path,'intent.json'))$stat['uid']=1001;
        return $stat;
    }
    function ini_get($name){return $name==='auto_prepend_file'?'/opt/upgrade/prepend.php':($name==='disable_functions'?(\Ledger::$mode==='mail-enabled'?'exec,passthru,shell_exec,system,popen,proc_open':'mail,exec,passthru,shell_exec,system,popen,proc_open'):\ini_get($name));}
    function getenv($name){return match($name){'UPGRADE_DEMO'=>'1','UPGRADE_PROJECT_ID'=>'admin-review','UPGRADE_TARGET_ID'=>'target-admin-review',default=>\getenv($name)};}
    function mail(...$args){\Ledger::$data['forbidden_calls'][]='mail';throw new \RuntimeException('FORBIDDEN_SEND');}
    function flock($stream,$operation){if(\Ledger::$mode==='writer-busy')return false;return \flock($stream,$operation);}
    function rename($from,$to){
        if(\Ledger::$mode==='receipt-commit-error'&&str_ends_with($to,'receipt.json')){
            $record=json_decode(\file_get_contents($from),true);
            if(($record['state']??'')==='COMMITTED')return false;
        }
        return \rename($from,$to);
    }
}
`;

type Account = Record<string, unknown>;
type LedgerData = {
  users: Account[];
  groups: Record<string, number[]>;
  add_calls: number;
  login_calls: number;
  forbidden_calls: string[];
  password_hash?: string;
  added_fields?: Account;
  pending_seen_by_add?: boolean;
  password_fields_match?: boolean;
  login_options?: string[];
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-admin-completion-"));
  const web = join(directory, "web"), state = join(directory, "state"), privateDir = join(state, "admin-bootstrap");
  mkdirSync(join(web, "bitrix/modules/main/include"), { recursive: true });
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(web, "bitrix/modules/main/include/prolog_before.php"), "<?php \\Ledger::$data['bootstrap_calls']=(\\Ledger::$data['bootstrap_calls']??0)+1;\n");
  const script = join(directory, "contract.php"), ledgerPath = join(directory, "ledger.json"), receiptPath = join(privateDir, "receipt.json");
  writeFileSync(script, harness);
  const intent = { scope: "ISOLATED_FIRST_ADMIN", project: "admin-review", target: "target-admin-review", login: "upgrade.tech", email: "technical@example.test", name: "Upgrade", last_name: "Technical", xml_id: "upgrade:target-admin-review:technical-admin" };
  const raw = JSON.stringify(intent), secretRaw = JSON.stringify({ login: intent.login, email: intent.email, password });
  writeFileSync(join(privateDir, "intent.json"), raw);
  writeFileSync(join(privateDir, "credentials.json"), secretRaw);
  writeFileSync(ledgerPath, JSON.stringify({ users: [], groups: {}, add_calls: 0, login_calls: 0, forbidden_calls: [] }));
  return {
    intent,
    receiptPath,
    privateDir,
    lockedPath: ledgerPath + ".locked",
    releasePath: ledgerPath + ".release",
    start(mode: string) {
      assert.ok(php);
      return spawn(php, ["-n", script, resolve("infra/provisioning/complete-admin.php"), ledgerPath, web, state, sha(raw), mode], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    },
    run(mode = "normal", pin = sha(raw)) {
      assert.ok(php);
      return spawnSync(php, ["-n", script, resolve("infra/provisioning/complete-admin.php"), ledgerPath, web, state, pin, mode], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000 });
    },
    ledger: (): LedgerData & { bootstrap_calls?: number } => JSON.parse(readFileSync(ledgerPath, "utf8")),
    update(change: (data: LedgerData) => void) { const data: LedgerData = JSON.parse(readFileSync(ledgerPath, "utf8")); change(data); writeFileSync(ledgerPath, JSON.stringify(data)); },
    receipt: (): Record<string, unknown> => JSON.parse(readFileSync(receiptPath, "utf8")),
    pending() { writeFileSync(receiptPath, JSON.stringify({ state: "PENDING", intent_sha256: sha(raw), credential_sha256: sha(secretRaw) })); },
    ownUser(): Account { return { ID: "1", LOGIN: intent.login, EMAIL: intent.email, NAME: intent.name, LAST_NAME: intent.last_name, XML_ID: intent.xml_id, ACTIVE: "Y", EXTERNAL_AUTH_ID: "" }; },
    close() { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(basename(directory), /^upgrade-admin-completion-[A-Za-z0-9_-]+$/); rmSync(directory, { recursive: true, force: true }); },
  };
}

function receiptSuccess(result: ReturnType<ReturnType<typeof fixture>["run"]>) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, new RegExp(password));
  const value = JSON.parse(result.stdout);
  assert.equal(value.status, "ADMIN_AUTH_VERIFIED");
  assert.equal(value.readiness, "NOT_READY");
  assert.equal(value.installer_wizard, "NOT_EXECUTED");
  assert.equal(value.license_activation, "NOT_VERIFIED");
  assert.equal(value.browser_admin, "NOT_RUN");
  return value;
}

test("own admin helper: two PHP processes create once and freshly authenticate replay without sender/reset", { skip: !php }, () => {
  const f = fixture();
  try {
    const first = receiptSuccess(f.run());
    assert.equal(first.created, true);
    const second = receiptSuccess(f.run());
    assert.equal(second.created, false); assert.equal(second.reconciled, true);
    const data = f.ledger();
    assert.equal(data.users.length, 1); assert.equal(data.add_calls, 1); assert.equal(data.login_calls, 2);
    assert.equal(data.pending_seen_by_add, true); assert.equal(data.password_fields_match, true);
    assert.deepEqual(data.added_fields, { LOGIN: f.intent.login, EMAIL: f.intent.email, NAME: f.intent.name, LAST_NAME: f.intent.last_name, XML_ID: f.intent.xml_id, ACTIVE: "Y", GROUP_ID: [1] });
    assert.deepEqual(data.login_options, [f.intent.login, "N", "Y"]); assert.deepEqual(data.forbidden_calls, []);
    assert.equal(f.receipt().state, "COMMITTED"); assert.equal(f.receipt().user_id, 1);
    assert.doesNotMatch(readFileSync(f.receiptPath, "utf8"), new RegExp(password));
  } finally { f.close(); }
});

for (const mode of ["unknown-add", "throw-after-add", "receipt-commit-error"]) test(`own admin helper: ${mode} reconciles persisted account before retry`, { skip: !php }, () => {
  const f = fixture();
  try {
    const first = f.run(mode); assert.notEqual(first.status, 0);
    assert.equal(f.ledger().users.length, 1); assert.equal(f.receipt().state, "PENDING");
    const second = receiptSuccess(f.run()); assert.equal(second.created, false); assert.equal(second.reconciled, true);
    assert.equal(f.ledger().add_calls, 1); assert.equal(f.ledger().users.length, 1); assert.equal(f.receipt().state, "COMMITTED");
  } finally { f.close(); }
});

for (const mode of ["add-error", "vendor-exception", "uppercase-exception"]) test(`own admin helper: ${mode} cannot leak a secret or inherit vendor exit-zero handler`, { skip: !php }, () => {
  const f = fixture();
  try {
    const result = f.run(mode); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, new RegExp(password)); assert.doesNotMatch(result.stderr, /VENDOR/);
    assert.equal(JSON.parse(result.stderr).status, "ERROR"); assert.equal(f.receipt().state, "PENDING");
    assert.equal(f.ledger().users.length, 0); assert.deepEqual(f.ledger().forbidden_calls, []);
  } finally { f.close(); }
});

for (const mode of ["login-array", "login-integer", "login-string", "login-false", "not-authorized", "not-admin", "wrong-auth-id"]) test(`own admin helper: ${mode} cannot commit authentication`, { skip: !php }, () => {
  const f = fixture();
  try {
    const result = f.run(mode); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).reason, "ADMIN_AUTHENTICATION_FAILED"); assert.doesNotMatch(result.stderr, new RegExp(password));
    assert.equal(f.ledger().users.length, 1); assert.equal(f.receipt().state, "PENDING");
    receiptSuccess(f.run()); assert.equal(f.ledger().add_calls, 1);
  } finally { f.close(); }
});

for (const field of ["EMAIL", "NAME", "LAST_NAME", "XML_ID", "ACTIVE", "EXTERNAL_AUTH_ID", "GROUP_ID"]) test(`own admin helper: owned account ${field} drift is rejected without mutation`, { skip: !php }, () => {
  const f = fixture();
  try {
    receiptSuccess(f.run());
    f.update(data => { if (field === "GROUP_ID") data.groups["1"] = [2]; else data.users[0]![field] = field === "ACTIVE" ? "N" : "foreign-value"; });
    const before = f.ledger(), receipt = readFileSync(f.receiptPath, "utf8");
    const result = f.run(); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).reason, "EXISTING_ACCOUNT_CONFLICT");
    assert.deepEqual(f.ledger().users, before.users); assert.deepEqual(f.ledger().groups, before.groups);
    assert.equal(f.ledger().add_calls, before.add_calls); assert.equal(f.ledger().login_calls, before.login_calls);
    assert.deepEqual(f.ledger().forbidden_calls, []); assert.equal(readFileSync(f.receiptPath, "utf8"), receipt);
  } finally { f.close(); }
});

test("own admin helper: matching account without durable intent cannot be adopted", { skip: !php }, () => {
  const f = fixture();
  try {
    f.update(data => { data.users = [f.ownUser()]; data.groups = { "1": [1] }; });
    const result = f.run(); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).reason, "EXISTING_ACCOUNT_CONFLICT");
    assert.equal(f.ledger().add_calls, 0); assert.equal(f.ledger().login_calls, 0); assert.equal(existsSync(f.receiptPath), false);
  } finally { f.close(); }
});

for (const variant of ["foreign-user", "missing-committed-user", "different-user-id", "credential-change", "receipt-pin-change", "receipt-null", "receipt-array"]) test(`own admin helper: ${variant} cannot bypass receipt/identity binding`, { skip: !php }, () => {
  const f = fixture();
  try {
    if (variant === "foreign-user") f.update(data => { data.users = [{ ...f.ownUser(), LOGIN: "somebody.else" }]; });
    else if (variant === "receipt-null" || variant === "receipt-array") writeFileSync(f.receiptPath, variant === "receipt-null" ? "null" : "[]");
    else {
      receiptSuccess(f.run());
      if (variant === "missing-committed-user") f.update(data => { data.users = []; });
      if (variant === "different-user-id") f.update(data => { data.users[0]!.ID = "2"; data.groups["2"] = [1]; });
      if (variant === "credential-change") writeFileSync(join(f.privateDir, "credentials.json"), JSON.stringify({ login: f.intent.login, email: f.intent.email, password: password + "CHANGED" }));
      if (variant === "receipt-pin-change") writeFileSync(f.receiptPath, JSON.stringify({ ...f.receipt(), intent_sha256: "0".repeat(64) }));
    }
    const before = f.ledger(); const result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(f.ledger().add_calls, before.add_calls); assert.equal(f.ledger().login_calls, before.login_calls); assert.deepEqual(f.ledger().users, before.users); assert.deepEqual(f.ledger().forbidden_calls, []);
  } finally { f.close(); }
});

for (const mode of ["missing-prepend", "mail-enabled", "writer-busy", "insecure-secret", "foreign-intent-owner"]) test(`own admin helper: ${mode} stops before CMS bootstrap`, { skip: !php }, () => {
  const f = fixture();
  try {
    const result = f.run(mode); assert.equal(result.status, 1); assert.equal(f.ledger().bootstrap_calls ?? 0, 0);
    assert.equal(f.ledger().add_calls, 0); assert.equal(f.ledger().login_calls, 0); assert.equal(existsSync(f.receiptPath), false);
  } finally { f.close(); }
});

test("own admin helper: unaccepted intent bytes stop before bootstrap", { skip: !php }, () => {
  const f = fixture();
  try { const result = f.run("normal", "0".repeat(64)); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).reason, "ACCEPTED_INTENT_PIN_REQUIRED"); assert.equal(f.ledger().bootstrap_calls ?? 0, 0); }
  finally { f.close(); }
});

test("own admin helper: destination readback drift never reaches Login or COMMITTED", { skip: !php }, () => {
  const f = fixture();
  try { const result = f.run("readback-drift"); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).reason, "ADMIN_READBACK_FAILED"); assert.equal(f.ledger().login_calls, 0); assert.equal(f.receipt().state, "PENDING"); }
  finally { f.close(); }
});

test("own admin helper: actual competing PHP process cannot write under held target flock", { skip: !php, timeout: 15000 }, async () => {
  const f = fixture(), child = f.start("hold-add");
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const completion = new Promise<number | null>((accept, reject) => { child.once("error", reject); child.once("close", accept); });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(f.lockedPath) && Date.now() < deadline) await new Promise(accept => setTimeout(accept, 10));
    assert.ok(existsSync(f.lockedPath), "First process did not hold lock inside Add");
    const rival = f.run();
    assert.equal(rival.status, 1, rival.stdout + rival.stderr);
    assert.equal(JSON.parse(rival.stderr).reason, "TARGET_WRITER_BUSY");
    assert.equal(f.ledger().add_calls, 1);
    writeFileSync(f.releasePath, "release");
    assert.equal(await completion, 0, stdout + stderr);
    assert.equal(JSON.parse(stdout).status, "ADMIN_AUTH_VERIFIED");
    assert.equal(stderr, "");
    assert.equal(f.ledger().users.length, 1); assert.equal(f.ledger().add_calls, 1);
    assert.equal(f.receipt().state, "COMMITTED");
  } finally {
    writeFileSync(f.releasePath, "release");
    if (child.exitCode === null) child.kill();
    await completion;
    f.close();
  }
});
