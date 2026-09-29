<?php
declare(strict_types=1);
if (getenv('UPGRADE_DEMO')!=='1' || !preg_match('/^[a-z0-9][a-z0-9-]{0,62}$/',(string)getenv('UPGRADE_PROJECT_ID'))) { http_response_code(503); exit('Isolated demo project binding is required'); }
define('UPGRADE_SANDBOX_PREPEND_ACTIVE',true);
// These constants suppress normal hit-triggered scheduled work. Network policy is the primary protection.
if (!defined('BX_CRONTAB')) { define('BX_CRONTAB',true); }
if (!defined('BX_CRONTAB_SUPPORT')) { define('BX_CRONTAB_SUPPORT',true); }
if (!defined('NO_AGENT_CHECK')) { define('NO_AGENT_CHECK',true); }
if (!defined('NO_KEEP_STATISTIC')) { define('NO_KEEP_STATISTIC',true); }
if (!defined('DisableEventsCheck')) { define('DisableEventsCheck',true); }
if (PHP_SAPI!=='cli') { header('X-Robots-Tag: noindex, nofollow, noarchive'); }
