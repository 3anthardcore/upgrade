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
