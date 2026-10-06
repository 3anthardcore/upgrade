# Матрица требований и фактических проверок

Контрольная точка **30.09, 10:05 UTC**: AT15/27 r18 app deployment EXIT0, реальный `native configure` EXIT0; `native prepare --action apply` IN_PROGRESS, licensed handoff execution NOT_RUN. AT20/28 current restore процесс3271034 подтверждён живым, итоговый result отсутствует: IN_PROGRESS. App release не меняет установленный CMS stage389/r15 и не доказывает activation/full QA. Catalog25/25 и runtime-evidence40/40 — авторские targeted результаты, ещё не независимая приёмка или native PASS. Следующие обязательные проверки: завершение restore, root review модулей, exact-request handoff/reconcile/replay.

Контрольная точка **30.09, 09:47 UTC**: AT07/08 ordinary extractor V2 ACCEPT7+5independent/81regression; AT15/27 handoff V2 ACCEPT root unchanged4/4, INVALID artifact admission запрещён. Isolated r18 candidate checkPASS/local498/498/E2E28/28,0SKIP; native deployment NOT_RUN. §23 scale: controlled crawl250/1250 PASS29.464s, полный10000/50000/full pipeline/Bitrix NOT_RUN. AT20/28 current restore IN_PROGRESS, не PASS. Непринятые catalog/evidence/persistence drafts исключены из candidate.

Контрольная точка **30.09, 09:32 UTC**: AT20/28 current restore V2 code review ACCEPT, root11/11 Windows+11/11 WSL, native plan EXIT0/execute IN_PROGRESS (не restore PASS). AT17/28 admission V2 root31/31 actual PHP PASS, native NOT_RUN. AT07/08 commerce ordinary V2 bridge root81/81 PASS0SKIP и unchanged independent probes7/7; V1 REJECT сохранён, V2 reviewer ещё работает. AT15/27 native handoff V1 author27/27/privilege boundary PASS, root review REJECT1PASS3FAIL: INVALID metadata не должна разрешать экспорт native request. В процессе исправления; native bridge ещё NOT_RUN. r17 остаётся текущей установленной версией; окончательная готовность не присвоена.

Контрольная точка **30.09, 08:55 UTC**: AT20/28 current backup **INTEGRITY_VERIFIED**, 160598tree entries/4092865871raw bytes, source runtime restored, retained receipt GET×2 stable11907bytes/session unchanged. Это ещё не restore PASS. AT23 native QA CLI ingest/replay EXIT0, same id/artifact, status NOT_READY; r17 actual deployment EXIT0. AT15/28 независимые probes выявили file-admission4999→5001 и restore rejection штатного vendor PHPSESSID, исправления ожидаются, исходные отрицательные результаты сохраняются. Измеренный p951861ms относится к динамическому no-store, не к кешированному ориентиру. Полный r17 local450/450 и E2E25/25 остаётся последним принятым набором; агентские drafts в него не входят.

Контрольная точка **30.09, 08:32 UTC**: AT15/17/19/21 — новый reusable browser verifier на HTTPS/настоящем Битрикс:205requests/responses/intercepts/transport,0blocked,4syntheticPOST,45viewportshots/14boundedchecks PASS; factual readback389rows и DBcounts неизменны,orders/events0. AT23 — QA validatorV2 теперь отвергает все7 независимых inconsistentreceipt cases; genuinebaseline/cartvariation PASS,14unit и3cache/lease независимых PASS. R17candidate450/450local0SKIP+25/25E2E0SKIP+checkPASS. Первый candidate-run447PASS/3SKIP сохранён: изолированному staging не хватало трёх ignored real-source diagnostics; после копирования неизменённых privatefixturebytes повтор450/450PASS. AT20/28 currentbackup EXECUTING, currentprivatestate restore NOT_RUN. P951861ms и577uncoveredtargets остаются отклонениями, **NOT_READY**.

Контрольная точка **30.09, 08:21 UTC**: AT17/19 — заголовки389 страниц PASS; AT23 — HTTP measurement отдельно сообщает невыполненный p95<1s (фактически1861.134ms,10clients/120samples), не повышает readiness. AT03/06/23 — exact link closure PARTIAL:6532 ссылочных вхождения,4299 вне текущих маршрутов,577 уникальных назначений;389 HTTP200 не доказывают полную навигацию. AT10/21/28 — новый browser verifier15/15 actual PHP/Chromium PASS после root-repeat, native запуск INCOMPLETE до0requests из-за отсутствующей runtime revision, не PASS. AT20/28 — backup fail-closed после nested EIO подтверждён независимыми8/8 Windows+WSL; автор42/42 на обеих платформах; настоящая current backup/restore ещё NOT_RUN. QA normalizer REJECT attempt1: семь несогласованных copied receipts ошибочно принимались, исправление проходит review. **NOT_READY**, полные исторические419local/25E2E не заменяются частичными targeted наборами. [Команды и факты](pilots/completion-20260930.md).

Контрольная точка **30.09, 07:44 UTC**: AT16 частично закрыт настоящим API-edit→HTTP→import-conflict→restore→HTTP→reconcile389/defects0; browser admin editing отдельно NOT_RUN. AT10/15/20/28: actual PHP process restart сохраняет private session/receipts; это не current-state disaster restore. AT17/19: повторный native neutral-context и firewall guard PASS, users1/orders0/events0. AT23: native import evidence COMMITTED с привязкой package/build/model/scope; полный CLI ingest/replay EXIT0. Независимый stage389 review и root-repeat169/169 offline assertions PASS (не169 native сценариев). App r16, `npm test`419/419, `npm run check` PASS; прежний E2E25/25 остаётся последним полным браузерным набором. Новый measurement helper:10 Python assertions PASS, native запуск пока NOT_RUN. Полнота источника UNKNOWN/2742known/389selected, PDF299 и оставшиеся AT сохраняются. **NOT_READY**. [Доказательства](pilots/completion-20260930.md).

Контрольная точка **30.09, 07:10 UTC**: AT10/14/15 — настоящий stage389 apply/reconcile/replay/facts PASS; created286/updated1/skipped102, routes389, defects0, legacy ID1. AT03/06/14 — HTTPS389 маршрутов и2345 assets PASS. AT17/19/21 — synthetic HTTP29 requests/13checks PASS, native JS-disabled Chromium40перехватов/44ответа/10checks PASS; product/cart/receipt/lead/search/empty при360/390/768/1024/1440 без overflow. Native counts и389 facts после HTTP не изменились, users1/orders0/events0. AT20/28 — actual V6 isolated restore исторического r12/103 PASS; production и поздний private demo-state restore NOT_RUN. AT16 native edit ещё выполняется; AT23 общий report ещё не содержит новые receipts. Local413/413, E2E25/25 PASS0SKIP. Source registry2742/PDF299/full UNKNOWN сохраняются; **NOT_READY**. [Доказательства и следующий шаг](pilots/completion-20260930.md).

Контрольная точка **30.09, 06:32 UTC**: AT15/27 — native v7 ingestion восстановлен до COMMITTED, replay вернул тот же3346-file artifact без дублей. AT01/10/23 — v8-stage389 страниц с mandatory-missing0, сохранённый registry2742, full source UNKNOWN; ingest/model/build EXIT0, CMS ещё r12/103. AT17/28 — новый pre-bootstrap transport независимо принят локально (20 HTTP cases), native NOT_RUN. AT28 — restore V4 FAILED на занятой подсети до старта DB; V5 выполняется в новой свободной подсети/каталоге. Общие local375/375 и E2E25/25 PASS,0SKIP; check PASS. [Команды, pins, результаты и следующий шаг](pilots/completion-20260930.md). Это текущий срез; контрольные точки ниже — история.

Контрольная точка **30.09, 05:51 UTC**: AT01/10/23/27 — v8 DOM948, registry2742, ordinary queue0 при review1935; UNKNOWN сохраняется. Исправление registry: 47 независимых tests PASS. AT15/27 — native ingest FAILED/PENDING из-за lease, исправление 9 targeted PASS, независимая проверка продолжается. AT28 — native restore V2 FAILED на static DB host; V3 local36 PASS, native NOT_RUN. `npm test`373/373 PASS0SKIP; E2E24/25, исправленная выдача BLOCKED targeted1/1 PASS, полный повтор продолжается. CMS r12/103, PARTIAL / NOT_READY. [Команды, факты и следующий шаг](pilots/completion-20260930.md).

Контрольная точка **30.09, 05:30 UTC**: `npm test` 362/362 PASS, `npm run test:e2e` 23/23 PASS, check PASS; PHP задан явно, SKIP=0. Commerce V3 / DemoEngine26 / DemoWeb24 / View8 / runtime accepted locally; это PARTIAL по AT-09/15/17/28, native HTTP ещё не проверен. Guard24 и recovery30+independent10/race PASS относятся к локальной политике/контрактам. Native восстановление запущено и ожидает отдельного результата. Полный v7 source registry2737/DOM932 остаётся UNKNOWN; 299 PDF недоступны для проверенного файлового переноса. Staged capture с потерей derived denominator остановлен до импорта. Подробности/команды/следующий шаг: [актуальная точка](pilots/completion-20260930.md). Исторические результаты ниже не заменяют эти границы.

Обновление 30.09: [контрольная точка](pilots/completion-20260930.md). AT01/10/23/27: offline queue12/12 PASS с сохранением unresolved/query/provenance. AT07/08/17/28: pure PHP demo engine18/18 independently PASS; HTTP-интеграция NOT_RUN. AT15/27: native CLI9/9 PASS, включая actual process death/reconcile-first; новая версия native Bitrix NOT_RUN. Commerce v1/v2 REJECT по противоречивым ценам, исправление проходит следующую независимую проверку. DEMO_READY не установлен.

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
# Дополнение r4 — проверка доступа и устойчивость лимитов

29.09.2026: `npm run check` PASS, `npm test` 78 PASS, `npm run test:e2e` 7 PASS, FAIL/SKIP 0. `tests/unit/access-challenge.test.ts`, `tests/integration/access-challenge.test.ts`, `tests/integration/reporter-access.test.ts`, `tests/e2e/access-resume.test.ts` расширяют доказательства AT-01/10/13/17/23/27: challenge не становится контентом, robots HTML не разрешает обход, повтор требует конкретного ack, очередь/счётчики/лимиты живут между процессами, старые или незавершённые снимки не доходят до сборки. Report учитывает источник и не скрывает неизвестную полноту за нулём сущностей. Эти результаты не подтверждают CAPTCHA bypass, полноту teplypol-market.ru или работу Битрикс. Browser operator input и server HTTP имеют раздельный статус.

Серверный r4: access/reporter/CLI запуск дал 24 PASS и один CANCELLED (тайм-аут CLI при параллельной сборке PHP); отдельный последовательный повтор трёх CLI-сценариев дал 3 PASS, exit 0. Реальный KillBot robots сохранён как блок; повтор без ack не добавил запросов. Логи сохранены в `var/evidence/server-r4/`.

AT-17/19/28: предварительный реальный runtime без CMS подтвердил prepend/запрет mail и process functions, доступ только к своей БД, недоступность host/cross-network/public TCP, отсутствие исходящих DNS-пакетов в контролируемом capture. Host controls положительны. HTTPS Basic Auth/noindex и точный raw URI через host proxy проверены. Это **PRE_CMS_RUNTIME_ONLY**, поэтому строка AT-28 первого bootstrap клона и Bitrix-функции остаются NOT_RUN. Дистрибутив «Бизнес» получен, активация и работа CMS ещё не подтверждены. См. `docs/pilots/bitrix-runtime.md` и независимый review.

## Дополнение: portable input и FPM installer

AT-01/10/13/20/23/27: `tests/integration/operator-capture.test.ts` (28) и `tests/e2e/operator-capture.test.ts` (5) подтверждают bounded portable-input validation, exact bytes, persistent partial denominator, повтор/конфликт/pin, TOCTOU, restart и reconcile неизвестной публикации. Итоговый локальный набор: check PASS, 106 tests + 12 E2E PASS, 0 FAIL/CANCEL/SKIP. Это intake доказательств, ещё не extraction/Bitrix import.

AT-17/19/28: actual FPM installer preparation — 108/108 assertions над 45 HTTP requests, independent receipt review. Первый vendor wizard отображается; пакетный capture первого GET INCONCLUSIVE из-за отсутствия положительного контроля. EULA/активация/БД/admin/import/restore/функции CMS NOT_RUN. Текущая точка и команды в `docs/pilots/bitrix-installation-run.md`; не переносить PASS подготовительного runtime на целую AT-28.

Сервер r5: реальный пилотный capture принят двумя различными процессами CLI;149 исходных файлов+1 результат, повтор без дубликатов, неизменные source block/crawl artifact/budget и PAUSED. Receipt `r5-operator-pilot-receipt.json` от05:23:16 UTC, scope REAL_PILOT_OPERATOR_INTAKE_ONLY. Это дополнительное поведение AT-20/27; включение операторского input в общие extraction/report и настоящий target остаются незавершёнными.

AT-20/27, серверная контрольная копия r5:194 backup files,189 artifacts восстановлены в отдельный каталог;149 capture files и13 accepted tasks проверены после restore, budget/PAUSED сохранены, dispatcher detached. Receipt `art-934debf8-eb28-444b-99e6-e20ff4b979cb`. Проверка ограничена Upgrade state; Bitrix DB/runtime recovery NOT_RUN.

## Operator model/build/report — 29.09.2026,06:54 UTC

AT-01/10/13/20/23/27 расширены17 extractor tests,22 operator-report tests и8 operator-model E2E. Проверяются точные поля/URL/query, отсутствие выдуманной commerce semantics, SHA/provenance, missing-media blockers, полный known source denominator при damaged capture, инертный report, offline повтор и restore, неизвестный результат записи,20 metadata tamper variants. Итог после независимых review fixes: check PASS,145 tests+20 E2E PASS,0 FAIL/CANCEL/SKIP. Команды и raw logs в PROGRESS. Это частичная модель/пакет, **не** AT настоящего Bitrix import/admin/commerce/restore.

AT-17/19/28: штатная установка CMS фактически начала создавать модули. Факт записи и отсутствие активных соединений перед resume не являются полной проверкой изоляции/первого bootstrap. Новый временный вход использует documented wizard API и прежний сетевой профиль; PHP lint/nginx -t PASS. Активация, итоговая установка/admin, реальные gateway/URL/function/Bitrix restore остаются NOT_RUN на этой точке.

## Реальная CMS / миграция r6 — 07:24 UTC

AT-01/13/25/27: фактические server operator model/build повторы сохранили IDs и artifacts,25known URLs/24unresolved и source gate. AT-14/15: first native migration INSTALLED, но replay выявил DuplicateEntryException; независимый Gateway review воспроизвёл ложный reconcile без mapping. Оба дефекта исправляются, не отмечены PASS. Actual dry-run: created1,0conflicts/blockers; apply ещё NOT_RUN. AT-20: реальный SQL+files backup integrity PASS; CMS restore NOT_RUN. AT-17/19/28: повторная изолированная CLI runtime-проба PASS, без CMS bootstrap/packet proof; полные требования остаются PARTIAL/NOT_RUN. Доказывающие артефакты/ошибочные попытки перечислены в PROGRESS.

Исправления к следующему release прошли локально168 tests/20 E2E,0 FAIL/CANCEL/SKIP. AT-14/15: matching orphan требует восстановления mapping до strict reconcile; apply recovery и repeat не создают второй элемент. Migration replay registerModule не повторяется; ошибки дают JSON/exit1 даже при vendor error handler. AT-17/19: static Nginx policy tests подтверждают ограниченные routes/методы/headers, но реальные HTTP/Bitrix side effects ещё не проверены новым профилем.

## Настоящий r7 / локальный r8 — 08:01 UTC

AT14/15: migration replay, actual apply/reconcile/reapply PASS в одной isolated CMS: created1, затем skipped1, mapping/routes1. Crash kill и административный conflict NOT_RUN. AT01/10/13/27: known25, imported1/unresolved24, full source UNKNOWN. AT17/19: actual224 HTTP,221 PASS и3 явно сохранённых TRACE405 privacy exceptions;152 media records/150 SHA files; IAB PDF/изображения/details/mobile overflow check PASS в ограниченном preview. AT20: files restore108264 и5 byte comparisons PASS, DB/HTTP recovery NOT_RUN. AT28: текущие20s namespace observation PASS, исторический bootstrap INCONCLUSIVE. r8 local170 tests/20 E2E/25 synthetic observer cases PASS; live r8 ещё отдельный результат. Полный DEMO_READY не разрешён. Артефакты и runbook: docs/pilots/bitrix-cms-verification.md, независимый docs/reviews/partial-target-acceptance.md.

R8 actual delta: AT14/15 PASS bounded update1→repeat skipped1, element ID1/mapping1/routes1, two package operations. AT01/10/13:1/25known remainsPARTIAL/UNKNOWN. HTTP repeats221/224 plus3 preserved TRACE405 privacy exceptions. Actual IAB Russian labels/images/width checked. Independent r8 review and state checkpoint are recorded in subsequent PROGRESS; full AT17/19/20/28/commerce/admin not marked complete.

AT20/27 r8: отдельный Upgrade state backup1044files→restore373 immutable artifacts→readback PASS, IDs/SHA/tasks/operator models/builds/budget/PAUSED совпали. Receipt art-051a6208-8154-484d-8e53-2da068646148. Это UPGRADE_STATE_RESTORE_ONLY; SQL restore и восстановленный HTTP Битрикс NOT_RUN. Новый independent r8 review фактически ACCEPT bounded, но180s publication lease истёк: stale result отвергнут и сохранён отдельно, taskFAILED/unknown budget; root scoped integration result принят до своего deadline. Полный DEMO_READY не выставлялся.

## Администратор — 29.09.2026

AT14/17/19/27 расширены ограниченной account acceptance: actual Add1→fresh Login/IsAdmin→repeat ID1/createdfalse, точные identity/credentials и shared flock;37 local PHP process cases PASS. Общие207 tests/20E2E PASS. Неизвестный Add, exit-after-write, receipt rename failure, чужой admin/identity drift и vendor secret redaction покрыты поведением. Native admin browser/edit conflict и готовность магазина этим не подтверждены. AT28:213 DB frames/0external только в20s окне первого CLI account execution; mail/order counts0,7HTTPprivacy probes PASS. SQL backup integrity не SQL restore. Source1/25known, fullUNKNOWN, NOT_READY сохраняются. Evidence art-6eb3e3e4-e520-46f4-8101-494c3d520763; детали/границы docs/pilots/bitrix-admin-completion.md.

AT20/27: account-stage checkpoint от служебного upgrade — backup1051files/restore380artifacts/readback PASS; tasks, models/builds, SHA, PAUSED и неизменный бюджет совпали. Исправлен обнаруженный EACCES исторических root-owned artifacts ограниченной сменой owner/group проекта; все bytes/modes сохранены и380 artifacts проверены безroot. Receipt art-81209a6a-caa8-4ed4-b103-d219aeaa7611. Это состояние Upgrade, не восстановление БД Битрикс.

## Каталог r10: локальная приёмка — 29.09.2026

AT01/10/13/23/27: ALL_OBSERVED сохраняет весь исходный реестр, v1/v2 повтор, restore и неизвестные публикации; реальный операторский capture131, выбранное множество103,known943/fullUNKNOWN. AT14/15: TS/PHP link/card контракты, точные query, MIME/hash, escaped facts и malformed items проверены до target writes. AT09/17: новый шаблон, доступные имена ссылок, фактологичная навигация и собственные media; реальный expanded Bitrix browser пока NOT_RUN. AT22: фактический designer Codex CLI job/input/output/role pins и независимый proposal review PASS, input ограничен прежней моделью одной страницы. Общие check PASS,249tests+23E2E PASS0SKIP. Source actions/form/cart не считаются реализованными. Подробности и frozen reviews — pilots/catalog-stage.md и reviews/catalog-*.md. AT20 fresh target backup выполняется; SQL restore NOT_RUN.
# Дополнение: native catalogue r12, 29.09.2026

| Требование | Фактическая проверка | Результат и граница |
|---|---|---|
| Повтор без дублей и unknown-write reconciliation | r11 error → отдельный reconcile; r12 native apply/reconcile/repeat | PASS в выбранном scope103:102created/1updated; repeat0/0/103skipped, oldID1 сохранён |
| URL и значимые параметры | HTTPS103exact request targets, включая16query | PASS выбранных маршрутов;840из943known unresolved, fullUNKNOWN |
| Фактический контент | Native103rawfactsSHA + HTTPS10300textvalues +802unique mediaSHA | PASS в проверенных пределах; порядок/кратность textnodes и полнаяvisual semantics не доказаны |
| Пределы native property | Actual r11 truncationFAIL; lossless codec,5PHPtests и GatewayAdd/update/repeat | r12 PASS; encoded≤60000bytes, legacyraw≤65535; несжимаемые oversized data блокируются |
| Реальная команда и независимый review | Persisted disjoint tasks, agent code/reviews, designerCLI, Store artifacts/fencing | Исполнение фактическое; r10/r11 REJECT сохранён, поздний media review не принят задним числом |
| Изоляция | HTTPS401/POST403/admin+license+resume404; native orders0/mail0 | PASS этих6probes; новая полнаяprivacy matrix NOT_RUN, старыйTRACEheadersFAIL не стёрт |
| Адаптивный UI | Root IAB1280/360,menu/catalog/product/contacts,decodedphotos,3/1columns | Bounded PASS; final design/a11y/keyboard/full103visual QA NOT_RUN |
| Backup/recovery | Fresh SQL/files checksum/gzip/listing + предыдущий Upgrade state restore | Backup integrityPASS; настоящий SQLrestoreNOT_RUN |

Команды: `npm run check` PASS; `npm test`257PASS; `npm run test:e2e`23PASS,0SKIP; `operator build --all-observed`; native PHP `dry-run`, `claim`, `apply`, `reconcile`, repeat`apply`; `scripts/verify-pilot-http.py`; `scripts/verify-pilot-bitrix.php`. Evidence `var/evidence/catalog-stage/*r12-final.txt`, `var/evidence/server-r12`, `docs/reviews/catalog-target-r12.md`. Общий статус **NOT_READY**: incomplete source, commerce/search, license activation, native admin editing, SQL restore остаются открытыми.

| HTML design preview (30.09) | node demos/design-v1/verify.mjs: filter/search/product/cart add-remove/390px overflow/images/JS | PASS ограниченного HTML-демо; native Bitrix/design migration NOT_RUN |

| Новый stage1 preflight | node stage1-design/preflight.mjs | API_CONFIGURATION_REQUIRED; actual image generation NOT_RUN; приёмка отдельно docs/stage1/PROGRESS.md |

| Stage1 UI/UX repository | pinned installer + node stage1-design/design-guidance.mjs query | PASS local search; runtime service NOT_RUN |

| Stage1 Studio запуск 01.10 | Серверные smoke.mjs, behavior-test.mjs, edit-smoke.mjs, final-smoke.mjs; реальный restart | Ограниченный PASS: UI→PNG, edit/history, download hash, mobile, auth/CSRF/idempotency/private-IP, persistence; полная приёмка NOT_RUN. См. stage1/LAUNCH.md |
| Регрессия 01.10 | npm run check; npm test; npm run test:e2e | check PASS;406PASS/178SKIP/0FAIL;27PASS/1SKIP/0FAIL. SKIP не PASS; не новая интеграционная проверка Битрикс |

| HyperUI renderer | Server render-test.mjs | 4PASS: escaping/injection, sparse source, bounded style, actual browser/no-network/mobile/immutable files |
| HTML UI и версии | live-test.mjs, version-test.mjs, final-test.mjs | PASS ограниченного сценария: fresh source→HTML/PNG, preview/download SHA, keyboard disclosure, owner/auth, hash navigation, old PNG editor;0paid calls |
| HTML persistence/capture | acceptance-setup.mjs, restart-test.py | PASS: idempotency, fresh10DOM paragraphs/8images, actual restart preserves state; crash-during-write NOT_RUN |
| Regression after HyperUI | npm run check; npm test; npm run test:e2e | PASS;406PASS/178SKIP/0FAIL;27PASS/1SKIP/0FAIL. Полная HTML/Bitrix приёмка не установлена |

| Astra replaces GPT-4.1 in Stage1 analysis/review | model-config.mjs + app.mjs | Real analysis/review HTTP200, completed and JSON contracts; syntax; restart retains 6 jobs/call counts | PASS; full new PNG UI run NOT_RUN; see stage1/ASTRA.md |


| Full new Astra design run | 44620572-78a9-479e-89d2-0e23da13b569 | Authenticated submission, fresh analysis, generation dispatched | RUNNING; final visual QA PENDING |

| Automatic JS capture fallback | source-capture/worker/browser + browser-network | 5 actual Node/browser tests PASS; isolated cookies, GET-only and private IP guard; restart 8 jobs preserved | teplypol-market.ru remains blocked by KillBot; live job pending; see stage1/BROWSER_FALLBACK.md |

| Protected source through real queue | 104983a1-1292-4a83-aaad-7d0998594580 | Automatic browser failure returned clearly, 0 AI calls | Handling PASS; source access BLOCKED, design NOT_RUN |

| Existing regression suite after browser change | npm run check; npm test; npm run test:e2e; isolated codex.test.ts | Check PASS; E2E27/1skip; suite405/178skip/1timeout; isolated retry3PASS | Full suite not all PASS; see stage1/BROWSER_FALLBACK.md |

## 2026-10-02 local source capture evidence
- Source provenance/raw snapshots: 30 timestamped JSON DOM exports, PASS (browser-assisted; no raw HTML claim).
- Scope accounting: 793 observed URLs, 628 unique product URLs, 20 listing pages; full-site completeness PARTIAL. Product details 3/628.
- Saved assets: 154; four failed downloads recorded as limitation.
- Integrity/reproducibility: scripts/package-teplypol-capture.py, 190 SHA256 checks, exact-URL uniqueness, listing/detail count assertions and ZIP integrity PASS.
- Server autonomous capture, Bitrix import and design generation: NOT_RUN in this stage. Existing server challenge remains unresolved.
- Artifact: var/pilots/teplypol-local-20261002/report.html and sibling ZIP. Next: validated ingestion or additional product detail capture.

## 2026-10-04 HTML catalog regression
- Same-origin category/image/name associations, original paths, nested-product filtering, missing-catalog rejection: catalog-test.mjs PASS (3 tests).
- Duplicate headings, category loss and absent category images reject: PASS within catalog-test.mjs.
- Safe escaped rendering, immutable output, desktop/mobile layout, blocked external requests: render-test.mjs PASS (4 tests).
- Fresh live SnabMetal pipeline: 15 category cards, 15 loaded images, no mobile overflow, ready Studio result; var/design-fix-remote/verification.json PASS.
- Capture security suite: initial invocations failed due environment/runtime mismatch, not a successful regression run. General aesthetic quality is not proven by these structural checks; supported image-linked layouts only.

Capture regression follow-up 2026-10-04: correct service runtime/environment => browser-test.mjs 5 PASS/0 FAIL, exit0; evidence var/design-fix-remote/security-tests.log. This supersedes environment-blocked attempts above.
