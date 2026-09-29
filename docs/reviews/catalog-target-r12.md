# Каталог r12: независимая приёмка

29.09.2026. Задача `catalog-target-review-r12`, worker `catalog-r12-review`, fence 1. Reviewer пишет только этот документ и `var/evidence/catalog-target-r12-review`; исходники, Store, сервер, БД и браузер не изменяет. Предыдущая r10/r11 попытка остаётся FAIL/REJECT в `catalog-target-r10.md` и её raw receipts, независимо от результата нового запуска.

**Итог: ACCEPT в ограниченной области выбранных 103 страниц и подтверждённых media.** Actual native apply создал 102 элемента и обновил один; strict reconcile — DATABASE_RECONCILED, 0 defects; повтор пропустил все103 без новых Add/Update. Все103 raw factual SHA совпали с независимо проверенной моделью. HTTPS: 103 маршрута, 802 media SHA и 6 access/method/path checks PASS. Это частичная целевая приёмка: **103 из943 известных URL, full source UNKNOWN, общий NOT_READY**, DEMO_READY не присваивается. Старые r10/r11 FAIL/REJECT сохраняются.

## Архив, код и локальные проверки

Команда `node --disable-warning=ExperimentalWarning var/evidence/catalog-target-r12-review/review-archive.mjs` — exit 0. Архив `var/app-packages/upgrade-foundation-20260929-r12.tar.gz`, expected SHA `b909aa109a070b8f02157b7fff847936b6ef23cfa0388221cb096ca1a8088d86`: независимо проверены все **200 файлов**, SHA и размеры каждого, aggregate source fingerprint, точный перечень и совпадение embedded/external manifest. Archive copies материализованы только в reviewer evidence после проверки путей и типов tar members.

Закреплённые implementation SHA совпадают с ранее проверенными исправлениями:

- `factsproperty.php`: `e46150bc1f3a3ddc0eae4ca018ad67ebb288ea7eeed6b44706c5347fdedf7bd5`.
- `gateway.php`: `e909692206bc5543482d5afb98a4b0f7f83a63305873b499b73abe8ecd6edf73`.
- `router.php`: `5e6e941345df7100c99f07b19b8758dc613c2684d210e4115ca29d4932c8083e`.
- HTTP verifier: `364a42341297572d51523d3f1797c4343503331b7172a40247e8825e14f7b411`.

В архиве присутствуют обе write ветви: `fields()` проверяет допустимость storage value на dry-run, managed fields/hash сохраняют raw JSON, Add/SetPropertyValuesEx получают encoded UG_FACTS. `Gateway::current()` и `Router::content()` декодируют значение. Собственный codec подключён явно. Prefix, версия, точная envelope schema, canonical base64, raw SHA/byte-length и finite decompression limit защищают границу хранения; предел stored value — 60 000 байт, legacy raw value — 65 535 байт. Native S-property с длинными facts содержит envelope, поэтому его нельзя считать обычным прямо редактируемым JSON.

**Независимый PHP 8.3 roundtrip выполнен codec именно из r12 архива** на 103 фактических payloads ранее проверенного v4 model: 103/103 raw byte/SHA equality, 28 compressed, max raw **371 049 байт**, max stored **41 412 байт**. Эта локальная проверка не доказывает целевой Add/Update до получения native receipts.

Reviewer сверил сохранённые журналы `var/evidence/catalog-stage/*-r12-final.txt`: TypeScript без ошибок, **257 PASS** unit/integration (19 564.182 ms), **23 PASS** E2E (40 199.6701 ms), FAIL/CANCEL/SKIP=0. Полный suite без нового finding повторно не запускался. Ранее неуспешный промежуточный fixture run не подменяется этими журналами; это новый final run после исправления fixture.

Независимые artifacts:

- `archive-review.json` SHA `bee6db202ac33b9daf87cefe4d4e50f2a2343f8a1ebb8e8a62faa5190fe89687`: manifest composition, pins, changed files и хеши всех трёх test logs.
- `archive-codec-review.json` SHA `b16a074660198007a1aef7348953dd00e01b60b1459d296d0a643a886ad08683`: результат каждой из 103 factual строк с raw/decoded SHA.

## Исходный scope и условия целевой приёмки

Вход остаётся capture v4 manifest SHA `de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff`. Ранее независимая проверка подтвердила 103 selected DOM URL, совпадающих с initial pinned subset, 131 raw observed page URL, 28 deferred pages, **943 known URL**, 837 verified media references / 802 различных SHA содержимого и отсутствие mandatory entity assets без bytes. Общая полнота источника UNKNOWN. 840 URL вне selected scope не исчезают из знаменателя. Исходный HTTP access gate не снимается операторским capture или фактом Bitrix import.

Для нового native результата нужны: COMMITTED build и точный manifest/code binding; Add/Update с post-write raw facts equality; строгий reconcile; повтор без новых элементов/операций; HTTP фактического текста и media SHA; bounded browser evidence. Успех выбранного103scope не равен переносу943URL. HTTP verifier проверяет presence нормализованного текста, а не порядок/кратность; privacy header matrix помечена NOT_RUN_BY_THIS_SCRIPT. Browser/commerce/search/admin editing, activation и SQL restore должны оцениваться своими свидетельствами.

## Независимо проверенные целевые свидетельства

Команда `node --disable-warning=ExperimentalWarning var/evidence/catalog-target-r12-review/review-server.mjs` — exit 0. Архив `var/evidence/server-r12/catalog-r12-target-evidence.tar.gz`: **53 287 байт**, SHA `ed7781a01781805a0d0f5da9c61f87e83fa0d0c717a8dd8c74ab5c91e5e78480`. Все **11 regular-file members** побайтно совпали с распакованными receipts; индивидуальные SHA записаны в `server-review.json`. Tar PAX headers содержат только mtime. SHA вычислен после локальной передачи, отдельный authoritative transport pin не был предоставлен. Reviewer не повторял серверные действия.

Build `a08186a14295feed3094f7dd5b46190d034f137470caef4bd2fb0a94f092d169` — COMMITTED. Его code fingerprint независимо пересчитан по **архиву r12**, v2 build ID пересчитан по прежнему принятому model ID/output hashes и design tokens. Binding в точности совпадает с model receipt r11: capture v4, selected103, source artifact pin и прежний access block. Import intent ссылается на тот же build/result artifact и manifest **`7f4314d21dd936307add05908c646da3b538cae8ae3a3bfa1871b5babd4f25c1`**. Неудачная первоначальная ручная транскрипция model hash (root сообщил exit2) не входит в raw bundle и отдельно reviewer не подтверждал; corrected build receipt проверен непосредственно.

| Check | Фактический результат |
|---|---|
| Native apply | created102 / updated1 / skipped0 / errors0 / routes103. Log фиксирует14 own files и fence4; обе verification sections и отдельный reconcile — DATABASE_RECONCILED, defects0, unreferenced files0. |
| Повтор | created0 / updated0 / skipped103 / errors0 / routes103, strict reconcile также без дефектов. Это фактический повтор, не только unit idempotency test. |
| Native raw facts | 103 уникальных entity keys; **каждый raw_sha256 и expected_sha256** сопоставлен с независимым local codec/model receipt по stable key, не только друг с другом. Все103 совпали; max raw371049 / stored41412 байт. Исправление реально пережило Bitrix write/readback. |
| Counts / сохранение ID | ug_entity103, ug_route103, ug_operation105, b_user1, b_sale_order0, b_event0; прежний HW-500 остался ID1. Count операций измерен после повтора; отдельного before/after105 measurement bundle не содержит, поэтому такой дополнительный замер не заявляется. |
| Selected HTTP routes | 103/103 exact request targets совпали с независимо построенным selected route set. Status200, H1, stable entity marker, partial banner, noindex и factual-text checks — все PASS. Всего **10 300** проверяемых текстовых значений блоков/списков/таблиц; проверяется presence после whitespace normalization, не порядок/кратность. |
| Media HTTP | 802/802 уникальных public paths; каждый полученный SHA соответствует media bytes независимого offline пакета. Все status200. 837 source references при этом сохраняются; одинаковые bytes не требуют повторных HTTP запросов. |
| Private access / methods / paths | 6/6 PASS: unauthenticated root401, authenticated POST403, admin/license/helper/absent paths404. Это не новое доказательство сетевой egress isolation или полный privacy-header matrix. Последний явно NOT_RUN_BY_THIS_SCRIPT. |
| Scope | Receipt сохраняет known943 / selected103 / unresolved840 / fullUNKNOWN / readinessNOT_READY. Source access block `access-eff7ee21-1e84-499e-9245-eec1142033c6` остаётся в binding. |

Независимый итог `var/evidence/catalog-target-r12-review/server-review.json`: SHA **`5aba7185f54c6e5edbf5b2acab5a8fff9ee99b79a4a626d7c93b2674dfddcc77`**. Raw full target package/model artifact bodies в bundle не включены: metadata/code fingerprints и собственные sets/hash сопоставлены, повторное чтение всех authoritative Store artifacts не заявляется. Backup paths/pins присутствуют в intent, но SQL restore этой приёмкой не проверялся.

## Браузер: ограниченное свидетельство root-оператора

Дополнительно прочитан `var/evidence/server-r12/browser-observation.json`, SHA **`3a9899ab430c1517009ccede7e1fe48a9e62977907a6a6b34fd054f8af6bbbe5`**, observed_at18:34:30UTC, manifest pin совпадает. Пять checks PASS: главная (84 cards,20 mapped menu links,0 forms); переход через меню в `/katalog` (12 cards, decoded photos); mobile HW-500 (360x800, observed2178 text,1table,0forms); mobile menu→contacts; settled grid3columns при1280 /1column при360 и decoded photos. ScrollWidth1265/345 соответствует viewport1280/360 без горизонтального overflow.

Это **атрибутированное IAB-наблюдение root**, не независимый повтор браузера reviewer. Receipt явно отличает ранние placeholders до загрузки от settled DOM; screenshots/полный DOM в этом файле не вложены. Визуальная приёмка всех103страниц, keyboard/a11y, admin editing, commerce/search и завершённый redesign не доказаны. Эти ограничения не скрываются за PASS пяти узких checks.

## Граница приёмки и продолжение

Снятый defect: длинные canonical facts больше не обрезаются в настоящем Битрикс в проверенной партии; import/reconcile/repeat и selected HTTP/media работают. Следующий шаг — самостоятельная работа с оставшимися840URL,28deferred observations и непокрытыми сценариями, без изменения знаменателя и старых failure receipts. Public commerce/actions, лицензионная активация, SQL recovery, полная accessibility/admin-editing и полная visual QA не приняты этим результатом.

**ACCEPT_BOUNDED_SELECTED_TARGET_SCOPE; общий NOT_READY, модель PARTIAL, full source UNKNOWN.**
