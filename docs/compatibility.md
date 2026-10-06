# Совместимость и проверенные границы

**Текущий срез07:44UTC:** app r16, target389 с native apply/reconcile/replay/factual readback и389HTTP/2345media PASS; native synthetic HTTPS/Chromium PASS, PHP restart persistence PASS. V6 исторический r12/103 isolated restore PASS, current private-state restore NOT_RUN. Native API-edit/conflict/restore/HTTP PASS, browser-admin NOT_RUN. Target-evidence V2 реально ingested/replayed с одинаковым result artifact. Suite перед r16:419/419 и E2E25/25,0SKIP. Ниже сохранён совместимый исторический срез06:50 с его тогдашними ограничениями; записи RUNNING/ожидания в нём заменены только перечисленными позднейшими доказательствами. Общая готовность PARTIAL/NOT_READY и UNKNOWN источника сохраняются.

Контрольная точка: **30 сентября 2026, 06:50 UTC**. Версии относятся к наблюдавшимся средам, PASS — к указанным сценариям и ревизиям. Последующие native результаты фиксируются в [контрольных точках пилота](pilots/completion-20260930.md) и [PROGRESS](PROGRESS.md). Lock-файл задаёт зависимости приложения; библиотечная совместимость не означает завершённость миграции.

| Компонент | Наблюдалось | Область доказательства |
| --- | --- | --- |
| Node.js | Требуется `>=24.0.0 <25`; локально и в отдельном серверном runtime 24.20.0 | Native TS, `node:sqlite`, CLI и сохранённое состояние. Системный Node других приложений не заменяется. |
| JS-зависимости | Ajv 8.20.0, Cheerio 1.2.0, Playwright 1.63.0, YAML 2.9.1 | Закреплены `package-lock.json`; установка `npm ci`. |
| Статическая проверка | TypeScript 7.0.2, `@types/node` 26.6.3 | `npm run check` PASS; типы Node 26 не меняют требование фактического Node 24. |
| Chromium | Наблюдавшийся Playwright Chromium 153.0.8010.12 | Настоящие локальные browser discovery и PHP demo flow, в том числе без JS и на пяти ширинах. Это не native CMS evidence. |
| Codex CLI | 0.154.0 | Исторический PASS двух реальных параллельных `codex exec`, schema outputs и review; серверная авторизация отдельно. Другие версии/модели требуют probe. |
| Windows | Среда разработки, официальный PHP 8.3.35 NTS | Последний сохранённый suite: 407/407 unit/integration, 25/25 E2E, 0 SKIP. Эти PASS не отменяют найденные позже дефекты. |
| Linux / WSL2 | Ubuntu-хост и отдельный Node 24; WSL для ограниченных проверок | Реальный Linux CLI/browser smoke и native пилот выполнены; recovery Python contract suite также повторён в WSL. Полный Windows suite не объявляется полным Linux suite. |
| PHP target | 8.3.35 внутри отдельного PHP service | Реальные Bitrix bootstrap, r12 импорт/повтор/readback и admin API. Новый transport также прошёл ограниченный native probe uid33: D7 query/post/cookie пусты, methodGET, own request сохранён. Native interactive HTTP/browser сценарии ещё не подтверждены. |
| Docker | На сервере наблюдался Engine 29.1.3 | Отдельные Upgrade сети/контейнеры; compose/images закрепляются фактическими digest/IDs. Проверки затрагивают только собственный target. |
| MySQL / Nginx | Изолированный работающий target, версии/images закреплены серверными receipts | Реальные r12 операции БД, HTTPS/маршруты/media проверены. Этот результат не переносится на другой image или пакет автоматически. |
| «1С-Битрикс: Управление сайтом» | Business; main 26.150.0, iblock 25.300.0, catalog 25.550.0, sale 26.0.0 | Настоящий CMS установлен. Исторически проверены 103 страницы r12; собственные расширения `/local`, без правок ядра. Другие редакции/версии не аттестованы. |
| Лицензия | Локально `isDemo=false`, `isDemoKey=false`, `isTimeBound=false`; даты и имя пусты | Наблюдение локального API, **не доказательство удалённой активации**. Remote activation NOT_RUN; ключ вне Git/логов. |
| Администратор | Один технический аккаунт; API Add/Login и повторный readback проверены | [Account/API review](reviews/admin-completion.md). Browser admin, штатное завершение wizard и native редактирование с конфликтом не следуют из этого PASS. |

PHP для локальных тестов размещён в игнорируемом `var/tools/php-8.3.35/`; SHA-256 скачанного архива `25a8e2ac9ff30f1d768d1447c09a600617fa6e6082729f6e95f008b59c91fe45`. Runtime не поставляется репозиторием. Задайте абсолютные `UPGRADE_PHP_BIN` и, для Windows, `UPGRADE_PHP_EXT_DIR`; отсутствие PHP и SKIP не подтверждают проверку. MySQL/Nginx/PHP images берутся из принятого target-профиля и серверной аттестации, не из плавающего `latest`.

## Три разные области размещения

| Область | Пилотный путь / назначение | Кто пишет |
| --- | --- | --- |
| Приложение | `/opt/upgrade`, versioned releases и отдельный Node 24; текущий CLI r15 | Уполномоченный deploy-оператор; не изменяет системный Node. |
| Content Store | `/opt/upgrade/shared/projects/teplypol-market` | CLI от пользователя `upgrade`; задачи/leases/artifacts/история. Privileged target transport этот Store не открывает. |
| CMS target | `/opt/upgrade/targets/teplypol-market/cms-root`; private `state` вне webroot | Один target writer; PHP от uid/gid 33:33; отдельные БД, network guard и журнал native transport. |

Сервер приложения и CMS физически могут находиться на одном хосте; это разные root/state/process/network scopes. Ubuntu 22.04.5 и системный Node 22.13.1 — ранее зафиксированные характеристики хоста. Текущий свободный диск, контейнерные IDs и auth нужно читать перед соответствующей операцией, а не брать из старого отчёта. Соседние пользовательские проекты не входят в область Upgrade.

Серверный Codex CLI ранее проверен как установленный, но без авторизации. Локальный AT-22 не доказывает серверный доступ. Авторизация сервера выполняется отдельно; локальные credentials не переносятся автоматически. Внутренние CUA/IAB инструменты Codex не являются API проекта: оператор передаёт переносимый capture, а автоматический адаптер запускает документированный `codex exec`.

## Статус новой ревизии и незакрытые условия

- CMS r12 / 103 страницы имеет [ограниченную native приёмку](reviews/catalog-target-r12.md). App остаётся r15. Собственный код нового пакета 389 entities/routes установлен и сверён; actual dry-run: 286 created / 1 updated / 102 skipped, conflicts0/blockers0. Это план записи, не её результат: **apply RUNNING**, принятого нового native import пока нет.
- Полный capture v8: 948 DOM, 2742 известных URL. Stage сохраняет весь реестр, использует 389 страниц и откладывает 559; 299 PDF ещё отсутствуют. Полный размер источника UNKNOWN. Ни 389/389 package validation, ни r12 HTTP PASS не доказывают полноту.
- Commerce V3 и Engine/Web/View/Runtime имеют независимые локальные проверки, включая реальные PHP/Chromium процессы. Это локальная функциональность, а не подтверждённый native checkout. Native catalog offers/SKU/stock и настоящие платёжные/почтовые интеграции не реализованы данным демо.
- Recovery V2/V3/V4 попытки имеют сохранённые FAIL. V5 выполнил SQL/files/counts/isolation/HTTP проверки, но общий результат **FAILED**: source-runtime comparator считал изменением порядок Docker Mounts. Отдельная canonical identity/guard сверка PASS не переписывает исходный FAIL. V6 с сортировкой имеет 44 Python PASS от root; новый native план ожидается. [История executor](reviews/native-restore-runner-20260930.md), [независимый V4 review](reviews/native-restore-independent-v4-20260930.md).
- `target-evidence ingest` V1 получил **REJECT** за stale-writer, неполную проверку source payload и повреждённый replay intent. Исправленный V2 принят root после 38 tests, включая три сохранённых независимых воспроизведения; приложение с этим исправлением **ещё не развёрнуто**. Общий suite 407 PASS относится к отдельному сохранённому прогону. [Независимый review и история](reviews/target-evidence-independent-20260930.md).
- `run --until demo-ready`, `doctor`, HTTP/browser/admin/restore и итоговые readiness gates ещё не образуют полностью автоматический native цикл. Проверки выполняются этапами по [runbook](runbooks/internal-demo.md). DEMO_READY запрещён при FAIL/NOT_RUN обязательных критериев.
- Два дополнительных пилота, масштабы 10 000 HTML / 50 000 ресурсов, полная проверка SEO/контента/сценариев, native admin edit/conflict и production delta/switch остаются отдельными незакрытыми условиями. [Аудит](reviews/final-gap-audit-20260930.md) и [матрица](requirements-tests.md) уточняют критерии.

Дистрибутив Business, лицензия, БД и секреты не поставляются проектом. Для нового target нужны свои разрешённые доступы, отдельные root/БД/state, принятые pins, backup и проверенная изоляция до первого bootstrap. Пилотные адреса/контейнеры нельзя переносить в новый профиль без проверки.
