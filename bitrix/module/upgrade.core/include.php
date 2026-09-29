<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) { return; }
\Bitrix\Main\Loader::registerAutoLoadClasses('upgrade.core', [
    'Upgrade\\Core\\Gateway' => 'lib/gateway.php',
    'Upgrade\\Core\\Router' => 'lib/router.php',
]);
