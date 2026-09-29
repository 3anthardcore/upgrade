# Совместимость и границы окружения

Дата проверки: 29 сентября 2026. Lock-файл — первичный источник версий JS-зависимостей; сторонние серверы и версии Битрикс проверяются при отдельном интеграционном запуске.

| Компонент | Зафиксировано/наблюдалось | Статус |
|---|---|---|
| Node.js | `>=24.0.0 <25`; локально 24.20.0 | PASS: native TS type stripping, node:sqlite, unit/integration tests. |
| npm dependencies | Ajv 8.20.0; Cheerio 1.2.0; Playwright 1.63.0; YAML 2.9.1 | package.json + package-lock.json; устанавливать `npm ci`. |
| TypeScript | 7.0.2; @types/node 26.6.3 | Статическая проверка не доказывает наличие API Node 26; фактический runtime — Node 24. |
| Chromium | 153.0.8010.12, Playwright install | PASS: настоящий browser discovery, JS/lazy links и блокировка POST fixture. |
| Codex CLI | 0.154.0 | PASS: два реальных параллельных `codex exec` и структурированные результаты. Доступная модель назначается явно; другие версии требуют probe и regression. |
| Windows | Текущая среда разработки | PASS для перечисленных локальных тестов. Эксплуатационный путь из ТЗ — Linux/WSL2. |
| Linux/WSL2 | Архитектурный путь | Полный runtime/test набор Linux в этой ревизии не подтверждён. |
| PHP | Локально официальный PHP 8.3.35 NTS Windows; Dockerfile требует выбранный PHP 8.3 image по digest | PASS: 16 файлов `php -n -l`; настоящий validator с положительными/отрицательными пакетами и 10 package tests PASS. Реальный Битрикс NOT_RUN. |
| MySQL | Compose требует выбранный MySQL 8.0+ по digest | NOT_RUN на настоящем target. |
| Nginx | Compose требует проверенный image по digest | NOT_RUN маршруты/canonical/redirects на целевой установке. |
| Битрикс | Дистрибутив и лицензия не поставляются репозиторием | Версия/редакция и совместимость не подтверждены; DEMO_READY запрещён. |

В Compose намеренно нет выдуманных digest и плавающего latest. Оператор фиксирует реально проверенные PHP/Nginx/MySQL images. Существование Docker CLI не означает доступный daemon; `doctor` различает это. Разрешения процессов браузера/агентов и изоляция целевой сети проверяются отдельно.

Локальный PHP расположен в исключённом из Git `var/tools/php-8.3.35/`; SHA-256 проверенного архива `25a8e2ac9ff30f1d768d1447c09a600617fa6e6082729f6e95f008b59c91fe45`. Сам PHP runtime в репозиторий не поставляется. Для воспроизведения targeted tests задать абсолютные `UPGRADE_PHP_BIN` и `UPGRADE_PHP_EXT_DIR`, затем `node --disable-warning=ExperimentalWarning --test tests/unit/bitrix.test.ts`. См. [целевой runbook](bitrix.md).

## Предоставленный хост приложения

Отдельно проверен хост приложения: Ubuntu 22.04.5, системный Node.js 22.13.1. После разрешённого расширения раздела/LVM/ext4 размер `/` 157G, свободно около 95G до установки runtime. PHP отсутствует в host PATH, Битрикс не проверен. Это снимок проверки, не постоянные характеристики сервера. Он **не является настроенным target Битрикс**.

В `/opt/upgrade` установлен отдельный Node 24.20.0 и Chromium; реальный Linux browser integration прошёл. Полный source/offline/restore smoke повторяется после исправления no-op CLI через current symlink и скопированной dispatcher lease; актуальный итог — в `PROGRESS.md`. Системный Node и 22 соседних контейнера сохранены. Codex CLI 0.154.0 установлен отдельно с проверенным npm integrity, версия/exec flags проверены, auth **Not logged in**. Не переносить local Codex auth автоматически: серверный CLI авторизуется отдельно. Нужны выбранная модель и бюджет; local AT-22 не доказывает серверный доступ.

## Неизвестные интеграционные параметры

Для первого настоящего демо нужны пилотный URL и зафиксированный scope, редакция/лицензия и версия Битрикс, отдельный document root и БД, профиль исходящих ограничений до bootstrap, private state/backup paths, доступ к закрытому demo URL, секреты вне Git и фактические image digest. Каталог/магазин дополнительно требуют подтверждённых источников цен/наличия и согласованных функций.

Отсутствующие параметры не мешают локальным fixtures, contract tests, пакетированию и review; они блокируют только соответствующее внешнее испытание. Три пилота, 10 000 HTML/50 000 ресурсов, production delta и настоящий backup/restore остаются NOT_RUN.
