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

## ADR — закрытая установка Битрикс и граница host proxy

Первый target использует отдельные корень, state, credentials, DB volume и единственную internal bridge network `upgrade-teplypol-market-isolated`. Выход к хосту блокируется отдельным INPUT guard; cross-network — правилами только для своего bridge. Перед CMS проверяются достижимые canary controls, реальные socket/PHP и DNS packet tests. Auto-restart выключен: после host/daemon restart сначала guard и probes. Это пилотный профиль, не законченный multi-project firewall manager.

Docker 29.1.3 не создаёт host publication на таком internal endpoint. Ingress реализован host Nginx → pinned internal Nginx без замены URI. Второй network interface ради publication не добавляется. Публичный HTTPS остаётся с Basic Auth; операторский SSH tunnel использует отдельный loopback-only proxy и приватный credential include. Запросы мастера не логируются. Временный installation profile разрешает только конкретные PHP и статические файлы, наблюдавшиеся в официальном архиве; затем требуется возврат к demo profile. Vendor/core files не патчатся, факты лицензии не публикуются.

## ADR-013 — переносимый ввод операторского браузера

Desktop IAB используется оператором для наблюдения, а проект получает собственный versioned capture manifest и файлы с внешним SHA pin. Нет вызовов внутренних desktop API из приложения. Capture остаётся недоверенным PARTIAL input: выбранные поля не равны полному DOM, все наблюдаемые и прежние URL сохраняются в отдельном inventory, full source denominator UNKNOWN. Сетевой access block не снимается по факту открытия страницы другим браузером.

Maintenance CLI сохраняет immutable exact bytes и PENDING/COMMITTED receipt, сверяет уже опубликованный результат до повтора и закрепляет исходный crawl artifact. Другой SHA для capture ID — конфликт. Это отдельный приём данных; extract/model/target readiness не выводятся автоматически из COMMITTED.

## ADR-014 — явная частичная сборка из операторского ввода

Пока автоматический источник заблокирован, отдельный operator model/build может сформировать пакет ровно одной наблюдавшейся страницы. Он не подменяет обычные stages, не снимает access block и не угадывает полноту сайта. Все known URLs входят в signed-by-hash scope файла пакета;24 из25 остаются unresolved в первом пилоте. Пакет получает видимый partial banner; model,route,scope,release закрепляют исходный capture/crawl и code hashes. Integrity COMMITTED отделена от import blockers и target readiness. Любая metadata-only несовместимость при replay отклоняется, а не исправляется молча.

Истёкший run закрывается с причиной deadline, его история/счётчики сохраняются. Явное продолжение пользователя создаёт новый ограниченный run и ссылку на прежний checkpoint; начальное время и бюджет старого run не переписываются.

## ADR-015 — технический администратор без установки готового решения

Для уже созданного Upgrade template/router используется отдельный CLI bootstrap администратора через documented CUser::Add/Login. Штатный CreateAdminStep может обновить существующий ID1 и затем создать index.php для solution wizard; этот путь не подходит для неизменяемого собственного пакета. Мы сохраняем PENDING до Add, общий target flock и точную identity/XML_ID binding; неизвестный исход сначала сверяется с Битрикс. Пароль не сбрасывается при конфликте. COMMITTED требует свежего успешного Login/IsAdmin. Это ограниченная account acceptance, не завершение wizard, активация или браузерная админка. Последующие интерфейс и функциональная приёмка остаются отдельной работой.

## ADR-016 — явный многостраничный операторский этап

ALL_OBSERVED означает все DOM-наблюдения конкретного принятого capture, а не весь исходный сайт. Новое binding v2 закрепляет отсортированное выбранное множество; старые v1 records и immutable artifacts не переписываются. Отдельный pinned observation scope разрешает поэтапный импорт: отложенные raw DOM остаются на диске, их URL входят в исходный denominator и не становятся PASS от отсутствия в пакете. Source controls не превращаются в обещание действующей формы/покупки. Дизайн и карточки используют только подтверждённые изображения/факты; неподтверждённая галерея явно остаётся в evidence. Браузерный операторский экспорт — переносимый вход, внутренний desktop API не часть внешнего API Upgrade.
