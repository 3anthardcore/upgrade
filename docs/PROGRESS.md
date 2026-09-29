# Ход реализации

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
