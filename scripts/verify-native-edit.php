<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
final class UpgradeEditProofError extends RuntimeException {}
ini_set('display_errors','0'); ini_set('log_errors','0');
$finished=false; $phase='PREFLIGHT'; $level=ob_get_level();
ob_start(static fn(string $bytes):string=>'');
$finish=static function(array $result,int $code)use(&$finished,$level):never{
    $finished=true;while(ob_get_level()>$level)ob_end_clean();
    fwrite(STDOUT,json_encode($result,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR).PHP_EOL);exit($code);
};
register_shutdown_function(static function()use(&$finished,&$phase,$finish):void{if(!$finished)$finish(['status'=>'UNKNOWN','phase'=>$phase,'reason'=>'PROCESS_TERMINATED_RECONCILE_CURRENT_VALUE'],1);});
set_error_handler(static function():never{throw new UpgradeEditProofError('PHP_DIAGNOSTIC_REJECTED');});
function editNeed(bool $ok,string $reason):void{if(!$ok)throw new UpgradeEditProofError($reason);}
function editJson(mixed $value):string{return json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);}
function editHash(mixed $value):string{return hash('sha256',editJson($value));}
function editFile(string $file,?string $pin=null,int $cap=16777216):string{
    $file=str_replace('/',DIRECTORY_SEPARATOR,$file);
    editNeed(realpath($file)===$file&&!is_link($file)&&is_file($file),'CANONICAL_FILE_REQUIRED');$s=lstat($file);
    editNeed($s['nlink']===1&&$s['size']>0&&$s['size']<=$cap,'FILE_LIMIT_OR_LINK');
    $raw=file_get_contents($file);editNeed(is_string($raw)&&strlen($raw)===$s['size']&&($pin===null||hash_equals($pin,hash('sha256',$raw))),'FILE_PIN_MISMATCH');return $raw;
}
function editPrivate(string $path,bool $directory=false):void{
    $path=str_replace('/',DIRECTORY_SEPARATOR,$path);
    editNeed(realpath($path)===$path&&!is_link($path)&&($directory?is_dir($path):is_file($path)),'PRIVATE_PATH_INVALID');
    if(PHP_OS_FAMILY==='Linux'){$s=lstat($path);editNeed($s['uid']===33&&($s['mode']&0077)===0,'PRIVATE_UID33_MODE_REQUIRED');}
}
function editSyncDirectory(string $path):void{
    if(PHP_OS_FAMILY!=='Linux')return;
    $stream=fopen($path,'r');editNeed(is_resource($stream),'DIRECTORY_SYNC_OPEN_FAILED');
    try{editNeed(fsync($stream),'DIRECTORY_SYNC_FAILED');}finally{fclose($stream);}
}
function editWrite(string $file,array $value):string{
    $raw=editJson($value)."\n";$stream=fopen($file,'xb');editNeed(is_resource($stream),'EXCLUSIVE_RECEIPT_REQUIRED');
    try{editNeed(chmod($file,0600),'RECEIPT_MODE_FAILED');editNeed(fwrite($stream,$raw)===strlen($raw)&&fflush($stream)&&fsync($stream),'RECEIPT_DURABILITY_FAILED');}finally{fclose($stream);}
    editPrivate($file);editNeed(editFile($file) === $raw,'RECEIPT_READBACK_FAILED');editSyncDirectory(dirname($file));return hash('sha256',$raw);
}
function editEvent(string $dir,string $name,array $value):string{
    editPrivate($dir,true);return editWrite($dir.'/'.$name.'-'.bin2hex(random_bytes(12)).'.json',$value);
}
function editServiceSnapshot(array $o,array $entity):array{
    $db=\Bitrix\Main\Application::getConnection();$sql=$db->getSqlHelper();$q=static fn(string $v):string=>"'".$sql->forSql($v)."'";
    $one=static function(string $query)use($db):array{$result=$db->query($query);$row=$result->fetch();editNeed(is_array($row)&&!$result->fetch(),'SERVICE_ROW_NOT_UNIQUE');ksort($row);return $row;};
    $route=$one('SELECT * FROM ug_route WHERE PROJECT_ID='.$q($o['project']).' AND ROUTE_KEY='.$q(hash('sha256',$o['route'])));
    $mapping=$one('SELECT * FROM ug_entity WHERE PROJECT_ID='.$q($o['project']).' AND ENTITY_KEY='.$q($entity['stable_key']));
    editNeed($route['PROJECT_ID']===$o['project']&&$route['REQUEST_TARGET']===$o['route']&&$route['ENTITY_KEY']===$entity['stable_key']&&(int)$route['STATUS']===200&&$route['REDIRECT_TARGET']===null,'SERVICE_ROUTE_BINDING');
    editNeed($mapping['PROJECT_ID']===$o['project']&&$mapping['ENTITY_KEY']===$entity['stable_key']&&$mapping['ENTITY_TYPE']===$entity['type']&&$mapping['SOURCE_ID']===$entity['source_id']&&(int)$mapping['BITRIX_ID']===(int)$o['expected-id']&&preg_match('/\A[a-f0-9]{64}\z/D',$mapping['MANAGED_HASH'])===1&&$mapping['PAYLOAD_HASH']===editHash($entity),'SERVICE_MAPPING_BINDING');
    $counts=[];foreach(['ug_operation','b_user','b_sale_order','b_event']as$table){$row=$db->query('SELECT COUNT(*) AS C FROM '.$table.($table==='ug_operation'?' WHERE PROJECT_ID='.$q($o['project']):''))->fetch();$value=$row['C']??null;editNeed((is_int($value)||is_string($value))&&preg_match('/\A[0-9]{1,12}\z/D',(string)$value)===1,'SERVICE_COUNT_INVALID');$counts[$table]=(int)$value;}
    editNeed($counts['ug_operation']<=10000,'OPERATION_FINGERPRINT_LIMIT');$rows=$db->query('SELECT * FROM ug_operation WHERE PROJECT_ID='.$q($o['project']).' ORDER BY OPERATION_KEY LIMIT 10001');$operations=[];
    while($row=$rows->fetch()){editNeed(count($operations)<10000,'OPERATION_FINGERPRINT_LIMIT');ksort($row);$operations[]=$row;}editNeed(count($operations)===$counts['ug_operation'],'OPERATION_COUNT_CHANGED');
    return ['route'=>$route,'route_sha256'=>editHash($route),'mapping'=>$mapping,'mapping_sha256'=>editHash($mapping),'operations_sha256'=>editHash($operations),'counts'=>$counts];
}
function editSnapshot(array $o,array $entity):array{
    $route=\Upgrade\Core\Router::resolve($o['project'],$o['route']);
    editNeed(is_array($route)&&($route['REQUEST_TARGET']??null)===$o['route']&&(int)($route['STATUS']??0)===200&&(int)($route['BITRIX_ID']??0)===(int)$o['expected-id']&&($route['ENTITY_KEY']??null)===$entity['stable_key']&&($route['ENTITY_TYPE']??null)===$entity['type'],'ROUTE_ENTITY_BINDING');
    $content=\Upgrade\Core\Router::content((int)$o['expected-id']);
    editNeed(is_array($content)&&(int)$content['ID']===(int)$o['expected-id']&&$content['XML_ID']==='upgrade:'.$entity['stable_key']&&$content['ACTIVE']==='Y'&&(int)$content['IBLOCK_ID']>0,'ELEMENT_BINDING');
    $iblock=(int)$content['IBLOCK_ID'];
    $items=\CIBlockElement::GetList([],['IBLOCK_ID'=>$iblock,'=XML_ID'=>$content['XML_ID']],false,['nTopCount'=>2],['ID']);
    $one=$items->Fetch();editNeed(is_array($one)&&(int)$one['ID']===(int)$o['expected-id']&&!$items->Fetch(),'DUPLICATE_OR_MISSING_EXTERNAL_ID');
    $rows=\CIBlockElement::GetProperty($iblock,(int)$o['expected-id'],[],['CODE'=>'UG_H1']);$property=$rows->Fetch();
    editNeed(is_array($property)&&!$rows->Fetch()&&($property['PROPERTY_TYPE']??null)==='S'&&($property['MULTIPLE']??null)==='N'&&empty($property['USER_TYPE'])&&is_string($property['VALUE'])&&($property['DESCRIPTION']??'')==='','UG_H1_FORMAT_UNSUPPORTED');
    $properties=[];foreach(['UG_SEO_TITLE','UG_DESCRIPTION','UG_H1','UG_FACTS'] as $key){editNeed(is_string($content['UPGRADE_PROPERTIES'][$key]??null),'MANAGED_PROPERTY_MISSING');$properties[$key]=$content['UPGRADE_PROPERTIES'][$key];}
    editNeed($properties['UG_H1']===$property['VALUE'],'PROPERTY_READBACK_DISAGREES');
    $managed=[];foreach(['NAME','DETAIL_TEXT','DETAIL_TEXT_TYPE','PREVIEW_TEXT','PREVIEW_TEXT_TYPE'] as $key)$managed[$key]=(string)$content[$key];$managed['properties']=$properties;
    return ['id'=>(int)$content['ID'],'iblock_id'=>$iblock,'xml_id'=>$content['XML_ID'],'active'=>$content['ACTIVE'],'entity_key'=>$entity['stable_key'],'entity_type'=>$entity['type'],'route'=>$o['route'],'managed'=>$managed,'property_value_id'=>$property['PROPERTY_VALUE_ID']??null,'property_description'=>$property['DESCRIPTION']??'','service'=>editServiceSnapshot($o,$entity)];
}
function editWithoutH1(array $snapshot):array{unset($snapshot['property_value_id']);unset($snapshot['managed']['properties']['UG_H1']);return $snapshot;}
function editDryCheck(array $dry,array $package,array $entity,bool $edited):void{
    editNeed(($dry['blockers']??null)===[]&&($dry['created']??-1)===0&&($dry['updated']??-1)===0&&($dry['reconciled']??-1)===0,'UNEXPECTED_DRY_RUN_CHANGE');
    $conflicts=$dry['conflicts']??null;
    editNeed($edited?(is_array($conflicts)&&count($conflicts)===1&&($conflicts[0]['source_id']??null)===$entity['source_id']&&($conflicts[0]['reason']??null)==='USER_EDIT_CONFLICT:'.$entity['stable_key']):$conflicts===[],'EXPECTED_CONFLICT_NOT_CONFIRMED');
    editNeed(($dry['skipped']??-1)===count($package['entities'])-($edited?1:0),'DRY_RUN_SCOPE_MISMATCH');
}
try{
    $names=['command','project','target','document-root','package','manifest-sha256','route','expected-id','state-dir','proof-dir','prepend-file','prepend-sha256','intent-sha256'];$o=[];
    foreach(array_slice($argv,1) as $arg){editNeed(preg_match('/\A--([a-z][a-z0-9-]*)=(.+)\z/D',$arg,$m)===1&&in_array($m[1],$names,true)&&!isset($o[$m[1]]),'ARGUMENT_INVALID');$o[$m[1]]=$m[2];}
    $command=$o['command']??'';editNeed(in_array($command,['prepare','inspect','edit','restore'],true),'COMMAND_INVALID');
    editNeed(count($o)===($command==='prepare'?12:13)&&($command==='prepare'?!isset($o['intent-sha256']):isset($o['intent-sha256'])),'REQUIRED_ARGUMENT_MISSING');
    foreach(array_slice($names,0,12) as $name)editNeed(isset($o[$name]),'REQUIRED_ARGUMENT_MISSING');
    editNeed(preg_match('/\A[a-z0-9][a-z0-9-]{0,62}\z/D',$o['project'])===1&&preg_match('/\A[a-z0-9][a-z0-9-]{0,80}\z/D',$o['target'])===1&&preg_match('/\A[1-9][0-9]{0,9}\z/D',$o['expected-id'])===1,'IDENTITY_INVALID');
    editNeed(getenv('UPGRADE_DEMO')==='1'&&getenv('UPGRADE_PROJECT_ID')===$o['project']&&getenv('UPGRADE_TARGET_ID')===$o['target'],'DEMO_TARGET_BINDING');
    editNeed(function_exists('posix_geteuid')&&posix_geteuid()===33,'UID33_REQUIRED');
    editNeed(defined('UPGRADE_SANDBOX_PREPEND_ACTIVE')&&UPGRADE_SANDBOX_PREPEND_ACTIVE===true&&realpath((string)ini_get('auto_prepend_file'))===$o['prepend-file'],'PREPEND_GUARD');
    foreach(['manifest-sha256','prepend-sha256',...($command==='prepare'?[]:['intent-sha256'])] as $key)editNeed(preg_match('/\A[a-f0-9]{64}\z/D',$o[$key])===1,'SHA256_REQUIRED');
    editFile($o['prepend-file'],$o['prepend-sha256'],1048576);
    foreach(['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $function)editNeed(in_array($function,array_map('trim',explode(',',(string)ini_get('disable_functions'))),true)&&!function_exists($function),'FUNCTION_POLICY_REQUIRED');
    editNeed(!filter_var(ini_get('allow_url_fopen'),FILTER_VALIDATE_BOOLEAN)&&!filter_var(ini_get('allow_url_include'),FILTER_VALIDATE_BOOLEAN),'URL_POLICY_REQUIRED');
    foreach(['document-root','package','state-dir'] as $key)editNeed(realpath($o[$key])===$o[$key]&&is_dir($o[$key])&&!is_link($o[$key]),'CANONICAL_DIRECTORY_REQUIRED');
    $root=$o['document-root'];$proof=$o['proof-dir'];
    editNeed($o['state-dir']!==$root&&!str_starts_with($o['state-dir'],$root.DIRECTORY_SEPARATOR)&&realpath(dirname($proof))===dirname($proof)&&str_starts_with($proof,$o['state-dir'].DIRECTORY_SEPARATOR)&&preg_match('/\A[a-z0-9][a-z0-9-]{0,62}\z/D',basename($proof))===1,'PRIVATE_PROOF_DIRECTORY_REQUIRED');
    $manifest=json_decode(editFile($o['package'].'/manifest.json',$o['manifest-sha256'],4000000),true,128,JSON_THROW_ON_ERROR);
    editNeed(($manifest['project_id']??null)===$o['project']&&($manifest['blockers']??null)===[],'PACKAGE_PROJECT_OR_BLOCKERS');
    $reader=$o['package'].'/code/importer/package.php';editFile($reader,$manifest['files']['code/importer/package.php']??'missing',1048576);require $reader;
    $package=\Upgrade\Importer\Package::read($o['package'],$o['project'],$o['manifest-sha256']);
    \Upgrade\Importer\Package::target($o['route']);$matches=array_values(array_filter($package['routes'],static fn($r)=>$r['request_target']===$o['route']));
    editNeed(count($matches)===1&&$matches[0]['expected_status']===200,'PACKAGE_ROUTE_INVALID');
    $entities=array_values(array_filter($package['entities'],static fn($e)=>$e['stable_key']===$matches[0]['entity_key']));editNeed(count($entities)===1,'PACKAGE_ENTITY_INVALID');$entity=$entities[0];
    editNeed(!class_exists('Bitrix\\Main\\Application',false)&&!class_exists('Upgrade\\Core\\Gateway',false),'CMS_ALREADY_LOADED');
    foreach(['gateway','router','factsproperty','demotransport'] as $name)editFile($root.'/local/modules/upgrade.core/lib/'.$name.'.php',$manifest['files']['code/module/upgrade.core/lib/'.$name.'.php']??'missing',1048576);
    require $root.'/local/modules/upgrade.core/lib/demotransport.php';
    foreach(['NO_KEEP_STATISTIC','BX_CRONTAB','BX_CRONTAB_SUPPORT','NO_AGENT_CHECK','DisableEventsCheck','NOT_CHECK_PERMISSIONS'] as $constant){if(!defined($constant))define($constant,true);editNeed(constant($constant)===true,'BACKGROUND_POLICY_REQUIRED');}
    $_SERVER['DOCUMENT_ROOT']=$root;$_SERVER['HTTP_HOST']='edit-proof.invalid';$_SERVER['SCRIPT_NAME']='/local/upgrade-route.php';$_SERVER['PHP_SELF']='/local/upgrade-route.php';
    \Upgrade\Core\DemoTransport::isolateGlobals();$phase='CMS_BOOTSTRAP';require $root.'/bitrix/modules/main/include/prolog_before.php';
    editNeed(\Bitrix\Main\Loader::includeModule('iblock')&&\Bitrix\Main\Loader::includeModule('upgrade.core'),'MODULES_REQUIRED');
    // Keep this instance alive through every CMS read/write; it owns the importer filesystem lock.
    $gateway=new \Upgrade\Core\Gateway($o['project'],$o['state-dir']);$phase='LOCKED_READBACK';$current=editSnapshot($o,$entity);
    $binding=[];foreach(['project','target','document-root','package','manifest-sha256','route','expected-id','state-dir','proof-dir','prepend-file','prepend-sha256']as$key)$binding[$key]=$o[$key];
    $binding['script_sha256']=hash_file('sha256',__FILE__);
    if($command==='prepare'){
        editNeed(!file_exists($proof)&&!is_link($proof),'NEW_PROOF_DIRECTORY_REQUIRED');
        $dry=$gateway->dryRun($package);editDryCheck($dry,$package,$entity,false);
        editNeed(editSnapshot($o,$entity)===$current,'BASELINE_CHANGED_DURING_DRY_RUN');
        editNeed(hash_equals($current['service']['mapping']['MANAGED_HASH'],editHash($current['managed'])),'BASELINE_MANAGED_HASH_MISMATCH');
        $before=$current['managed']['properties']['UG_H1'];$after=$before.' [проверка редактирования '.basename($proof).']';
        editNeed($before!==''&&preg_match('//u',$before)===1&&strlen($after)<=512,'H1_SIZE_OR_ENCODING');
        editNeed(mkdir($proof,0700),'PROOF_DIRECTORY_CREATE_FAILED');editPrivate($proof,true);editSyncDirectory($proof);editSyncDirectory(dirname($proof));
        $original=['schema_version'=>1,'binding'=>$binding,'snapshot'=>$current,'managed_hash'=>editHash($current['managed']),'baseline_dry_run'=>$dry];
        $originalPin=editWrite($proof.'/original.json',$original);
        $intent=['schema_version'=>1,'kind'=>'single-ug-h1-edit-proof','binding'=>$binding,'original_sha256'=>$originalPin,'field'=>'UG_H1','before_sha256'=>hash('sha256',$before),'test_value'=>$after,'test_sha256'=>hash('sha256',$after)];
        $intentPin=editWrite($proof.'/intent.json',$intent);editEvent($proof,'prepared',['intent_sha256'=>$intentPin,'original_sha256'=>$originalPin]);
        $finish(['status'=>'PREPARED','intent_sha256'=>$intentPin,'original_sha256'=>$originalPin,'api_writes'=>0,'native_http'=>'NOT_RUN'],0);
    }
    editPrivate($proof,true);editPrivate($proof.'/intent.json');$intent=json_decode(editFile($proof.'/intent.json',$o['intent-sha256'],65536),true,64,JSON_THROW_ON_ERROR);
    editNeed(($intent['schema_version']??null)===1&&($intent['kind']??null)==='single-ug-h1-edit-proof'&&($intent['binding']??null)===$binding&&($intent['field']??null)==='UG_H1','INTENT_BINDING_MISMATCH');
    editPrivate($proof.'/original.json');$original=json_decode(editFile($proof.'/original.json',$intent['original_sha256']),true,128,JSON_THROW_ON_ERROR);
    editNeed(($original['schema_version']??null)===1&&($original['binding']??null)===$binding&&editHash($original['snapshot']['managed'])===$original['managed_hash'],'ORIGINAL_BINDING_MISMATCH');
    $before=$original['snapshot']['managed']['properties']['UG_H1'];$after=$intent['test_value'];
    editNeed(is_string($before)&&is_string($after)&&$before!==$after&&hash('sha256',$before)===$intent['before_sha256']&&hash('sha256',$after)===$intent['test_sha256']&&strlen($after)<=512,'INTENT_VALUES_INVALID');
    editNeed(editWithoutH1($current)===editWithoutH1($original['snapshot']),'OTHER_FIELDS_OR_IDENTITY_CHANGED');
    $value=$current['managed']['properties']['UG_H1'];$state=$value===$before?'ORIGINAL':($value===$after?'EDITED':'CONFLICT');
    if($command==='inspect'){
        $dry=$gateway->dryRun($package);if($state!=='CONFLICT')editDryCheck($dry,$package,$entity,$state==='EDITED');
        editNeed(editSnapshot($o,$entity)===$current,'READBACK_CHANGED_DURING_DRY_RUN');
        $receipt=editEvent($proof,'inspection',['intent_sha256'=>$o['intent-sha256'],'value_state'=>$state,'h1_sha256'=>hash('sha256',$value),'dry_run'=>$dry]);
        $finish(['status'=>$state,'h1_sha256'=>hash('sha256',$value),'receipt_sha256'=>$receipt,'dry_run'=>$dry,'api_writes'=>0,'native_http'=>'NOT_RUN'], $state==='CONFLICT'?3:0);
    }
    editNeed($state!=='CONFLICT',$command==='restore'?'RESTORE_CONFLICT':'EDIT_CONFLICT');
    $restoreIntent=$proof.'/restore-intent.json';
    if($command==='edit')editNeed(!file_exists($restoreIntent)&&!is_link($restoreIntent),'RESTORE_ALREADY_REQUESTED');
    else{
        $terminal=['schema_version'=>1,'intent_sha256'=>$o['intent-sha256'],'terminal_command'=>'restore'];
        if(file_exists($restoreIntent)||is_link($restoreIntent)){editPrivate($restoreIntent);editNeed(editFile($restoreIntent)===editJson($terminal)."\n",'RESTORE_INTENT_MISMATCH');}
        else editWrite($restoreIntent,$terminal);
    }
    $desired=$command==='edit'?$after:$before;$replayed=$value===$desired;
    if(!$replayed){
        $phase=strtoupper($command).'_REQUESTED';
        editEvent($proof,strtolower($phase),['intent_sha256'=>$o['intent-sha256'],'observed_sha256'=>hash('sha256',$value),'desired_sha256'=>hash('sha256',$desired)]);
        // Reconcile immediately before the one-field API call; never send a full property array.
        editNeed(editSnapshot($o,$entity)===$current,'COMPARE_BEFORE_WRITE_CHANGED');
        \CIBlockElement::SetPropertyValuesEx((int)$o['expected-id'],$current['iblock_id'],['UG_H1'=>$desired]);
    }
    $phase='POST_WRITE_READBACK';$actual=editSnapshot($o,$entity);
    editNeed($actual['managed']['properties']['UG_H1']===$desired&&editWithoutH1($actual)===editWithoutH1($original['snapshot']),'POST_WRITE_READBACK_FAILED_RECONCILE');
    $dry=$gateway->dryRun($package);editDryCheck($dry,$package,$entity,$command==='edit');
    editNeed(editSnapshot($o,$entity)===$actual,'READBACK_CHANGED_DURING_DRY_RUN');
    \CIBlock::clearIblockTagCache($actual['iblock_id']);
    $receipt=editEvent($proof,$command.'-confirmed',['intent_sha256'=>$o['intent-sha256'],'h1_sha256'=>hash('sha256',$desired),'managed_hash'=>editHash($actual['managed']),'replayed'=>$replayed,'dry_run'=>$dry]);
    $finish(['status'=>$command==='edit'?'EDIT_READBACK_CONFLICT_CONFIRMED':'RESTORED_READBACK_CONFIRMED','replayed'=>$replayed,'api_writes'=>$replayed?0:1,'receipt_sha256'=>$receipt,'h1_sha256'=>hash('sha256',$desired),'dry_run'=>$dry,'native_http'=>'NOT_RUN','full_reconcile'=>'REQUIRED_SEPARATELY'],0);
}catch(Throwable $e){$finish(['status'=>'ERROR','phase'=>$phase,'reason'=>$e instanceof UpgradeEditProofError?$e->getMessage():'FAILURE_REDACTED_RECONCILE_CURRENT_VALUE','native_http'=>'NOT_RUN'],1);}
