# Независимая проверка исправлений перед настоящим импортом

29.09.2026. Задача `review-actual-import-fixes-v1`, worker `actual-import-independent-reviewer`, fence 1. Назначенные входы: `art-cef367fe-f536-4841-a98d-abbf6236b6fa`, `art-716e924f-ee3c-48d5-8d03-899b4cf18ad3`. Root остаётся единственным писателем Store и целевой БД. Ревьюер изменил только этот документ; PHP, TypeScript, конфигурацию, доказательства, Store и сервер не изменял. Проверки выполнялись локально с временными fixture-каталогами.

**Решение: ACCEPT в пределах локальных исправлений и ограниченного installer checkpoint.** Блокирующих замечаний к замороженным изменениям не обнаружено. Это разрешает отдельную проверяемую попытку интеграционного импорта, но не подтверждает её результат, завершение установки CMS или готовность демо.

## Зафиксированные файлы

Хеши независимо прочитаны после FREEZE обоих исполнителей и совпали с сообщёнными ими значениями.

| Файл | SHA-256 |
|---|---|
| `bitrix/module/upgrade.core/lib/gateway.php` | `62bb10084f3da1117fb292b2071340e09cbc4b06f9096d6f72f1e1af029392e8` |
| `bitrix/migrations/install.php` | `ecfa8cb6bde39652dfca532312d6eae620a199c9e26dddd24022200cd99362bb` |
| `infra/nginx/partial-demo.conf` | `1c4f65ee0000b87764ea7be0d069143317f4753633df2f303e346a681ddf081e` |
| `tests/integration/gateway-reconcile.test.ts` | `4d14c037a426d966519e6dbbc0b882629fbc2c7f00467e75b1dc381cab16dafe` |
| `tests/integration/migration-replay.test.ts` | `b39097c698799c760014aaa4ec9ddf1b18cf240f2319ec1078f8ff349c21b3ea` |
| `tests/integration/partial-preview.test.ts` | `02c9d1b970ce660d3789506a02e249f8ec027f6e2e87044b2c807f3882244326` |

## Выводы по изменениям

1. Gateway больше не принимает совпадающий элемент без записи `ug_entity` за завершённое назначение маршрута. Финальная сверка проверяет project/key/type/source/id, managed/payload hashes, фактические `XML_ID` и `ACTIVE`, управляемые поля и связь каждого ожидаемого 200 с проверенным назначением. Отдельный `apply` по-прежнему восстанавливает отсутствующий mapping, не создавая и не переписывая совпадающий элемент. Проверка маршрута сохраняет буквальный request target, включая регистр, `%2F`, пустые и повторяющиеся query-параметры.
2. Migration проверяет `ModuleManager::isModuleInstalled` перед регистрацией. Тест запускает тело собственной миграции двумя PHP-процессами с общим fixture-ledger: остаются один module/iblock/project, четыре properties; `registerModule` вызывается один раз. Отдельные ошибки регистрации и обновления site дают JSON в stderr и exit 1 даже при имитированном vendor exception handler, который иначе выводит HTML и exit 0. Namespace shim подменяет только условия окружения и API; это не исполнение настоящего Битрикс.
3. Partial Nginx profile имеет единственный фиксированный PHP handler, исходные URI/query передаются router как данные. Exact CSS и hash-media ограничены собственным namespace одного проекта. Basic Auth, запрет методов записи, отключение передачи body/cookies/Authorization, закрытые vendor/installer/direct-PHP paths, logging-off и строгая CSP сохранены. Профиль выбирается вместо installer profile. Его статические тесты не являются парсером Nginx и не подтверждают действующий HTTP/FPM.
4. Рассмотренный source delta меняет собственные Gateway/migration и добавляет собственный профиль; правок vendor, ослабления prepend/network isolation, обхода access gate или повышения source coverage нет. Новая сверка не добавляет цены, остатки и commerce semantics. Проверки рендеринга/пакета также подтверждают экранирование исходного текста и отказ при чужом project, изменённых байтах и отсутствующих данных.

## Команды и фактический результат

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path -LiteralPath 'var/tools/php-8.3.35/php.exe').Path
$env:UPGRADE_PHP_EXT_DIR = (Resolve-Path -LiteralPath 'var/tools/php-8.3.35/ext').Path
node --disable-warning=ExperimentalWarning --test tests/integration/gateway-reconcile.test.ts tests/integration/migration-replay.test.ts tests/integration/partial-preview.test.ts tests/unit/bitrix.test.ts tests/unit/bitrix-review.test.ts
npm run check
```

Независимый результат: **37/37 PASS, FAIL/CANCEL/SKIP 0**, 1191.9077 ms; TypeScript check exit 0. В составе: 15 Gateway, 3 migration, 5 static Nginx policy, 14 существующих package/security contract tests. Использовался настоящий локальный PHP 8.3.35; CMS API/БД в новых Gateway/migration тестах — doubles. Полный набор и E2E выполняет root отдельно; здесь их результат не присваивается ревьюеру.

## Принятие ограниченного installer checkpoint

Root предоставил `var/evidence/server-r6/r6-pre-import-evidence.tar.gz`. Независимо вычислен SHA-256 `916bcca03cb353db16d3f0d76dd60789fce6d88168ff88ab5ba8be08172ee96c`, совпадающий с переданным pin. Все 12 локальных файлов сравнены с соответствующими байтами архива через `tar.exe -tf` и `tar.exe -xOf`; SHA-256 и размеры совпали. Архив не извлекался и доказательства не изменялись. Это подтверждает целостность доставленных записей, а не повторяет серверные команды.

- `r6-bitrix-migration.json`: `INSTALLED`, iblock 1, runtime verification `NOT_RUN`. `r6-after-migration-counts.json`: modules 50, users 0, iblocks 1, own properties 4, own projects 1, own entities/routes/operations 0. Значение 50 уже включает собственный модуль; его нельзя подписывать как «49 модулей после own migration».
- Повтор миграции сохранён как HTML ошибки; отдельный diagnostic содержит `DuplicateEntryException`, код MySQL 1062, `upgrade.core`, `b_module.PRIMARY`. Повтор **FAIL**, а не успешная идемпотентность. Локальный fix ещё должен пройти отдельный серверный повтор.
- `r6-bitrix-dry-run.json`: created 1, conflicts/blockers пусты. Это план записи, а не факт импорта.
- `r6-live-isolation.json`: prepend активен, mail/process functions выключены, 5 TCP-проверок PASS; собственная БД доступна. Сам probe ограничен `PRE_CMS_RUNTIME_ONLY`, DNS packet egress — `NOT_VERIFIED_BY_THIS_PROBE`. Его достаточно для узкой записи «runtime controls сохранены на момент probe»; он не доказывает отсутствие всех побочных действий CMS или AT-28.
- Host/container backup receipts совпадают по database/files SHA, target/project/time; оба явно содержат restore и production recovery `NOT_RUN`. Сами backup payloads здесь не доступны и повторно не хешировались. Успешное восстановление не заявляется.
- Model/build replay records содержат `COMMITTED`, `replayed: true`, прежнюю привязку к source artifact и активному server access block. Build runtime остаётся `NOT_RUN`. Полный known source inventory в этих 12 файлах не содержится: число 25/1 берётся из отдельно принятого root scope, а не проверяется заново данным архивом.

Поэтому `installer-state-recorded` можно принять с зафиксированными ошибкой replay и отсутствующим администратором. `isolation-preserved` допустим только с указанным ограничением runtime probe. Завершение wizard/admin, активация, исправленный replay на целевой БД, настоящий импорт/reconcile, Nginx HTTP/browser, CMS egress и Bitrix restore остаются открыты. Ни этот checkpoint, ни будущий частичный 200 не снимают исходный access block и не дают `DEMO_READY`.

После независимого прогона root дополнительно сообщил: candidate profile с указанным SHA прошёл `nginx -t` в выделенном контейнере, но ещё не выбран активным; backup files извлечены в новый recovery-каталог с `FILES_EXTRACTED`, тогда как database import/smoke/production recovery остаются `NOT_RUN`; полный локальный набор root дал 168 tests и 20 E2E PASS. Эти новые действия ревьюер не выполнял и их новые receipts в рамках этого документа не сверял. Они не меняют приведённую границу приёмки и не требуют повторения уже принятого подготовительного шага без причины.

```json
[
  {"id":"gateway-reconcile-contract","status":"PASS","details":"15 own PHP contract tests; missing mapping fails final reconcile and is recovered without duplicate element."},
  {"id":"migration-replay-contract","status":"PASS","details":"3 own migration tests; two processes register once; errors produce JSON stderr and exit 1."},
  {"id":"partial-preview-static-policy","status":"PASS","details":"5 static configuration tests; live Nginx/FPM not exercised."},
  {"id":"delivered-r6-evidence-integrity","status":"PASS","details":"Trusted archive SHA and all 12 local member bytes match."},
  {"id":"installer-state-recorded","status":"PASS","details":"Bounded checkpoint only: partial CMS, own migration first result, explicit replay failure, users 0, no content import."},
  {"id":"isolation-preserved","status":"PASS","details":"Provided runtime probe only: prepend/function restrictions and five TCP checks; CMS behavior and DNS packet capture excluded."},
  {"id":"actual-fixed-bitrix-import-replay","status":"NOT_RUN","details":"Requires separate sole-writer target execution and reconciliation."},
  {"id":"actual-partial-preview-http-browser","status":"NOT_RUN","details":"Requires chosen in-container profile hash, nginx -t, authenticated routes/media/method/privacy checks."},
  {"id":"cms-admin-activation-restore-full-coverage","status":"NOT_RUN","details":"Not established by local contracts or delivered checkpoint; DEMO_READY prohibited."}
]
```

Следующий шаг: root принимает ограниченный checkpoint, создаёт отдельную задачу интеграционного импорта, фиксирует принятые package/code/profile hashes и проверяет исправленный replay, единственный импортёр, реальную сверку назначения и закрытый частичный просмотр. Непроверенные действия сохраняются открытыми в общей матрице.
