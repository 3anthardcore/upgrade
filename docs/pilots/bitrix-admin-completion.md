# Технический администратор Битрикс — 29.09.2026

Стадия завершена в области создания учётной записи и проверки API-авторизации. Это не завершённая миграция, штатный мастер готового решения или приёмка веб-интерфейса админки.

Пользователь предоставил email `indiro@yandex.ru`. Создан `upgrade.operator`, имя Upgrade Operator, ID1, ACTIVE=Y, группа администраторов1. Другие пользователи не создавались. Пароль сгенерирован на сервере и хранится только в `/opt/upgrade/private/bitrix/admin-credentials.json` (root:root,0600) и в приватном runtime input вне web root (33:33,0600; parent0700). Значения секретов не входят в Git, CLI arguments, stdout или артефакты.

## Исполнение

После истечения предыдущего PAUSED run его история сохранена с причиной deadline. Новый `run-3352a79b-a89a-4b56-ba7d-efa464efb8bc`:20 units/7200s, исходное начало09:05:49 UTC. Root и независимый reviewer зарегистрированы до делегирования; sole target writer root. Вход `art-523ad6f0-0c95-4ada-8b2d-1dcd445ee3b0`.

Перед записью создан отдельный SQL backup `/root/upgrade-install-20260929/admin-completion/database-before-admin.sql`:1551556bytes, mysqldump exit0 и completion footer. SHA `0d2ad9a67bbb852bbe4ec8f38ff2f3fbdd906f604eb050cad03e93c8efca35df`. Это integrity/backup БД перед администратором; SQL restore NOT_RUN.

Собственный CLI `infra/provisioning/complete-admin.php`, SHA `c1fbac9eee59799a5739b652b14bfe548ee79e98af1cb6643521b48edf0db3c4`, проверяет target/project, prepend/disabled functions, приватные права и общий `upgrade-PROJECT.lock` до записи. Accepted intent SHA `e6283866f68c5ebf781db838bd827a41d4138af51df18266a6eb316fe1d12ee5` хранится отдельно от credentials. Он закрепляет login/email/name/XML_ID; пароль не передаётся аргументом.

Пример точного вызова в действующем изолированном контейнере:

```sh
docker exec -u 33:33 teplypol-market-php-1 php \
  /var/lib/upgrade/admin-bootstrap/complete-admin.php \
  --intent=/var/lib/upgrade/admin-bootstrap/intent.json \
  --intent-sha256=e6283866f68c5ebf781db838bd827a41d4138af51df18266a6eb316fe1d12ee5 \
  --document-root=/var/www/html --state-dir=/var/lib/upgrade
```

До CUser::Add сохраняется PENDING receipt. Повтор сначала сверяет destination: собственный XML_ID, точные поля, ACTIVE и группу1. Чужой пользователь, изменённые credentials/receipt или исчезнувший COMMITTED аккаунт дают отказ без сброса пароля. COMMITTED записывается после свежего [CUser::Login](https://dev.1c-bitrix.ru/api_help/main/reference/cuser/login.php), IsAuthorized/IsAdmin/GetID; remember=N. Используется [CUser::Add](https://dev.1c-bitrix.ru/api_help/main/reference/cuser/add.php), а не методы регистрации с отправкой уведомлений. Vendor hooks дополнительно ограничены прежней изоляцией.

Фактический первый процесс: ADMIN_AUTH_VERIFIED, ID1, created=true, user_count1. Отдельный повтор: тот же ID1, created=false/reconciled=true, повторная успешная авторизация. Readback:users1, element/entity/route по1, operations2, mail_events0, orders0. Существующий импорт не менялся.

## Проверки и доказательства

- Локально: PHP8.3.35 lint PASS; npm run check PASS; npm test **207 PASS**, npm run test:e2e **20 PASS**, FAIL/CANCEL/SKIP0. Raw logs `var/evidence/admin-{check,tests,e2e}.txt`.
- Независимые37 PHP subprocess cases включают abrupt exit после persisted Add, потерянный Add response, ошибку rename, повтор, семь identity и семь auth failures, null/tampered receipt, redaction vendor errors и конкурирующий настоящий flock. Windows stat/runtime doubles не заменяют Linux integration.
- Фактический observer09:14:28.474634 UTC,20seconds:213 полученных/прочитанных DB TCP frames, external/IPv6/malformed/unsupported/dropped0. Первый CLI запуск попал в окно. Scope CURRENT_PHP_NAMESPACE_OBSERVATION_WINDOW_ONLY; повтор, loopback/Docker DNS, будущее и первый исторический bootstrap этим окном не подтверждены.
- Семь HTTP probes после записи PASS: приватность, прежний SHA карточки, POST403, admin/installer/helper/credential paths404. Публичный profile не открывался для административных действий. Веб-вход администратора NOT_RUN.
- Истёкшие собственные resume endpoint и marker предварительно скопированы в приватный backup и удалены. Vendor/core files и действующий Nginx profile не изменялись.

Очищенный bundle `var/evidence/admin-completion/evidence.json`, SHA `c4d51e798de496eb3c5f8870db38b211e2bd7ef039b7340df7a5bd6fe6128799`, восемь исходных receipts. Store artifact `art-6eb3e3e4-e520-46f4-8101-494c3d520763`. Не содержит SQL dump, пароля или license key. Независимый review: `docs/reviews/admin-completion.md`.

## Продолжение

Администратора повторно создавать не нужно. Штатный solution wizard намеренно не исполнялся: он может менять index.php и ставить готовое решение; используется собственный Upgrade template/router. Лицензия NOT_VERIFIED, браузерная админка/редактирование/конфликты и SQL recovery NOT_RUN. Пилот по-прежнему содержит1из25known URL, full source UNKNOWN, дизайн/торговые функции незавершённы; общий NOT_READY сохраняется.

## Пользователь процесса Upgrade

CLI/Store пилота выполняется от системного пользователя upgrade: `runuser -u upgrade -- /opt/upgrade/runtime/node-v24.20.0-linux-x64/bin/node /opt/upgrade/current/packages/cli/index.ts ...`. Root выполняет системную подготовку и единственные целевые docker exec, но не создаёт новые immutable artifacts в рабочем Store напрямую. Non-root validation выявила старые root-owned artifacts; восстановление владельца ограничено только рабочим проектом, private Bitrix credentials не затронуты. Новые контрольные копии этой стадии находятся под `/opt/upgrade/shared/checkpoints/teplypol-market-r9-admin-operator`.
