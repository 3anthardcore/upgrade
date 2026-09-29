# Завершение учётной записи техадминистратора: независимая проверка

Задача `review-technical-admin-v1`, run `run-3352a79b-a89a-4b56-ba7d-efa464efb8bc`, вход `art-523ad6f0-0c95-4ada-8b2d-1dcd445ee3b0`. Область reviewer: только этот документ и `tests/integration/admin-completion.test.ts`. Root является единственным исполнителем целевых записей. Итог **ACCEPT в области создания и API-аутентификации одного техадминистратора**: локальный PHP contract PASS и доставленные actual receipts проверены. Штатный wizard **NOT_EXECUTED**, browser admin **NOT_RUN**, активация **NOT_VERIFIED**, готовность **NOT_READY**.

Проверены официальные [CUser::Add](https://dev.1c-bitrix.ru/api_help/main/reference/cuser/add.php) и [CUser::Login](https://dev.1c-bitrix.ru/api_help/main/reference/cuser/login.php). Add вызывается на объекте и возвращает ID либо false с LAST_ERROR; LOGIN, EMAIL, PASSWORD и CONFIRM_PASSWORD обязательны, XML_ID предусмотрен для связи с внешним источником. Login возвращает строго true при успехе либо массив ошибки; remember=N не сохраняет постоянную авторизацию. Документация не даёт гарантии отсутствия событий: собственный helper не должен вызывать почтовые методы, а vendor hooks требуют сохранённой сетевой и почтовой изоляции.

Границы безопасного исполнения, переданные root до написания helper:

- Проверить проект/целевой root, активный prepend и disabled functions до bootstrap. Использовать общий `upgrade-PROJECT.lock` вместе с importer/migration, не отдельный параллельный admin lock.
- Сохранить привязанный PENDING intent до Add. Восстановление после неизвестного исхода сначала сверяет существующий аккаунт; повторный Add допустим только при доказанном отсутствии своего аккаунта.
- Сверять точные project/target/login/email/XML_ID, ACTIVE и членство в группе администратора. Одноимённая чужая учётная запись, внешний auth provider, inactive/non-admin и несовпадающая identity требуют отказа. Не сбрасывать пароль и не исправлять такого пользователя автоматически.
- Receipt не заменяет свежую проверку целевого состояния. COMMITTED допускается после успешных readback и Login===true, не после одного ненулевого ID. Секреты и vendor-ошибки, потенциально содержащие пароль, не должны попадать в receipt/stdout/stderr.
- Не вызывать Register, SendPassword, SendUserInfo и отправителей событий. Создание аккаунта не означает завершение штатного мастера, активации лицензии, полной проверки админки или DEMO_READY.

Проверен `infra/provisioning/complete-admin.php`, SHA256 `c1fbac9eee59799a5739b652b14bfe548ee79e98af1cb6643521b48edf0db3c4`. Тесты `tests/integration/admin-completion.test.ts`, SHA256 `d90a8642093a3457c6f00c11933bc084648baf4eae37db9a9fbf00373340e7aa`, **FREEZE**. Helper выполняется без изменения исходника через его существующий namespace. В отдельных PHP-процессах подменяются vendor API и наблюдения Linux metadata/runtime policy; собственные save/readback/receipt/identity/auth logic, файловое состояние, fsync/rename и блокировки исполняются. Это проверка поведения Upgrade, не эмулятор, принимаемый за настоящую CMS.

| Проверенные сценарии | Результат |
| --- | --- |
| Два последовательных процесса | Add 1, Login 2; одна учётная запись, COMMITTED; точные identity, XML_ID, ACTIVE и GROUP_ID=[1] переданы; Login с N/Y |
| Abrupt exit 75 после сохранения аккаунта; throw после Add; ошибка rename COMMITTED receipt | Все три оставляют PENDING, повтор сначала читает назначение и завершает без второго Add |
| Ошибка Add; исключение поставщика с паролем; пароль целиком из uppercase-символов как сообщение исключения | exit 1, структурированная ошибка, stdout пуст, пароль и vendor HTML не выходят; PENDING сохранён |
| Login возвращает массив/1/строку/false; IsAuthorized=false; IsAdmin=false; чужой authenticated ID | Семь отказов без COMMITTED; последующее успешное подтверждение не создаёт нового пользователя |
| Изменены EMAIL, NAME, LAST_NAME, XML_ID, ACTIVE, EXTERNAL_AUTH_ID, admin group | Семь конфликтов после COMMITTED: нет Add/Login/Update/Delete и автоматического исправления чужой identity |
| Matching account без собственной receipt | Не присваивается helper: EXISTING_ACCOUNT_CONFLICT |
| Чужой пользователь; пропавший COMMITTED пользователь; другой ID; новые credentials; другой receipt pin; JSON null и [] | Нет новых записей и обхода привязки |
| Отсутствует prepend; mail не disabled; busy writer; небезопасный mode credentials; чужой владелец intent; неверный accepted SHA | Отказ до bootstrap и любой записи пользователя |
| Add вернул ID, но readback EMAIL изменён | ADMIN_READBACK_FAILED, Login не вызывается, receipt PENDING |
| Два реально конкурирующих PHP-процесса на общем target lock | Второй получает TARGET_WRITER_BUSY, пока первый внутри Add; Add остаётся 1, затем COMMITTED |

Почтовые/разрушающие методы doubles Register/SendPassword/SendUserInfo/CEvent::Send/SendImmediate/Update/Delete запрещены trap-методами; счётчик остаётся пуст. Это доказывает отсутствие таких собственных вызовов helper, **не** отсутствие вызовов внутри настоящих vendor hooks. `user_count=1` и отсутствие дублей проверены отдельным persisted ledger между процессами; успешная receipt не принимается без свежего целевого readback и строгого Login.

Найденные и закрытые до целевого запуска дефекты:

1. Regex, допускавший любое сообщение исключения из uppercase-символов, мог вывести пароль из hook. Root ввёл собственный тип CompletionError только для проверок need; прочие Throwable получают фиксированный reason. Regression `uppercase-exception` PASS.
2. Доставленная receipt JSON `null` трактовалась как отсутствие состояния. Root добавил обязательный is_array для существующей receipt; regressions null/array PASS без Add.

Выполненные команды:

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path 'var/tools/php-8.3.35/php.exe').Path
node --test tests/integration/admin-completion.test.ts
npm run check
& 'var/tools/php-8.3.35/php.exe' -n -l 'infra/provisioning/complete-admin.php'
```

PHP 8.3.35 CLI Windows NTS. Финальный targeted запуск: **37 tests, 37 PASS, 0 FAIL, 0 SKIP**, 9007 ms; TypeScript check exit 0; PHP lint exit 0. До добавления настоящего competing-process case было 36/36 PASS; это предыдущий локальный запуск, не дополнительное число независимых тестов. Полный suite без необходимости не повторялся.

Границы: stat/uid/mode и INI/prepend observations в Windows harness подменены, поэтому правильность actual Linux private permissions и контейнерной изоляции остаётся отдельной проверкой. Настоящий flock проверен локально, но не заменяет root как единственного целевого писателя. Файловая запись синхронизируется перед rename; тесты доказывают восстановление после прерывания процесса и неизвестного API-исхода, не полную гарантию сохранности при сбое питания/носителя. Взаимодействие с исходным сайтом, сервером и целевой БД reviewer не выполнял.

Независимо от последующего account PASS сохраняются отдельные результаты `installer_wizard=NOT_EXECUTED`, `license_activation=NOT_VERIFIED`, `browser_admin=NOT_RUN`, `readiness=NOT_READY`. Штатное окончание wizard, полноценный вход в браузере, проверка лицензии и завершённость миграции не следуют из создания пользователя.

## Фактическое исполнение и независимая сверка квитанций

Получен `var/evidence/admin-completion/evidence.json`, SHA256 `c4d51e798de496eb3c5f8870db38b211e2bd7ef039b7340df7a5bd6fe6128799`. Отдельной read-only командой Node (`node:fs`, `node:crypto`, `node:assert/strict`, PowerShell here-string → `node`) проверен SHA всего bundle, уникальность имён и SHA256 UTF-8 `text` **8/8 вложений PASS**. Все вложенные JSON разобраны. Команда exit 0. Это дополнительная проверка доставленных данных; новых subprocess tests после freeze не добавлялось, сервер reviewer не посещал.

| Actual receipt | Независимо сверенное содержание |
| --- | --- |
| actual-first.json | ADMIN_AUTH_VERIFIED, ID 1, created=true, reconciled=false, user_count=1, administrator=true, CUser::Login, remember=N |
| actual-repeat.json | Тот же ID/login/email/intent SHA, created=false, reconciled=true, user_count=1 и повторная API-аутентификация |
| actual-readback.json | users=1, elements=1, own_entities=1, own_routes=1, own_operations=2, mail_events=0, orders=0 |
| Поля аккаунта readback | ID 1, ACTIVE=Y, XML_ID `upgrade:target-teplypol-20260929:technical-admin`; groups содержит 1 (также 3/4/2), проверяется наличие admin group, не утверждается единственность группы |
| actual-first.pending.json | RESPONSE_RECEIVED, result SHA совпадает с actual-first.json; время 09:14:28.567521–09:14:31.397915 UTC |
| http-after-admin.json | 7/7 ожидаемых HTTP-статусов и noindex/no-store/nosniff; unchanged выбранная страница |

Оба actual результата привязаны к одному intent SHA `e6283866f68c5ebf781db838bd827a41d4138af51df18266a6eb316fe1d12ee5`. Их login/email совпадают с отдельным readback; секретов bundle не содержит. `actual-first.pending.json` — квитанция исполнения команды, не приватный helper receipt с credential hash. Приватные intent/credentials/receipt и полный дамп БД reviewer не читает; их сохранность и содержимое не выдаются за независимое файловое чтение. Локальный helper SHA повторно совпал с ранее проверенным `c1fbac…db3c4`; bundle не содержит отдельного хеша исполнявшегося серверного helper, поэтому привязка deployed code к local pin опирается на контролируемую процедуру root, а не на самостоятельную проверку серверного файла reviewer.

`admin-window.json`: началось 09:14:28.474634 UTC, длина 20 секунд, PHP namespace `net:[4026534285]`, интерфейс eth0, own IP 172.30.50.3, DB 172.30.50.2. Первый CLI-запуск начался через 93 ms и завершился через 2923 ms после начала окна — целиком внутри. Записано 213 frames / 213 DB TCP frames, received=213, dropped=0; external IPv4 from PHP=0, IPv6=0, malformed=0, unsupported Ethernet=0. Положительный DB-контроль присутствует. Это **PASS текущего ограниченного наблюдения первого admin CLI-запуска**, не всех интерфейсов, будущих запросов, SMTP-hooks во всех условиях или исторического первого bootstrap. Отдельных временных меток повторного запуска нет, поэтому его попадание в это окно не утверждается. Payload не сохранялся.

HTTP: без авторизации выбранная страница 401, авторизованный GET 200, POST 403; `/bitrix/admin/index.php`, старый `/local/upgrade-installer-resume.php`, `/local/complete-admin.php` и путь credentials через HTTP дают 404. Эти 404 подтверждают закрытость endpoints в partial preview, **не** работоспособность штатной админки. SHA GET страницы `033e2e25336a6061d364ed3d043fd248a90a046fcf5afffb5eb3c7d21f4edbff` независимо сопоставлен с r8 HTTP-квитанцией и совпал. Семь проверок не заменяют прежние 224: исходные три TRACE privacy-header исключения r8 остаются записанными FAIL.

Backup receipt создан до операции, 09:11:31 UTC, target совпадает, 1551556 bytes; заявлена целостность через успешный mysqldump и завершающий footer. Дамп не доставлялся reviewer и не восстанавливался: **restore NOT_RUN**. Cleanup receipt ограничен двумя истёкшими собственными файлами resume endpoint/marker, содержит их старые SHA и `vendor_files_modified=0`, `nginx_partial_profile_unchanged=true`. Это записанный результат root; удаление и резервные копии reviewer самостоятельно не выполнял и не проверял на сервере.

Открытых блокирующих дефектов в принятой области account/API-auth нет. Следующий шаг — сохранить этот результат в Store и продолжать отдельно разрешённые этапы. Полный перенос по-прежнему 1/25 известных URL, общий исходный scope UNKNOWN; полноценный browser admin, штатное завершение wizard, проверка лицензии, commerce и restore остаются отдельными неподтверждёнными возможностями. **DEMO_READY запрещён.**
