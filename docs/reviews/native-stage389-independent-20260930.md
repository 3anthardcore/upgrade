# Независимый review native stage389 — 30.09.2026

**Вердикт: ACCEPT для перечисленных ниже скопированных свидетельств stage389 и отдельно исторического restore V6. Общая готовность — PARTIAL / NOT_READY.**

Задача `native-stage389-review-20260930`, input `art-484907e3-4d4e-407f-b345-a94fdfd95547`. Автор review не выполнял серверные команды, SQL, Store-операции, browser navigation или сетевые запросы. Проверка состояла из чтения переданных native receipts, независимого пересчёта package metadata, сравнения файлов и просмотра четырёх PNG. Использована граница `upgrade-qa`: NOT_RUN не повышается до PASS.

## Закреплённые входы

| Вход | SHA-256 |
| --- | --- |
| `native-evidence-0710.tar.gz`, 14 файлов | `494e01807054a712ca82c462e31adc395882f1119d5fcb9cb6bb37fcc478e1fc` |
| `native-stage389-data.tar.gz`, 6 файлов metadata | `38a7c26c14d5eb99d3a2d2683ce25b0c63c3b1ee2b07c0cfcaed6a372f5373a8` |
| `native-recovery-v6-review-details.tar.gz`, 5 файлов | `446f4b3f16c161ba9bd07ac7aa41031313cb631817b581106f5b0cf689a525df` |
| Принятый package manifest | `4141b1d86b294520f2a2dc02d668c0153924caa9d76ce6c74941b15e6a9a6a9b` |
| Рассмотренная копия `completion-20260930.md`, включая уточнение 07:21 | `8de4d13ada4651807e950b8948e094745cb74f8cdbc6b2aafb908c030fe36541` |

Архивы проверены потоковым чтением без распаковки: все члены — обычные ограниченные файлы; состав, размер и bytes совпадают с предоставленными локальными копиями. Отдельные SHA каждого native receipt/PNG сохранены в `receipt-audit-v4.json`; все входные/проверочные pins — в `artifact-pins.json` этой задачи.

## Принятые результаты

**Импорт и повтор.** Dry-run/apply/replay связываются с `project_id=teplypol-market`, `target_id=target-teplypol-20260929`, одним package SHA и одним private journal. Dry-run и apply содержат 286 created / 1 updated / 102 skipped; сумма — 389. Apply: routes389, errors0, `DATABASE_RECONCILED`, defects[]. Повтор: `TARGET_CONFIRMED`, `replayed:true`, новая applied-запись отсутствует, повторная сверка без defects. Вложенное `http_browser_admin=NOT_RUN` не подменено импортом.

**Фактические данные Битрикс.** Before/after native facts-файлы по 167563 bytes побайтно одинаковы, SHA обоих `6f88d7cde35ef7985f6371c76cecaeb6662553d5b6be4c2a999f7d3534256392`. Проверены 389 уникальных entity keys и 389 уникальных положительных Bitrix IDs. Для каждой сущности независимо сериализован `facts` из точного `data/entities.json`; вычисленный SHA совпал и с expected SHA, и с actual decoded raw SHA в native receipt. Все IDs и facts до/после совпадают. HW500 сохраняет Bitrix ID1; его route/entity association проверена по package. Главная `/` входит в выбранный набор.

Счётчики обоих native readback: `ug_entity=389`, `ug_route=389`, `ug_operation=494`, `b_user=1`, `b_sale_order=0`, `b_event=0`. Эти числа не означают отсутствие любых возможных внешних эффектов: mail/order counters имеют конкретную ограниченную область; packet capture сюда не входил.

**Доставка страниц и media.** HTTP receipt содержит ровно 389 уникальных request targets с status200 и положительными status/H1/entity/factual-text/noindex/demo проверками. Множество targets независимо совпало с полным `data/routes.json`; значимые query не нормализовались. Все 2345 уникальных media paths и SHA из HTTP receipt совпали с точным `data/assets.json`. HTTP receipt отдельно подтверждает auth401, source POST403, vendor/admin/license/installer/missing-path404. Доставка bytes оценивается по скопированному native HTTP receipt; reviewer не выполнял повторных HTTP-запросов и не скачивал все media заново.

**Операторская модель и snapshot.** Scope связан с model `778398197db344daad7c23d7a5e09518dcc81178c1e026aa1380c4b72170223b` и capture `teplypol-catalog-20260930-v8-stage`, SHA `ecb85765cf5b71b0299035334f064f3cdebc6d3528c7fb6c0c6bcd0d0e6078fb`. Сохранены все 2742 известных URL, выбранные389, unresolved2353 и все унаследованные raw URLs из stage manifest. Выбор соответствует ровно389 DOM-наблюдениям. Scope остаётся PARTIAL, source_access NOT_VERIFIED, full_source_denominator UNKNOWN.

SHA private demo snapshot bytes `907289cdf817e5b9141d22d595ebb136c4c794c93dc6f8ec5d600d1086f6d955` совпадает с package manifest и activation receipt. Независимо пересчитанный snapshot ID `aadf871e2e4ab20a8d1e67603e4629db6740ee0d74b24223e2980b34308c2cd2` совпал с activation и HTTPS scenarios. Все389 item IDs/request targets соответствуют package. Сам activation receipt по-прежнему `ACTIVATED_AWAITING_HTTP / http NOT_RUN`; это не ошибка, позднейшие HTTP свидетельства рассматриваются отдельно.

**Сценарии HTTPS.** `HTTP_SCENARIOS_VERIFIED`: 29 последовательных exchanges, 13 PASS checks, `unknown_write:false`, error null. Выделены 20 GET, два отвергнутых POST403 и семь синтетических POST303 исключительно `/__upgrade/action`. При exact add retry operation URL совпадает. Checkout receipt body SHA совпадает на трёх последующих чтениях; lead — на двух. Проверены привязка к origin/product/snapshot и SHA принятого verifier. Search/sort/filter, CSRF/Origin denial, add/update/remove, synthetic checkout/lead и readback подтверждены именно в пределах этих checks; это не реализация настоящих заказов/платежей.

**Браузер.** Принят скопированный native Chromium receipt: JS отключён, 10 сценариев PASS, 4 POST только в собственный action, каждый303. Исправлено неточное название счётчика в root-документе: `requests=40` — вызовы route interception, а response events44 — 40 GET200 + 4 POST303. Это не точный счётчик всех сетевых запросов. Исходные receipt и script не изменялись.

Четыре предоставленных PNG прошли signature/chunk-CRC/dimension checks и просмотрены: product360, cart390, receipt1440, search360, высота1000. На них видны389/2742 и partial-banner, фактические3350/2178 на карточке, неизвестная итоговая сумма, демо-корзина и явно синтетическая запись без отправки. В доступных первых экранах явных горизонтальных обрезаний/наложений не обнаружено. Заявленные30 полных screenshot-файлов не были предоставлены целиком: все30 визуально этим review **не проверены**. Остальные ширины/состояния подтверждаются сценарием receipt, не просмотром отсутствующих PNG.

## Историческое восстановление V6 — отдельный результат

Canonical plan SHA независимо пересчитан: `55ae7f465c988df2240ac20c678b404d1436820b4f1d4a7ea5e04a3833103977`, совпадает с accepted plan, intent и двумя копиями result. Закреплены исторические SQL SHA `42e544ed2a7bf213188f505a6781d1eb413afa5515493815972b97c54f8f0fef` и CMS-files SHA `a06afb75cf8954abcbaabadec57a6cfa4ecbf43f27d0aa96325b7ff6151cf157`.

План использует новый `/opt/upgrade/recovery/teplypol-market-20260930-v6`, clone project/target, отдельную172.30.53.0/24 сеть и volume `teplypol-recovery-v6-database`. Все clone bind mounts находятся внутри destination; опубликованные порты/host-network/privileged не заданы. IDs трёх clone-контейнеров отличаются от трёх source-контейнеров.

150 упорядоченных events подтверждают: file readback153609 entries / 1426884672 expanded bytes; объявленную замену только DB-host literal в clone settings после readback; успешный guard до запуска DB; SQL import exit0; database readback103/103/105/users1/orders0/events0; PRE_CMS runtime probe до WEB_START; auth401 и smoke200/200/404; final guard exit0 и FINAL_READBACK с теми же counts в07:07:42UTC. Собственная DB доступна, source DB недоступна, DNS наружу не разрешён, mail/process functions disabled — результаты сохранённого probe.

Принят `ISOLATED_COPY_RESTORED_AND_SMOKE_VERIFIED` **для исторического r12/103 SQL+CMS backup**. Это не restore текущих389 страниц, не private session restore, не production DR. Полный SQL, все CMS bytes, raw file ledger и final source inspect stdout не передавались: source-runtime unchanged и полный file readback принимаются как записанные результаты executor, не как заново локально пересчитанная файловая система. External packet capture и cleanup остаются NOT_RUN. Прежние FAILED V2/V4/V5 не переписаны.

## Неподтверждённые этой задачей части

- Полнота всего источника: UNKNOWN; известный scope2742 не сокращён. Доступ/границы переноса299 PDF, deferred559 DOM и другие unresolved URL не закрыты.
- Самостоятельный live повтор reviewer: NOT_RUN. Скопированные receipts доверенного оператора и SHA обеспечивают целостность/согласованность, но не криптографическую удалённую аттестацию против недостоверного оператора.
- Полная privacy-header matrix явно NOT_RUN_BY_THIS_SCRIPT в route verifier; нельзя заменить её six-path smoke. Variant/Lighthouse, все шаблоны и все30 screenshots не приняты этим review.
- Deployment POSIX ownership, весь установленный code/media tree и native D7 neutral-context probe не пересчитывались по этим архивам; соответствующие отдельные проверки не объявляются закрытыми этим заключением.
- Root сообщает о последующем PHP restart и сохранении приватных receipts, однако отдельный restart receipt не входит в рассматриваемые архивы. **Самостоятельно не подтверждено**, не превращается в private-state restore.
- Admin edit/conflict, остальные пилоты, лицензия и общая readiness не повышаются этим результатом.

## Воспроизводимая локальная проверка

```text
python -I -B var/evidence/native-stage389-review-20260930/audit.py --output var/evidence/native-stage389-review-20260930/receipt-audit-REPEAT.json --package-directory var/evidence/continuation-20260930/native-stage389-data --recovery-directory var/evidence/continuation-20260930/native-recovery-v6-details
```

Фактически использован bundled Python `C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`. Скрипт не имеет сетевых/DB/Store операций, не распаковывает архивы, создаёт только новый файл в разрешённой review-директории. Итог `receipt-audit-v4.json`: **169/169 локальных assertions PASS, exit0**. Число включает отдельные PNG CRC и byte-copy assertions; это не169 native сценариев. Промежуточные v1/v2/v3 результаты сохранены, последовательно добавлялись точные package metadata и restore detail.

- `audit.py`: SHA `b8dc93347c030c394843811447270460346f53f3ba82432339bca2d391f15cb3`.
- `receipt-audit-v4.json`: SHA `15c91710078b739e34ffe8a4a52e97380bf9e9fb8134a726ac4db2181a6e0313`.
- Input pins и просмотренные claims: `var/evidence/native-stage389-review-20260930/artifact-pins.json`, `completion-reviewed.md`.

```json
[
  {"id":"native-stage389-import-and-facts","status":"PASS","details":"Copied receipts bind exact project/target/package;389 factual hashes independently recomputed; before/after IDs and389/389/494/1/0/0 counts identical."},
  {"id":"native-stage389-http-and-snapshot","status":"PASS","details":"Exact389 route and2345media membership/SHA match copied HTTPS receipts; private snapshot identity and389items independently match package."},
  {"id":"native-stage389-demo-scenarios","status":"PASS","details":"Copied29-exchange/13check HTTPS and10check native browser outcomes;40route callbacks/44response events; four available PNG samples reviewed."},
  {"id":"native-r12-historical-restore","status":"PASS","details":"Separate pinned V6 plan/events/result: historical103/103/105 counts and isolated SQL/files smoke; no current389/private-session/production recovery claim."},
  {"id":"native-stage389-current-private-state-restore","status":"NOT_RUN","details":"Not part of supplied receipts. Later restart is not full recovery."},
  {"id":"native-stage389-full-source-readiness","status":"NOT_RUN","details":"2742known/389selected/2353unresolved; full source UNKNOWN,299PDF and deferred scope remain; PARTIAL/NOT_READY."}
]
```
