<?php
/** Private, temporary operator entry for the already-started official wizard.
 * API: https://dev.1c-bitrix.ru/api_help/main/general/wizards/api/cwizardbase/setcurrentstep.php
 * Remove this own entry and its exact Nginx location after installation.
 */
if (PHP_SAPI === 'cli') { fwrite(STDERR, "HTTP installer entry only\n"); exit(1); }
if (!defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') || UPGRADE_SANDBOX_PREPEND_ACTIVE !== true
    || getenv('UPGRADE_DEMO') !== '1' || getenv('UPGRADE_PROJECT_ID') !== 'teplypol-market'
    || getenv('UPGRADE_TARGET_ID') !== 'target-teplypol-20260929'
    || realpath($_SERVER['DOCUMENT_ROOT'] ?? '') !== '/var/www/html'
    || !is_file('/var/lib/upgrade/installer-resume-authorized.json')) {
    http_response_code(403); exit;
}
$upgradeMarkerPath = '/var/lib/upgrade/installer-resume-authorized.json';
$upgradeMarkerStat = lstat($upgradeMarkerPath);
if (!$upgradeMarkerStat || ($upgradeMarkerStat['mode'] & 0170000) !== 0100000
    || ($upgradeMarkerStat['mode'] & 0777) !== 0640 || $upgradeMarkerStat['uid'] !== 0
    || $upgradeMarkerStat['nlink'] !== 1 || $upgradeMarkerStat['size'] > 4096) {
    http_response_code(403); exit;
}
$upgradeResume = json_decode(file_get_contents($upgradeMarkerPath), true);
if (($upgradeResume['target_id'] ?? '') !== 'target-teplypol-20260929'
    || ($upgradeResume['stage'] ?? '') !== 'create_modules'
    || ($upgradeResume['preflight_verified'] ?? false) !== true
    || ($upgradeResume['user_eula_consent'] ?? false) !== true
    || !is_int($upgradeResume['expires_at'] ?? null)
    || $upgradeResume['expires_at'] <= time() || $upgradeResume['expires_at'] > time()+21600) {
    http_response_code(403); exit;
}
define('install_edition', 'business');
define('B_PROLOG_INCLUDED', true);
// POST processing remains entirely in the official wizard implementation.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require $_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/install/wizard/wizard.php';
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); exit; }
if (($_SERVER['QUERY_STRING'] ?? '') !== '' || $_GET !== []) { http_response_code(400); exit; }
// CWizardBase::Display inspects $_REQUEST, including GET, for OnPostForm.
// A new resume GET must only render; no old step action may execute twice.
$_REQUEST = $_GET = $_POST = [];
ob_start();
require $_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/install/wizard/wizard.php';
ob_end_clean();
$wizard->SetCurrentStep('create_modules');
$wizard->SetDefaultVar('devsrv', 'Y');
echo $wizard->Display();
