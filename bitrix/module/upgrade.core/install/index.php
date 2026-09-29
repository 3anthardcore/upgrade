<?php
class upgrade_core extends CModule
{
    public $MODULE_ID = 'upgrade.core';
    public $MODULE_VERSION = '0.1.0';
    public $MODULE_VERSION_DATE = '2026-09-29 00:00:00';
    public $MODULE_NAME = 'Upgrade: проверяемый перенос';
    public $MODULE_DESCRIPTION = 'Изолированное демо, реестр маршрутов и шлюз импорта';
    public function DoInstall(): void
    {
        throw new RuntimeException('Use CLI migrations/install.php in an isolated demo. Browser installation is intentionally disabled.');
    }
    public function DoUninstall(): void
    {
        throw new RuntimeException('Data removal requires a separate reviewed plan; automatic uninstall does not delete imported content.');
    }
}
