<?php
declare(strict_types=1);

// Own CLI diagnostics only. A fixture can satisfy the contract, so native proof
// requires a separately attested real CMS deployment and before/after counts.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
final class UpgradeTransportProbeFailure extends RuntimeException {}
ini_set('display_errors', '0');
ini_set('log_errors', '0');
$probeFinished = false;
$probeStage = 'PREFLIGHT';
$probeBootstrap = false;
$probeBufferLevel = ob_get_level();
ob_start(static function (string $bytes): string { return ''; });
$probeFinish = static function (array $result, int $code) use (&$probeFinished, $probeBufferLevel): never {
    $probeFinished = true;
    while (ob_get_level() > $probeBufferLevel) { ob_end_clean(); }
    fwrite(STDOUT, json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR).PHP_EOL);
    exit($code);
};
register_shutdown_function(static function () use (&$probeFinished, &$probeStage, &$probeBootstrap, $probeFinish): void {
    if (!$probeFinished) {
        $probeFinish(['schema_version'=>1, 'status'=>'ERROR', 'reason'=>'PROCESS_TERMINATED',
            'stage'=>$probeStage, 'cms_bootstrap_attempted'=>$probeBootstrap,
            'counts_status'=>$probeStage === 'READ_ONLY_COUNTS' ? 'NOT_VERIFIED' : 'NOT_RUN'], 1);
    }
});
set_error_handler(static function (): never { throw new UpgradeTransportProbeFailure('PHP_DIAGNOSTIC_REJECTED'); });

function upgradeTransportProbeNeed(bool $condition, string $code): void
{
    if (!$condition) { throw new UpgradeTransportProbeFailure($code); }
}
function upgradeTransportProbeFile(string $path, ?string $sha = null): string
{
    $actual = realpath($path);
    upgradeTransportProbeNeed($actual !== false && $actual === $path && is_file($path) && !is_link($path), 'CANONICAL_REGULAR_FILE_REQUIRED');
    $stat = lstat($path);
    upgradeTransportProbeNeed(is_array($stat) && $stat['nlink'] === 1 && $stat['size'] > 0 && $stat['size'] <= 1048576, 'BOUNDED_SINGLE_LINK_FILE_REQUIRED');
    $digest = hash_file('sha256', $path);
    upgradeTransportProbeNeed(is_string($digest) && ($sha === null || hash_equals($sha, $digest)), 'FILE_SHA256_MISMATCH');
    return $digest;
}

try {
    $allowed = ['project', 'target', 'document-root', 'transport-sha256', 'prepend-file', 'prepend-sha256'];
    $options = [];
    foreach (array_slice($argv, 1) as $argument) {
        upgradeTransportProbeNeed(preg_match('/\A--([a-z][a-z0-9-]*)=(.+)\z/D', $argument, $match) === 1, 'ARGUMENT_INVALID');
        upgradeTransportProbeNeed(in_array($match[1], $allowed, true) && !array_key_exists($match[1], $options), 'ARGUMENT_UNKNOWN_OR_DUPLICATE');
        $options[$match[1]] = $match[2];
    }
    upgradeTransportProbeNeed(count($options) === count($allowed), 'REQUIRED_ARGUMENT_MISSING');
    $project = $options['project']; $target = $options['target']; $root = $options['document-root'];
    upgradeTransportProbeNeed(preg_match('/\A[a-z0-9][a-z0-9-]{0,62}\z/D', $project) === 1
        && preg_match('/\A[a-z0-9][a-z0-9-]{0,80}\z/D', $target) === 1, 'PROJECT_OR_TARGET_INVALID');
    upgradeTransportProbeNeed(getenv('UPGRADE_DEMO') === '1' && getenv('UPGRADE_PROJECT_ID') === $project
        && getenv('UPGRADE_TARGET_ID') === $target, 'DEMO_PROJECT_TARGET_BINDING_REQUIRED');
    upgradeTransportProbeNeed(realpath($root) === $root && is_dir($root) && !is_link($root), 'CANONICAL_DOCUMENT_ROOT_REQUIRED');
    foreach (['transport-sha256', 'prepend-sha256'] as $key) {
        upgradeTransportProbeNeed(preg_match('/\A[a-f0-9]{64}\z/D', $options[$key]) === 1, 'SHA256_PIN_REQUIRED');
    }
    upgradeTransportProbeNeed(defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') && UPGRADE_SANDBOX_PREPEND_ACTIVE === true
        && realpath((string)ini_get('auto_prepend_file')) === $options['prepend-file'], 'PREPEND_REALPATH_GUARD_REQUIRED');
    upgradeTransportProbeFile($options['prepend-file'], $options['prepend-sha256']);
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    foreach (['mail', 'exec', 'passthru', 'shell_exec', 'system', 'popen', 'proc_open'] as $function) {
        upgradeTransportProbeNeed(in_array($function, $disabled, true) && !function_exists($function), 'DISABLED_FUNCTION_POLICY_REQUIRED');
    }
    upgradeTransportProbeNeed(!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)
        && !filter_var(ini_get('allow_url_include'), FILTER_VALIDATE_BOOLEAN), 'URL_STREAM_POLICY_REQUIRED');
    upgradeTransportProbeNeed(!class_exists('Bitrix\\Main\\Application', false)
        && !class_exists('Upgrade\\Core\\DemoTransport', false), 'CONTEXT_OR_HELPER_ALREADY_LOADED');
    $helper = $root.DIRECTORY_SEPARATOR.'local'.DIRECTORY_SEPARATOR.'modules'.DIRECTORY_SEPARATOR.'upgrade.core'.DIRECTORY_SEPARATOR.'lib'.DIRECTORY_SEPARATOR.'demotransport.php';
    $prolog = $root.DIRECTORY_SEPARATOR.'bitrix'.DIRECTORY_SEPARATOR.'modules'.DIRECTORY_SEPARATOR.'main'.DIRECTORY_SEPARATOR.'include'.DIRECTORY_SEPARATOR.'prolog_before.php';
    upgradeTransportProbeFile($helper, $options['transport-sha256']);
    $prologSha = upgradeTransportProbeFile($prolog);
    foreach (['NO_KEEP_STATISTIC', 'BX_CRONTAB', 'BX_CRONTAB_SUPPORT', 'NO_AGENT_CHECK', 'DisableEventsCheck'] as $constant) {
        if (!defined($constant)) { define($constant, true); }
        upgradeTransportProbeNeed(constant($constant) === true, 'DISABLED_BACKGROUND_WORK_REQUIRED');
    }
    require $helper;
    upgradeTransportProbeFile($helper, $options['transport-sha256']);

    $probeStage = 'TRANSPORT_ISOLATION';
    $query = 'bx_hit_hash=synthetic_probe&x=1&x=2&empty=&encoded=%2F';
    $getTarget = '/__upgrade/cart?'.$query;
    $postTarget = '/__upgrade/action';
    $body = 'AUTH_FORM=Y&TYPE=REGISTRATION&USER_LOGIN=synthetic_transport_probe&csrf=synthetic_only';
    $common = ['DOCUMENT_ROOT'=>$root, 'HTTP_HOST'=>'transport-probe.invalid', 'HTTPS'=>'on', 'SERVER_PORT'=>'443',
        'SERVER_NAME'=>'transport-probe.invalid', 'SCRIPT_NAME'=>'/local/upgrade-route.php',
        'SCRIPT_FILENAME'=>$root.'/local/upgrade-route.php', 'PHP_SELF'=>'/local/upgrade-route.php',
        'SERVER_PROTOCOL'=>'HTTP/1.1', 'REMOTE_ADDR'=>'127.0.0.1', 'QUERY_STRING'=>$query,
        'UPGRADE_ORIGIN'=>'https://transport-probe.invalid', 'CONTENT_TYPE'=>'application/x-www-form-urlencoded',
        'UPGRADE_COOKIE_HEADER'=>'PHPSESSID=synthetic_only; upgrade_demo_session='.str_repeat('a', 64),
        'HTTP_COOKIE'=>'PHPSESSID=synthetic_only', 'HTTP_AUTHORIZATION'=>'Basic synthetic_only',
        'PHP_AUTH_USER'=>'synthetic_only', 'PHP_AUTH_PW'=>'synthetic_only'];
    $ownGet = \Upgrade\Core\DemoTransport::capture($common + ['REQUEST_METHOD'=>'GET', 'REQUEST_URI'=>$getTarget], '');
    $_SERVER = $common + ['REQUEST_METHOD'=>'POST', 'REQUEST_URI'=>$postTarget, 'CONTENT_LENGTH'=>(string)strlen($body)];
    $_GET = ['bx_hit_hash'=>'synthetic_probe'];
    $_POST = ['AUTH_FORM'=>'Y', 'TYPE'=>'REGISTRATION', 'USER_LOGIN'=>'synthetic_transport_probe'];
    $_REQUEST = $_GET + $_POST; $_COOKIE = ['PHPSESSID'=>'synthetic_only']; $_FILES = ['synthetic'=>['tmp_name'=>'inert_only']];
    $ownPost = \Upgrade\Core\DemoTransport::capture($_SERVER, $body);
    \Upgrade\Core\DemoTransport::isolateGlobals();
    upgradeTransportProbeNeed($ownGet['request_target'] === $getTarget && $ownGet['method'] === 'GET' && $ownGet['body'] === ''
        && $ownPost['request_target'] === $postTarget && $ownPost['method'] === 'POST' && $ownPost['body'] === $body
        && $ownPost['cookie'] === str_repeat('a', 64), 'OWN_REQUEST_NOT_PRESERVED');
    upgradeTransportProbeNeed($_GET === [] && $_POST === [] && $_REQUEST === [] && $_COOKIE === [] && $_FILES === []
        && $_SERVER['REQUEST_METHOD'] === 'GET' && $_SERVER['REQUEST_URI'] === '/local/upgrade-route.php'
        && $_SERVER['QUERY_STRING'] === '', 'GLOBALS_NOT_NEUTRAL');
    foreach (['HTTP_COOKIE', 'HTTP_AUTHORIZATION', 'PHP_AUTH_USER', 'PHP_AUTH_PW', 'CONTENT_TYPE', 'CONTENT_LENGTH'] as $key) {
        upgradeTransportProbeNeed(!isset($_SERVER[$key]), 'GLOBAL_AUTH_OR_BODY_HEADER_REMAINED');
    }

    $probeStage = 'CMS_BOOTSTRAP'; $probeBootstrap = true;
    require $prolog;
    $probeStage = 'D7_REQUEST_CONTEXT';
    $request = \Bitrix\Main\Application::getInstance()->getContext()->getRequest();
    $context = ['query_count'=>count($request->getQueryList()->toArray()), 'post_count'=>count($request->getPostList()->toArray()),
        'cookie_count'=>count($request->getCookieList()->toArray()), 'method'=>$request->getRequestMethod(), 'uri'=>$request->getRequestUri()];
    upgradeTransportProbeNeed($context === ['query_count'=>0, 'post_count'=>0, 'cookie_count'=>0, 'method'=>'GET', 'uri'=>'/local/upgrade-route.php'], 'CMS_CONTEXT_NOT_NEUTRAL');
    upgradeTransportProbeNeed($ownGet['request_target'] === $getTarget && $ownPost['request_target'] === $postTarget
        && $ownPost['body'] === $body, 'OWN_REQUEST_CHANGED_AFTER_BOOTSTRAP');
    $probeStage = 'READ_ONLY_COUNTS';
    $connection = \Bitrix\Main\Application::getConnection();
    $counts = [];
    foreach (['b_user', 'b_sale_order', 'b_event'] as $table) {
        $row = $connection->query('SELECT COUNT(*) AS C FROM '.$table)->fetch();
        $value = $row['C'] ?? null;
        upgradeTransportProbeNeed((is_int($value) && $value >= 0) || (is_string($value) && preg_match('/\A[0-9]{1,12}\z/D', $value) === 1), 'COUNT_RESULT_INVALID');
        upgradeTransportProbeNeed((float)$value <= 1000000000000, 'COUNT_RESULT_OUT_OF_RANGE');
        $counts[$table] = (int)$value;
    }
    $probeFinish(['schema_version'=>1, 'status'=>'CHECKS_PASSED', 'project_id'=>$project, 'target_id'=>$target,
        'execution_scope'=>'CLI_CMS_CONTEXT_PROBE', 'effective_uid'=>function_exists('posix_geteuid') ? posix_geteuid() : null,
        'transport_sha256'=>$options['transport-sha256'], 'prepend_sha256'=>$options['prepend-sha256'], 'prolog_sha256'=>$prologSha,
        'cms_bootstrap_attempted'=>true, 'cms_bootstrap_completed'=>true, 'context'=>$context,
        'own_request'=>['get_target_sha256'=>hash('sha256', $getTarget), 'post_target_sha256'=>hash('sha256', $postTarget),
            'post_body_sha256'=>hash('sha256', $body), 'exact_preserved'=>true],
        'counts_status'=>'READ_ONLY_SNAPSHOT', 'counts'=>$counts, 'before_after_comparison'=>'NOT_PERFORMED',
        'native_deployment_attestation'=>'REQUIRED_SEPARATELY', 'readiness'=>'NOT_EVALUATED'], 0);
} catch (Throwable $error) {
    $reason = $error instanceof UpgradeTransportProbeFailure && preg_match('/\A[A-Z][A-Z0-9_]{2,80}\z/D', $error->getMessage()) === 1
        ? $error->getMessage() : 'PROBE_FAILURE_REDACTED';
    $probeFinish(['schema_version'=>1, 'status'=>'ERROR', 'reason'=>$reason, 'stage'=>$probeStage,
        'cms_bootstrap_attempted'=>$probeBootstrap, 'counts_status'=>$probeStage === 'READ_ONLY_COUNTS' ? 'NOT_VERIFIED' : 'NOT_RUN',
        'readiness'=>'NOT_EVALUATED'], 1);
}
