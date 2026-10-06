# Независимая проверка commerce, 30 сентября 2026

Task `commerce-review-20260930`, owner `demo-engine`, fence1, input `art-70118d18-7e4c-470e-a2c6-b5e11071dc8d`. Область записи — только этот документ. Автору commerce не изменялись файлы; сервер, Store, БД, browser, Git и исходная сеть не использовались. Все проверки ниже читают локальные исходники/снимки или выполняют чистый extractor в отдельном Node-процессе.

## Попытка v1: REJECT

Все пять переданных pin совпали с локальными файлами перед review:

| Файл | SHA256 |
|---|---|
| `packages/contracts/commerce.ts` | `06cad04a07634cce85cee935bac2776a11c0401d989529aae63eb2e273b6fbce` |
| `packages/extractor/commerce.ts` | `b0f7cc90aa2e482712ff2214b35062f17e2158e486696cef6260b577637079d9` |
| `packages/extractor/operator.ts` | `1d2ee942dfd51a544402702a707fbe0080e7e0ef72083eb74b2a8649e827f83a` |
| `packages/extractor/index.ts` | `6710e6f82d5819d90ec5cc50b499f134882ccf24ec1919a4269be3ee793aeb69` |
| `tests/integration/commerce-observations.test.ts` | `a5ced195284aa8efdfb059c976a7104ac1561a0c070b721e167030d5ae1818b6` |

Команда `node --disable-warning=ExperimentalWarning --test tests/integration/commerce-observations.test.ts` независимо выполнена: **11/11 PASS, 0 SKIP**. Это не достаточная приёмка: дополнительные негативные примеры ниже воспроизвели четыре дефекта P1. Они переданы автору/root немедленно; root подтвердил сохранённый REJECT первой попытки.

Все witnesses использовали `sourceUrl=documentUrl=https://shop.example/item`, immutable SHA256 фактических HTML-байтов, `<main><h1>Current item</h1><div id="product"><input name="quantity" min="1" step="1">…</div></main>`. JSON-LD, где присутствовал, имел `@context=https://schema.org`, `@type=Product`, `url=https://shop.example/item`. Никаких сетевых запросов, выполнения source JS или файлов записи диагностические Node-команды не делали.

| ID | Воспроизведение | Фактический ошибочный результат v1 | Требование для повторной приёмки |
|---|---|---|---|
| C1 P1 | В bound Product вложить Offer с `url=https://foreign.example/unrelated`, `itemOffered={@type:Product,url:https://foreign.example/unrelated,sku:FOREIGN-SKU}`, `availability=https://schema.org/InStock`, `price=1`, currencyRUB, unitTextpiece, eligibleQuantity min1/step1 | Parent availability становится OBSERVED InStock; CURRENT price `totals_eligible=true`; создаётся foreign variant со `source_url=null`, FOREIGN-SKU, eligible price и пустыми purchase.blockers | Чужое/конфликтующее вложенное offer/item identity не должно подтверждать цену, наличие и покупаемый вариант текущего товара. Ограничение URL только при построении ссылки недостаточно |
| C2 P1 | `<span>от </span><span class="price_new">100 р. / шт.</span>` | CURRENT, OBSERVED, eligible100RUB, purchase.blockers[]; отдельный соседний element «от» потерян | Сохранить соседний явный маркер FROM и запретить точный итог; не ограничиваться prev text node |
| C3 P1 | JSON-LD `Offer` содержит `lowPrice=1`, currencyRUB, unitTextpiece, но не содержит `price`/`priceSpecification.price` | lowPrice становится CURRENT exact price1RUB, eligible и blockers[] | Неправильный/неоднозначный lower bound нельзя превращать в точную текущую цену |
| C4 P1 | A: `<span class="price_new" content="1">100 р. / шт.</span>`; B: content100 + `100 р. / шт. для владельцев карты`; C: data-currencyEUR + `100 USD / шт.` | A: eligible money1 при visible100; B: conditions[] и eligible, хотя условие видно; C: eligible EUR100 при visibleUSD100. Во всех purchase.blockers[] | Metadata hints не отменяют видимый конфликт суммы/валюты или неразобранное условие. Конфликт должен остаться review/noneligible |

C1–C4 — ошибки семантического продвижения недоверенных данных, даже если текущий пилот дополнительно блокирует итог неизвестными unit/min/step. Успешный разбор реального пилота не доказывает корректность этих иных допустимых входов. В v1 нельзя утверждать, что вся чужая/неоднозначная commerce исключена из расчётов.

## Проверенные границы v1

Прочитан additive вызов `extractCommerceObservation` в operator extractor **до** удаления форм, через отдельный DOM. Контракт оставляет исходный Page/source_id; sidecar имеет `entity_source_id`, exact request_target и snapshot evidence. Реальный unit test отдельно подтвердил неизменный `Page`, source ID, generic price UNKNOWN, top-level prices/offers empty, source access block retained. Готовность Битрикс или полнота исходного реестра этим кодом не присваивается.

Существующие tests подтверждают from/range в одном текстовом узле, conflicting current amounts, `price_old old_new_price` UNKNOWN, decimal/minor overflow, отсутствие min/step по умолчанию, только четыре explicit варианта при двух-by-трёх select controls (не шесть комбинаций), same-origin base/navigation, exact repeated queries, inert scripts, category без изготовленной цены и сохранённый реальный HW500 с неизвестными unit/min/step. Это ограниченные PASS, не отменяющие C1–C4.

## Попытка v2: REJECT

Повторная task `commerce-review-v2-20260930`, owner `demo-engine`, fence1; закреплённый вход `art-28354fe7-72cb-4a37-88ec-49b6191ebc93`. Root подтвердил сохранённую задачу и отрицательный результат C4 до финального verdict этой попытки.

Проверены SHA extractor `453093b7832ae91c0d69c27e2ad3470d8b896360d4541ff786d6e3d9900b52bb` и tests `ad8c9fb3bb5c9e7d62da709d3de5b3f4ec30bbccb90a4af2adc99b54c4bb6530`; остальные три файла прежние. Независимый inline Node assertion-run дал **8/8 PASS**: C1, C2, C3, три исходных варианта C4, unit conflict и положительный matching metadata/text case. Чужие offer price/availability/variants теперь отсутствуют, lower-bound роли FROM, конфликты/условия не eligible; корректные одинаковые metadata/text остаются eligible.

Независимо выполнено:

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/commerce-observations.test.ts tests/integration/operator-extraction.test.ts tests/integration/operator-heartbeat.test.ts tests/integration/catalog-extractor-review.test.ts
# 57/57 PASS, 0 FAIL, 0 SKIP, 1.72s
```

Но C4 воспроизведён в соседнем обычном случае — видимое число без суффикса валюты, валюта/единица в metadata:

```html
<input name="quantity" min="1" step="1">
<span class="price_new" content="100" data-currency="RUB" data-unit="piece">200</span>
```

Фактический v2 результат: `raw_text=200`, `money.decimal=100`, CURRENT/OBSERVED, `totals_eligible=true`, `conditions=[]`, `purchase.blockers=[]`. Предыдущее сравнение amount с metadata работало только для regex match с явной валютой в видимом тексте. Такой результат не допускает приёмки C4. Автор/root уведомлены немедленно. Нужен canonical comparison и для чистого наблюдаемого числового текста. **Формальный verdict v2 — REJECT**; успешные 57 tests не скрывают этот отрицательный результат. Ожидается отдельный исправленный закреплённый вход v3.

Target Bitrix/native commerce/payment/mail integration этой review-задачи: **NOT_RUN**.

## Попытка v3: ACCEPT в ограниченном локальном scope

Task `commerce-review-v3-20260930`, owner `demo-engine`, fence1, закреплённые inputs `art-9f9b5587-5c03-474e-b3f5-ba3d79b79ab4` и `art-f88765ed-1c5f-4083-959f-50085c6e297f`. Все переданные pins проверены до чтения и extractor/tests повторно после выполнения:

| Файл | SHA256 v3 |
|---|---|
| `packages/extractor/commerce.ts` | `6bce19cca17c838c09022da05528d2d65978d3e518fd94c621a53a552e87c28f` |
| `tests/integration/commerce-observations.test.ts` | `222f08e921fa4ce0ff73c03286af512c1c0ebcb87c44b57e5be9cd41fe2bd62f` |
| `docs/reviews/commerce-model-20260930.md` | `efef28b19943cff463f304c32c9313aa03b6cb56b6848f3ce74f7d5e660ce632` |

Contracts/operator/index остались на исходных pins из таблицы v1. Исходники других исполнителей и сервер не менялись.

Повторно независимо выполнена та же команда из четырёх test suites: **59/59 PASS, 0 FAIL, 0 SKIP, 1.62s**. `npm run check` — **PASS**. В 59 tests входят 17 commerce tests, включая авторскую матрицу36 metadata/text случаев и17 context cases; остальные проверяют operator identity, generic content, source guard, media и heartbeat. Наличие внутри общей команды прежнего PHP renderer contract test не превращает это в проверку Bitrix или DemoEngine: целевой PHP/CMS API для commerce в этой задаче не выполнялся.

Отдельный независимый inline Node-run, не использующий test helper автора, дал **69/69 assertion cases PASS**:

- 9 случаев повторяют C1–C4 из v1/v2, unit conflict и положительный согласованный metadata/text control.
- 60 случаев — Cartesian test matrix **входов парсера**, не товарных вариантов: visible из `17.25`, `17,25`, `0017.2500`, `17.25 RUB / шт.`, `not a price`; content отсутствует/`17.25`/`18.25`/`invalid`; currency отсутствует/RUB/USD. Проверяются отдельные источники числа, согласованность hint, отсутствие подстановки18.25, blockers и точное допустимое17.25.
- 12 результатов этой матрицы eligible,48 noneligible. При несовпадении ни один metadata amount не заменил видимое число.

Первый запуск дополнительной матрицы остановился на моём слишком широком положительном ожидании для `0017.2500`: extractor отказал, хотя значение математически равно17.25. Это **консервативное ограничение**, не подмена и не ошибочное разрешение расчёта. Money grammar допускает два дробных знака, а numeric raw с четырьмя знаками остаётся noneligible с условием/ограничением. Повторная матрица явно проверила и зафиксировала этот отказ во всех12 соответствующих сочетаниях; исходники не подгонялись под reviewer test. Отчёт не скрывает первый отрицательный assertion.

Прочитаны исправления: visibleAmount вычисляется независимо от amountHint; конфликт сравнивает и чистое числовое содержимое; amount metadata не служит fallback для invalid visible text. Вложенные Product/Offer identity ограничивают parent prices/availability/quantity и варианты отдельно. FROM/lowPrice не становятся CURRENT exact; противоречащие role/units и неразобранные соседние условия блокируют расчёт. Скрытый явными DOM-атрибутами дочерний текст не используется как видимая цена. Все исходные review failures C1–C4 в проверенных формах закрыты.

**Verdict: ACCEPT v3 для этой ограниченной evidence-backed модели и её локальных проверок.** Это не универсальный коммерческий parser любых CSS/скриптов/шаблонов или подтверждение текущего наличия. Heuristic page_kind, необработанные структуры, составные бизнес-условия и computed visibility остаются границами модели. Numeric precision/валюты/units и обязательные quantity blockers должны дополнительно проверяться потребителем; отсутствие поддерживаемого разбора не разрешает изготовить цену, единицу, минимум, остаток или комбинацию вариантов.

Существующие Page/source_id, exact source routes, исходный URL denominator и source access gate сохраняются. При target projection нужно связать sidecar с теми же импортированными ID, использовать проверенный snapshot pin и сохранить ограничения. Приёмка не меняет PARTIAL/UNKNOWN исходного scope и не разрешает `DEMO_READY`. Реальный HTTP/Bitrix/native commerce, отправка сообщений/заказов/платежей и общая готовность проекта — **NOT_RUN здесь**; отдельная root-owned интеграция и её фактическая проверка обязательны.
