# Ход реализации

Актуальная запись находится в конце файла. Предыдущие разделы сохраняют историю этапов; их прежние блокеры не заменяют более поздние фактические результаты.

## Начальная проверка
- Репозиторий пустой, ветка master, коммитов нет. Существующих проектных инструкций не найдено.
- Windows Node 24.20.0, npm 11.19.0, Codex CLI 0.154.0; WSL Ubuntu обнаружен.
- `codex exec --help`: фактически доступны `--json`, `--output-schema`, `--output-last-message`, `--sandbox`, `--cd`.
- Битрикс, лицензия, сервер, пилотные URL не предоставлены: соответствующие интеграционные проверки NOT_RUN.
- Следующий шаг: ядро и независимые модули; конкретные результаты ниже добавляются после запусков.

## Этапы 0–1 — исполняемое ядро, выполненная часть
- Созданы AGENTS.md, CLI, схемы JSON Schema/Ajv, конфигурация, SQLite task/event/artifact store, leases/fencing, бюджет, независимый review, resume, отмена, checksum и backup/restore Upgrade.
- `npm run check` — PASS. Unit/integration проверки восстановления/повтора/конфликтов/повреждения/lease/бюджета фактически выполнялись.
- Независимый review воспроизвёл 3 ошибки (absolute deadline, неподтверждённый status, async stage). Исправлены; регрессионные тесты PASS. Дополнительно исправлены учёт истёкшего резерва и проверка dispatcher перед записью.
- Ограничения: локальный доверенный оператор; полномочия review не отделены отдельными OS credentials. Полное многопользовательское разграничение не заявляется. Нет автоматического публичного SaaS.

## Этапы 2–3 — исследование и модель, выполненная часть
- HTTP с DNS/IP pinning, robots, sitemap/index, долговечная очередь, bounded retries/bytes/time, свежий Chromium с GET-only mediation, JS/lazy links, запрет source POST/WS.
- Модель содержит Page/Product/Article/Service, наблюдаемые Offer/PriceObservation, evidence и типизированные блоки. Извлекаются ровно наблюдаемые комбинации, неизвестные цены не становятся нулём.
- Реальные проверки fixture: точные пути/query/case/%2F, canonical не сливает страницы, одинаковый SKU не сливает товары, media SHA, SVG exclusion, slow-stream deadline, zero source side effects.
- Ограничения: hash SPA, source consistency recheck, сжатые sitemap, 10k/50k нагрузка и полные связи CMS — не завершены. Полнота ограничена найденными источниками и неизменяемым scope.

## Этап 4 — Битрикс, код создан, интеграция NOT_RUN
- Собственный upgrade.core, migrations, CLI-only gateway, template/components, exact URL registry, manifest hashes, managed-field conflict policy, target fencing/reconcile, локальные медиа.
- Получен официальный PHP 8.3.35 с проверенным SHA-256 в ignored var/tools. PHP lint собственных файлов PASS; настоящий PHP валидатор принимает корректный пакет и отклоняет foreign project/tampering до bootstrap.
- Независимый review нашёл unlisted executable injection и bootstrap без обязательной изоляции PHP. Исправлены, отрицательные тесты PASS.
- **Не проверены:** установленный Битрикс, лицензия/редакция, целевые транзакции MySQL, публичная выдача и админка. Контент товаров — snapshot, не полноценный каталог с commerce.

## Этап 5 — реальный адаптер и команда, выполненная часть
- Codex CLI 0.154.0, документированный exec --json/--output-schema. 10 ролей загружаются из agents/ и хешируются; собственные job/event/result сохраняются на диске.
- `npm run test:agents` — AT-22 PASS: два действительных процесса, overlap **3993 ms**, task IDs smoke-researcher/smoke-analyst, независимые schema/fact/hash checks и ACCEPTED.
- Фактический usage: input 9580+9562, output 27+26; денежная стоимость UNAVAILABLE. Подтверждение: `var/agent-smoke-1790638572859/agent-smoke-report.json`.
- Автоматический профиль без model tools. Tool-using code agents/серверная авторизация Codex не объявляются проверенными этим тестом.

## Этапы 6–7 — шаблон и проверки, выполненная часть
- Общий PHP-шаблон, безопасные блоки, локальные медиа, noindex/demo label; дизайн-токены и brief сохраняются. CLI source → model → Bitrix package → QA/report реально запущен.
- `npm run demo:fixture` сохранил source/state/package/report; source side effects **0**. Демо на Битрикс не запускалось; отчёт NOT_READY, run BLOCKED.
- Сквозной тест после отключения источника повторно собирает те же данные/маршруты. Backup переносится в иной каталог, потом accepted artifacts и release проверяются там.
- Собственный PHP-renderer/template проверен реальным Chromium на **360/390/768/1024/1440 px**, menu/keyboard/404. Скриншоты визуально просмотрены интегратором. Это **OWN_TEMPLATE_CONTRACT_ONLY**, не Bitrix integration.
- Последний полный набор на данном этапе: `npm test` **45 PASS / 0 FAIL / 0 SKIP**, `npm run test:e2e` **2 PASS / 0 FAIL / 0 SKIP**, с UPGRADE_PHP_BIN/UPGRADE_PHP_EXT_DIR. Выводы: `var/evidence/tests-local.txt`, `var/evidence/e2e-local.txt`. Дальнейшие исправления требуют обновить итог ниже.

## Этап 8 — эксплуатация, частично
- Backup SQLite через штатный backup API и файловый manifest; независимое восстановление Upgrade PASS.
- Compose target с internal network, отдельными credentials/volumes, auth/noindex, disabled mail/cron/outbound guards; проверка исполнения настоящего клона **NOT_RUN**.
- Производственное внедрение, delta новых заказов, RPO/RTO и production rollback **NOT_RUN**.

## Сервер Upgrade — проверка 29 сентября 2026
- Пользователь предоставил `upgrade.help-ai-ru.ru`, SSH к `148.135.208.53` для самого приложения. DNS указывает на этот IP. Чужие проекты/контейнеры сохранены; Nginx не изменялся.
- Ubuntu 22.04.5, системный Node 22.13.1, Docker работает, PHP в host PATH отсутствует. Системный Node не заменять: он используется соседними приложениями.
- Уточнение диска: физический `/dev/sda` **171798691840 bytes (160 GiB)**, `/dev/sda3` **63348653568 bytes**, LVM `/dev/hk/root` около **59 GiB**, ext4 **58 GiB**, свободно примерно **502 MiB**. Дополнительное место ещё не включено в раздел/LVM/FS.
- Сохранены `/root/upgrade-preflight/sda-before-20260929.sfdisk` и `hk-before-20260929.vgcfg`. `growpart -N /dev/sda 3` показал сохранение начала 2101248 sectors и расширение длины 123727839 → 333443039 sectors. Только dry-run, диск пока не изменён.
- Запрошено отдельное подтверждение системного расширения growpart → pvresize → lvextend/resize2fs. Пока оно не получено, зависимое развёртывание не выполняется. Исходники и локальные независимые проверки продолжаются.

## Остаток до полноценного результата
1. Развернуть/проверить собственный Linux runtime Upgrade после исправления распределения диска; отдельная авторизация Codex, если агенты будут исполняться на сервере.
2. Предоставить/настроить лицензированную изолированную установку Битрикс и исходный пилотный URL. Пройти import/reconcile/admin/URL/факты/функции/изоляцию/restore на настоящей CMS.
3. Доработать catalog offers/prices/filters/search/cart/form sandbox, hash routes и остальные PARTIAL из матрицы; текущий snapshot не выдаётся за работающий магазин.
4. Три разных пилота, нагрузка 10k/50k, accessibility/performance, разрешённое production-переключение — отдельные непроведённые испытания.

Продолжение: читать эту запись, `docs/requirements-tests.md`, `upgrade status`, последние immutable artifacts и events. Не повторять прошедшие этапы без изменения кода/входов/окружения.

## Контрольная точка перед серверной установкой
- `npm run check` — PASS; `npm test` — **51 PASS / 0 FAIL / 0 SKIP** с PHP env; `npm run test:e2e` — **2 PASS / 0 FAIL / 0 SKIP**. Логи: `var/evidence/tests-final.txt`, `e2e-final.txt`.
- Проверены: два отдельных процесса не получают одно владение; отмена сохранённого job останавливает настоящий subprocess; потерявший dispatcher право не публикует; crawl возобновляется после переноса snapshots; asset limit сохраняет pending scope; design tokens меняют CSS и не принимают injection.
- Повторный CLI init теперь не меняет сохранённый профиль существующего проекта; project и profile фиксируются одной транзакцией. Регрессия включена в E2E и прошла.
- `npm run demo:fixture` — повторная сборка из состояния `fixture-demo-v2`, source side effects **0**, отчёт **NOT_READY**, запуск **BLOCKED**. Это пакет по синтетическому источнику, не развёрнутый сайт Битрикс.
- Системный диск и другие серверные приложения не изменялись. Следующий зависимый шаг: подтверждённое расширение корневого раздела, затем изолированная установка Upgrade. Настоящий Битрикс и пилот остаются отдельными блокерами.
- Диагностика и точные последовательные команды дискового шага: `docs/runbooks/server-capacity.md`. Это подготовленный план, не выполненное расширение.
- SQLite проекта `upgrade-development` содержит задачи команды, принятые результаты с SHA-256 исходников/проверок и аудит. Приёмка ограниченного этапа разработки не означает готовность продукта или успешный импорт в Битрикс.
- Установщик прошёл независимый review и локальные отрицательные проверки: root-only logs, принятый manifest вне writable staging, проверенная root-only копия входного архива, лимиты до распаковки, отказ при прерванном staging. Отчёты `var/deploy-security-report.json`, `var/manifest-only-report.json`; Bash syntax и TypeScript PASS. Упаковка содержит Dockerfile и Python restore tools. Server install/rollback **NOT_RUN**.
- При фактическом checkpoint обнаружено, что CLI запрещал backup при PAUSED/BLOCKED. Исправлено: backup берёт тот же dispatcher lock без запуска стадий и без изменения статуса/бюджета. E2E проверил backup заблокированного проекта и сохранение запрета на extract; 2 E2E и отдельный ownership test PASS. Реальный backup `upgrade-development` сохранён в `var/checkpoints/upgrade-development-20260929/`.
- Семь ограниченных задач команды приняты; разработческий run приостановлен. У одного истёкшего lease сохранена неизвестная единица расхода, она не обнулена задним числом. Это учёт резервов ядра; денежная стоимость интерактивной команды неизвестна.

## Серверный этап после команды «Продолжай» — 29 сентября 2026
- Выполнены `growpart /dev/sda 3`, `pvresize /dev/sda3`, `lvextend -l +100%FREE -r /dev/hk/root` с последовательной проверкой. ext4 выросла с 58G до **157G**, свободно **95G** сразу после расширения; без перезагрузки. Свежие копии разметки/LVM сохранены, начало раздела не изменено. Nginx/Docker active; прежние 22 контейнера сохранены. См. `docs/runbooks/server-capacity.md`.
- Приложение r2 установлено в `/opt/upgrade` под отдельным пользователем upgrade: private Node 24.20.0, Chromium 153.0.8010.12. Системный Node 22.13.1 и чужие сайты не изменялись. Реальный Linux browser integration PASS. Public listener не запускался.
- Фактический серверный smoke нашёл no-op CLI через символьную ссылку current; дополнительная проверка восстановления воспроизвела сохранённую dispatcher lease. Обе ошибки исправлены независимыми исполнителями с непересекающимися файлами. CLI сравнивает realpath; установщик проверяет содержимое JSON help до/после переключения. Restore снимает владение только в копии, fence незавершённой задачи повышается, резерв сохраняется как unknown, автоматического повтора нет.
- Проверки исправлений: `npm run check` PASS; `npm test` **53 PASS / 0 FAIL / 0 SKIP**; `npm run test:e2e` **4 PASS / 0 FAIL / 0 SKIP**. Логи `var/evidence/tests-r3.txt`, `e2e-r3.txt`. Исходный repro восстановления исправлен. Серверный полный сценарий на новом r3 ещё требует выполнения.
- Codex CLI **0.154.0** установлен отдельно в `/opt/upgrade/tools`, package integrity проверена по npm, `codex --version` PASS, `codex login status`: **Not logged in**. Auth не переносилась из других приложений. Серверный двухагентный запуск NOT_RUN до отдельной авторизации.
- Следующий шаг: неизменяемый пакет r3, установка и non-root source/offline/backup/restore smoke. Пилотный URL и лицензия/установка Битрикс запрошены; настоящая CMS/БД/admin/сценарии/демо пока NOT_RUN.

## Контрольная точка: r3 принят на сервере
- Пакет r3 из commit `1f67618460060143835ade5a7248c89a0f754a4e`, 126 проверенных source files, SHA `c3f85b3edc04181104b5c6360e0d99094d659afe620df8cfa8b5c9ad8992177b`. Install exit 0. Фактический полный протокол и пути доказательств: [server-validation-20260929.md](server-validation-20260929.md).
- Non-root CLI → source/model/package/report PASS: 19 сущностей, scope 23, side effects 0, NOT_READY/BLOCKED ожидаемы. Offline reuse PASS; отдельный restore 16 immutable artifacts и немедленное продолжение PASS; хеши и бюджет сохранены. Настоящий Linux Chromium — 1 PASS.
- Проверен отказ от активации неисправной r2: expected exit 1, установщик вернул current на r3, валидный help подтверждён, shared state не откатывался. Это не production rollback Битрикс.
- После установки `/` 157G, доступно 94G; Node 22.13.1, Nginx/Docker и 22 соседних контейнера сохранены, HTTPS ContentHub 200. Три новые ограниченные задачи команды приняты через ядро; итого 10 ACCEPTED, spent 10/reserved 0/unknown 1. Денежная стоимость интерактивной команды UNAVAILABLE.
- Серверный Codex executable доступен, отдельная авторизация пользователя запрошена через официальный device flow; на момент приёмки NOT_AUTHENTICATED, server agent smoke NOT_RUN. Не повторять диск/установку при продолжении. Проверить актуальный login status; исходный пилот и Битрикс остаются необходимыми входами следующего этапа.
# Контрольная точка пилота teplypol-market.ru — r4, 29 сентября 2026

- Входные данные получены: URL пилота, доступный сервер с расширенным диском, приватно сохранённый ключ Битрикс (редакция/валидность NOT_RUN). Через запрошенный пользователем встроенный браузер открыты главная и карточка товара; сохранены 147 проверенных изображений и выборочная карточка. Полная инвентаризация не выполнена. Серверный GET возвращает KillBot. Подробности: `docs/pilots/teplypol-intake.md`.
- Исправлен HTTP 200 challenge/HTML robots: долговечные блокировки, SHA evidence, явное одноразовое подтверждение конкретного блока, offline запрет извлечения и сборки старых challenge/legacy/PAUSED данных. Лимиты записываются и не растут после restart; повышение без отдельного решения запрещено. Старые несохранённые лимиты требуют нового явно запланированного snapshot, а не угадывания defaults.
- Reporter считает исходный реестр, queued/failed/excluded/access и sitemap frontier; не превращает 0 entities в пустой каталог. Прямой legacy report требует revalidation. Ошибка предыдущего crawl artifact не блокирует новый artifact.
- Зарегистрированы отдельные задачи crawler, reporter, независимого reviewer и root CLI integration; области записи не пересекаются. Целевой БД не касались. Точное состояние исполнения и приёмки хранится в серверном Store; итоговое принятие фиксируется после установки.
- Фактические команды: `npm run check` PASS; `npm test` **78 PASS / 0 FAIL / 0 SKIP**; `npm run test:e2e` с официальным локальным PHP **7 PASS / 0 FAIL / 0 SKIP**. Сохранённые выводы: `var/evidence/check-r4.txt`, `tests-r4.txt`, `e2e-r4.txt`. Новые subprocess checks проверяют restart, one-use ack, отсутствие POST, сохранение лимитов, запрет увеличения и legacy build.
- r4 пока подготовлен локально; установка/серверная проверка фиксируется следующим дополнением. Настоящая CMS, target import, admin, commerce и демо НЕ проверены. Следующий шаг: установить r4, зафиксировать блокировку реального пилота без автоповторов, подготовить изолированный runtime Битрикс и продолжить получение фактического source scope.

## r4 установлен; предварительная изоляция Битрикс — 29 сентября 2026

- Установлен `/opt/upgrade/releases/upgrade-0.1.0-foundation-20260929-r4`, `current` указывает на него. Commit `1fab9a2669a9b8bf4d0742cad96596b4a7e8a3b4`, 136 проверенных source files; SHA архива `262cd4385ac65c86d4d7ceebbd7cc0fba4046dad6d7e07ea6f13be2bf4008d3e`, install exit 0. Node 24 отдельный; системный Node 22 сохранён.
- Серверный targeted запуск access/reporter/CLI: 24 PASS, 1 CANCELLED из-за 45-секундного тайм-аута первого CLI-теста во время сборки PHP. После окончания сборки последовательный повтор `node --test --test-concurrency=1 tests/e2e/access-resume.test.ts`: 3 PASS, 0 FAIL/CANCELLED, exit 0. Это два сохранённых запуска, не один выдуманный зелёный набор. Логи: `var/evidence/server-r4/r4-access-tests.txt`, `r4-access-cli-retest.txt`.
- Реальный crawl пилота остановлен с exit 3 на KillBot в robots: total_requests 1. После report/resume и повторного crawl без ack запросов не прибавилось; исходные время/лимиты сохранены. Блок `access-eff7ee21-1e84-499e-9245-eec1142033c6` остаётся PAUSED. Серверный receipt `art-5fbe8d72-9391-4b0d-a1a5-1fe485cb793f`. Операторские browser observations приняты отдельно (`art-ab02c276-7c7e-44a5-a306-5a45e6fd580d`), полнота источника неизвестна.
- Пользователь подтвердил редакцию «Бизнес». Официальный коммерческий архив получен и безопасно распакован в отдельный `cms-root`; ключ остаётся приватным. Получение архива не доказывает активацию. Созданы собственные PHP 8.3.35, MySQL и Nginx на pinned images, отдельная БД/сеть/state.
- До монтирования CMS выполнены guard apply/check, положительные canary controls и реальные отрицательные TCP/PHP/DNS tests. Собственная БД доступна, хост/другая тестовая сеть/Интернет недоступны, исходящих DNS-пакетов PHP не обнаружено. Подробности и границы: `docs/pilots/bitrix-runtime.md`, независимый review рядом; raw receipts в `var/evidence/server-r4/`.
- Docker 29.1.3 не опубликовал port на единственной internal network. Подключён host Nginx к фиксированному внутреннему Nginx без второй сети; собственный HTTPS vhost с Basic Auth/noindex, Nginx backup и `nginx -t`/reload PASS. ContentHub HTTPS 200 после изменения. Для закрытого мастера подготовлен loopback SSH-туннель; секреты не входят в URL, args или request logs.
- Следующий шаг: live FPM/точные PHP routes/private-file negatives на инертном корне, затем настоящий мастер. Установка/активация/импорт/admin/Битрикс restore/commerce ещё NOT_RUN; DEMO_READY запрещён. Состояние задачи — серверный Store, лимиты и исходные timestamps не сбрасываются.

## Контрольная точка: установщик «Бизнес» и operator capture — 29.09.2026, 05:18 UTC

- Исправлены права собственных PHP/FPM-файлов в Docker image; legacy build PASS. Подготовительный HTTP/FPM checker: 108 PASS над 45 запросами, независимый review. Первый vendor wizard GET дал 200. Мастер открыт на шаге 2; EULA не принята, ожидает отдельного ответа пользователя по правилу browser tool. Ключ не копировался в CMS, активация/БД/admin/import/restore NOT_RUN.
- Packet capture первого vendor GET INCONCLUSIVE: отсутствовал положительный внутренний трафик. Не считать это AT-28 PASS. Подробные команды, image, актуальный compose и точка продолжения: `docs/pilots/bitrix-installation-run.md`.
- Реализован portable operator capture: автономный валидатор и CLI `operator-capture ingest`. Точные байты, schema/SHA/size/path/media checks, durable receipt, восстановление неизвестной публикации без дубликатов, сохранение original source binding, PAUSED/access block. Повтор не выполняет сеть и не объявляет данные полной миграцией. Исходники и инструкции desktop browser не встроены как API проекта.
- `npm run check` PASS; `npm test` 106 PASS; `npm run test:e2e` 12 PASS, FAIL/CANCEL/SKIP 0. Логи `var/evidence/check-operator-final.txt`, `tests-operator.txt`, `e2e-operator.txt`. Последние пять E2E проверяют настоящий CLI/restart/move, exact bytes/denominator, conflict/pin, TOCTOU и два варианта неизвестного результата публикации.
- Реальный portable input `var/pilots/teplypol-operator-capture-20260929`: manifest SHA `6555e2ad5bdb0a4f2450920c513207a7c5bba56e613e32da5f8ff1f61e4a120c`, 25 наблюдаемых URL, 1 selected-fields page, 24 unobserved, 147 изображений. Full source denominator UNKNOWN. Факты карточки повторно просмотрены через IAB; изображения имеют отдельное исходное время 03:47 UTC. PDF/заказы/отзывы не импортированы.
- Серверный immutable archive `art-07974390-41ea-4ec7-817a-4ed734f02253`, SHA `79ce992ba30972944b8b88280fcce2a0d948a36674b9df532f99c07b8b32dd62`; подготовка `art-e5df2395-77a8-4735-818f-84e0b96e9e99`. Блок `access-eff7ee21-1e84-499e-9245-eec1142033c6` сохраняется. Архив не является результатом импорта в CMS.
- Приняты ограниченные задачи portable validator, независимого FPM review и root installer stop. Приёмка CLI и обновление серверного release фиксируются следующим дополнением после фактических команд. Бюджет текущего run по-прежнему 20 units / 7200 seconds с исходным началом 03:25:11.993 UTC; сбросов нет.
- Следующий шаг: развернуть проверенный CLI, принять portable input, подтвердить повтор в новом процессе; после согласия на EULA продолжить Битрикс. Извлечение модели из operator input и полноценная товарная интеграция остаются отдельной работой.

## Сервер r5 и фактический приём пилота — 05:23 UTC

Релиз `upgrade-0.1.0-foundation-20260929-r5` установлен, exit 0. Git source `a3e698e`, archive SHA `0f6f12528dc3c26efb84fcfa54b1ed96823e9f62e208139f5c290b193084c8d4`, 153 files. Предыдущий r4 сохранён. Изменение собственного app release не переключало CMS compose; активным остаётся `compose.cms-installer.json` с image `1fdc8caa…`.

Два отдельных CLI subprocess приняли реальный portable capture: первый COMMITTED, второй replayed=true, прежние IDs/байты. Добавлено ровно 150 artifacts: 149 файлов (manifest, observation, 147 assets) и validated result `art-cd5dae19-f4df-446d-9510-eed55da7a877`. Восстановление Store между процессами подтвердило неизменность crawl artifact, access block и бюджета. Полнота: 25 known URL, 1 selected-fields, 24 unobserved, full source UNKNOWN. Receipt `/root/upgrade-install-20260929/r5-operator-pilot-receipt.json`, PASS только для intake.

Все 13 ограниченных задач этого run ACCEPTED, spent13/reserved0/unknown0 из20. Run явно PAUSED без изменения начального времени/лимита. HTTP endpoint Upgrade требует auth (401), соседний ContentHub вернул200. Общий pipeline report пока отражает серверный crawl; объединённые operator URL находятся в отдельном validated result. Автоматическое включение operator input в extract/model/report — следующий незавершённый шаг, не заявленное свойство intake.

Установщик по-прежнему ожидает согласия на EULA. После ответа продолжать с текущего шага; при исчерпании исходного 7200s run не сбрасывать бюджет для продолжения агентных стадий. Полный результат проекта **NOT_READY**.

Контрольная копия от05:25:39 UTC: `/opt/upgrade/shared/checkpoints/teplypol-market-20260929-r5`,194 files. `upgrade restore --from .../teplypol-market-20260929-r5 --to .../teplypol-market-20260929-r5-restored` фактически вернул RESTORED,189 artifacts. Отдельный read/compare проверил COMMITTED capture и149 files,13 ACCEPTED tasks, исходный budget, PAUSED, снятый dispatcher и целостность всех artifacts. Receipt `art-934debf8-eb28-444b-99e6-e20ff4b979cb`, scope UPGRADE_STATE_RESTORE_ONLY. Bitrix restore NOT_RUN. Продолжение на исходном проекте `/opt/upgrade/shared/projects/teplypol-market`, не на восстановленной проверочной копии. Бюджет run истёк по исходному времени; новая агентная стадия требует отдельного планирования, без обнуления текущего run.

## Частичная модель/пакет/отчёт и продолжение CMS — 06:54 UTC

После явного «Продолжай» прежний истёкший run завершён FAILED с причиной deadline, при сохранении13 ACCEPTED задач и spent13. Новый `run-e8fdef66-8fb8-49d5-9ccf-b02c98e94de1` отдельно запланирован20 units/7200s; вход `art-ea192b68-5737-455d-a878-4de4dcdb8a50`. До делегирования сохранены три непересекающиеся задачи extractor,operator-model CLI,reporter и отдельная root CMS task. Все обращения к пилотному Store и целевой БД выполняет root.

Реализованы `operator model` и `operator build` из COMMITTED capture: одна выбранная страница, отдельные PENDING/COMMITTED записи, закреплённые source/model/package fingerprints, повтор/потерянное подтверждение/restore, свои template+local media и полный known URL scope в пакете. Остальные URL остаются unresolved; цены и наличие — точные наблюдения, не действующая торговая функция. Reporter объединяет исходный scope с операторским, сохраняет URL повреждённых payload как UNVERIFIED_CAPTURE, отдельно показывает model/build integrity и blockers, всегда PARTIAL/UNKNOWN/NOT_READY. Desktop API в приложение не встроен.

Независимые взаимные reviews обнаружили и закрыли три P2: скрытый missing-media blocker в отчёте, неполная привязка build fingerprint и metadata-only повреждение COMMITTED replay. После исправлений `npm run check` PASS; `npm test` **145 PASS**; `npm run test:e2e` **20 PASS**,0 FAIL/CANCEL/SKIP. Логи `var/evidence/check-operator-model-final.txt`, `tests-operator-model-final.txt`, `e2e-operator-model-final.txt`. Предыдущий набор141/18 также сохранён, не подменён результатами нового. Все проверки относятся к Upgrade, не к настоящему импорту Битрикс.

Через IAB получены4 недостающие фотографии и PDF-инструкция. Новый portable capture `teplypol-browser-media-20260929-0638`: manifest SHA `aac33704b9433add880462fa6ec1d17a6dd04641cf6ac7761ae890772c479714`,152 assets,25 known URL,1 selected observation с прежним timestamp. Старый capture неизменен. PDF3442679 bytes/SHA `3f2c20616bd744da253dde085def5c220dce61b5728fcb60e52716c626fd3532`; прямой HTTP вместоPDF дал challengeHTML и не принят. Новый archive SHA `526145365bb35edf40e1ecae176db3139ae873c2f8073a7ed302bb47c89a3ce4`,7037152 bytes, передан на сервер, Store ingest ещё следующий шаг.

EULA согласована, штатная CMS установка создаёт модули, восстановлена после остановки браузера; детали в `pilots/bitrix-installation-run.md`. Email администратора ещё ожидается. Релиз r6 пока подготовлен локально; следующий шаг — принять задачи с frozen source/test evidence, установить r6, принять новый capture, выполнить настоящий частичный import с backup и проверками. DEMO_READY остаётся запрещён.

## r6: реальная частичная CMS и первый запуск миграции — 07:24 UTC

Приложение r6 из commit0146472 установлено: archive SHA8aa103a98bd3edbb322a8dfe2fe130f75bd46e947ea83a7325aadeadcf5a2afd. Current переключён на отдельный r6, r5 сохранён; PHP/compose не заменялись. Три задачи extractor/core/reporter приняты с frozen source bytes и полными145/20 test logs.

Новый capture принят COMMITTED (art-05c341e8-f015-4ae1-9f7b-31cbe31d3563). Настоящие server CLI operator model/build и их повторы в отдельных процессах подтвердили replayed=true с теми же IDs/артефактами. Model f52bced1…; package96dfb13a… с manifest SHA a72763e4e97e684cf4f0733eacbee7cda9b807ca00816739d27b78189a686cdf.152 assets, одна Page/route,25known URLs,24unresolved, full source UNKNOWN, blockers[]. Source access block сохранён; общий report NOT_READY. Первый повтор build с неверным именем env дал Project does not exist и не менял Store; после явного --data-dir повтор PASS.

Штатная CMS создала49модулей/883таблицы/site s1 и дошла до создания администратора. Email ожидается, users0. Обновление продукта не удалось из-за заблокированного DNS к серверу Битрикс; этот шаг явно пропущен. Активация NOT_VERIFIED. Резервная копия до установки собственного модуля:1516143bytes SQL,752537983bytes site.tar.gz, gzip/tar listing/checksums PASS. Два receipts с host/container paths имеют одинаковые данные; container receipt SHA1d3e417ce989a68647f4106efccf1ffe8dac4f465a5df13e4c3e89a44f3493ca. В первом сохранённом вводе один символ pin дублировался из-за PTY wrapping; отдельный correction art-dfd95cab-420a-4ad5-8d34-2442dc5e8079 сохраняет историю. Backup integrity не является restore PASS.

Повторный runtime probe отwww-data: prepend/functions и пять TCP cases PASS, external DNS resolution failed. Проба не выполняет CMS bootstrap и не подтверждает packet egress; AT-28 остаётся неполной. Первый вызов без обязательных IP аргументов дал exit2/no output, корректный вызов с тремя адресами exit0. Guards присутствуют.

13 собственных файлов скопированы в /local через deploy-code.sh с ограниченным PHP container validator. Перед копированием проверены accepted package/backup pins и hashes, после — destination bytes/permissions. Первый ввод65-символьного manifest pin был отвергнут до записи; повтор с64-символьным принятым pin exit0. Миграция фактически вернула INSTALLED/iblock_id1. Повтор показал ошибку vendor handler при exit0; собственная diagnostic wrapper уточнила DuplicateEntryException1062 для upgrade.core в b_module.PRIMARY. DB readback:50modules,1iblock,4properties,1ug_project,0entities/routes/operations. Dry-run created1/conflicts[]/blockers[]. Эти результаты сохранены в art-cef367fe-f536-4841-a98d-abbf6236b6fa.

Параллельно независимый review воспроизвёл false DATABASE_RECONCILED при существующем XML_ID и отсутствующей mapping. До apply исправляются обе ошибки с отдельными regression tests; sealed r6 package не изменяется. Задачи и расширенные области записи сохранены до делегирования. Следующий шаг — reviewed package с исправлениями, actual apply/reconcile/repeat, закрытый HTTP/browser preview и отдельная проверка восстановления. Импорт, HTTP/admin/commerce и готовность демо пока не подтверждены.

Проверка исправленного кода следующего release: `npm run check` PASS, `npm test` **168 PASS**, `npm run test:e2e` **20 PASS**,0 FAIL/CANCEL/SKIP. Логи `var/evidence/check-r7.txt`, `tests-r7.txt`, `e2e-r7.txt`. Новые23 проверки охватывают strict Gateway mapping/recovery, migration replay/error JSON и private preview policy. Это локальные контракты; actual target retest ещё отдельный шаг.

## r7: настоящий частичный импорт и r8 labels — 08:01 UTC

r7 из commit51b53cb установлен, archive SHA a8d1d0e094be82512de8c6cd857a9fc17e083c04c4b37bb434fd77e7eeda58c5. Два запуска миграции INSTALLED; apply created1/routes1/errors0, strict reconcile DATABASE_RECONCILED, повтор created0/updated0/skipped1. Readback:1 элемент/mapping/route/operation, users0/mail_events0/orders0. Доказательства art-850cca3d-9cdb-483e-afe7-2b9b633823b2 и независимый docs/reviews/partial-target-acceptance.md.

HTTP224 requests:221 PASS,3 TRACE405 без privacy headers; исходный FAIL сохранён. TRACE возвращает стандартное166-byte тело общего Nginx. Проверены19 фактических значений,152 media records/150 уникальных файлов, CSS, исходный реестр25 URL:1 imported200/24 unresolved404, full source UNKNOWN. IAB:4 изображения, фактическая загрузка PDF с SHA, keyboard details и отсутствие горизонтального переполнения при viewport360. Представление частичное, дизайн магазина не завершён.

Текущий packet observer:20seconds,127 received/read frames,117 DB TCP frames, external/malformed/unsupported/drop0; HTTP200 внутри окна. Это CURRENT_PHP_NAMESPACE_OBSERVATION_WINDOW_ONLY, не исторический первый bootstrap/AT28. Файловый backup восстановлен отдельно:108264 файла,5 контрольных byte matches; SQL restore/HTTP recovery NOT_RUN.

r8 исправляет только подписи таблицы: русские названия, точные исходные значения/raw names/provenance сохранены. Независимые19 tests PASS. Общие npm run check PASS; npm test170 PASS; npm run test:e2e20 PASS;0 FAIL/CANCEL/SKIP. Raw logs var/evidence/*-r8.txt. Переносимый test_capture_runtime.py под WSL python3 -O:25/25 PASS; это synthetic parser/guard tests, не packet evidence. Новая модель/пакет и actual update r8 проверяются следующим дополнением. Email admin ожидается, activation NOT_VERIFIED; commerce/search/full scope, server Codex auth и автоматический deploy executor остаются незавершёнными. NOT_READY сохраняется.

## r8 установлен и фактически применён — 08:09 UTC

Release upgrade-0.1.0-foundation-20260929-r8, git247176e, archive7eb6b88cf8f6fda44397eb6b84b990df9a49f06f93df7109a2a5090da42bb86b,176files, install exit0. Source extract fingerprint создал новый COMMITTED model/build; пакет manifest838682ba05352434af745140ac726cec1186dd51664900908eb744e860e3ff26. Все13 deployed own-code files совпали с новым пакетом, копирование кода не понадобилось. Принятый intent и actual evidence art-a0c1ff61-06ec-4a0b-8346-63693504939c, SHA8608686f44e457e2d4c95c17f183d1b407a656dc0cc0951d896f582a2d47e97e; локальный var/evidence/server-r8/r8-target-evidence.json содержит14 очищенных исходных receipts и browser observation.

Фактический dry-run updated1/conflicts0/blockers0; claim fence2; apply created0/updated1/errors0; reconcile DATABASE_RECONCILED; repeat created0/updated0/skipped1. Readback: элемент и mapping с BITRIX_ID1, routes1, operations2 (по одному для двух пакетов), users0/mail_events0/orders0. Протокол неизвестного результата сохраняет DISPATCHED_UNKNOWN до ответа и не повторяет зависшую запись без reconcile.

HTTP224 снова221 PASS/3 TRACE405 header exceptions, исходный report FAIL сохранён.19 значений и152 media records/150 unique files прошли. IAB подтвердил19 русских подписей, отсутствие технических labels,4 loaded images; viewport360 document345/scroll345,table271/271. Узкая таблица переносит слова, полноценный дизайн/UX остаётся работой следующего этапа.

Задачи labels и r7 independent acceptance приняты. У observer review истёк lease до публикации: старое выполнение сохранено в unknown budget, новый разрешённый attempt повторно проверил frozen review и принят без сброса истории. Дополнительная задача independent r8 checkpoint зарегистрирована до делегирования. Бюджет/начало run не менялись. Следующие действия текущей точки: принятие bounded r8 receipt и отдельный backup/restore Upgrade state; полный проект NOT_READY.

Независимый r8 review:14/14 вложенных SHA совпали, ACCEPT в ограниченной области (docs/reviews/r8-target-checkpoint.md). Публикация review превысила180s lease: ядро отвергло stale token, задача FAILED, результат сохранён отдельно как позднее операторское evidence. Это не задним числом ACCEPTED. Основная интеграционная задача принята по фактическому независимому review до собственного deadline. Run PAUSED:spent11/reserved0/unknown2 из20, исходный started_at1790662530788/max7200s сохранён. Две unknown единицы относятся к истёкшим попыткам ревью, не к неизвестной записи в Битрикс; все target apply ответы сверены. Следующая контрольная операция — отдельный backup/restore состояния Upgrade.

## Восстановленная контрольная точка r8 — 08:14 UTC

Фактические команды: upgrade backup --project teplypol-market --to /opt/upgrade/shared/checkpoints/teplypol-market-20260929-r8 (exit0,1044files); upgrade restore --from .../teplypol-market-20260929-r8 --to .../teplypol-market-20260929-r8-restored (exit0). Readback PASS:373 immutable artifacts с совпавшими ID/SHA, задачи, operator captures/models/builds и исходный бюджет совпали; PAUSED и dispatcher detached сохранены. Receipt art-051a6208-8154-484d-8e53-2da068646148, server /root/upgrade-install-20260929/r8-state-restore-readback.json. Receipt опубликован в исходный Store после сравнения, поэтому там на один артефакт больше. Scope UPGRADE_STATE_RESTORE_ONLY; Bitrix DB restore NOT_RUN.

Продолжать на /opt/upgrade/shared/projects/teplypol-market, current r8; проверочную восстановленную копию не использовать как рабочий проект. Активный закрытый partial Nginx profile и CMS сохранены. Последняя стадия закончена контрольной точкой, общий Upgrade NOT_READY. Не повторять disk expansion, CMS migration, принятые captures, imports и media QA без изменения входов. Следующая независимая работа: расширить source inventory через разрешённый браузер/выгрузку, выполнить реальный designer adapter и улучшить шаблон; email необходим для завершения администратора. Для полного integration acceptance остаются activation, DB restore/HTTP recovery, admin conflicts, commerce и server agent auth.

## Технический администратор — 29.09.2026,09:20 UTC

Получен недостающий email. Предыдущий истёкший run закрыт FAILED по deadline с сохранением spent11/unknown2 и всех результатов; новый run-3352a79b-a89a-4b56-ba7d-efa464efb8bc отдельно запланирован20units/7200s. Задачи root/admin reviewer, входы и disjoint write scope сохранены до делегирования. Администратор upgrade.operator ID1 создан с указанным email; секреты только в приватных файлах сервера. Реальная CUser::Login авторизация и IsAdmin PASS, повтор использует ID1 и не создаёт второго пользователя.

Helper complete-admin.php сохраняет PENDING до Add, общий target flock, identity/credential pins и fresh readback/auth при каждом повторе. Два найденных reviewer edge cases исправлены до live: отражённый uppercase password в vendor exception и null receipt.37 реальных PHP subprocess tests PASS, включая неизвестный Add/exit75, повтор/конфликты и конкурирующий process flock. npm run check PASS; npm test207 PASS; npm run test:e2e20 PASS,0 FAIL/CANCEL/SKIP. Raw logs var/evidence/admin-*.txt.

До admin сделан отдельный SQL backup; restore NOT_RUN. Live counts users1, element/entity/route1,operations2,mail_events0,orders0. Сеть в20s окне первого создания:213 DB frames,external/IPv6/malformed/unsupported/drop0; это текущая ограниченная CLI observation, не исторический bootstrap. Семь HTTP проверок PASS: прежняя карточка побайтово сохранена, POST403, чувствительные admin/installer/helper/private paths404. Истёкшие собственные resume endpoint и marker скопированы в private backup и удалены; ядро/vendor и partial profile не изменялись.

Bundle art-6eb3e3e4-e520-46f4-8101-494c3d520763, SHA c4d51e798de496eb3c5f8870db38b211e2bd7ef039b7340df7a5bd6fe6128799;8 sanitized receipts. Подробный runbook docs/pilots/bitrix-admin-completion.md. Далее: зафиксировать frozen review, установить новый application release и сохранить state checkpoint. Аккаунт готов в области API auth; native browser admin, activation, SQL recovery, full source/design/commerce остаются NOT_RUN/NOT_READY.

r9 установлен из commit5a82f34: archive f75f2bd5eb589292b2517b2eae2e0dff951a051b9977f98d11f18d065409bf8e,181files, install exit0. Current указывает на r9; previous r8 сохранён. Повторный серверный readback подтвердил SHA helper и0600/33:33 private input permissions; root master credential0600. Независимый review принят art-9271b16a-e0f1-4064-8341-f8e7e98a555e, source/test logs frozen. Native HTTP admin остаётся намеренно404, поэтому browser admin NOT_RUN, а не скрытый PASS. Аккаунт/API auth и развернутый CLI helper готовы в оговорённой области.

Проверка служебного исполнения обнаружила EACCES при validateArtifacts на историческом root-owned artifact. Это фактический дефект прав, ранее скрытый запуском пилотного Store отroot. После события repair_planned изменён только owner/group дерева /opt/upgrade/shared/projects/teplypol-market на upgrade; сначала проверены все resolved paths и отсутствие symlinks. Байты/режимы, другие проекты и /opt/upgrade/private/bitrix не менялись. Все дальнейшие server Store/CLI вызовы выполнять через runuser -u upgrade, root оставлять только для системного размещения и docker exec целевого PHP. Итог non-root validation и новая контрольная копия фиксируются ниже.

Контрольная точка09:28:54 UTC: non-root validation PASS всех380 artifacts; исправлены442 owner/group из1501 проверенных путей. От пользователя upgrade выполнены backup1051files, restore в отдельную папку и readback PASS:380 ID/SHA, задачи, operator captures/models/builds, исходный budget и PAUSED совпали, dispatcher detached; source access block сохранён. Receipt art-81209a6a-caa8-4ed4-b103-d219aeaa7611, scope UPGRADE_STATE_RESTORE_ONLY. После публикации receipt исходный Store содержит на один artifact больше снимка. Новый run PAUSED со spent2/reserved0/unknown0, оба ограниченных задания ACCEPTED; прошлые run budgets не менялись. Дальнейшее исполнение Store только отupgrade, продолжение на исходном проекте, не на restored копии. Аккаунт создавать заново не требуется; следующий этап — отдельный закрытый native admin интерфейс/редактирование и проверка активации, затем source/design/commerce и настоящая DB recovery.

## 29.09.2026 18:35 UTC — настоящий частичный каталог r12

На изолированном target выполнен native import103pages: created102,updated1,errors0,routes103; последующий reconcile DATABASE_RECONCILED,0defects. Повтор apply:created0,updated0,skipped103. Native readback:103entities/103routes/105operations, прежний HW-500ID1 сохранён,103исходных facts SHA совпали после чтения Битрикс; users1/orders0/mail0.

Release r12 archive SHA `b909aa109a070b8f02157b7fff847936b6ef23cfa0388221cb096ca1a8088d86`; model `d070603f105414eb787b64d78fb85dc25da6b5000df024b022334de02462e031`; build `a08186a14295feed3094f7dd5b46190d034f137470caef4bd2fb0a94f092d169`; Bitrix manifest `7f4314d21dd936307add05908c646da3b538cae8ae3a3bfa1871b5babd4f25c1`. Исполнение state отupgrade, target writer один. Свежий SQL/files backup pre-catalog-r10b проверен по checksum/gzip/listing; actual SQL restore **NOT_RUN**.

Проверки: `npm run check` PASS; `npm test`257PASS; `npm run test:e2e`23PASS,0SKIP. Настоящие `operator build --all-observed` и PHP importer `dry-run/claim/apply/reconcile/apply` завершились успешно. `scripts/verify-pilot-http.py` проверил103GET маршрута (16query),10300фактических текстовых значений,802уникальных mediaSHA,6access/isolation probes — PASS. `scripts/verify-pilot-bitrix.php` — PASS native readback. Root IAB: главная/каталог/мобильная карточка/контакты, раскрытие меню, реальные decoded photos,3/1columns и отсутствие horizontal overflow1280/360. Полная visual/a11y/admin/commerce приёмка этим не заменяется. Receipts: `var/evidence/server-r12`; server `/root/upgrade-install-20260929/r12-*`.

Предыдущие отказы сохранены: r10 model PENDING после starvation heartbeat; r11 native POST_WRITE_RECONCILE_FAILED из-за65535-byte UG_FACTS truncation, независимый REJECT. Исправлены cooperative yield и bounded lossless facts codec; legacy managed hashes сохранены. Первое r12 CLI обращение содержало ошибочно переписанный65-символьный modelID и было отклонено до build; исправленный запуск читает ID из COMMITTED JSON. Неизвестный r11 исход сначала сверили, затем создавали отдельный r12 пакет. Подробнее `docs/pilots/catalog-stage.md` и reviews.

**NOT_READY, PARTIAL:**103из943известных URL,840unresolved, fullsourceUNKNOWN; ещё28rawDOM наблюдений сохранены, но отложены. Автоматический источник остаётся access-blocked, разрешённый операторский IAB работает. Следующий шаг — продолжать исходную очередь из сохранённых captures, исправлять реальные gaps/link destinations, довести новый дизайн и scoped search/catalog/cart simulation; отдельно native admin editing, активация лицензии и SQL recovery. Нельзя объявлять это завершённым сайтом/магазином или DEMO_READY.

## Расширенный каталог: подготовка r10 — 29.09.2026,17:40 UTC

Новый bounded run run-3dc0ebd4-5200-4ae8-9e91-3be4f6ace3ca создан после завершения истёкшего предыдущего с сохранением истории. До делегирования записаны disjoint tasks. Реальный Codex designer CLI job завершился exit0, отдельно принят по независимому review; Markdown role подтверждена фактическим role hash/job/result. Подробности и границы — docs/pilots/catalog-stage.md.

Получено131 DOM-наблюдение и943 известных URL через IAB. Первый расширенный пакет явно выбирает103 исходно закреплённые страницы,837 verified media URL,49177722bytes;28 новых наблюдений остаются сохранёнными для отдельного переноса форм/сценариев. Capture v4 SHA de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff. Все обязательные entity.assets для103 страниц подтверждены; неполная галерея и840 URL вне выбранных наблюдений остаются в отчёте. Полный источник UNKNOWN.

Реализованы --all-observed v2 model/build с v1 replay, исходный denominator, link/card контракты в TS/PHP, собственный адаптивный каталог и меню из фактической навигации. Независимые reviews закрыли найденные ошибки сохранения данных, unsafe/dedup/accessibility границы, пустой/probel src. Последний полный запуск: npm run check PASS; npm test249PASS; npm run test:e2e23PASS;0FAIL/CANCEL/SKIP. Raw logs var/evidence/catalog-stage/{check,tests,e2e}-release.txt. Предыдущие FAIL и исправления сохранены, проверки настоящего Битрикс новым пакетом ещё NOT_RUN.

Root выполняет свежий SQL/files backup и затем server release/import/reconcile/browser. Первая backup попытка остановилась до получения SQL из-за отсутствующего mariadb-dump; сохранена как FAILED, повтор использует реально установленный mysqldump в новой папке. Target writes пока не начаты. Общая готовность NOT_READY.

Текущая последняя контрольная точка — раздел выше «18:35 UTC — настоящий частичный каталог r12»:103маршрута native/HTTP PASS, повтор без дублей; общий NOT_READY. Старый prep r10 ниже него сохранён как история, не текущий статус.
