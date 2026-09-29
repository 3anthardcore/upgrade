# Операторские наблюдения в общем отчёте

Задача `report-operator-scope-v1`, исполнитель `operator-report-implementer`, вход `art-ea192b68-5737-455d-a878-4de4dcdb8a50`, run `run-e8fdef66-8fb8-49d5-9ccf-b02c98e94de1`. Область изменения: `packages/reporter/index.ts`, `tests/integration/operator-report.test.ts`, этот документ. Сервер, целевая БД, исходный сайт и Store пилота исполнителем не изменялись.

Обычная команда `report --project ID` теперь включает принятые операторские capture в JSON, HTML и Markdown. Она остаётся чтением сохранённого состояния с записью только производных `reports/report.json`, `reports/index.html`, `reports/summary.md`. Сеть, исходный HTML/JS и целевые PHP не исполняются. Закрытие чата или перезапуск процесса не требует повторного получения источника.

## Раздельные факты

- `source` сохраняет последний автоматический crawl: его artifact ID, состояние, URL-реестр, фактически сохранённые HTTP-статусы, robots/access block и очередь. Capture не очищает PAUSED, KillBot block или legacy revalidation gate.
- `operator.captures` содержит каждую запись `operator_capture`. Только полностью проверенный COMMITTED результат имеет `state=PARTIAL`, `integrity=VERIFIED`. PENDING остаётся PENDING; несогласованные данные — INVALID. Успешная проверка локальных байтов не становится подтверждением полноты страницы или правдивости исходных фактов.
- `operator.registry` объединяет текущие URL crawl, исходный URL проекта, URL первоначального привязанного crawl и все URL проверенного capture: объявленный inventory, observation/document URL, внутренние ссылки из DOM или выбранных полей. Query, регистр путей, `%2F`, пустые/повторные параметры не сворачиваются. Фрагменты сохраняются в raw-вариантах одного HTTP request target.
- `operator_derived` показывает отдельные COMMITTED/PENDING/INVALID модели и пакеты операторского ввода. Запланированный ответ 200 и созданный package не превращаются в наблюдавшийся HTTP200 источника или проверенный сайт Битрикс.
- `target` содержит отдельно сохранённые QA counts/coverage. Даже `verified=998` в QA не изменяет знаменатель или число операторских наблюдений. `operator_capture_import=NOT_RUN`, readiness отчёта остаётся NOT_READY.

`SELECTED_FIELDS` означает сохранённые выбранные поля. `DOM_OBSERVED` означает сохранённый DOM. Ни один статус не утверждает полной страницы, успешной HTTP-загрузки, формы, фильтра, заказа, наличия товара или снятия ограничения автоматического доступа. Общее количество URL сайта всегда UNKNOWN.

## Проверка capture перед показом

Reporter читает артефакты из Store, проверяя принадлежность проекту, статус VALID, размер, SHA и тип. Прочитанные для использования байты повторно сопоставляются с pin; изменяемый исходный каталог capture для отчёта не нужен. Для operator payload разрешены только независимые обычные файлы, не symlink/hardlink, размером не более 256 MB на артефакт; это дополнительный предел чтения отчёта, а не увеличение лимитов intake.

Проверяются capture ID, manifest SHA, result artifact ID и детерминированный type, project/origin, сохранённые source artifact/access block, PARTIAL/NOT_VERIFIED/NOT_EVALUATED. Оригинальный crawl заново сверяется по SHA и сохраняется как binding; новый current crawl не подменяет его. Если снимки различаются, `stale_binding=true` показывается рядом с capture/наблюдением/моделью/пакетом.

Result `artifact_files` должен совпадать с receipt, `files` — с исходным pinned manifest. Требуется ровно один manifest плюс все объявленные observation/media files, без подмены SHA/размера. Manifest и selected JSON проверяются по экспортированным схемам intake. Данные selected fields сверяются с файлом, DOM разбирается инертно; URL-реестр и observation counts пересчитываются, а не принимаются из строки coverage. JSON objects сравниваются семантически по именам ключей; порядок массивов сохраняется. Хеш исходных байтов при этом не нормализуется.

Повреждение медиа не должно уменьшать знаменатель. Поэтому URL из отдельно hash-verified, привязанного result inventory сохраняются как known URLs даже при последующем отказе payload. Они получают `UNVERIFIED_CAPTURE` в `capture_inventory_sources`; selected/dom success не начисляется. `unverified_capture_urls` и `evidence_complete=false` делают границу видимой. Если не проходит сам result SHA/project/source binding, его список не используется; отчёт сохраняет текущий достоверный реестр и явно помечает INVALID. PENDING без принятого result не даёт неизвестным URL выдуманного счётчика. Полнота такого общего реестра не утверждается.

## Модель и пакет

`operator_model` проверяется по COMMITTED record, input hash, полному `operator_binding`, capture/source SHA, output artifact IDs и `output_sha256`. В `operator-content-model.json`, `operator-route-manifest.json`, `operator-scope-manifest.json` должны совпасть binding/input/state. Scope inventory/coverage сверяются с capture; одна выбранная сущность/маршрут не скрывает остальные unresolved URLs. PENDING и повреждённая модель не дают счётчиков успешного извлечения.

`operator_build` дополнительно связывается с проверенной моделью и точным массивом input artifact IDs. Input hash пересчитывается по контракту `operator-build-v1` из model ID, output SHA, записанного code SHA и default design tokens; code SHA в release должен совпасть с record. Это проверка записанного происхождения, не утверждение совпадения со свежими исходниками. Проверяются `operator-release-manifest.json`, release ID, scope/model/routes IDs, package path и принятый manifest SHA. Локальный package читается без исполнения: проверяются все файлы, их SHA и отсутствие лишних файлов, symlink/hardlink. Подмена после сборки не остаётся VERIFIED. Состояние даже целого пакета — PARTIAL; `runtime_verification=NOT_RUN`.

`package_blockers` и `package_warnings` читаются из принятого manifest, сверяются с release и выводятся в каждом формате, включая общие ограничения. Проверенная целостность пакета не означает разрешения на импорт. При блокерах `import_gate=BLOCKED_PACKAGE`; следующий шаг требует устранить их и создать новую принятую сборку, даже если поздний автоматический crawl уже COMPLETE. Пустой список даёт только `import_gate=NOT_EVALUATED`: фактические prerequisites и runtime ещё не проверены. Отсутствующий PDF остаётся блокером, не перенесённым документом.

Операционные файлы и счётчики всех предыдущих capture сохраняются; отчёт не меняет SQLite, бюджет, dispatcher ownership, задачи и readiness. Последние проверенные model/build IDs выделены отдельно, а незавершённые и невалидные outputs не скрываются. Созданный пакет не является деплоем, импортом, лицензированным runtime или подтверждённым восстановлением Битрикс.

## Недоверенные строки

Все источники, URL, ошибки и идентификаторы экранируются для HTML и Markdown. Не вставляются исполняемый DOM, скрипты, raw Markdown links или изображения источника. В HTML адреса выводятся текстом; строки из capture не получают инструкций/разрешений. Выбранные факты не нормализуются в цены/наличие и не выводятся как новый фактический контент — это задача отдельной частичной модели.

## Фактическая проверка

Команды для этого изменения:

```text
npm run check
node --disable-warning=ExperimentalWarning --test tests/integration/operator-report.test.ts tests/integration/reporter-access.test.ts
```

Новые tests используют реальные временные файлы, Store и intake, затем закрывают/открывают Store и читают все три формата отчёта. Проверяются исходный denominator/gate/budget, неизвестная полнота, stale source bindings, PENDING после неизвестной публикации, повреждённые файлы, согласованный новый SHA при ложном содержимом/binding, сохранение URL при повреждении медиа, escaping и независимые target counts. Отдельный сценарий действительно вызывает `createOperatorModel` и `buildOperatorPackage`, проверяет отчёт и отклонение постороннего PHP в локальном пакете. Это настоящий локальный builder, не запущенный Битрикс.

Fixture масштаба пилотного ввода содержит 25 URL, одно SELECTED_FIELDS, 24 UNOBSERVED и 147 media files: отчёт подтверждает эти значения и 149 файлов вместе с manifest/observation. Файлы теста синтетические; это не повторная проверка достоверности 147 ресурсов реального сайта. Предоставленный `r5-operator-pilot-receipt.json` отдельно сообщает аналогичные actual intake counts, но root server receipt не заменяется этим fixture.

Финальный запуск после независимого review 29.09.2026: `npm run check` — PASS; указанная совместная команда — **32 PASS, 0 FAIL, 0 SKIP**, 14.5 s (22 operator-report и 10 прежних reporter-access). `npx prettier --write packages/reporter/index.ts tests/integration/operator-report.test.ts docs/operator-report.md` — exit 0. Review выявил два P2: отсутствие блокеров пакета в отчёте/next step и неполную проверку build code provenance. Оба исправлены; четыре новые поведенческие регрессии создают настоящий локальный operator package с отсутствующим PDF и проверяют отдельные подмены record code SHA, release code SHA и release blockers. Byte integrity при missing PDF остаётся VERIFIED, import gate — BLOCKED_PACKAGE; подмена происхождения/предупреждений даёт INVALID. Исходный gate, бюджет и Store history сохраняются. Первые два отказа первоначальных тестов также устранены: новый bounded-file error требовал проверки повреждения равного размера, а package walker ошибочно вызывал `inside` для самого корня вместо его дочернего пути. Непроведённые сетевые, target HTTP/admin/import/restore проверки остаются NOT_RUN.

Отчёт также даёт отдельный следующий шаг для незавершённого capture, модели или пакета, сохраняя исходный шаг восстановления автоматического доступа. Когда существует частичная операторская модель, текст не утверждает глобально «контент не извлечён»: её сущности и маршруты названы отдельно от модели автоматического обхода.

Следующий шаг: независимый review трёх файлов, повтор общего отчёта root на принятом пилотном Store и отдельная проверка настоящего частичного импорта; исходный crawl и его access block сохраняются.
