<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
try {
if (!defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') || UPGRADE_SANDBOX_PREPEND_ACTIVE!==true || realpath((string)ini_get('auto_prepend_file'))!=='/opt/upgrade/prepend.php') { throw new RuntimeException('Isolated PHP prepend required before Bitrix bootstrap'); }
$disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));
foreach (['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $function) { if (!in_array($function,$disabled,true)) { throw new RuntimeException('Demo function policy required'); } }
$options = getopt('', ['document-root:', 'project:', 'site:', 'state-dir:']);
$project = (string)($options['project'] ?? '');
$root = realpath((string)($options['document-root'] ?? ''));
if (!preg_match('/^[a-z0-9][a-z0-9-]{0,62}$/', $project) || !$root || getenv('UPGRADE_DEMO') !== '1' || getenv('UPGRADE_PROJECT_ID') !== $project) {
    throw new RuntimeException('Dedicated demo root, project binding and UPGRADE_DEMO=1 required');
}
$state=realpath((string)($options['state-dir']??''));
if (!$state||$state===$root||str_starts_with($state,$root.DIRECTORY_SEPARATOR)||is_link((string)$options['state-dir'])) { throw new RuntimeException('Private target state outside web root required'); }
$installLock=fopen($state.'/upgrade-'.$project.'.lock','c');
if (!$installLock||!flock($installLock,LOCK_EX|LOCK_NB)) { throw new RuntimeException('Target writer busy'); }
foreach (['NO_KEEP_STATISTIC','NOT_CHECK_PERMISSIONS','BX_CRONTAB','BX_CRONTAB_SUPPORT'] as $constant) { if (!defined($constant)) { define($constant,true); } }
$_SERVER['DOCUMENT_ROOT'] = $root;
require $root.'/bitrix/modules/main/include/prolog_before.php';
if (!\Bitrix\Main\Loader::includeModule('iblock')) { throw new RuntimeException('iblock module required'); }
$siteId = (string)($options['site'] ?? 's1');
if (!CSite::GetByID($siteId)->Fetch()) { throw new RuntimeException('Configured site does not exist'); }
$db = \Bitrix\Main\Application::getConnection();
if (!in_array(strtolower($db->getType()), ['mysql', 'mysqli'], true)) { throw new RuntimeException('Only verified MySQL-family migration syntax is supported'); }
// Only own module tables. Core content is created exclusively through documented APIs.
$tables = [
    'ug_project' => 'PROJECT_ID varchar(63) NOT NULL PRIMARY KEY, IBLOCK_ID int NOT NULL, FENCE bigint NOT NULL DEFAULT 0, OWNER varchar(128) NOT NULL DEFAULT \'\', LEASE_UNTIL bigint NOT NULL DEFAULT 0',
    'ug_entity' => 'ENTITY_KEY char(64) NOT NULL PRIMARY KEY, PROJECT_ID varchar(63) NOT NULL, ENTITY_TYPE varchar(32) NOT NULL, SOURCE_ID text NOT NULL, BITRIX_ID int NOT NULL, MANAGED_HASH char(64) NOT NULL, PAYLOAD_HASH char(64) NOT NULL, UNIQUE KEY own_entity_id (PROJECT_ID, BITRIX_ID)',
    'ug_route' => 'ROUTE_KEY char(64) NOT NULL, PROJECT_ID varchar(63) NOT NULL, REQUEST_TARGET text NOT NULL, ENTITY_KEY char(64) NULL, STATUS int NOT NULL, REDIRECT_TARGET text NULL, PRIMARY KEY (PROJECT_ID, ROUTE_KEY), KEY route_entity (PROJECT_ID, ENTITY_KEY)',
    'ug_operation' => 'OPERATION_KEY char(64) NOT NULL PRIMARY KEY, PROJECT_ID varchar(63) NOT NULL, FENCE bigint NOT NULL, PACKAGE_HASH char(64) NOT NULL, ENTITY_KEY char(64) NOT NULL, RESULT varchar(32) NOT NULL, APPLIED_AT bigint NOT NULL',
];
foreach ($tables as $name => $fields) {
    if (!$db->isTableExists($name)) { $db->queryExecute('CREATE TABLE '.$name.' ('.$fields.') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin'); }
}
$sql = $db->getSqlHelper(); $q = static fn(string $s): string => "'".$sql->forSql($s)."'";
$existing = $db->query('SELECT * FROM ug_project WHERE PROJECT_ID='.$q($project))->fetch();
if (!$existing) {
    $type = 'upgrade_content';
    if (!CIBlockType::GetByID($type)->Fetch()) {
        $t = new CIBlockType();
        if (!$t->Add(['ID'=>$type, 'SECTIONS'=>'Y', 'IN_RSS'=>'N', 'SORT'=>500, 'LANG'=>['ru'=>['NAME'=>'Upgrade', 'SECTION_NAME'=>'Разделы', 'ELEMENT_NAME'=>'Материалы'], 'en'=>['NAME'=>'Upgrade', 'SECTION_NAME'=>'Sections', 'ELEMENT_NAME'=>'Content']]])) { throw new RuntimeException($t->LAST_ERROR); }
    }
    $existingBlocks=CIBlock::GetList([],['TYPE'=>$type,'=XML_ID'=>'upgrade:'.$project]);
    $recovered=$existingBlocks->Fetch();
    if ($existingBlocks->Fetch()) { throw new RuntimeException('Duplicate installation XML_ID requires reconciliation'); }
    $id=$recovered?(int)$recovered['ID']:null;
    if (!$id) {
        $ib = new CIBlock();
        $id = $ib->Add(['IBLOCK_TYPE_ID'=>$type, 'NAME'=>'Upgrade '.$project, 'CODE'=>'upgrade_'.str_replace('-', '_', $project), 'XML_ID'=>'upgrade:'.$project, 'SITE_ID'=>[$siteId], 'LID'=>[$siteId], 'ACTIVE'=>'Y', 'VERSION'=>2, 'GROUP_ID'=>['2'=>'R']]);
        if (!$id) { throw new RuntimeException($ib->LAST_ERROR); }
    }
    foreach (['UG_SEO_TITLE'=>'SEO: title', 'UG_DESCRIPTION'=>'SEO: description', 'UG_H1'=>'Заголовок H1', 'UG_FACTS'=>'Подтвержденные факты (JSON)'] as $code=>$name) {
        if (CIBlockProperty::GetList([],['IBLOCK_ID'=>$id,'CODE'=>$code])->Fetch()) { continue; }
        $property = new CIBlockProperty();
        if (!$property->Add(['IBLOCK_ID'=>$id, 'NAME'=>$name, 'CODE'=>$code, 'PROPERTY_TYPE'=>'S', 'ACTIVE'=>'Y', 'MULTIPLE'=>'N'])) { throw new RuntimeException($property->LAST_ERROR); }
    }
    $db->queryExecute('INSERT INTO ug_project (PROJECT_ID,IBLOCK_ID) VALUES ('.$q($project).','.(int)$id.')');
} else { $id = (int)$existing['IBLOCK_ID']; }
if (!\Bitrix\Main\ModuleManager::isModuleInstalled('upgrade.core')) { \Bitrix\Main\ModuleManager::registerModule('upgrade.core'); }
// Explicit site-scoped install, not a modification of vendor template files.
$site = new CSite();
if (!$site->Update($siteId, ['TEMPLATE'=>[['CONDITION'=>'', 'SORT'=>1, 'TEMPLATE'=>'upgrade']]])) { throw new RuntimeException($site->LAST_ERROR); }
\Bitrix\Main\Config\Option::set('upgrade.core', 'project_id', $project, $siteId);
\Bitrix\Main\Config\Option::set('upgrade.core', 'iblock_id', (string)$id, $siteId);
echo json_encode(['status'=>'INSTALLED', 'project_id'=>$project, 'iblock_id'=>$id, 'runtime_verification'=>'NOT_RUN'], JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT).PHP_EOL;
} catch (\Throwable $error) {
    fwrite(STDERR,json_encode(['status'=>'ERROR','stage'=>'migration','class'=>get_class($error),'reason'=>$error->getMessage()],JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE).PHP_EOL);
    exit(1);
}
