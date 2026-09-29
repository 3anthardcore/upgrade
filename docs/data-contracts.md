# Контракты состояния, данных и исполнения

Все данные источника имеют доверие `untrusted-source-data`. Source URL, внешняя сущность и целевой ID Битрикс — отдельные понятия. Схема и checksum подтверждают структуру/целостность, но не истинность извлечённого факта.

## Машинные схемы

Публичные JSON Schema находятся в `packages/contracts/schemas/`: `project.schema.json`, `profile.schema.json`, `task.schema.json`, `event.schema.json`, `artifact.schema.json`, `result.schema.json`. Источник определений — `packages/contracts/schemas.ts` и `index.ts`; экспорт — `node scripts/export-schemas.ts`. Валидатор `validateContract` использует Ajv, без выполнения кода источника.

| Контракт | Значимые поля и правила |
|---|---|
| Project | `schema_version:1`, project_id, source entry_url/allowed_hosts/mode, target platform/profile. Активный CLI по умолчанию создаёт public-demo; перечисление других mode в схеме ещё не реализует их операции. |
| Run | run_id, phase, execution_status, dispatcher_owner/until, budget: max/spent/reserved/unknown/time. Хранится ядром; отдельной публичной Run JSON Schema пока нет. |
| Task | project/run/stage/role/goal, input IDs, dependencies, allowed paths/tools, acceptance checks, attempts, lease owner/until, fencing token, idempotency key, budget. `attempt_started_at` ограничивает абсолютное время попытки. |
| AgentResult | task/attempt/input_hash, artifact IDs, summary, checks, issues, followups, usage, runtime_version. Сообщение агента не закрывает задачу без валидации и отдельного reviewer. |
| Artifact | project/run/producer, relative path, SHA-256/bytes, schema version, input hashes, time, validation status. Изменение создаёт новую запись; accepted файл не переписывается. |
| Event | event_id/sequence, project/run/task, actor/type/time, correlation/causation, payload. SQLite — источник истины; events.jsonl — экспорт. Скрытые рассуждения не сохраняются. |

Исполнители используют `task create/claim/heartbeat/submit/review` и `artifact add` CLI. Прямое редактирование SQLite не является протоколом. JSON задачи регистрируется до делегирования; схема результата и фактические входные хеши сохраняются. Codex dispatcher один, до трёх no-tools исполнителей, один шлюз записи назначения.

## Снимки и модель контента

Полные типы crawl/model/route находятся в соответствующих TypeScript-модулях; отдельные экспортируемые JSON Schema для всех этих доменных артефактов пока отсутствуют. Их нельзя считать покрытыми общей схемой Artifact: та описывает оболочку хранения.

| Артефакт | Производитель | Содержание |
|---|---|---|
| `crawl-result.json` | crawler/pipeline | Состояние COMPLETE/PAUSED, исходные entries, медиа, persistent counters, robots/sitemap очереди, политика и ограничения. |
| `url-inventory.json` | pipeline | Исходные raw URL, request target, crawl key, источник обнаружения, HTTP/DOM, статусы и причины. |
| `scope-manifest.json` | pipeline | Зафиксированный реестр включённых URL и обоснованные исключения. Знаменатель полноты берётся отсюда. |
| `asset-manifest.json` | crawler/pipeline | source URL, MIME, размер, SHA-256, локальный снимок или причина EXCLUDED/FAILED. |
| `content-model.json` | extractor | Page/Product/Article/Service, blocks, SEO, факты и evidence; Offers/PriceObservation отдельно. Неподдержанные типы/свойства отражаются ограничениями. |
| `content-requirements.json` | extractor | Обязательные и условные поля по типам; сравнение с исходными снимками. |
| `feature-matrix.json` | extractor | Наблюдаемые функции, evidence и UNVERIFIED/REQUIRES_INTEGRATION. Кнопка не получает implemented автоматически. |
| `route-manifest.json` | route planner | source origin/target, target route, status, entity source ID, redirect, query rules, unresolved/conflicts/exclusions. |
| `qa-report.json` | verifier | Исходный scope hash, rows/checks, coverage/counts, ограничения, readiness. |
| `release-manifest.json` | builder/pipeline | Ссылка на immutable package, версии, хеши файлов, counts/blockers/warnings, runtime verification. |

`Fact` хранит value либо null, статус OBSERVED/ABSENT_IN_SOURCE/UNKNOWN/REQUIRES_REVIEW, confidence, evidence и единицу. Evidence содержит source_url, observed_at, locator и snapshot_sha256. SKU не является достаточным ключом объединения. Source IDs выводятся из типа и точного source URL; aliases не объединяются без отдельного подтверждения.

HTTP identity сохраняет регистр пути, завершающий slash, расширение, spelling `%2F`, повторение/порядок и пустые query values. Fragment отделён от HTTP key; полноценная семантика hash-route остаётся отдельным ограничением. Query сохраняется целиком; классификация tracking/pagination/variant не даёт права удалить параметр.

## Пакет назначения

Пакет имеет собственную `schema_version: "1.0"`, project/source version, mode public-demo, target profile `editable-content-snapshot`, manifest SHA-256 и хеш каждого файла. Данные: `data/entities.json`, `routes.json`, `assets.json`, `design-tokens.json`; код: `code/`; локальные медиа: `assets/`.

Ключ сущности — SHA-256 от `[project_id,type,source_id]`. Route key — SHA-256 точного request target. Модель не наследует структуру инфоблоков; gateway отдельно сопоставляет стабильный ключ с назначением. Текущий пакет переносит редактируемый снимок контента, не реализует торговые Offers/Prices/Stock автоматически.

TypeScript builder проверяет пути, хеши, IDs и конфликты. PHP `bitrix/importer/cli.php --command=validate` независимо проверяет пакет и доверенный manifest hash до bootstrap. `apply` требует изолированного demo, owner/fence и backup receipt. Неизвестный write сверяется `reconcile` до повторения; локальный fixture этого протокола не является Битрикс.

## Конфигурация

`packages/core/config.ts` загружает `configs/<profile>.yaml` и проверяет profile schema; baseline — `public`. Диапазоны и defaults машиночитаемо заданы в `profile.schema.json`. Фактический runtime должен сохранять выбранные значения; изменение config-файла не обнуляет счётчики уже созданного run/crawl.

| Группа | Baseline | Смысл изменения |
|---|---|---|
| Crawl | 10 000 pages, 50 000 assets, 10 GiB, 240 min, 1 req/s, max concurrency 2, 5 redirects, robots=true | Ограничивает объём; достижение создаёт PAUSED и неполный отчёт. Изменение лимита — явное решение, без сброса накопленного расхода. Текущий crawler сериализует трафик и может работать ниже верхнего concurrency. |
| Agents | 3 workers, 3 attempts, 2 fix cycles, 100 task units, 3600 sec | Все верхние пределы; no-tools adapter отдельно ограничивает задачу 300 сек. Наличие max_fix_cycles в профиле не означает реализацию автоматического исправления любого дефекта. |
| Demo | authenticated, noindex, outbound disabled | Требования к целевому окружению; запись YAML не является проверкой работающей изоляции. |

Секреты — только внешние ссылки/окружение требуемых инструментов; credentials не входят в project YAML, промпты и events. Цена/наличие/стоимость LLM при отсутствии данных неизвестны, не равны нулю.
