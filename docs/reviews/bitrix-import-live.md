# Review первого частичного импорта Битрикс

Дата: 29.09.2026. Задача `review-bitrix-import-v1`, исполнитель `bitrix-import-reviewer`, fence 1. Входы root: `art-716e924f-ee3c-48d5-8d03-899b4cf18ad3`, результат пакета `art-96a56788-47a5-4dbd-94dd-4869c67ecf30`. Эти серверные артефакты доступны только root; reviewer не открывал server Store, БД, сервер, browser target или ключ лицензии.

Первоначальная область — только этот документ. Root сохранил расширения scope на `bitrix/module/upgrade.core/lib/gateway.php`, `tests/integration/gateway-reconcile.test.ts`, затем `bitrix/migrations/install.php`, `tests/integration/migration-replay.test.ts`. Это исчерпывающий список записанных файлов. Sealed package и уже скопированный `/local` не изменялись этим исполнителем. После исправлений собственный результат должен пройти независимую приёмку; reviewer `discovery` назначен root отдельно.

## Вывод и обнаруженные дефекты

Первый проход выявил два препятствия надёжному повторному запуску. Исправления прошли локальные контрактные проверки. **Реальный target apply/reapply/reconcile/HTTP/admin/restore этим документом не подтверждён.** Старый sealed r6 содержит предыдущий код; root должен создать новый принятый package hash и развернуть именно его перед проверкой исправлений.

### P1: matching элемент без mapping давал ложный DATABASE_RECONCILED

До изменения `Gateway::planEntity` возвращал `reconciled`, если элемент с точным XML_ID и совпадающими управляемыми полями существовал, а `ug_entity` отсутствовал. Это корректное основание для восстановления mapping через `apply`. Но `Gateway::reconcile` принимал такой план за законченный импорт и проверял только raw `ug_route`. Между тем `Router::resolve` получает `BITRIX_ID` через LEFT JOIN к `ug_entity`; без mapping нужного ID нет, HTTP-код затем становится 404.

Локальный repro действительно исполнил исходные методы PHP Gateway/Router с in-memory doubles Connection/CIBlock, не CMS: при mapping=true результат был `DATABASE_RECONCILED`, ID 7; при mapping=false результат также был `DATABASE_RECONCILED`, ID null. Exit 0 подтвердил воспроизведение ошибки, а не готовность Битрикс.

Теперь final reconcile требует mapping с точными project/key/type/source ID/Bitrix ID, `MANAGED_HASH` и `PAYLOAD_HASH`, а затем повторно проверяет реальные управляемые поля, XML_ID и ACTIVE. Каждому ожидаемому 200 route нужна проверенная mapping. Отсутствие, несовпадение, выключенный элемент, изменённые свойства/HTML и неверный exact query дают FAIL. Изменение владельца не исправляется молча.

Поведение восстановления сохранено: для совпадающего orphan `dryRun.reconciled=1`, final reconcile FAIL; `apply` записывает mapping/operation без нового элемента, final reconcile становится согласованным; повторный apply даёт skipped. Контрактный тест проверяет `element_writes=0`, один mapping write при восстановлении, неизменённый raw HTML с экранированным source script, XML_ID и связь точного request-target с ID 7.

### P1: повторная регистрация модуля и неоднозначный exit 0 миграции

Root сообщил фактические результаты target: первый запуск — INSTALLED, iblock_id 1; затем 50 modules, 1 iblock, 4 свойства, 1 `ug_project`, 0 импортированных entities/routes/operations. Повтор дал общий vendor exception HTML при process exit 0. Отдельная own wrapper диагностика root получила exit 1 и `Bitrix\Main\DB\DuplicateEntryException`: `Duplicate entry 'upgrade.core' for key 'b_module.PRIMARY'`. Root проверил vendor реализацию: registerModule вызывает безусловный ModuleTable::add. Reviewer не выполнял эти запросы и не подменяет их своим локальным тестом.

Собственная миграция теперь вызывает registerModule только при `!ModuleManager::isModuleInstalled('upgrade.core')`. Весь CLI-body обёрнут в `catch (\Throwable)`, который выдаёт `status=ERROR`, `stage=migration`, class/reason на stderr и завершает процесс с кодом 1. Это не правка vendor handler. Машинный успех всё равно требует корректного JSON `status=INSTALLED`, а не одного exit code.

Два локальных PHP-процесса исполняют тело миграции с сохранённым fixture ledger: ровно один register call, один iblock/project и четыре свойства. Вторые два теста заставляют register/site API выбросить ошибку при установленном synthetic vendor handler, который без own catch возвратил бы HTML и exit 0. Результат — JSON stderr, пустой stdout и exit 1.

## Проверенные границы остальных частей

- Importer `Package::read` сверяет принятый manifest hash и project/profile, каждый включённый файл, полный tree без посторонних файлов/symlink, asset MIME/path/hash, стабильные entity keys, маршруты и redirect loops до bootstrap. PHP validate не подключается к БД.
- CLI bootstrap предваряет проверка own prepend и запрещённых process/mail функций. Root/state/project привязаны к demo. Apply дополнительно требует принятый SHA backup receipt, target ID, возраст не более суток и SHA database dump. Сама integrity-квитанция не доказывает восстановление БД.
- Gateway использует project flock, row lock, owner/fence/TTL; запись entity/mapping/operation находится в одной ограниченной транзакции, медиа сверяются по хешу. Advisory checkpoint не является источником истины. Цены, склад, корзина, платежи в этом профиле не создаются.
- Route lookup использует SHA точного request target и дополнительное точное сравнение. Case, encoded slash, порядок/пустые/повторные query parameters не нормализуются. 200 без доступного активного content превращается в 404. Физические коллизии и служебные пути проверяются до apply.
- Маршрут и один перенесённый Page не означают полноту сайта. По переданному root описанию пакета: 25 известных URL, 1 planned route, 24 unresolved, 152 assets; данные server package здесь не пересчитывались. Общий размер сайта UNKNOWN, торговые функции не подтверждены.
- Миграция пишет только собственные `ug_*` таблицы прямым SQL; инфоблок/свойства/шаблон сайта создаёт API. Проверка D7 транзакций, storage engine core/property tables, event hooks и round-trip значений на фактической версии остаётся задачей target интеграции.

API сверены 29.09.2026 с официальными источниками: [CIBlock::Add — SITE_ID/GROUP_ID/VERSION](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblock/add.php), [CIBlock::GetList — XML_ID и операторы фильтра](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblock/getlist.php), [CIBlockElement::Add — поля и события](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblockelement/add.php), [GetProperty](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblockelement/getproperty.php), [ModuleManager API](https://docs.1c-bitrix.ru/api/classes/Bitrix-Main-ModuleManager.html). Source-ссылка ModuleManager на docs вернула 404; фактическую DuplicateEntryException подтвердил root на установленном runtime, а не предположение из этой ссылки.

## Фактически выполненные команды

Локальный PHP: `var/tools/php-8.3.35/php.exe`, официальный runtime уже подготовлен проектом. Перед test:

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR = (Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/gateway-reconcile.test.ts tests/integration/migration-replay.test.ts tests/unit/bitrix.test.ts tests/unit/bitrix-review.test.ts
npm run check
```

Результат: **32 PASS, 0 FAIL, 0 SKIP**, 1.66 s: 15 Gateway, 3 migration, 14 ранее существовавших package/bootstrap/renderer. `npm run check` — exit 0. Все **15 PHP-файлов `bitrix/`, включая hidden component template, `php -n -l` — PASS**. Prettier только для двух новых TS tests — exit 0.

Первая попытка migration test adapter дала 3 FAIL из-за `eval` с закрывающим/открывающим PHP tag перед strict_types; это ошибка тестового adapter, не CMS. После удаления opening tag из eval-кода при сохранении strict_types все три теста PASS. Данные и guards миграции тестом не вырезаются: имена runtime функций разрешаются в тестовом namespace, API заменяются doubles. Поэтому результаты явно не являются доказательством runtime isolation, совместимости D7/CIBlock или работы реальной БД.

```json
[
  {"id":"OWN_GATEWAY_RECONCILE_REGRESSION","status":"PASS","details":"15 actual own PHP contract cases; CIBlock/Connection doubles, not Bitrix"},
  {"id":"OWN_MIGRATION_REPLAY_ERROR_CONTRACT","status":"PASS","details":"3 actual own PHP body cases; separate-process ledger and controlled API/policy adapters"},
  {"id":"PACKAGE_BOOTSTRAP_RENDERER_REGRESSION","status":"PASS","details":"14 previous cases including real PHP package validator"},
  {"id":"PHP_SYNTAX","status":"PASS","details":"15 files"},
  {"id":"TYPESCRIPT_CHECK","status":"PASS","details":"npm run check exit 0"},
  {"id":"FIXED_TARGET_IMPORT_REPLAY_HTTP_ADMIN","status":"NOT_RUN","details":"root must rebuild accepted package and run target checks"},
  {"id":"TARGET_DATABASE_RESTORE","status":"NOT_RUN","details":"backup integrity does not establish restoration"}
]
```

## Freeze и следующий шаг

| Файл | SHA-256 |
|---|---|
| `bitrix/module/upgrade.core/lib/gateway.php` | `62bb10084f3da1117fb292b2071340e09cbc4b06f9096d6f72f1e1af029392e8` |
| `bitrix/migrations/install.php` | `ecfa8cb6bde39652dfca532312d6eae620a199c9e26dddd24022200cd99362bb` |
| `tests/integration/gateway-reconcile.test.ts` | `4d14c037a426d966519e6dbbc0b882629fbc2c7f00467e75b1dc381cab16dafe` |
| `tests/integration/migration-replay.test.ts` | `b39097c698799c760014aaa4ec9ddf1b18cf240f2319ec1078f8ff349c21b3ea` |

После независимого review root создаёт новую sealed release, сверяет deployed own-code SHA, повторяет миграцию, dry-run, claim/apply/reapply/reconcile с единственным writer и сохраняет receipts. Затем — HTTP точного выбранного URL, неохваченные/ошибочные адреса, медиа, raw content, административное редактирование и контролируемый конфликт. Предоставленные root данные пока указывают 0 пользователей/admin email pending; это граница admin проверки. Реальный restore в новую БД/каталог остаётся отдельным непроведённым испытанием. DEMO_READY не устанавливается.
