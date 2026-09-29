# Независимый checkpoint r8 — 2026-09-29

Результат: **ACCEPT в ограниченной области `actual-r8-evidence-reviewed`**. Это приёмка доставленных квитанций обновления одной страницы в настоящем изолированном Битрикс. Исходный HTTP-отчёт остаётся **FAIL**, готовность **NOT_READY**, перенос **PARTIAL**. Разрешения на сервер, БД и дополнительные изменения review не предоставляет.

Вход: `var/evidence/server-r8/r8-target-evidence.json`, артефакт `art-a0c1ff61-06ec-4a0b-8346-63693504939c`, SHA256 `8608686f44e457e2d4c95c17f183d1b407a656dc0cc0951d896f582a2d47e97e`. Проверен SHA всего файла и SHA256 UTF-8 байтов каждого вложенного `text`: **14/14 PASS**, имена уникальны. Среди вложений 12 относятся к r8, два — сохранённые квитанции сетевого окна r7.

Сверены связанные поля intent/model/build/HTTP: проект `teplypol-market`, target `target-teplypol-20260929`, COMMITTED model и build, одинаковый operator binding, исходный snapshot и access block остаются указанными; выходные IDs модели совпадают со входами build. Build ID `e3e8473c57b3febe0c626b547b96e515ba97a06890a77e27e543dda07cc7c892`, result artifact `art-df2659e4-8a1f-4d55-a038-55aa512c3cb6`, package manifest SHA256 `838682ba05352434af745140ac726cec1186dd51664900908eb744e860e3ff26` совпали между соответствующими квитанциями. Сами полный пакет и содержимое всех Store-артефактов в этой короткой проверке заново не открывались.

| Проверка доставленных данных | Фактический результат |
| --- | --- |
| Первый r8 apply | created 0, updated 1, skipped 0, errors 0, routes 1 |
| Повтор apply | created 0, updated 0, skipped 1, errors 0, routes 1 |
| Строгая сверка apply / reconcile / repeat | Все три `DATABASE_RECONCILED`, defects и unreferenced_files пусты |
| Readback counts | 1 iblock, element, project, entity, route; 2 операции |
| Mapping | Единственный SOURCE_ID `operator_entity_f26b5a8a233ed1d9fdcc22e4` связан с BITRIX_ID 1 |
| Сценарии с внешним эффектом | users 0, mail_events 0, orders 0; это показания счётчиков, не реализация commerce |
| HTTP | 224 наблюдения: 221 PASS, 3 FAIL |
| Исходный известный реестр | 25 уникальных URL, 1 IMPORTED, 24 UNRESOLVED; соответствующие GET действительно записаны с ожидаемым 200/404 |
| Медиа | 152 успешных GET-записи, 150 уникальных путей; SHA ответа совпадает с SHA в имени каждого файла, MIME соответствует расширению |
| Наличие фактов / partial banner | Квитанция содержит facts_checked 19, facts_pass true, partial_banner_pass true |

Независимый Node-пересчёт проверил ожидаемый HTTP-статус у всех 224 записей, обязательные noindex/no-store/nosniff у всех 221 ответов, кроме TRACE, и совпадение coverage/failures с r7. Три прежние ошибки — TRACE к странице, CSS и PNG: статус 405, по 166 байт, один и тот же SHA256 `11f4864b57acc22316998d012efc32274ea8c3f3230acab7bc8ee576c594b203`, отсутствуют privacy-заголовки. Методы отклонены. Эти исключения **сохраняются**, общий FAIL не переписывается. Обоснование допустимости ограниченной приёмки и точное сопоставление стандартного тела 405 находятся в `partial-target-acceptance.md`.

Строгая сверка управляемых полей подтверждена результатом реально выполненного importer/reconcile и отдельными counts/mapping. Полного сырого дампа полей XML_ID/JSON/route payload в этом bundle нет; review не выдаёт чтение серверной БД за собственное действие. Проверка 19 фактов означает присутствие значений по применённому HTTP-checker, не полноту или точное визуальное соответствие исходной страницы: HTML и ожидаемые raw values здесь заново не сравнивались.

Блок `browser` в закреплённом SHA входа сообщает ACTUAL_IAB: 19 русских подписей, 0 технических, 4 загруженных изображения, requested width 360; document width/scroll 345/345, table width/scroll 271/271. Это доставленная запись root о браузерной проверке. Reviewer браузер не открывал; отдельного DOM/скриншота в 14 вложениях нет. Независимая локальная проверка изменения подписей (19/19 PASS, raw names/values/provenance сохранены, без вывода «старая/новая цена») уже зафиксирована в `partial-target-acceptance.md` и здесь не повторялась.

Два сетевых вложения относятся к **r7, 07:47 UTC**, а не к новому r8: 20 секунд, 117 DB TCP frames из 127, 0 external IPv4, IPv6 и dropped; HTTP 200 записан внутри того окна. Их наличие не доказывает наблюдение сетевого поведения r8, первого bootstrap или будущих запросов. В r8 HTTP-отчёте честно осталось `SEPARATE_RECEIPT_REQUIRED`.

Команда проверки: PowerShell here-string → `node` с `node:fs`, `node:crypto`, `node:assert/strict`; только чтение входного bundle и r7 HTTP JSON. Проверены SHA, идентичность binding/ID/manifest, apply/repeat/reconcile/counts, все HTTP-строки, coverage, media SHA/MIME и неизменность трёх исключений. Фактический итог **exit 0 / PASS**. Полный suite, сеть, Store и target DB не запускались. Изменён только этот review-файл.

Остаются: полный источник UNKNOWN, 24 известных URL не перенесены, автоматический источник требует доступа; администратор/email и активация не завершены, commerce не реализован, восстановление БД не проверено, историческое первое сетевое окно INCONCLUSIVE. **DEMO_READY не допускается.** Следующий шаг root — сохранить checkpoint с этими границами и оставшимися блокерами.
