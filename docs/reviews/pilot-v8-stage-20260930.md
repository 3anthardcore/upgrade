# Pilot v8: проверенный частичный stage — 30 сентября 2026

Результат: **VERIFIED_PARTIAL_STAGE**, самостоятельный offline capture `teplypol-catalog-20260930-v8-stage`. Выбраны все 389 извлечённых страниц, у которых каждый обязательный `entity.assets` URL имеет проверенные локальные bytes. 559 страниц явно отложены; их факты, DOM и обязательные документы сохранены в полном v8, а URL остаются в stage registry. Это не полная миграция, не native package/import и не DEMO_READY. Native Bitrix, source HTTP, сеть, браузер, Store и целевая БД в этой задаче **NOT_RUN**.

Области записи: новый evidence directory `var/evidence/pilot-v8-stage-20260930/`, новый capture `var/pilots/teplypol-catalog-package-20260930-v8-stage/`, этот документ. Root заранее сохранил amendment для временного sibling `<stage>.pending-*`, который штатный packer использует до atomic rename. Исходники приложения, raw captures, полный v8, старый ошибочный v7-stage, Git и сервер не изменялись. Предыдущий v7-stage не использовался как источник реестра или артефакт переноса.

## Входы и pins

| Вход | SHA256 |
| --- | --- |
| Полный v8 `operator-capture.json` | `29f903fbba20fa92149433bf304c2254adc0b718d054c5a6acaff4ec283006a5` |
| Исправленный `scripts/pack-browser-observations.ts` | `a410ff91f275fd93aa67de0d64caf82b8f24dec9282f60a4aa825bcc865d3e04` |
| Новый scope `v8-safe-stage-scope.json` | `8e7022454c618a60e00a78da4230169274d227e6c27d47efd1455718f8eb748e` |
| Новый raw freeze `v8-raw-freeze.json` | `e90cf014f65d3e5e893fa814640baa77ff85448460711a12cd4ea324db8f2606` |

Прочитаны оба raw directory: `var/pilots/teplypol-catalog-20260929` и `var/pilots/teplypol-catalog-20260930`. Все **985 raw JSON** по абсолютному пути, длине и SHA256 совпали с input pins принятого full-v8 pack report. Файлы являются недоверенными данными; HTML не исполнялся. Анализ использует actual `validateOperatorCapture` и pure `extractOperatorContent`, а не эвристическое предположение по имени файла.

SHA используемых crawler/extractor модулей записаны в анализ и повторно сверены после сборки: `implementation-pin-verification.json`, **PASS**, SHA `13eb3e669b77b97dd384ada72eb4e5e661abdbc40f86c687ddfee92bee1853ec`.

## Полный capture и причина частичного выбора

| Метрика | Полный v8 | Новый v8-stage |
| --- | ---: | ---: |
| Известные URL / crawl keys | 2 742 | 2 742 |
| Точные raw URL-варианты в validated inventory | 3 461 | все 3 461 сохранены |
| DOM-наблюдения | 948 | 389 |
| UNOBSERVED в данном capture | 1 794 | 2 353 |
| Проверенные asset URL | 2 434 | 2 434 |
| Уникальные asset SHA | — | 2 345 |
| Извлечённые entities | 948 | 389 |
| Обязательные отсутствующие asset URL | 301 | 0 у выбранных entities |

Критерий выбора строго совпадает с обязательным builder gate: **каждая** строка `entity.assets` присутствует среди проверенных `capture.assets.source_url`. Не удалены ссылки, блоки, характеристики, цены, сертификаты/PDF или изображения ради прохождения gate. Типы entities и source ID не менялись. Все 2 434 проверенных файла сохранены в stage с прежними SHA256, размером и MIME.

Полный v8 содержит **301 уникальный обязательный отсутствующий URL**, влияющий на 559 entities: **299 PDF** и два остальных файла:

- `https://teplypol-market.ru/image/catalog/News/kabelniy-tepliy-pol-na-balkone-svoimi-rukami.jpg` — одна страница-свидетель;
- `https://teplypol-market.ru/info/img/close.svg` — девять страниц-свидетелей.

Полный список, исходные страницы-свидетели и hash evidence: `v8-missing-mandatory-assets.json`, SHA `77a96170d02587e5a17bd31fc3f84096ed796028801fa5db702ddb839481c0a2`. Данный анализ не устанавливает, почему файл отсутствует или какой HTTP status у него на источнике: доступ к сети не выполнялся. Нельзя объявлять такие документы необязательными только по расширению или имени.

Другие unverified URL полного capture: 1 436; validator stage сообщает **141 unverified asset URL**. Они не скрыты и сохранены в pack report. Нулевой mandatory missing означает только отсутствие блокера `ENTITY_ASSET_MISSING` у 389 выбранных entities; это не заявление о полном переносе всех изображений/ресурсов/документов сайта. Все **4 484 записи pack omissions** сохранены как исходный журнал, без подмены его числом уникальных отсутствующих обязательных файлов.

## Сборка и фактические проверки

Последовательно выполнено, все команды завершились exit 0:

```sh
node --disable-warning=ExperimentalWarning \
  var/evidence/pilot-v8-stage-20260930/analyze-v8.mjs

node --disable-warning=ExperimentalWarning scripts/pack-browser-observations.ts \
  var/pilots/teplypol-catalog-20260929 \
  var/pilots/teplypol-catalog-package-20260930-v8-stage \
  teplypol-catalog-20260930-v8-stage \
  var/evidence/pilot-v8-stage-20260930/v8-safe-stage-scope.json \
  8e7022454c618a60e00a78da4230169274d227e6c27d47efd1455718f8eb748e \
  var/pilots/teplypol-catalog-20260930 \
  --registry-manifest var/pilots/teplypol-catalog-package-20260930-v8/operator-capture.json \
  --registry-sha256 29f903fbba20fa92149433bf304c2254adc0b718d054c5a6acaff4ec283006a5 \
  --raw-freeze var/evidence/pilot-v8-stage-20260930/v8-raw-freeze.json \
  --raw-freeze-sha256 e90cf014f65d3e5e893fa814640baa77ff85448460711a12cd4ea324db8f2606 \
  --report-dir var/evidence/pilot-v8-stage-20260930

node --disable-warning=ExperimentalWarning \
  var/evidence/pilot-v8-stage-20260930/verify-v8-stage.mjs
```

Команды создают новые immutable outputs с `wx`/unused-directory guard; их не следует слепо повторять поверх уже готового stage. Анализатор, verifier и JSON evidence сохранены в новой evidence directory для повторяемой независимой проверки. `--registry-manifest` передаёт **полный validated v8**; исправленный packer наследует каждый его crawl key и raw URL, включая URL, найденные только в DOM. Предыдущий дефект уменьшения знаменателя не обойдён выборочным manifest inventory.

Новый manifest SHA256: **`ecb85765cf5b71b0299035334f064f3cdebc6d3528c7fb6c0c6bcd0d0e6078fb`**. Размер manifest **1 700 881 bytes**; content files **129 395 784 bytes**; всего **131 096 665 bytes** с manifest. Исходные ограничения 2 000 000/512 000 000 bytes не повышались.

`stage-verification.json`, SHA **`51e46c7d547eaeaab68d343a3582a7bdbdf66714da654e8792a8760c2d3c0c07`**, содержит **8/8 PASS**:

1. Каждый из 2 742 full prior crawl keys и 3 461 точных raw URL присутствует в соответствующей записи stage; `lost=[]`.
2. В stage ровно выбранные 389 DOM observations; посторонних/отсутствующих наблюдений нет, SHA DOM совпадают с full v8.
3. Все 559 deferred страниц явно присутствуют в stage inventory как `UNOBSERVED`.
4. Все 2 434 assets full v8 сохранены, изменения SHA/размера/MIME и потери отсутствуют.
5. После **повторного реального извлечения stage** mandatory assets missing = **0**.
6. Ровно одна entity на каждый выбранный source URL: 389/389, без лишних или пропущенных.
7. Главная `https://teplypol-market.ru/` и `https://teplypol-market.ru/termoregulyatory/grand-meyer-hw-500` обе наблюдены, включены в scope и имеют entity; не deferred.
8. Состояние остаётся `PARTIAL`, full source denominator `UNKNOWN`, server source access `NOT_VERIFIED`.

## Следующий шаг и блокеры

Root должен независимо принять pins и stage, затем продолжить собственный model/build/native workflow с сохранением полного известного знаменателя. Этот capture ещё не доказывает совместимость каждого builder block, native импорт, фактические HTTP routes, интерактивные формы, изоляцию или DEMO_READY. Получение и верификация 301 обязательного отсутствующего файла, возврат 559 deferred страниц, исследования остальных 1 794 ненаблюдённых URL и доказательство source closure остаются отдельной работой. Нулевой остаток одной discovery queue не подменяет эту полноту.
