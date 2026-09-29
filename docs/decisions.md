# Журнал архитектурных решений

## ADR-001 — среда и состояние
Node 24, TypeScript с native type stripping, `node:sqlite` и синхронные короткие транзакции. Один владелец диспетчеризации; SQLite BEGIN IMMEDIATE сериализует операции CLI. WAL, foreign keys, busy timeout. Windows — разработка; документируемый эксплуатационный путь Linux/WSL2.

## ADR-002 — границы доказательств
Fixture target — только модель проверки протокола, никогда Битрикс и никогда DEMO_READY. Отчёты различают локальные тесты, настоящий агентный запуск и NOT_RUN интеграции. Финальная готовность fail-closed.

## ADR-003 — интеграция Codex
Документированный `codex exec` с JSONL и output schema. Внутренние инструменты приложения не экспортируются как API. Модель — явный параметр профиля либо зафиксированное наследование конфигурации CLI, без встроенных названий моделей. Источник: https://learn.chatgpt.com/docs/non-interactive-mode ; сверено с установленной 0.154.0.

## ADR-004 — границы реализации
Разработка по непересекающимся папкам; интегратор владеет core/CLI/contracts/общими документами. Любой непокрытый AT сохраняется в матрице как PARTIAL или NOT_RUN. Не заявлять весь проект завершённым до реального Битрикс и трёх пилотов.

## ADR-005 — снимок контента и торговля
В первом исполняемом target profile переносится редактируемый контент, включая факты товара. Реальные торговые предложения, каталожные цены, фильтры и checkout требуют отдельного catalog profile и тестов установленной редакции. Нормализованные Offer и PriceObservation уже существуют; не заменяем отсутствующую торговую реализацию декоративными кнопками.

## ADR-006 — архивы и согласованная версия
Один manifest с self-declared hashes недостаточен. SHA manifest привязывается к immutable accepted artifact, проверяются все файлы и отсутствие незаявленного кода. Изменение собственного кода, токенов или входных данных изменяет fingerprint сборки. Старая версия не переписывается.

## ADR-007 — неудавшийся redirect остаётся в scope
Если URL разрешённого источника перенаправляет на private IP/внешний origin, блокируем переход; исходный URL остаётся FAILED/unresolved в знаменателе. Явная robots-policy может исключать URL с причиной. Предыдущий синтетический snapshot сохранён для аудита; обновлённый fixture-demo-v2 содержит 24 обнаруженных URL, 23 в scope, 22 маршрута и один видимый нерешённый адрес.

## ADR-008 — развёртывание самого Upgrade
Данный пользователем сервер — хост приложения, не автоматически настроенный Битрикс. Приватный Node 24.20.0, root-owned immutable releases, OS user upgrade, shared state/cache, без публичного listener и без смены системного Node/Nginx. Расширение раздела/LVM/ext4 выполнено после диагностики, backup метаданных и подтверждения «Продолжай»: итоговый размер `/` 157G. Сам установщик приложения разметку не меняет.

## ADR-009 — ограничения текущего адаптера
Роли исполняются фактически через Codex CLI, но автоматический профиль сознательно ограничен JSON-анализом без model tools. Код создаётся интерактивной командой с независимой приёмкой. Это не универсальный автономный shell-agent и не гарантия возобновления творческой генерации после любого сбоя. Неизвестное выполнение получает UNKNOWN и не перезапускается вслепую.

## ADR-010 — владение после восстановления и проверка активации
Backup сохраняет непротиворечивый снимок, включая текущие leases. После проверки файлов восстановленная независимая копия отсоединяет dispatcher, блокирует незавершённые worker-задачи с новым fence и переносит их резерв в unknown. Исходная копия остаётся неизменной; готовые результаты сохраняют авторство и независимый review. Восстановление состояния не подтверждает исход неизвестной записи в Битрикс.

Успех запуска CLI подтверждается непустым валидным JSON help с ожидаемой версией/командами. Exit 0 недостаточен: старый symlink main guard давал пустой вывод. Проверка выполняется до и после переключения и при rollback. На сервере отказ активации старой r2 фактически вернул рабочую r3 без отката shared data.
# ADR — HTTP 200 access pages and operator browser evidence, 2026-09-29

Known KillBot titles and Cloudflare challenge headers are access evidence, not content. A robots response containing HTML, including a fragment mislabeled text/plain, cannot become an allow-all policy. The crawler persists the bytes, SHA, URL, stage and block ID before stopping. A retry requires a one-use acknowledgement tied to the current block and a recorded reason; budgets and original start time survive it.

CLI persists effective crawl limits. An omitted flag reuses the previous value; raising it requires a separate budget decision, which this CLI version does not implement. Old snapshots whose original limits were never saved cannot safely resume through the CLI: preserve the evidence and explicitly plan a new project/snapshot. Completed legacy artifacts also require access revalidation before extraction/build; PAUSED discovery cannot build from an older model.

An operator may use the user-requested built-in browser and save observations/resources as untrusted input. That access is recorded separately from the server crawler. Codex desktop tools are not imported into the project's external API. Partial browser observations do not establish the complete URL registry, override robots, clear a server block or prove feature behavior.
