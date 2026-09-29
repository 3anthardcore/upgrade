<?php
declare(strict_types=1);
if (!defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') || UPGRADE_SANDBOX_PREPEND_ACTIVE!==true || realpath((string)ini_get('auto_prepend_file'))!=='/opt/upgrade/prepend.php') { http_response_code(503); exit('Изолированный PHP-контур не подтвержден'); }
$disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));
foreach (['mail','exec','passthru','shell_exec','system','popen','proc_open'] as $function) { if (!in_array($function,$disabled,true)) { http_response_code(503); exit('Политика PHP-контура не подтверждена'); } }
foreach (['NO_KEEP_STATISTIC','BX_CRONTAB','BX_CRONTAB_SUPPORT'] as $constant) { if (!defined($constant)) { define($constant,true); } }
require $_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php';
header('X-Robots-Tag: noindex, nofollow, noarchive');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
if (getenv('UPGRADE_DEMO')!=='1' || !\Bitrix\Main\Loader::includeModule('upgrade.core') || !\Bitrix\Main\Loader::includeModule('iblock')) { http_response_code(503); exit('Демо не настроено'); }
$project=\Bitrix\Main\Config\Option::get('upgrade.core','project_id','',SITE_ID);
if ($project===''||$project!==getenv('UPGRADE_PROJECT_ID')) { http_response_code(503); exit('Назначение проекта не подтверждено'); }
$request=(string)($_SERVER['REQUEST_URI']??'/');
$route=\Upgrade\Core\Router::resolve($project,$request);
if ($route && (int)$route['STATUS']>=300 && (int)$route['STATUS']<400) { header('Location: '.$route['REDIRECT_TARGET'],true,(int)$route['STATUS']); exit; }
$content=$route && $route['BITRIX_ID']?\Upgrade\Core\Router::content((int)$route['BITRIX_ID']):null;
$status=$route?(int)$route['STATUS']:404;
if ($status===200 && !$content) { $status=404; }
http_response_code($status);
if ($status===404) { define('ERROR_404','Y'); }
$GLOBALS['UPGRADE_ROUTE']=$route; $GLOBALS['UPGRADE_CONTENT']=$content; $GLOBALS['UPGRADE_STATUS']=$status;
$GLOBALS['UPGRADE_NAVIGATION']=\Upgrade\Core\Router::navigation($project);
$APPLICATION->SetTitle($content?($content['UPGRADE_PROPERTIES']['UG_SEO_TITLE']?:$content['NAME']):($status===410?'Страница удалена':'Страница не найдена'));
$APPLICATION->SetPageProperty('description',$content['UPGRADE_PROPERTIES']['UG_DESCRIPTION']??'');
$APPLICATION->SetPageProperty('robots','noindex, nofollow');
require $_SERVER['DOCUMENT_ROOT'].'/bitrix/header.php';
$APPLICATION->IncludeComponent('upgrade:page','',[],false,['HIDE_ICONS'=>'Y']);
require $_SERVER['DOCUMENT_ROOT'].'/bitrix/footer.php';
