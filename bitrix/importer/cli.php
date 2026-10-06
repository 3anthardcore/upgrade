<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli') { http_response_code(403); exit; }
require __DIR__.'/package.php';
$options=getopt('', ['command:','package:','project:','target-id:','manifest-sha256:','document-root:','owner:','fence:','state-dir:','backup-receipt:','backup-receipt-sha256:']);
$command=(string)($options['command']??'validate'); $project=(string)($options['project']??'');
try {
    // Validation occurs before Bitrix bootstrap or any target write.
    $package=\Upgrade\Importer\Package::read((string)($options['package']??''),$project,(string)($options['manifest-sha256']??''));
    if ($command==='validate') { echo json_encode(['status'=>'PACKAGE_VALID','blockers'=>$package['manifest']['blockers']],JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT).PHP_EOL; exit; }
    if (!in_array($command,['dry-run','claim','apply','reconcile'],true)) { throw new RuntimeException('UNKNOWN_COMMAND'); }
    if (isset($options['target-id']) && (!getenv('UPGRADE_TARGET_ID') || !hash_equals((string)getenv('UPGRADE_TARGET_ID'),(string)$options['target-id']))) { throw new RuntimeException('TARGET_ID_BINDING_MISMATCH'); }
    if (!defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') || UPGRADE_SANDBOX_PREPEND_ACTIVE!==true || realpath((string)ini_get('auto_prepend_file'))!=='/opt/upgrade/prepend.php') { throw new RuntimeException('ISOLATED_PHP_PREPEND_REQUIRED_BEFORE_BOOTSTRAP'); }
    $disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));
    foreach (['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $function) { if (!in_array($function,$disabled,true)) { throw new RuntimeException('DEMO_FUNCTION_POLICY_REQUIRED'); } }
    $root=realpath((string)($options['document-root']??'')); $state=realpath((string)($options['state-dir']??''));
    if (!$root||!$state||str_starts_with($state,$root.DIRECTORY_SEPARATOR)||$state===$root||getenv('UPGRADE_DEMO')!=='1'||getenv('UPGRADE_PROJECT_ID')!==$project) { throw new RuntimeException('ISOLATED_DEMO_AND_PRIVATE_STATE_REQUIRED'); }
    // Physical path conflicts must be resolved before any write. The dedicated demo index is the only explicit exception.
    foreach ($package['routes'] as $route) { $path=rawurldecode(explode('?',$route['request_target'],2)[0]); if ($path!=='/' && file_exists($root.$path)) { throw new RuntimeException('PHYSICAL_ROUTE_COLLISION:'.$route['request_target']); } }
    foreach (['NO_KEEP_STATISTIC','NOT_CHECK_PERMISSIONS','BX_CRONTAB','BX_CRONTAB_SUPPORT'] as $constant) { if (!defined($constant)) { define($constant,true); } }
    $_SERVER['DOCUMENT_ROOT']=$root;
    require $root.'/bitrix/modules/main/include/prolog_before.php';
    if (!\Bitrix\Main\Loader::includeModule('upgrade.core')) { throw new RuntimeException('UPGRADE_MODULE_NOT_INSTALLED'); }
    $gateway=new \Upgrade\Core\Gateway($project,$state);
    switch ($command) {
        case 'dry-run': $result=$gateway->dryRun($package); break;
        // Full bounded packages may require more than five minutes. The gateway
        // still checks this finite fence before/after each transaction and never
        // revives an expired owner; process death is reconciled before retry.
        case 'claim': $result=$gateway->claim((string)($options['owner']??''),3600); break;
        case 'reconcile': $result=$gateway->reconcile($package); break;
        case 'apply':
            $receiptFile=(string)($options['backup-receipt']??'');
            $receiptHash=(string)($options['backup-receipt-sha256']??'');
            if (!preg_match('/^[a-f0-9]{64}$/',$receiptHash)||!is_file($receiptFile)||!hash_equals($receiptHash,(string)hash_file('sha256',$receiptFile))) { throw new RuntimeException('ACCEPTED_BACKUP_RECEIPT_HASH_REQUIRED'); }
            $receipt=is_file($receiptFile)?json_decode((string)file_get_contents($receiptFile),true,512,JSON_THROW_ON_ERROR):null;
            $age=time()-(int)strtotime($receipt['created_at']??'');
            if (!getenv('UPGRADE_TARGET_ID')||($receipt['target_id']??'')!==getenv('UPGRADE_TARGET_ID')||$age<0||$age>86400) { throw new RuntimeException('CURRENT_TARGET_BACKUP_REQUIRED'); }
            if (!$receipt||($receipt['project_id']??'')!==$project||($receipt['status']??'')!=='INTEGRITY_VERIFIED'||!is_file((string)($receipt['database_file']??''))||!hash_equals((string)($receipt['database_sha256']??''),(string)hash_file('sha256',$receipt['database_file']))) { throw new RuntimeException('VERIFIED_DATABASE_BACKUP_REQUIRED'); }
            $result=$gateway->apply($package,(int)($options['fence']??0),(string)($options['owner']??''),$state); break;
    }
    $result['_target']=['project_id'=>$project,'target_id'=>(string)getenv('UPGRADE_TARGET_ID'),'manifest_sha256'=>$package['manifest_hash']];
    echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR).PHP_EOL;
} catch (Throwable $error) { fwrite(STDERR,json_encode(['status'=>'ERROR','reason'=>$error->getMessage()],JSON_UNESCAPED_UNICODE).PHP_EOL); exit(1); }
