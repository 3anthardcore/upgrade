<?php
declare(strict_types=1);
// Read-only pilot acceptance. Run inside the already isolated PHP service.
if (PHP_SAPI!=='cli' || !defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') || UPGRADE_SANDBOX_PREPEND_ACTIVE!==true || getenv('UPGRADE_DEMO')!=='1') { throw new RuntimeException('ISOLATED_CLI_REQUIRED'); }
$project=(string)getenv('UPGRADE_PROJECT_ID');
if (!preg_match('/^[a-z0-9-]+$/',$project)) { throw new RuntimeException('PROJECT_REQUIRED'); }
$_SERVER['DOCUMENT_ROOT']='/var/www/html';
foreach (['NO_KEEP_STATISTIC','NOT_CHECK_PERMISSIONS','BX_CRONTAB','BX_CRONTAB_SUPPORT'] as $constant) { if (!defined($constant)) { define($constant,true); } }
require '/var/www/html/bitrix/modules/main/include/prolog_before.php';
if (!\Bitrix\Main\Loader::includeModule('upgrade.core') || !\Bitrix\Main\Loader::includeModule('iblock')) { throw new RuntimeException('MODULE_REQUIRED'); }
require $argv[1].'/code/importer/package.php';
$package=\Upgrade\Importer\Package::read($argv[1],$project,$argv[2]);
$db=\Bitrix\Main\Application::getConnection();$q=static fn(string $s):string=>"'".$db->getSqlHelper()->forSql($s)."'";
$projectRow=$db->query('SELECT IBLOCK_ID FROM ug_project WHERE PROJECT_ID='.$q($project))->fetch();
if (!$projectRow) { throw new RuntimeException('PROJECT_NOT_INSTALLED'); }
$iblock=(int)$projectRow['IBLOCK_ID'];$rows=[];
foreach ($package['entities'] as $entity) {
    $result=CIBlockElement::GetList([],['IBLOCK_ID'=>$iblock,'=XML_ID'=>'upgrade:'.$entity['stable_key']],false,['nTopCount'=>2],['ID','XML_ID']);
    $item=$result->Fetch();$duplicate=(bool)$result->Fetch();
    if (!$item || $duplicate) { throw new RuntimeException('ENTITY_MISSING_OR_DUPLICATE'); }
    $property=CIBlockElement::GetProperty($iblock,(int)$item['ID'],[],['CODE'=>'UG_FACTS'])->Fetch();
    $stored=(string)($property['VALUE']??'');$raw=\Upgrade\Core\FactsProperty::decode($stored);
    $expected=json_encode($entity['facts']??[],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    $rows[]=['entity_key'=>$entity['stable_key'],'bitrix_id'=>(int)$item['ID'],'stored_bytes'=>strlen($stored),'raw_bytes'=>strlen($raw),'raw_sha256'=>hash('sha256',$raw),'expected_sha256'=>hash('sha256',$expected),'pass'=>hash_equals($expected,$raw)];
}
$counts=[];
foreach (['ug_entity','ug_route','ug_operation'] as $table) { $counts[$table]=(int)$db->query('SELECT COUNT(*) AS N FROM '.$table.' WHERE PROJECT_ID='.$q($project))->fetch()['N']; }
foreach (['b_sale_order','b_event','b_user'] as $table) { $counts[$table]=$db->isTableExists($table)?(int)$db->query('SELECT COUNT(*) AS N FROM '.$table)->fetch()['N']:null; }
$legacyRoute=$db->query('SELECT e.BITRIX_ID FROM ug_route r INNER JOIN ug_entity e ON e.ENTITY_KEY=r.ENTITY_KEY AND e.PROJECT_ID=r.PROJECT_ID WHERE r.PROJECT_ID='.$q($project).' AND r.REQUEST_TARGET='.$q('/termoregulyatory/grand-meyer-hw-500'))->fetch();
$pass=count($rows)===count($package['entities']) && !array_filter($rows,static fn($r)=>!$r['pass']) && (int)($legacyRoute['BITRIX_ID']??0)===1 && $counts['b_sale_order']===0 && $counts['b_event']===0;
echo json_encode(['scope'=>'READ_ONLY_NATIVE_FACTS_AND_COUNTS','pass'=>$pass,'manifest_sha256'=>$argv[2],'counts'=>$counts,'legacy_hw500_id'=>(int)($legacyRoute['BITRIX_ID']??0),'facts'=>$rows,'full_readiness'=>'NOT_READY'],JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT),PHP_EOL;
exit($pass?0:1);
