<?php
declare(strict_types=1);
// Trusted, CLI-only probe before mounting CMS. Arguments name known reachable canaries, never source data.
if (PHP_SAPI !== 'cli' || $argc !== 4) { http_response_code(404); exit(2); }
$hostBridge = $argv[1]; $hostPublic = $argv[2]; $neighbor = $argv[3];
foreach ([$hostBridge, $hostPublic, $neighbor] as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) { exit(2); }
}
$cases = [
    ['target'=>'db', 'port'=>3306, 'expected'=>true, 'purpose'=>'own isolated database'],
    ['target'=>$hostBridge, 'port'=>22, 'expected'=>false, 'purpose'=>'host bridge SSH'],
    ['target'=>$hostPublic, 'port'=>443, 'expected'=>false, 'purpose'=>'host public HTTPS'],
    ['target'=>$neighbor, 'port'=>5432, 'expected'=>false, 'purpose'=>'neighbor database'],
    ['target'=>'1.1.1.1', 'port'=>443, 'expected'=>false, 'purpose'=>'public HTTPS canary'],
];
$disabled=[];
foreach (['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $function) { $disabled[$function]=!function_exists($function); }
$pass = defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') && ini_get('auto_prepend_file')==='/opt/upgrade/prepend.php' && !in_array(false,$disabled,true) && !ini_get('allow_url_fopen');
foreach ($cases as &$case) {
    $errno=0; $error='';
    $started=microtime(true);
    $socket=@fsockopen($case['target'], $case['port'], $errno, $error, 3);
    $case['connected']=is_resource($socket);
    if ($socket) { fclose($socket); }
    $case['errno']=$errno; $case['error']=$error; $case['elapsed_ms']=(int)round((microtime(true)-$started)*1000);
    $case['status']=$case['connected']===$case['expected'] ? 'PASS' : 'FAIL';
    $pass = $pass && $case['status']==='PASS';
}
unset($case);
$externalResolved=gethostbyname('example.org');
$dnsBlocked=$externalResolved==='example.org';
$pass=$pass && $dnsBlocked;
echo json_encode(['scope'=>'PRE_CMS_RUNTIME_ONLY','php_version'=>PHP_VERSION,'extensions'=>get_loaded_extensions(),
    'prepend_active'=>defined('UPGRADE_SANDBOX_PREPEND_ACTIVE'),'prepend_file'=>ini_get('auto_prepend_file'),
    'disabled_functions'=>$disabled,'allow_url_fopen'=>(bool)ini_get('allow_url_fopen'),
    'external_dns_resolution_failed'=>$dnsBlocked,'dns_packet_egress'=>'NOT_VERIFIED_BY_THIS_PROBE',
    'checks'=>$cases,'status'=>$pass?'PASS':'FAIL'], JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES),"\n";
exit($pass?0:1);
