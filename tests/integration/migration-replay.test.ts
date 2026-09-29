import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const php = process.env.UPGRADE_PHP_BIN;
// Executes the own migration body with API doubles and namespaced runtime-policy
// adapters. This is a replay/error contract, not proof of a sandbox or Bitrix API.
const harness = String.raw`<?php
declare(strict_types=1);
namespace Bitrix\Main\DB { class DuplicateEntryException extends \RuntimeException {} }
namespace Bitrix\Main {
    class Loader { static function includeModule($name){return $name==='iblock';} }
    class Application { static function getConnection(){return new \Connection();} }
    class ModuleManager {
        static function isModuleInstalled($name){return \Ledger::$data['module'];}
        static function registerModule($name){
            \Ledger::$data['register_calls']++;
            if(\Ledger::$data['module']||\Ledger::$mode==='register-error') throw new \Bitrix\Main\DB\DuplicateEntryException("Duplicate entry 'upgrade.core' for key 'b_module.PRIMARY'");
            \Ledger::$data['module']=true;
        }
    }
}
namespace Bitrix\Main\Config { class Option { static function set(...$args){\Ledger::$data['option_writes']++;} } }
namespace {
class Ledger { static array $data=[]; static string $mode=''; }
class Rows { function __construct(private array $rows){} function Fetch(){return array_shift($this->rows)?:false;} }
class Connection {
    function getType(){return 'mysqli';}
    function isTableExists($name){return isset(Ledger::$data['tables'][$name]);}
    function getSqlHelper(){return new class{function forSql($s){return addslashes($s);}};}
    function query($sql){if(str_starts_with($sql,'SELECT * FROM ug_project'))return new Rows(Ledger::$data['project']?[['PROJECT_ID'=>'migration-review','IBLOCK_ID'=>1]]:[]);throw new RuntimeException('Unexpected query');}
    function queryExecute($sql){
        if(preg_match('/^CREATE TABLE (ug_[a-z]+) /',$sql,$match)){Ledger::$data['tables'][$match[1]]=true;return;}
        if(str_starts_with($sql,'INSERT INTO ug_project ')){if(Ledger::$data['project'])throw new RuntimeException('Duplicate project');Ledger::$data['project']=true;return;}
        throw new RuntimeException('Unexpected write');
    }
}
class CSite {
    public string $LAST_ERROR='Site update rejected by fixture';
    static function GetByID($id){return new Rows($id==='s1'?[['LID'=>'s1']]:[]);}
    function Update($id,$fields){Ledger::$data['site_updates']++;return Ledger::$mode!=='site-error';}
}
class CIBlockType {
    static function GetByID($id){return new Rows(Ledger::$data['type']?[['ID'=>$id]]:[]);}
    function Add($fields){Ledger::$data['type']=true;return $fields['ID'];}
}
class CIBlock {
    static function GetList($order,$filter){return new Rows(Ledger::$data['iblock']?[['ID'=>1]]:[]);}
    function Add($fields){Ledger::$data['iblock']++;if(Ledger::$data['iblock']!==1)throw new RuntimeException('Duplicate iblock');return 1;}
}
class CIBlockProperty {
    static function GetList($order,$filter){return new Rows(isset(Ledger::$data['properties'][$filter['CODE']])?[['CODE'=>$filter['CODE']]]:[]);}
    function Add($fields){Ledger::$data['properties'][$fields['CODE']]=true;return count(Ledger::$data['properties']);}
}
foreach(['CSite','CIBlockType','CIBlock','CIBlockProperty','RuntimeException'] as $name)class_alias($name,'MigrationContract\\'.$name);
Ledger::$mode=$argv[5];
Ledger::$data=is_file($argv[2])?json_decode(file_get_contents($argv[2]),true,512,JSON_THROW_ON_ERROR):['module'=>false,'register_calls'=>0,'tables'=>[],'type'=>false,'iblock'=>0,'properties'=>[],'project'=>false,'site_updates'=>0,'option_writes'=>0];
register_shutdown_function(static function() use($argv){file_put_contents($argv[2],json_encode(Ledger::$data,JSON_THROW_ON_ERROR));});
// Simulates the observed vendor handler: an uncaught error misleadingly exits zero.
set_exception_handler(static function($error){echo '<html>VENDOR_EXCEPTION_HANDLER</html>';exit(0);});
define('UPGRADE_SANDBOX_PREPEND_ACTIVE',true);
$GLOBALS['migration_options']=['document-root'=>$argv[3],'project'=>'migration-review','site'=>'s1','state-dir'=>$argv[4]];
$source=file_get_contents($argv[1]);
if(substr_count($source,'declare(strict_types=1);')!==1)throw new RuntimeException('Unexpected own migration syntax');
$source=str_replace('declare(strict_types=1);','declare(strict_types=1); namespace MigrationContract;',$source);
eval(preg_replace('/^<\?php\s*/','',$source));
}
namespace MigrationContract {
    function getopt($short,$long){return $GLOBALS['migration_options'];}
    function realpath($path){return $path==='/opt/upgrade/prepend.php'?$path:\realpath($path);}
    function ini_get($name){return $name==='auto_prepend_file'?'/opt/upgrade/prepend.php':($name==='disable_functions'?'mail,exec,passthru,shell_exec,system,popen,proc_open':\ini_get($name));}
    function getenv($name){return $name==='UPGRADE_DEMO'?'1':($name==='UPGRADE_PROJECT_ID'?'migration-review':\getenv($name));}
}
`;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-migration-replay-"));
  const web = join(directory, "web"),
    state = join(directory, "state");
  mkdirSync(join(web, "bitrix/modules/main/include"), { recursive: true });
  writeFileSync(
    join(web, "bitrix/modules/main/include/prolog_before.php"),
    "<?php // inert bootstrap fixture\n",
  );
  mkdirSync(state);
  const script = join(directory, "contract.php"),
    ledger = join(directory, "ledger.json");
  writeFileSync(script, harness);
  return {
    run(mode = "normal") {
      assert.ok(php);
      return spawnSync(
        php,
        [
          "-n",
          script,
          resolve("bitrix/migrations/install.php"),
          ledger,
          web,
          state,
          mode,
        ],
        { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000 },
      );
    },
    ledger: () => JSON.parse(readFileSync(ledger, "utf8")),
    close() {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.match(
        basename(directory),
        /^upgrade-migration-replay-[A-Za-z0-9_-]+$/,
      );
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test(
  "own migration contract: two processes keep one module, iblock, project and four properties",
  { skip: !php },
  () => {
    const f = fixture();
    try {
      for (let index = 0; index < 2; index++) {
        const result = f.run();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(result.stderr, "");
        const receipt = JSON.parse(result.stdout);
        assert.equal(receipt.status, "INSTALLED");
        assert.equal(receipt.iblock_id, 1);
        assert.equal(receipt.runtime_verification, "NOT_RUN");
      }
      const state = f.ledger();
      assert.equal(state.register_calls, 1);
      assert.equal(state.module, true);
      assert.equal(state.iblock, 1);
      assert.equal(state.project, true);
      assert.equal(Object.keys(state.properties).length, 4);
      assert.equal(Object.keys(state.tables).length, 4);
    } finally {
      f.close();
    }
  },
);

for (const mode of ["register-error", "site-error"])
  test(
    `own migration contract: ${mode} is JSON stderr and exit 1 despite vendor exception handler`,
    { skip: !php },
    () => {
      const f = fixture();
      try {
        const result = f.run(mode);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.equal(result.stdout, "");
        const error = JSON.parse(result.stderr);
        assert.equal(error.status, "ERROR");
        assert.equal(error.stage, "migration");
        assert.match(error.class, /Exception$/);
        assert.match(
          error.reason,
          mode === "register-error"
            ? /Duplicate entry/
            : /Site update rejected/,
        );
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /VENDOR_EXCEPTION_HANDLER/,
        );
      } finally {
        f.close();
      }
    },
  );
