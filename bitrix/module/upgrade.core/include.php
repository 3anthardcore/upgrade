<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) { return; }
\Bitrix\Main\Loader::registerAutoLoadClasses('upgrade.core', [
    'Upgrade\\Core\\Gateway' => 'lib/gateway.php',
    'Upgrade\\Core\\Router' => 'lib/router.php',
    'Upgrade\\Core\\DemoEngine' => 'lib/demoengine.php',
    'Upgrade\\Core\\DemoWeb' => 'lib/demoweb.php',
    'Upgrade\\Core\\DemoView' => 'lib/demoview.php',
    'Upgrade\\Core\\DemoRuntime' => 'lib/demoruntime.php',
]);
