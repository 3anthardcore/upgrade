# Целевой адаптер Битрикс: состояние и запуск

Реализован пакет собственного кода и шлюз для изолированного `public-demo`. Это ещё **не проверенная установка Битрикс и не готовый магазин**. Реальные БД Битрикс, административное редактирование, HTTP, фоновые события и восстановление целого сайта имеют статус `NOT_RUN` до интеграционного запуска.

## Что исполняется

`packages/bitrix-adapter/index.ts` экспортирует `buildBitrixPackage(input)` и `validateBitrixPackage(directory, projectId, expectedManifestHash?)`. Вход — независимые от CMS сущности и точные маршруты. Выход — новая неизменяемая директория с JSON manifest/schema version, SHA-256 каждого файла, данными, локальными ресурсами и собственным PHP-кодом. Валидаторы отвергают файлы вне manifest, symlink и изменение самого принятого manifest. Повторная сборка в существующую директорию запрещена; повторное использование принятой сборки не вызывает LLM.

`assets` принимаются только из указанного `assetRoot`, после realpath-проверки, SHA-256 и проверки сигнатуры. Поддержаны PNG, JPEG, GIF, WebP, AVIF, PDF. SVG и HTML не исполняются и не импортируются. Неизвестные/отсутствующие медиа — блокер пакета. PHP повторно сверяет MIME через `finfo`, относительные пути, схемы и хеши. В публичном содержимом используются свои `/upload/upgrade/<project>/<sha256>.<ext>`; hotlink не нужен.

Принятые токены цвета, шрифта, размера текста/заголовка, высоты строки, скругления, ширины и отступа применяются к CSS пакета. Значения проходят ограниченную проверку синтаксиса; CSS injection отклоняется. Массив breakpoints описывает контрольные ширины QA; адаптивные правила остаются общими в собственном stylesheet. Проверка эстетики/контрастности произвольной новой палитры требует отдельного визуального review.

`bitrix/importer/cli.php` — единственный программный шлюз записи. Команды:

```text
validate   Проверка manifest SHA, проекта, версии, хешей, ресурсов и связей до bootstrap Битрикс
dry-run    Чтение назначения, reconciliation внешних ключей и обнаружение ручных правок
claim      Получение следующего fencing token под flock и блокировкой строки проекта
apply      Обязательный проверенный backup, dry-run, media, ограниченные транзакции, mapping, журнал, routes, индексы, reconcile
reconcile  Сравнение всего входного пакета с текущими элементами, маршрутами и файлами
```

Импорт требует `UPGRADE_DEMO=1`, `UPGRADE_PROJECT_ID` с точным проектом, приватный каталог состояния вне web-root и ожидаемый SHA-256 **принятого manifest** из состояния Upgrade. Перед bootstrap дополнительно проверяется маркер обязательного `/opt/upgrade/prepend.php`, auto_prepend_file и запрет mail/process-функций; одних env-флагов недостаточно. Изменение manifest и его файлов нельзя разрешать простым пересчётом хешей. Стандартный профиль не допускает production.

## Соответствие данных

| Upgrade | Назначение | Уникальность и управление |
|---|---|---|
| Page, Service, Article, контакты, представление категории | CIBlockElement собственного инфоблока | XML_ID = `upgrade:` + SHA-256(JSON `[project,type,source_id]`) |
| Product | Редактируемый информационный снимок CIBlockElement | Собственный устойчивый source_id; не объединяется по SKU/названию |
| Текстовые блоки | DETAIL_TEXT, составленный из экранированных paragraph/heading/list/table/quote | Не исполняется HTML/JS источника |
| Изображение / документ | content-addressed файл + image/document блок | SHA-256; отдельная от БД запись; временные и бесхозные файлы перечисляются |
| title, description, H1, факты | Собственные свойства UG_SEO_TITLE, UG_DESCRIPTION, UG_H1, UG_FACTS | Видны в штатной админке; управляемые поля защищены от молчаливого затирания |
| Route | `ug_route` собственного модуля | Индекс `(PROJECT_ID, SHA256(request_target))` и точное сравнение |
| source_id → bitrix_id | `ug_entity` собственного модуля | Привязка независима от NAME и CODE |
| Владение и операции | `ug_project`, `ug_operation` | Lease, fence, один flock, транзакционный журнал |

Нет прямого SQL для таблиц ядра. Собственные SQL-таблицы используют MySQL/InnoDB; элементы/свойства — `CIBlockElement::Add/Update`, `SetPropertyValuesEx`, инфоблоки/установка — `CIBlock*`, состояние модуля — D7. Транзакция объединяет элемент, его соответствие и запись операции. Если процесс завершился после commit без локального checkpoint, повтор читает назначение и пропускает совпадающее состояние. Неизвестный внешний элемент с отличающимися полями и правки владельца дают конфликт. Удаление отсутствующих сущностей/маршрутов не выполняется.

Наличие Product **не означает** реальные торговые предложения, каталог D7, цены/наличие, фасетный фильтр, корзину, checkout, 1С или оплату. Offer и другие неподдержанные сущности блокируют применение. Эти функции требуют отдельного профиля и испытаний на подходящей редакции Битрикс. Поиск, динамические фильтры/пагинация, формы с тестовым приёмником, настройки общих контактов/логотипа, полный перенос ссылок/якорей, hreflang, structured data, canonical/sitemap, перенос разделов в `CIBlockSection` и управление меню через админку ещё не реализованы. Маршруты обрабатываются по точному наблюдаемому request-target; непросмотренные состояния query не объявляются реализованными.

## Подготовка отдельного назначения

1. Оператор предоставляет лицензированный дистрибутив/тестовую установку, редакцию и версию, отдельный Linux/WSL2 Docker host, место на диске, demo hostname, TLS при внешнем доступе и secret store. Дистрибутив не хранится в Git и не скачивается/лицензируется автоматически.
2. Создать отдельные site/state/secrets/backup-каталоги и отдельный Compose project. Не использовать рабочую БД и каталоги исходного сайта. Файлы настроек Битрикс должны указывать только на `db` из данной сети и отдельные учётные данные.
3. Выбрать проверенные образы PHP 8.3, MySQL 8.0+, Nginx, закрепить реальные digest в окружении и сохранить версии в `infra/runtime-manifest.json` для данного выпуска. Пример `.env.example` преднамеренно не запускается с фиктивными digest. Сборка расширений использует apt; для полностью воспроизводимой сборки зафиксировать итоговый PHP image digest после проверки.
4. `bash infra/provisioning/preflight.sh`. Подготовить собственный PHP image до монтирования любых файлов клиента. Перед первым PHP контейнер обязан быть только в `internal: true` сети. У контейнеров нет cron/MTA/host networking. Mail/process execution отключены, PHP prepend подавляет фоновые события. Это дополнительные меры; основная граница — сеть.
5. Сначала запустить БД и проверить Compose network inspect/egress с инертным образом в той же сети. Попытки к внешнему HTTPS, DNS, SMTP, webhook и службам host bridge должны быть заблокированы; при необходимости дополнить Docker сеть политикой host firewall. Только затем запускать PHP Битрикс. Нельзя считать флаг `UPGRADE_DEMO` или один `internal: true` доказательством сетевой изоляции.
6. Compose публикует Nginx только на `127.0.0.1:8090`, доступ требует отдельного htpasswd, ответы содержат `X-Robots-Tag`, robots запрещает индексацию. Для внешнего доступа необходим ограниченный TLS reverse proxy/VPN и отзыв доступа. Nginx направляет публичные пути в один собственный `/local/upgrade-route.php`; `/bitrix`, `/local`, `/upload` и физические коллизии проверяются отдельно.

## Установка собственного кода и импорт

После bootstrap чистой лицензированной установки в уже изолированном контуре сделать per-project backup (`infra/backup/backup.sh`). Передать в `UPGRADE_PACKAGE` путь принятого пакета, в `UPGRADE_MANIFEST_SHA256` — сохранённый хеш manifest; в `UPGRADE_BACKUP_RECEIPT` — квитанцию проверенного backup. `bash infra/provisioning/deploy-code.sh` копирует только собственные `local/modules/upgrade.core`, `local/components/upgrade`, `local/templates/upgrade`, `local/upgrade-route.php`. Изменения ядра, поставщиков и серверных файлов соседних сайтов не требуются.

Внутри изолированного PHP-сервиса, где пакет доступен по `/var/lib/upgrade/release`:

```bash
php /var/lib/upgrade/release/code/migrations/install.php --document-root=/var/www/html --project=example-demo --site=s1 --state-dir=/var/lib/upgrade
php /var/lib/upgrade/release/code/importer/cli.php --command=dry-run --package=/var/lib/upgrade/release --project=example-demo --manifest-sha256="$UPGRADE_MANIFEST_SHA256" --document-root=/var/www/html --state-dir=/var/lib/upgrade
php /var/lib/upgrade/release/code/importer/cli.php --command=claim --package=/var/lib/upgrade/release --project=example-demo --manifest-sha256="$UPGRADE_MANIFEST_SHA256" --document-root=/var/www/html --state-dir=/var/lib/upgrade --owner=operator-1
```

Сохранить возвращённый fence в состоянии запуска. Вызов `apply` использует тот же project/package/hash/owner/root/state и `--fence=<актуальный token> --backup-receipt=<путь receipt.json> --backup-receipt-sha256=<принятый хеш квитанции>`. Backup связан с отдельным постоянным `UPGRADE_TARGET_ID` назначения и должен быть не старше 24 часов. Для deploy-code аналогичные ссылки передаются через `UPGRADE_BACKUP_RECEIPT_SHA256` и `UPGRADE_TARGET_ID`. Пути файлов backup в receipt должны быть доступны из PHP-контейнера. Lease составляет 300 секунд; истёкший token блокирует следующий пакет или commit. После истечения получить новый claim и повторить: шлюз сверяет назначение. `reconcile` проверяет весь пакет, а не локальные checkpoint.

Файл manifest SHA должен приходить из принятого состояния; команда validate не делает недоверенный пакет принятым. Шлюз не проверен для мультихостового развёртывания: один CLI writer host и приватный каталог flock обязательны. Роли агентов не получают реквизиты целевой БД. При наличии прямого административного доступа внешняя ручная запись не может быть предотвращена CLI, но будет обнаружена при сравнении управляемых полей.

## Обязательные испытания настоящего Битрикс

- Импорт небольшого пакета, повтор без дублей, kill до и после commit и reconciliation после неизвестного ответа.
- Два процесса gateway, устаревший fence, истечение lease, чужой project, неизвестный XML_ID, конфликт ручных правок.
- Изменить NAME/DETAIL_TEXT/SEO через штатную админку: публичный вывод отражает изменения; повтор импорта не стирает их, URL не меняется.
- Запросить каждый адрес исходного scope, редиректы, 404/410, регистр, `%2F`, кириллицу, повторяющиеся/пустые query. Проверить физические и служебные коллизии.
- Отключить источник; загрузить локальные медиа. Проверить 360/390/768/1024/1440, клавиатуру, открытие меню, длинные тексты, таблицы и пустое содержимое.
- Подтвердить отсутствие исходящих mail/webhook/платежей до первого hit и после него, включая административный вход.
- Backup → пустое изолированное назначение → DB import → HTTP/admin/browser smoke; отдельный протокол восстановления.

## Backup и восстановление

`backup.sh` принимает секретный MySQL defaults-файл, создаёт новый каталог конкретного проекта, SQL dump, архив файлов и хеш-квитанцию. Архиватор не кладёт пароли в аргументы/log. Квитанция `INTEGRITY_VERIFIED` подтверждает только хеши/читаемость архива, не работающий восстановленный сайт.

`python3 infra/backup/restore-prepare.py --receipt <receipt.json> --project <id> --new-root <absent-directory>` сверяет хеши и проект, отказывается от существующего назначения, traversal, symlink/hardlink/device members. Извлечение выполняется только в новое назначение; БД не открывается. SQL импортировать в отдельную пустую БД внутри уже изолированного Compose-проекта. Исходные пути/credentials/host должны быть изменены до первого PHP. Запустить smoke и сохранить реальные RPO/RTO. Это не автоматическое восстановление production. Переключение/откат production и сохранение новых заказов — отдельная работа с отдельным разрешением.

## Фактическая проверка разработки

На 29.09.2026:

- `npm run check` — PASS.
- `node --test tests/unit/bitrix.test.ts` с `UPGRADE_PHP_BIN` и `UPGRADE_PHP_EXT_DIR` — 10 PASS; в том числе настоящий PHP-валидатор без bootstrap Битрикс, изменение CSS по токенам и запрет CSS injection. Без PHP проверка явно SKIP.
- Все 16 PHP-файлов — `php -n -l` PASS под официальным PHP 8.3.35 NTS. Для локальной проверки использован архив с SHA-256 `25a8e2ac9ff30f1d768d1447c09a600617fa6e6082729f6e95f008b59c91fe45`, распакованный в игнорируемый `var/tools/`; это не утверждение совместимости Битрикс.
- `node --test tests/e2e/bitrix-template.test.ts` — PASS: настоящий PHP-рендерер блоков и собственные шаблоны через HTTP, ширины 360/390/768/1024/1440, меню, клавиатура, экранирование source script и HTTP 404. Прокручиваемая таблица получает фокус, ArrowRight меняет scrollLeft; последняя ячейка доступна. Это **только контракт шаблона с тестовым APPLICATION**, не интеграция Битрикс. Скриншоты и отчёт: `var/evidence/bitrix-template/`.
- `bash -n` для preflight/deploy-code/backup в WSL — PASS.
- `python3 infra/backup/test_restore.py` в WSL — 5 PASS: извлечение синтетического архива в новый каталог, отказ для чужого проекта, существующего назначения, повреждённого SQL и traversal. Это контракт файлового восстановления; БД Битрикс не восстанавливалась.
- Docker Compose запуск, Nginx config test, D7/CIBlock runtime, реальный импорт, административные и браузерные проверки Битрикс, сетевое испытание первого запуска, восстановление БД — **NOT_RUN**.

Следующий шаг: предоставить отдельную лицензированную установку и ресурсы, зафиксировать совместимость и image digest, затем провести перечисленные испытания. До этого `DEMO_READY` недопустим.

## Проверенные первичные источники

Проверены 29.09.2026: [требования Битрикс](https://www.1c-bitrix.ru/products/cms/requirements.php), [API инфоблоков](https://docs.1c-bitrix.ru/pages/modules/iblocks/api.html), [CIBlockElement::Update](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblockelement/update.php), [CIBlock API/cache](https://docs.1c-bitrix.ru/api/classes/CIBlock.html), [D7 startTransaction](https://dev.1c-bitrix.ru/api_d7/bitrix/main/db/connection/starttransaction.php), [D7 commitTransaction](https://dev.1c-bitrix.ru/api_d7/bitrix/main/db/connection/committransaction.php), [CSite::Update](https://dev.1c-bitrix.ru/api_help/main/reference/csite/update.php), [обработка адресов и физические коллизии](https://dev.1c-bitrix.ru/api_help/main/general/urlrewrite.php), [официальный PHP Windows 8.3](https://www.php.net/downloads.php?os=windows&version=8.3).
