<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once __DIR__.'/../module/upgrade.core/lib/cataloggateway.php';
use Upgrade\Core\CatalogGateway;
use Upgrade\Core\CatalogError;
use Upgrade\Core\NativeCatalogPort;

/** Pinned standalone seam; the general dispatcher does not call this automatically. */
function catalogPinnedJson(string $path,string $hash,int $limit): array
{
    CatalogGateway::need(preg_match('/^[a-f0-9]{64}$/D',$hash)===1&&is_file($path)&&!is_link($path),'CATALOG_PINNED_FILE_REQUIRED');
    $h=fopen($path,'rb');CatalogGateway::need(is_resource($h),'CATALOG_FILE_OPEN_FAILED');try{$stat=fstat($h);CatalogGateway::need($stat&&$stat['size']>0&&$stat['size']<=$limit,'CATALOG_FILE_SIZE_INVALID');$raw=stream_get_contents($h,$limit+1);CatalogGateway::need(is_string($raw)&&strlen($raw)===$stat['size']&&hash_equals($hash,hash('sha256',$raw)),'CATALOG_FILE_HASH_MISMATCH');}finally{fclose($h);}
    $data=json_decode($raw,true,128,JSON_THROW_ON_ERROR);CatalogGateway::need(is_array($data),'CATALOG_JSON_OBJECT_REQUIRED');return $data;
}
try{
    $options=getopt('',['command:','catalog-file:','catalog-sha256:','profile-file:','profile-sha256:','project:','target-id:','document-root:','state-dir:','owner:','fence:','backup-receipt:','backup-receipt-sha256:']);
    foreach($options as $v)CatalogGateway::need(is_string($v),'CATALOG_DUPLICATE_OR_MISSING_ARGUMENT');
    $projection=catalogPinnedJson($options['catalog-file']??'',$options['catalog-sha256']??'',67108864);$profile=catalogPinnedJson($options['profile-file']??'',$options['profile-sha256']??'',65536);CatalogGateway::validate($projection,$profile);
    CatalogGateway::need(($options['project']??null)===$projection['project_id']&&($options['target-id']??null)===$projection['target_id'],'CATALOG_COMMAND_BINDING_MISMATCH');
    $command=$options['command']??'validate';CatalogGateway::need(in_array($command,['validate','claim','setup','dry-run','apply','reconcile'],true),'CATALOG_COMMAND_UNKNOWN');
    if($command==='validate'){$result=['status'=>'CATALOG_PROJECTION_VALID','products'=>count($projection['products']),'categories'=>count($projection['categories']),'runtime_verification'=>'NOT_RUN'];}
    else{
        CatalogGateway::need(defined('UPGRADE_SANDBOX_PREPEND_ACTIVE')&&UPGRADE_SANDBOX_PREPEND_ACTIVE===true&&realpath((string)ini_get('auto_prepend_file'))==='/opt/upgrade/prepend.php','ISOLATED_PHP_PREPEND_REQUIRED_BEFORE_BOOTSTRAP');
        $disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));foreach(['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $f)CatalogGateway::need(in_array($f,$disabled,true),'DEMO_FUNCTION_POLICY_REQUIRED');
        $root=realpath($options['document-root']??'');$state=realpath($options['state-dir']??'');CatalogGateway::need($root!==false&&$state!==false&&!is_link($options['state-dir']??'')&&$root!==$state&&!str_starts_with($state,$root.DIRECTORY_SEPARATOR)&&getenv('UPGRADE_DEMO')==='1'&&getenv('UPGRADE_PROJECT_ID')===$projection['project_id']&&getenv('UPGRADE_TARGET_ID')===$projection['target_id'],'CATALOG_PRIVATE_TARGET_BINDING_REQUIRED');
        if(PHP_OS_FAMILY!=='Windows')CatalogGateway::need((fileperms($state)&0077)===0&&function_exists('posix_geteuid')&&fileowner($state)===posix_geteuid(),'CATALOG_PRIVATE_STATE_PERMISSIONS');
        if(in_array($command,['apply','setup'],true)){
            $receipt=catalogPinnedJson($options['backup-receipt']??'',$options['backup-receipt-sha256']??'',1048576);$age=time()-(int)strtotime($receipt['created_at']??'');CatalogGateway::need(($receipt['project_id']??null)===$projection['project_id']&&($receipt['target_id']??null)===$projection['target_id']&&($receipt['status']??null)==='INTEGRITY_VERIFIED'&&$age>=0&&$age<=86400,'CATALOG_CURRENT_BACKUP_REQUIRED');$sql=$receipt['database_file']??'';CatalogGateway::need(is_string($sql)&&is_file($sql)&&!is_link($sql)&&isset($receipt['database_sha256'])&&hash_equals($receipt['database_sha256'],(string)hash_file('sha256',$sql)),'CATALOG_BACKUP_DATABASE_HASH_MISMATCH');
        }
        foreach(['NO_KEEP_STATISTIC','NOT_CHECK_PERMISSIONS','BX_CRONTAB','BX_CRONTAB_SUPPORT'] as $constant)if(!defined($constant))define($constant,true);
        $_SERVER['DOCUMENT_ROOT']=$root;$_GET=$_POST=$_REQUEST=$_COOKIE=$_FILES=[];$_SERVER['REQUEST_METHOD']='GET';$_SERVER['QUERY_STRING']='';$_SERVER['REQUEST_URI']='/local/upgrade-route.php';
        require $root.'/bitrix/modules/main/include/prolog_before.php';
        $port=new NativeCatalogPort($profile,$state,$projection['content_manifest_sha256']);$owner=$options['owner']??'';$fenceText=$options['fence']??'0';CatalogGateway::need(preg_match('/^(0|[1-9]\d{0,15})$/D',$fenceText)===1,'CATALOG_FENCE_INVALID');$fence=(int)$fenceText;
        if($command==='claim')$result=$port->claim($owner);
        elseif($command==='setup')$result=$port->setup($fence,$owner);
        else{$gateway=new CatalogGateway($port,$projection,$profile,$state);$result=match($command){'dry-run'=>$gateway->dryRun(),'apply'=>$gateway->apply($fence,$owner),'reconcile'=>$gateway->reconcile()};}
    }
    $result['_binding']=['project_id'=>$projection['project_id'],'target_id'=>$projection['target_id'],'catalog_sha256'=>$options['catalog-sha256'],'profile_sha256'=>$options['profile-sha256'],'content_manifest_sha256'=>$projection['content_manifest_sha256'],'model_sha256'=>$projection['model_sha256']];echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR).PHP_EOL;
    if(($result['status']??null)==='FAIL'||($result['conflicts']??[]))exit(2);
}catch(Throwable $error){fwrite(STDERR,json_encode(['status'=>'ERROR','reason'=>$error instanceof CatalogError?$error->getMessage():'CATALOG_OPERATION_FAILED_OR_UNKNOWN'],JSON_UNESCAPED_UNICODE).PHP_EOL);exit(1);}
