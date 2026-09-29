# Матрица требований и фактических проверок

Дата: 29 сентября 2026. PASS означает только описанный проверенный сценарий. PARTIAL означает работающую проверенную часть при неполном AT. NOT_RUN означает отсутствие соответствующего фактического запуска. Fixture target, сборка пакета и PHP lint не являются настоящим Битрикс.

Последний полный запуск: `npm run check` — PASS; `npm test` — **51 PASS, 0 FAIL, 0 SKIP**; `npm run test:e2e` — **2 PASS, 0 FAIL, 0 SKIP**. Заданы абсолютные `UPGRADE_PHP_BIN` и `UPGRADE_PHP_EXT_DIR` для PHP 8.3.35. Логи: `var/evidence/tests-final.txt`, `var/evidence/e2e-final.txt`. `npm run test:agents` отдельно дал AT-22 PASS. Результаты этапов и ограничения фиксируются в [PROGRESS.md](PROGRESS.md).

| AT | Проверяемое требование | Статус AT | Фактическое доказательство и оставшаяся граница |
|---|---|---|---|
| AT-01 | Sitemap-only, JS, пагинация, lazy loading | PARTIAL | `tests/integration/discovery.test.ts`: HTTP source registry и отдельный настоящий Chromium находят JS/lazy URLs; полная browser-инвентаризация всех страниц и внешний пилот не выполнены. |
| AT-02 | Разные структуры HTML, неизвестная CMS | PARTIAL | Общий HTML/JSON-LD extractor не требует Битрикс; fixture обрабатывает Page/Product и произвольный HTML. Три разных реальных платформы не испытаны. |
| AT-03 | Регистр, slash, расширения, кириллица, %2F, query | PARTIAL | `tests/unit/discovery.test.ts`, `tests/unit/bitrix.test.ts`: идентичность и пакет сохраняют различия. Ответы настоящего Nginx/Битрикс по всем формам — NOT_RUN. |
| AT-04 | Варианты, фильтры, пагинация, hash-route, якорь | PARTIAL | Query сохраняется буквально; anchors отдельно от HTTP identity. Полноценный hash-router, фильтры/варианты в целевом интерфейсе — NOT_RUN. |
| AT-05 | Несколько origin с одинаковым путём | PARTIAL | URL identity включает origin; package отвергает смешанные origin. Маршрутизация нескольких источников на разные целевые host не реализована и не испытана. |
| AT-06 | Redirect chain, внешний redirect, цикл, 404, soft-404 | PARTIAL | Discovery проверяет 301, 404, 410, redirect loop; private redirects блокируются, исходный URL остаётся FAILED в scope. Полная цепочка 301→302→200, soft-404 и целевые редиректы Битрикс — NOT_RUN. |
| AT-07 | Одинаковый SKU, подтверждённые aliases | PARTIAL | Discovery и Bitrix package tests сохраняют два source_id при одинаковом SKU. Автоматическое доказательство aliases/слияние нескольких URL товара не выполнено. |
| AT-08 | Только четыре реальные комбинации из 2×3 | PARTIAL | Discovery fixture извлекает ровно четыре наблюдаемых Offer. Создание четырёх торговых предложений в настоящем каталоге Битрикс — NOT_RUN. |
| AT-09 | Единицы, «от», скидка, кратность, неизвестная цена | PARTIAL | Fixture проверяет четыре цены с единицей м² и null при отсутствии цены. Полный набор скидок/кратности/условий и целевой каталог — NOT_RUN. |
| AT-10 | Остановка crawl/import, повреждения, resume | PARTIAL | `tests/integration/discovery.test.ts`, `import-recovery.test.ts`, `tests/unit/core.test.ts`: сохранённая очередь, хеши, неизвестный COMMIT и отсутствие дублей в SQLite fixture. Crash/reconcile настоящего Битрикс — NOT_RUN. |
| AT-11 | Два worker, lease, поздний ответ | PARTIAL | Core tests отвергают поздний fencing token; fixture target отвергает устаревшего писателя. Два конкурирующих импортёра реальной БД Битрикс — NOT_RUN. |
| AT-12 | Новая версия входа делает потомков STALE | PASS | `tests/unit/core.test.ts`: замена артефакта помечает непосредственные и транзитивные задачи STALE; старый артефакт остаётся для аудита. Проверка относится к графу ядра. |
| AT-13 | Лимиты, постоянные 429/503, бесконечный обход | PARTIAL | Discovery tests: page budget, oversize, throttling с ограничением retry, slow-stream deadline. Бесконечный календарь и масштаб 10k/50k отдельно не испытаны. |
| AT-14 | Работа демо при отключённом источнике | PARTIAL | `tests/unit/bitrix.test.ts`: медиа включается в пакет по SHA-256 без hotlink. `tests/e2e/pipeline.test.ts`: источник выключен, повторная сборка использует сохранённые данные. Работа всех страниц Битрикс с отключённым источником — NOT_RUN. |
| AT-15 | Поиск, фильтры, варианты, корзина, форма, checkout | NOT_RUN | Feature matrix сохраняет UNVERIFIED. Торговые функции целевого сайта не подключены; наличие элементов не считается реализацией. |
| AT-16 | Правка админки и повторный импорт | PARTIAL | SQLite fixture обнаруживает three-way conflict и сохраняет правку владельца. Реальная админка Битрикс и отображение правки — NOT_RUN. |
| AT-17 | Prompt injection, private redirect, опасный SVG | PARTIAL | Discovery tests: текст инструкции остаётся данными, active HTML удаляется, SSRF/IP/redirect блокируются, SVG не публикуется; Chromium блокирует POST. Полный isolation/secret canary тест Битрикс — NOT_RUN. |
| AT-18 | Изоляция проектов A/B | PARTIAL | Core/fixture/package tests отвергают чужой project_id, артефакт и target fence. Файловая система одного оператора не является OS multi-tenant sandbox; две реальные БД/демо не испытаны. |
| AT-19 | Демо не отправляет заявки и платежи | NOT_RUN | Исходный browser fixture действительно не делает POST; в шаблоне/профиле предусмотрена блокировка. Тест исходящего трафика работающего демо Битрикс — NOT_RUN. |
| AT-20 | Backup, чистое восстановление, smoke | PARTIAL | `tests/integration/backup.test.ts`: отдельная восстановленная SQLite state + immutable artifacts и проверка хешей. БД/файлы/HTTP smoke Битрикс — NOT_RUN. |
| AT-21 | Неверная схема/хеш/project до записи | PARTIAL | Core result schema, fixture hash/project, TypeScript package validation проходят negative tests; настоящий PHP validator 8.3.35 проверил пакет и отверг чужой project/изменённые байты до bootstrap. Реальная попытка импорта Битрикс — NOT_RUN. |
| AT-22 | Настоящие два параллельных агента | PASS | `npm run test:agents`: Codex CLI 0.154.0, два task IDs, перекрытие 3993 мс, сохранённые артефакты и независимая приёмка. Подробности ниже. |
| AT-23 | FAIL/NOT_RUN не превращаются в DEMO_READY | PASS | `tests/unit/verification.test.ts` и `core-review.test.ts`: missing source URL, FAIL/NOT_RUN и пустые checks не готовность; произвольный status setter не выдаёт readiness. |
| AT-24 | Production delta и репетиция отката | NOT_RUN | Production executor блокирован; новые заказы, интеграции и переключение не испытаны. |
| AT-25 | Повторная сборка из принятых артефактов | PARTIAL | E2E повторяет сборку после выключения источника и после backup/restore в другой каталог; те же content/route/file hashes, без нового LLM. Независимый повтор build/deploy на Битрикс ещё не подтверждён. |
| AT-26 | Длинные тексты, missing media, 360 px | PARTIAL | Настоящий PHP renderer и Chromium проверены на 360/390/768/1024/1440 px: длинные тексты, menu/keyboard/404, локальный scroll таблицы; скриншоты просмотрены. OWN_TEMPLATE_CONTRACT_ONLY; фактический сценарий внутри Битрикс NOT_RUN. |
| AT-27 | Бюджет, сбой, resume/retry, dispatcher handoff | PARTIAL | Core tests: reserve сохраняется, лишняя задача блокируется, stale fence и handoff проверяются; deadline ограничивает heartbeat. Полная автоматическая сверка денежного расхода после worker crash отсутствует. |
| AT-28 | Изоляция до первого bootstrap клона | NOT_RUN | Compose internal network, no mail/cron и preflight существуют. Реальный первый запуск клона с исходными событиями и проверка egress — NOT_RUN. |

## Фактический агентный запуск

Доказательства: `var/agent-smoke-1790638572859/agent-smoke-report.json`, `events.jsonl`, SQLite и `agent-jobs/`. Task IDs: `smoke-researcher`, `smoke-analyst`. Job IDs: `job-d8bc23e2-454a-43fc-a339-8bf9766a3a9a`, `job-66e81af6-7b72-43de-a298-d212c0543c38`. Reviewer: `deterministic-fact-checker`; факты, JSON Schema и SHA-256 проверены отдельно от исполнителей. Токены: 19 142 input, 53 output; стоимость UNAVAILABLE. Это малый агентный smoke без инструментов, не проверка качества полного переноса.

## Остальные требования и блокеры

Регрессии серверного этапа 29 сентября: `npm test` 53 PASS, `npm run test:e2e` 4 PASS, skip 0. Новый subprocess-тест запускает CLI через current symlink/junction и проверяет непустой JSON; installer отвергает пустой/неверный help до/после переключения. AT-20/27 дополнены восстановлением внутри ещё живой исходной dispatcher lease, fencing незавершённых задач, сохранением бюджета/истории и независимого review. Проверки остаются ограничены состоянием Upgrade; Битрикс restore NOT_RUN. См. `docs/review-restore.md` и `docs/review-server-deploy.md`.

Сервер r3: non-root source → 19 entities / 23 scope URLs → package/report PASS; source отключён, offline reuse и restore в отдельный каталог PASS; budget/content/route/release hashes сохранены, реальный Chromium 1 PASS. Полнота target = 0 и NOT_READY сохранены. Подробности/команды: [server-validation-20260929.md](server-validation-20260929.md). Эти проверки расширяют доказательства AT-01/14/20/25/27, но не переводят их непроверенные части Битрикс в PASS.

Реализованы короткий AGENTS, план/решения, SQLite и файловые артефакты, CLI, документированный Codex-адаптер, HTTP/browser fixtures, source scope, route planner, контентный пакет Битрикс, собственные модуль/шаблон и honest reporter. Полные данные каталога/продаж, auto design integration, live target gateway deployment, три пилота и масштаб 10k HTML/50k assets остаются непроверенными или незавершёнными.

Для интеграционного запуска нужны пилотные URL и зафиксированный scope, лицензия/редакция Битрикс, изолированный target profile, достаточное дисковое пространство, совместимые PHP/БД и images по digest, разрешённые доступы, источники секретов и бюджет. Хост самого Upgrade не заменяет сервер Битрикс. Следующий шаг: устранить инфраструктурные блокеры, выполнить маленький настоящий импорт и его URL/admin/isolation/restore checks, затем расширять функциональный объём.
