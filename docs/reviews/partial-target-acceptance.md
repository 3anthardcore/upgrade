# Независимая приёмка частичного target r7

29.09.2026. Задача `review-partial-target-acceptance-v1`, worker `partial-target-qa-reviewer`, fence 1. Входы root: `art-850cca3d-9cdb-483e-afe7-2b9b633823b2`, `art-8ac954d2-2f3a-45a1-886d-b70e4a591c89`. Reviewer записал только этот документ. Сервер, БД, Store, исходные receipts, пакет и код не изменялись. HTTP и browser target заново не вызывались.

**Решение: ACCEPT ограниченного результата r7 с тремя явно сохранёнными HTTP-исключениями.** Доказан предоставленными квитанциями импорт одной наблюдавшейся страницы, повтор без дубликата, сверка назначения и закрытая HTTP-выдача фактических данных. Исходный `r7-http-verification.json` остаётся **FAIL**. Ни это решение, ни локальная приёмка подписей r8 не означают `DEMO_READY`, полный перенос сайта, настроенную торговлю, администрирование, активацию или восстановление БД.

## Целостность доставленного evidence

`var/evidence/server-r7/r7-target-evidence.tar.gz`: независимо вычисленный SHA-256 **`74897550b63d185c8e339dfa2afbb0d4b677416146b659feec787489255b22a3`**, совпал с pin root. Через `tar.exe -tf` и `tar.exe -xOf` без извлечения каждый из **13 членов** сравнен побайтно с уже распакованным локальным файлом — 13/13 PASS.

Проверены intent; две migration receipts; dry-run; claim; apply; отдельный reconcile; повтор apply; after-import counts; HTTP verification; packet window; HTTP этого окна; active nginx check. Отдельный `verify-http.py`, доставленный рядом, не входит в архив: его код прочитан для оценки смысла проверок, но archive pin не аттестует его байты. Полные пакет/media/HTML/DB не входят в этот архив; reviewer не пересчитывал их на сервере.

Значимые pins:

| Данные | SHA-256 |
|---|---|
| r7 import intent | `7799931f24e6d5bff30d9a4b46c1923884211d21f70d77ae994a27a94d9f3e22` |
| исходный r7 HTTP report, статус FAIL | `c83445e486b928efa1bbcd662b1fccf29ec7b11b26c39f65156232994c4f6c2b` |
| r7 packet window | `d6fc69b901b71787a774d2ab85fb29b9b10f3c38dad23b189b1f397c8745cf1c` |
| HTTP receipt внутри packet window | `639ffff46b97db9c8b02ad52b9de0b8972efcb4dab611c1b68fdce60a9ac7ba5` |
| package manifest, одинаковый в intent и HTTP report | `a0f32ca62adb6b24d488dcf93af7870e85c74a79d13015832ca12632e8e76637` |

Это проверка целостности доставленных записей и их согласованности. У apply/counts receipts нет отдельных manifest/PID/timestamp fields; связь каждого процесса с intent опирается на предоставленную root последовательность и общий evidence bundle. Нельзя по этим JSON восстановить полную трассу исполнения или независимо переаттестовать установленный образ.

## Импорт и повтор

- Оба запуска migration возвращают одинаковый корректный `INSTALLED`, project `teplypol-market`, iblock 1. Исправленный повтор больше не выглядит как vendor HTML с exit 0. Поле самой миграции `runtime_verification=NOT_RUN` сохранено: оно не утверждает результат последующего импорта.
- Dry-run: created 1, updated/skipped/reconciled 0, conflicts и blockers пусты. Claim: fence 1, owner `root-bitrix-integrator`, lease_until `1790667741`.
- Первый apply: created 1, routes 1, errors 0; verification `DATABASE_RECONCILED`, defects и unreferenced_files пусты. Отдельный reconcile совпадает по результату.
- Повтор apply: created 0, updated 0, skipped 1, routes 1, errors 0; verification без дефектов. Counts после импорта: iblocks 1, elements 1, own projects/entities/routes/operations по 1. Это подтверждает отсутствие дубликата в данном повторе.
- Counts users 0, mail_events 0, orders 0. Это снимок счётчиков в этой БД, не доказательство отсутствия любых внешних побочных действий во все моменты. HTTP/admin поле Gateway закономерно остаётся NOT_RUN: HTTP проверен отдельным report, административное редактирование ещё не проверено.

Не проверены авария посередине реального target apply, восстановление mapping после такой аварии, реальный конфликт после административной правки и Bitrix DB restore. Ранее принятые локальные contract tests покрывают часть этой логики, но не заменяют эти target сценарии.

## HTTP: пересчитаны 224 наблюдения

Reviewer независимо разобрал все rows JSON и сопоставил известный scope с действительными GET observations. В исходном report — **221 pass / 3 fail**; все 25 request targets уникальны, 1 имеет expected/imported 200, 24 сохраняют UNRESOLVED и действительный 404. Корень `/` не переадресован на единственную карточку. Полный размер сайта UNKNOWN, target readiness NOT_READY.

| Наблюдения | Количество | Результат |
|---|---:|---|
| GET 200 | 156 | PASS в исходном report |
| HEAD 200 | 1 | Нулевое тело и SHA пустого тела независимо сверены |
| GET 401 без Basic для страницы/CSS/media | 3 | PASS |
| GET 404: 24 unresolved + 8 вариантов URL + 14 закрытых путей | 46 | PASS |
| POST/PUT/PATCH/DELETE/OPTIONS к странице/CSS/media | 15 | 403, PASS |
| TRACE к тем же трём ресурсам | 3 | 405, метод запрещён; отсутствуют privacy headers, исходный FAIL |

Все **221 ответа статусов 200/401/403/404** имеют `noindex`, `no-store`, `nosniff`; значения заново проверены reviewer. Для unsupported methods все 18 ответов имеют 403/405. Это подтверждает ответы запрета, но сами HTTP receipts без backend counters не являются покомандной трассой отсутствия входа в PHP.

Выбранный путь: `/termoregulyatory/grand-meyer-hw-500`. Report содержит `facts_checked=19`, `facts_pass=true`, `partial_banner_pass=true`. Прочитанный verifier сравнивает наличие каждого значения из вторых и последующих ячеек таблицы и H1 в разобранном тексте ответа, а также фразы `1 из 25` и неизвестную полноту. Это проверка присутствия 19 наблюдавшихся значений, **не** полное сравнение DOM, порядка/кратности каждого факта, всего исходного описания или функциональности каталога. Сам HTML и массив ожидаемых значений не приложены: reviewer подтверждает сохранённый результат проверки и её алгоритмическую границу, а не повторяет её по исходным байтам.

### Медиа: 152 записи, 150 уникальных файлов

Все **152 asset GET observations** имеют 200; SHA ответа совпадает с 64-hex digest в публичном content-addressed пути, MIME соответствует расширению. Суммарно в этих ответах 7 329 817 bytes, включая повторные запросы. Уникальных target paths **150**: два JPEG (`c2628dc0…` и `d7a8b1fb…`) встречаются по два раза. Поэтому корректная формулировка — «152 проверенные media-записи / 150 уникальных публичных файлов». Исходное `assets_checked=152` считает итерации входного asset registry, а не уникальные blobs; это не ошибка импорта.

Первая независимая проверка намеренно требовала 152 unique paths и выявила это различие (150 != 152). После явного разделения records/blobs повтор проверки всех rows прошёл. Сам report не редактировался. Verifier дополнительно сопоставляет SHA/MIME с hash-verified `data/assets.json`; повторное хеширование target payload reviewer не выполнял.

### Три TRACE исключения

У всех трёх ответов одинаковые status 405, размер 166 bytes, SHA `11f4864b57acc22316998d012efc32274ea8c3f3230acab7bc8ee576c594b203`; из сохранённых headers есть только `content-type=text/html`.

Reviewer локально восстановил обычный постоянный HTML «405 Not Allowed» с footer `nginx/1.18.0 (Ubuntu)` и CRLF: **его 166 bytes и SHA точно совпали** с тремя observations. Таким образом сохранённые хеши соответствуют общей странице отказа без исходного контента или credentials; также видна версия Nginx. Ответ согласуется с ранним отказом переднего Nginx, однако сами отфильтрованные headers не содержат аттестацию слоя/процесса.

Рекомендуется **сохранить эти три исключения**, не менять приложение для обнуления строк теста. Runbook `docs/reviews/partial-preview.md`, пункт 5, требует отказ 4xx для методов и privacy headers на 200/401/403/404. `verify-http.py` применил privacy predicate также к 405, расширив этот критерий. При этом общее предложение runbook «заголовки действуют также на ошибки» следует читать с явно записанной границей early TRACE 405; без такой оговорки оно слишком широко.

Это не разрешение переименовать исходный FAIL в PASS. Бounded acceptance отдельно принимает method-denial и требуемый набор privacy statuses; отсутствие заголовков и раскрытие версии остаются открытым исключением front ingress. Если впоследствии будет принято требование headers на любом early HTTP error, его надо проверять и исправлять отдельной задачей в соответствующем ingress, не правкой PHP и не изменением shared host ради косметического «всё зелёное».

## Текущее сетевое окно CMS

`r7-cms-window.json`: scope `CURRENT_PHP_NAMESPACE_OBSERVATION_WINDOW_ONLY`, 20 секунд, namespace `net:[4026534285]`, own `172.30.50.3`, DB `172.30.50.2`, eth0, subnet `172.30.50.0/24`. Reviewer проверил:

- frames_read = socket_received = 127; все 127 — IPv4; положительных DB TCP frames 117;
- external IPv4 from PHP = 0, IPv6 = 0, malformed/unsupported Ethernet = 0, drops = 0;
- отдельный HTTP receipt имеет тот же namespace/own IP, status 200, 5042 bytes; его start находится через 622 ms после начала окна, end через 852 ms — внутри 20 секунд;
- payload не сохранялся; historical_first_bootstrap и future_requests остаются NOT_VERIFIED.

Это **PASS только для отсутствия наблюдавшихся запрещённых классов кадров в этом текущем eth0-окне с положительным DB control и согласованным HTTP receipt**. Границы observer подробно приняты отдельно в `docs/reviews/cms-packet-observer.md`: он не покрывает loopback, другие интерфейсы, внутриподсетные назначения, proxy forwarding хостом или будущие запросы. DB packet visibility сама по себе не доказывает конкретный SQL. Принадлежность namespace текущему PHP-контейнеру аттестовал вызывающий root; reviewer Docker не опрашивал.

**Это не AT-28 первого bootstrap.** Ранее сохранённое INCONCLUSIVE первого окна не меняется ретроспективно.

## Browser и отдельный label delta для r8

Root сообщил действительное браузерное наблюдение при requested viewport 360: clientWidth 345 и scrollWidth 345, четыре изображения загружены, details раскрывается с клавиатуры. Это подтверждение root, а не повтор reviewer: browser screenshot/DOM receipt не входит в 13-member bundle. Оно не доказывает все breakpoints, touch, keyboard scrolling таблицы, все 152 media records или новую r8 версию. Ширина 345 отражает наблюдавшийся content viewport; нельзя подписывать её как независимо проверенный полный viewport 360 без этого уточнения.

Независимо принят **локальный** delta подписей полей:

| Файл | Проверенный SHA |
|---|---|
| `packages/extractor/operator.ts` | `2b36fef65839d67b2bb3603f5e15c25f9bac85d8cf0381abcb79c41f8e85d01c` |
| `tests/integration/operator-extraction.test.ts` | `b60f3369f4e0b0e2bfab432b5ee97e2052e3ada888a2ac7b4f8ecbe3e2eadc36` |
| `docs/reviews/operator-field-labels.md` | `f9156a6fec366254ed68359b591a2cda99f7179ac8f518f3602dc0cafad3a324` |

Map меняет только первую ячейку таблицы для известных имён и `displayed_price_N` с каноническим индексом 0–4999. Текст значений, raw имена, locator/evidence, `operator_field:*`, UNKNOWN price/availability и пустые commerce массивы не изменяются. Нумерация не присваивает ценам смысл старой/новой/действующей. Неизвестные имена, включая HTML и `__proto__`, сохраняются как экранируемый текст. Это исправление представления технических имён, не новый дизайн.

Reviewer выполнил:

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path var/tools/php-8.3.35/php.exe).Path
node --disable-warning=ExperimentalWarning --test tests/integration/operator-extraction.test.ts
```

Независимый результат **19/19 PASS, 0 SKIP**, 994 ms, включая реальный own PHP formatter без CMS/БД. Новых blocking findings к frozen delta нет. На момент этого review обновление существующего entity и HTTP r8 выполняет root отдельно; оно здесь NOT_RUN. Старый r7 report и model bytes не переписываются.

## Приёмочные границы и следующий шаг

```json
[
  {"id":"r7-delivered-evidence-integrity","status":"PASS","details":"Trusted archive SHA and 13/13 local member bytes verified."},
  {"id":"r7-migration-import-reapply-recorded","status":"PASS","details":"Provided actual receipts: migration twice, one created element, strict reconciliation, reapply skipped, one entity/route/operation."},
  {"id":"r7-http-original-overall","status":"FAIL","details":"Original immutable report retains three TRACE 405 privacy-header failures out of 224 observations."},
  {"id":"r7-http-scoped-content-media-methods","status":"PASS","details":"221 required-status privacy rows, 18 method denials, 25 source routes; 152 hash/MIME media records over 150 unique paths; presence check for 19 source values recorded."},
  {"id":"r7-current-cms-observation-window","status":"PASS","details":"Only current eth0 20-second window: 117 DB frames, 127 received/read, zero external/IPv6/drops; separate HTTP 200 inside window."},
  {"id":"historical-first-bootstrap-at28","status":"NOT_RUN","details":"Prior first-window INCONCLUSIVE is not replaced by r7 observation."},
  {"id":"r8-label-local-review","status":"PASS","details":"Frozen hashes match; 19 independent local extraction/formatter tests passed; raw facts and provenance preserved."},
  {"id":"r8-actual-update-http-browser","status":"NOT_RUN","details":"Separate root execution; not established by r7 receipts or local label tests."},
  {"id":"admin-activation-fullscope-commerce-database-restore","status":"NOT_RUN","details":"Admin identity pending; activation unverified; 24 known URLs unresolved; commerce not implemented; database restore absent; DEMO_READY prohibited."}
]
```

Root сохраняет исходный FAIL и это ограниченное решение раздельными артефактами. Для r8 нужен новый pin, dry-run/update/reapply того же entity, проверка неизменённых raw fact values и новых пользовательских подписей, media и повтор browser. Административный email/учётная запись, активация, полный source scope, commerce и восстановление реальной БД остаются явно открытыми. Общий отчёт не повышает readiness на основании одной страницы.
