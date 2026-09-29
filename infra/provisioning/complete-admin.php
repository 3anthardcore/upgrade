<?php
declare(strict_types=1);
namespace Upgrade\AdminCompletion;

// Own CLI only. API: CUser::Add, GetByLogin, GetCount, GetUserGroup and Login.
// A private pending record survives unknown Add outcomes. No password reset path.
final class CompletionError extends \RuntimeException {}
function need(bool $condition, string $reason): void {
    if (!$condition) { throw new CompletionError($reason); }
}
function privateFile(string $path, int $limit = 16384): string {
    $stat = lstat($path);
    need($stat !== false && ($stat['mode'] & 0170000) === 0100000
        && ($stat['mode'] & 0777) === 0600 && $stat['nlink'] === 1
        && $stat['uid'] === posix_geteuid() && $stat['size'] <= $limit,
        'PRIVATE_REGULAR_FILE_REQUIRED');
    $data = file_get_contents($path);
    need(is_string($data), 'PRIVATE_FILE_READ_FAILED');
    return $data;
}
function save(string $path, array $value): void {
    need(!is_link($path), 'RECEIPT_SYMLINK_REFUSED');
    $tmp = $path.'.pending-'.bin2hex(random_bytes(8));
    $stream = fopen($tmp, 'xb');
    need($stream !== false, 'RECEIPT_CREATE_FAILED');
    chmod($tmp, 0600);
    $bytes = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    need(fwrite($stream, $bytes) === strlen($bytes), 'RECEIPT_WRITE_FAILED');
    need(fflush($stream) && fsync($stream), 'RECEIPT_SYNC_FAILED');
    fclose($stream);
    need(rename($tmp, $path), 'RECEIPT_COMMIT_FAILED');
}
function identity(array $row, array $intent): bool {
    return ($row['LOGIN'] ?? null) === $intent['login']
        && ($row['EMAIL'] ?? null) === $intent['email']
        && ($row['NAME'] ?? null) === $intent['name']
        && ($row['LAST_NAME'] ?? null) === $intent['last_name']
        && ($row['XML_ID'] ?? null) === $intent['xml_id']
        && ($row['ACTIVE'] ?? null) === 'Y'
        && empty($row['EXTERNAL_AUTH_ID'])
        && in_array(1, array_map('intval', \CUser::GetUserGroup((int)$row['ID'])), true);
}

$level = ob_get_level();
ob_start();
try {
    need(PHP_SAPI === 'cli', 'CLI_ONLY');
    $options = getopt('', ['intent:', 'intent-sha256:', 'document-root:', 'state-dir:']);
    $root = realpath((string)($options['document-root'] ?? ''));
    $state = realpath((string)($options['state-dir'] ?? ''));
    need($root !== false && $state !== false && $state !== $root
        && !str_starts_with($state, $root.DIRECTORY_SEPARATOR), 'PRIVATE_STATE_REQUIRED');
    need(defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') && UPGRADE_SANDBOX_PREPEND_ACTIVE === true
        && realpath((string)ini_get('auto_prepend_file')) === '/opt/upgrade/prepend.php'
        && getenv('UPGRADE_DEMO') === '1', 'ISOLATED_PREPEND_REQUIRED');
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    foreach (['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $function) {
        need(in_array($function, $disabled, true), 'DEMO_FUNCTION_POLICY_REQUIRED');
    }
    $dir = $state.'/admin-bootstrap';
    $dirStat = lstat($dir);
    need($dirStat !== false && ($dirStat['mode'] & 0170000) === 0040000
        && ($dirStat['mode'] & 0777) === 0700 && $dirStat['uid'] === posix_geteuid()
        && realpath($dir) === $dir, 'PRIVATE_ADMIN_DIRECTORY_REQUIRED');
    need(($options['intent'] ?? '') === $dir.'/intent.json', 'FIXED_INTENT_PATH_REQUIRED');
    $raw = privateFile($dir.'/intent.json');
    $pin = (string)($options['intent-sha256'] ?? '');
    need(preg_match('/^[a-f0-9]{64}$/D', $pin) === 1 && hash_equals($pin, hash('sha256', $raw)), 'ACCEPTED_INTENT_PIN_REQUIRED');
    $intent = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    need(($intent['scope'] ?? '') === 'ISOLATED_FIRST_ADMIN'
        && ($intent['project'] ?? '') === getenv('UPGRADE_PROJECT_ID')
        && ($intent['target'] ?? '') === getenv('UPGRADE_TARGET_ID')
        && preg_match('/^[a-z0-9][a-z0-9-]{0,62}$/D', $intent['project']) === 1,
        'INTENT_TARGET_MISMATCH');
    foreach (['login','email','name','last_name','xml_id'] as $key) {
        need(is_string($intent[$key] ?? null) && trim($intent[$key]) !== '', 'IDENTITY_REQUIRED');
    }
    need(filter_var($intent['email'], FILTER_VALIDATE_EMAIL) !== false
        && preg_match('/^[a-zA-Z0-9._-]{3,64}$/D', $intent['login']) === 1
        && $intent['xml_id'] === 'upgrade:'.$intent['target'].':technical-admin', 'IDENTITY_INVALID');
    $secretRaw = privateFile($dir.'/credentials.json');
    $credentials = json_decode($secretRaw, true, 16, JSON_THROW_ON_ERROR);
    need(($credentials['login'] ?? '') === $intent['login']
        && ($credentials['email'] ?? '') === $intent['email']
        && is_string($credentials['password'] ?? null)
        && strlen($credentials['password']) >= 24, 'CREDENTIAL_BINDING_REQUIRED');
    $lockPath = $state.'/upgrade-'.$intent['project'].'.lock';
    need(!is_link($lockPath), 'WRITER_LOCK_SYMLINK_REFUSED');
    $lock = fopen($lockPath, 'c');
    need($lock !== false && flock($lock, LOCK_EX | LOCK_NB), 'TARGET_WRITER_BUSY');

    foreach (['NO_KEEP_STATISTIC','NOT_CHECK_PERMISSIONS','BX_CRONTAB','BX_CRONTAB_SUPPORT'] as $constant) {
        if (!defined($constant)) { define($constant, true); }
    }
    $_SERVER['DOCUMENT_ROOT'] = $root;
    require $root.'/bitrix/modules/main/include/prolog_before.php';
    $receiptPath = $dir.'/receipt.json';
    $existed = file_exists($receiptPath);
    $record = $existed ? json_decode(privateFile($receiptPath), true, 32, JSON_THROW_ON_ERROR) : null;
    need(!$existed || is_array($record), 'RECEIPT_BINDING_MISMATCH');
    if ($record !== null) {
        need(($record['intent_sha256'] ?? '') === $pin
            && ($record['credential_sha256'] ?? '') === hash('sha256', $secretRaw)
            && in_array($record['state'] ?? '', ['PENDING','COMMITTED'], true), 'RECEIPT_BINDING_MISMATCH');
    }
    $row = \CUser::GetByLogin($intent['login'])->Fetch();
    $created = false;
    if ($row) {
        need($record !== null && identity($row, $intent), 'EXISTING_ACCOUNT_CONFLICT');
        need(!isset($record['user_id']) || (int)$record['user_id'] === (int)$row['ID'], 'USER_ID_CONFLICT');
    } else {
        need($record === null || ($record['state'] === 'PENDING' && !isset($record['user_id'])), 'EXPECTED_ACCOUNT_MISSING');
        need((int)\CUser::GetCount() === 0, 'FIRST_ADMIN_REQUIRES_EMPTY_USERS');
        $record = ['state'=>'PENDING','intent_sha256'=>$pin,'credential_sha256'=>hash('sha256', $secretRaw),'created_at'=>gmdate('c')];
        save($receiptPath, $record); // Durable intent BEFORE the first destination write.
        $user = new \CUser();
        $id = $user->Add(['LOGIN'=>$intent['login'],'EMAIL'=>$intent['email'],
            'NAME'=>$intent['name'],'LAST_NAME'=>$intent['last_name'],'XML_ID'=>$intent['xml_id'],
            'ACTIVE'=>'Y','GROUP_ID'=>[1],'PASSWORD'=>$credentials['password'],
            'CONFIRM_PASSWORD'=>$credentials['password']]);
        need((int)$id > 0, 'ADMIN_ADD_FAILED'); // Do not print vendor error text containing credentials.
        $row = \CUser::GetByLogin($intent['login'])->Fetch();
        need(is_array($row) && (int)$row['ID'] === (int)$id && identity($row, $intent), 'ADMIN_READBACK_FAILED');
        $created = true;
    }
    // COMMITTED is not trusted without a fresh destination and password check.
    global $USER;
    $auth = $USER->Login($intent['login'], $credentials['password'], 'N', 'Y');
    need($auth === true && $USER->IsAuthorized() && $USER->IsAdmin()
        && (int)$USER->GetID() === (int)$row['ID'], 'ADMIN_AUTHENTICATION_FAILED');
    $record['state'] = 'COMMITTED';
    $record['user_id'] = (int)$row['ID'];
    $record['verified_at'] = gmdate('c');
    save($receiptPath, $record);
    $result = ['status'=>'ADMIN_AUTH_VERIFIED','user_id'=>(int)$row['ID'],
        'login'=>$intent['login'],'email'=>$intent['email'],'created'=>$created,
        'reconciled'=>$existed && !$created,'user_count'=>(int)\CUser::GetCount(),
        'administrator'=>true,'authentication'=>'CUser::Login','remember'=>'N',
        'intent_sha256'=>$pin,'installer_wizard'=>'NOT_EXECUTED',
        'license_activation'=>'NOT_VERIFIED','browser_admin'=>'NOT_RUN',
        'readiness'=>'NOT_READY'];
    while (ob_get_level() > $level) { ob_end_clean(); }
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE).PHP_EOL;
} catch (\Throwable $error) {
    while (ob_get_level() > $level) { ob_end_clean(); }
    $reason = $error instanceof CompletionError
        ? $error->getMessage() : 'ADMIN_COMPLETION_FAILED_RECONCILE_BEFORE_RETRY';
    fwrite(STDERR, json_encode(['status'=>'ERROR','reason'=>$reason]).PHP_EOL);
    exit(1);
}
