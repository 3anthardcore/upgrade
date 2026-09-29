# Каталог: независимая проверка r10 и целевой попытки

29.09.2026. Задача `catalog-target-review-v1`, worker `catalog-final-review`, fence 1. Область записи reviewer: этот документ и `var/evidence/catalog-target-review`. Reviewer не обращался к источнику, браузеру, серверу, Store или целевой БД.

**Итог: REJECT текущей целевой интеграции.** Локальные capture/package/navigation проверки PASS в ограниченной области. R10 остановился до target apply (model exit 3 `Dispatcher ownership lost`). R11 завершил model/build, но native apply завершился exit 1 `POST_WRITE_RECONCILE_FAILED`: Битрикс обрезал UG_FACTS. Последующая строгая сверка — FAIL, 308 дефектов. Raw server receipts независимо прочитаны и проверены ниже. Новый codec прошёл локальный roundtrip всех 103 factual payloads; его целевой retest в эту приёмку **не входит и остаётся NOT_RUN**. Общий проект NOT_READY.

## Независимо выполненные локальные проверки

Команда: `node var/evidence/catalog-target-review/review-local.mjs`, exit 0. Скрипт применял валидатор, extractor и builder **из проверенного архива r10**, материализованного только в разрешённом review-каталоге. Текущее меняющееся рабочее дерево для их исполнения не использовалось. Собственный PHP header исполнен локальным PHP 8.3; настоящий Битрикс этим запуском не проверялся.

| Check | Результат и граница |
|---|---|
| Архив приложения | PASS: `upgrade-foundation-20260929-r10.tar.gz` SHA `c8ab97fe05ed1b844e05e42174f835212410b2e8315b3c31f74abe9e7bbff044`; все 193 исходных файла, размеры, SHA, точный перечень, tar header checksums и отсутствие symlink/unsafe paths проверены до записи. Сумма 1 817 324 байта; source fingerprint `694d0aa80370f7e3b54cada327faf4c233135950bef4e6d1d4116fd248f5d50f`. Вложенный manifest совпадает с внешним. |
| Capture v4 | PASS: manifest SHA `de844784471ab432f184f23d659a60db079c58ac379fd2baeb4f6a20ffe430ff`; validator проверил 103 DOM observations + 837 media references, 940 проверенных файловых references, суммарно 49 177 722 байта. Assets могут разделять одинаковые байты: это не утверждение о 837 уникальных физических файлах. |
| Ограничение выбранных страниц | PASS: множество 103 URL в точности совпадает с исходным scope manifest SHA `a114591f0bfd0706c335284332741036f14095fc403ec837eeadfeb93f5e438d`. Для каждой страницы найдены совпадающие raw HTML SHA и observed_at. Pack report перечисляет 142 raw-файла, содержащих 131 уникальный page URL; разность с выбранным множеством — ровно 28 отложенных страниц, совпадающих с deferred list. |
| Исходный denominator | PASS: 943 URL в validated inventory; выбранные 103 не подменяют его. 840 URL вне текущего выбранного DOM-набора. Все 131 raw-страница не объявляются перенесёнными; полнота всего источника UNKNOWN. |
| Материалы страниц | PASS ограниченно: все `entity.assets` 103 извлечённых entities имеют проверенные capture bytes, missing = 0. В общем observed inventory остаются 79 asset URLs без подтверждённых bytes; они сохранены в limitations, не объявлены перенесёнными. Отсутствующее изображение с пустым src не превращено в URL главной. |
| Локальная упаковка | PASS: создан отдельный offline пакет 103 entities / 103 routes, `blockers=[]`, `warnings=[]`; manifest pin `4c02b337046eea35f59455c2181efe55e48776fda9dfd6db6257e79b15b4db54` проверен через `validateBitrixPackage`. Это самостоятельный review-пакет с построенными по выбранным source URLs маршрутами, без authoritative Store binding и не предполагаемый production/target release. Runtime в manifest остаётся NOT_RUN. |
| Реальная навигация источника | PASS: builder включил 20 наблюдавшихся ссылок главной; каждая присутствует среди mapped status-200 маршрутов. В него не добавлялись придуманные разделы. Источниковые подписи и числа внутри них — наблюдения snapshot, не гарантия актуального ассортимента. |
| Негативный nav/brand contract | PASS: отдельный пакет с `<img onerror>`, кавычками, ampersand и `<?php ... ?>` в подписи и бренде. Parsed HTML и **реальный PHP subprocess exit 0** подтверждают сохранённый текст без активного img/script/PHP. Точный `/Catalog/a%2Fb.php?x=&x=2&z=%22` сохранён; иной порядок query, unmapped path, redirect-only route, protocol-relative URL и javascript URL не включены; дубликат удалён. |

Ветвь template fallback также прочитана: `href` и title из `UPGRADE_NAVIGATION` проходят `htmlspecialchars(ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8')`; SQL router отдаёт только project routes status 200 с активным элементом. Локальное выполнение выше проверяло сгенерированное source-navigation меню. Авторизованный браузер, открытие/закрытие меню, touch/keyboard и итоговая адаптивная страница нового каталога на целевом сайте пока **NOT_RUN**.

Дополнительная независимая команда `node var/evidence/catalog-target-review/review-php-package.mjs` выполнила архивный собственный `Upgrade\Importer\Package::read` настоящим PHP 8.3.35 с `fileinfo` и `mbstring`, без загрузки CMS. Exit 0, status VALID: 103 entities, 103 routes, 837 asset references; MIME-проверка прошла для 13 PDF, 35 PNG и 789 JPEG. Точный accepted package pin сохранён; read-only PHP-контракт проверяет перечисление файлов, hashes и типы содержимого, не только TS signatures. Это подтверждает допустимость фактических media bytes для импортера, но не импорт/рендеринг в Битрикс. Receipt `var/evidence/catalog-target-review/php-package-review.json` сохраняет stdout, stderr, exit и SHA PHP-валидатора.

## Журналы общего тестирования

Reviewer прочитал и закрепил журналы автора, не повторял весь suite при отсутствии нового finding:

- `check-release.txt`: `tsc --noEmit`, без вывода ошибок; SHA `52047e4e2fd4dc882cff78211cb1676d757caf9d13a5d278d05f40582bf43314`.
- `tests-release.txt`: **249 PASS, 0 FAIL/CANCEL/SKIP**, 16 005.0039 ms; SHA `fe15795452181a3300d1a309eba0a4c196ddef7d199102cb76f0bdf68d81afcb`.
- `e2e-release.txt`: **23 PASS, 0 FAIL/CANCEL/SKIP**, 39 995.6169 ms; SHA `e66b68b233180cad81eb09316f00bb80cc2af751b6e5335ff2ce83d5b33de3f5`.

Это не доказательство отсутствия server CPU/lease ошибки: серверная попытка воспроизвела её после локального suite.

## Сохранённые независимые результаты

- `var/evidence/catalog-target-review/local-review.json`: SHA `be042565f68232a721d05ce7b1d48ed500032ad795f80d7c510321ab893a8505`.
- `var/evidence/catalog-target-review/source-witnesses.json`: SHA `1ce71d2690d196c007e194422bbeddab2bc588233025fcdedc3cd19daef42d42`.
- `var/evidence/catalog-target-review/review-local.mjs`: SHA `230a2b41ff6cbd26accfb106b8a24e262fe9992bdbf68c4a22d4204f4c81b64d`.

## R11: независимая проверка исправления до server evidence

Локальный архив `upgrade-foundation-20260929-r11.tar.gz` SHA `2b425324b68828e980193a9ce1d4bb0a728bc9b005a7ed2a4e1998a031ce5719` проверен отдельной командой `node var/evidence/catalog-target-review/review-r11.mjs`, exit 0. Все 196 файлов, SHA/размеры, точный состав, aggregate pin и вложенный manifest проверены тем же способом; файлы материализованы только внутри review evidence.

Между r10 и r11 runtime изменился только `packages/extractor/operator.ts`. Независимое точное сравнение подтверждает: добавлены standard-library import `setImmediate`, поясняющий комментарий и два `await` перед обработкой asset/observation. Других изменений семантики extractor нет; runtime-файлы Pipeline/Store, срок lease, fencing и budget идентичны r10. Различия остальных трёх файлов — новый test и два документа, включая промежуточный snapshot этого review.

Из архивной копии r11 независимо запущен `tests/integration/operator-heartbeat.test.ts`: **1/1 PASS, 0 SKIP**, 594.7854 ms; сам test 194.837 ms. Temp paths ограничены review-каталогом через окружение subprocess. Тест доказывает timer turns между synchronous resolver units и deep-equal модель относительно асинхронного resolver. Он не доказывает hard preemption внутри одного DOM и не заменяет server retest.

Первый запуск reviewer-скрипта остановился на проверке точного source diff: исключались import/yields, но не новый поясняющий комментарий. Это ошибка overly-strict вспомогательной проверки; комментарий прочитан и явно учтён, после чего полный запуск прошёл. Продуктовый исходник и архив не менялись.

- `r11/archive-review.json`: SHA `64383e50ba7bf5219f40e087443128c6ea7d3db0867b30ad4dc660c92c3b274d`.
- `r11/heartbeat-independent.txt`: SHA `34368384bb17f50f68a8f055533571b153709d4aed00c334510e98bb3287eefc`.

Локальная приёмка scheduling fix — PASS в описанных пределах. Первая r10 интеграционная попытка остаётся REJECT; r11 actual target пока NOT_RUN reviewer.

## Результат следующей native-попытки: остановка на UG_FACTS

Сохранённые receipts подтверждают COMMITTED server model и build r11, после чего native import обнаружил **обрезание UG_FACTS строковым свойством Битрикс**: исходный JSON 355 848 символов / 371 049 UTF-8 байт, readback 59 713 символов / ровно 65 535 байт. Диагностический Add обозначен `TRANSACTIONAL_DIAGNOSTIC_ROLLED_BACK`; post-error reconcile подтверждает 102 отсутствующих entity и прежний один требующий update, 102 отсутствующих/неверных route и 103 непроверенных mapping. Это независимое чтение server evidence, не прямое обращение reviewer к БД.

**Native-попытка — FAIL / приёмка интеграции REJECT.** Постзаписная сверка не позволила принять потерянные факты. Успешные model/build и локальный Package::read не отменяют фактический target defect. Копирование immutable media происходит раньше entity transactions, а собственный шаблон может быть уже развёрнут: отсутствие новых DB elements не доказывает отсутствие filesystem effects. Число selected 103 нельзя выдавать за accepted target count во время этого отказа.

Reviewer передал условия узкого исправления: однозначно маркированный versioned lossless codec больших facts, strict base64/gzip/JSON/hash/byte-length, конечный decompression cap, detect incompressible overflow на dry-run до записи, raw canonical facts в managed hashing/readback, legacy small-value совместимость, обе write-ветви Add/SetPropertyValuesEx и явная граница native admin editing. Неизменяемый пакет хранит исходный JSON; исправление должно попасть в новый sealed release, без редактирования прежнего. До тестов codec и фактического повтора этот план не считается реализованным или принятым.

## Review нового HTTP verifier

Прочитан root-owned `scripts/verify-pilot-http.py`. Найден и передан до запуска schema blocker: `data/entities.json` содержит `stable_key`, а исходный код пытался обращаться к `entity_key`. Исправленная версия строит map по stable_key, соединяет его с route.entity_key и заранее требует status-200 routes. `data-upgrade-entity` действительно существует в собственном component template; предположение о его отсутствии после проверки снято.

По замечанию reviewer добавлена проверка нормализованного фактического текста внутри `.prose`: paragraphs/headings/quotes/links/cards/documents, list/card items и table cells. HTMLParser декодирует entities один раз; alt изображения не ошибочно требуется как видимый текст. Headers приведены к lowercase; сетевые ошибки isolation записываются как FAIL, а не теряют весь промежуточный результат. Верификатор сохраняет NOT_READY/full UNKNOWN, явно помечает privacy-header matrix NOT_RUN.

Ограниченная статическая приёмка исправленного verifier — PASS. Factual-text check подтверждает наличие значений, а не их порядок/кратность; проверка media SHA подтверждает HTTP bytes, а не каждый rendered img/src/интерактивный сценарий. HTTP schema/logic review не заменяет фактическое исполнение. Скрипт изменял root, reviewer не правил его и не выполнял запросы.

## Независимая проверка переданных server receipts

Команда `node --disable-warning=ExperimentalWarning var/evidence/catalog-target-review/review-server-receipts.mjs` — exit 0. Архив `var/evidence/server-r10/catalog-r11-failure-evidence.tar.gz`: **43 297 байт**, SHA `681d28e573c30a1b500bdda278eb991fdec498f4367ee911b96ff33433750639`; 10 regular-file receipts (11 файлов вместе с архивом). Все десять member bytes совпали с распакованными файлами, индивидуальные SHA сохранены. PAX headers содержат только mtime, учтены отдельно; первый запуск вспомогательного reader остановился на этом мета-типе, после явной поддержки mtime-only headers проверка завершилась. Source/receipt bytes не менялись. SHA архива вычислен reviewer после передачи; отдельный authoritative транспортный pin не был предоставлен.

- R10 failure receipt: model PENDING, exit 3, target NOT_DISPATCHED.
- Model `d070603f105414eb787b64d78fb85dc25da6b5000df024b022334de02462e031` и build `5970883e305c7685e6c42b0e0d0e8e63935c99215a9a8f32e66f290383426fbd` — COMMITTED. Независимо пересчитаны оба v2 intent ID и code fingerprints **по архиву r11**. Capture pin, ALL_OBSERVED selection 103 URL, source artifact pin и source access block совпадают между receipts; блок `access-eff7ee21-1e84-499e-9245-eec1142033c6` сохранён.
- Build inputs совпадают с model output IDs; import intent связывает тот же build/result artifact и package manifest SHA `94d88f642c41c2dca6e9707cb5354342bbc1f13a125df27ef15a4fb64d2b6767`. Полные output artifact bodies / target package bytes в этом bundle отсутствуют: metadata binding проверен, отдельная повторная валидация этих серверных payload bytes не заявляется.
- Dry-run: created 102 / updated 1 / conflicts 0 / blockers 0. Он **не обнаружил** невозможность хранения длинного свойства; это фактический пробел preflight.
- Import log: `IMPORT_FAILED:1` и `POST_WRITE_RECONCILE_FAILED`, не успешный apply.
- Diagnostic: три остальные property value совпадают побайтно; UG_FACTS actual — точный усечённый префикс expected, уже невалидный JSON. Expected facts семантически равны независимо извлечённой local model этой же страницы. Expected raw SHA `b0d772f2a184e438559e49c5ebf47c99bbaa0c064cca0c153a391f27abd5814e`, actual SHA `2a8c13f34f5d3bb13027a5770dd0f273f0840231eea77d4036b02a36fd12bfcb`.
- Strict reconcile FAIL: created 102, updated 1, ROUTE_MISMATCH 102, ROUTE_ENTITY_MAPPING_UNVERIFIED 103 = **308 дефектов**. `unreferenced_files=[]` вычислено относительно **нового** пакета и не доказывает отсутствия ранее скопированных media.

Receipt независимой проверки `server-receipts-review.json`: SHA `c46f5174909553872ca804394e987a887a713c2128abb1ede2aa57c2b6b08774`. Содержит Check-массив с сохранёнными FAIL/NOT_RUN и индивидуальные SHA всех входов. В intent присутствуют backup receipt paths/pins, но сами backup receipts/dumps сюда не включены; backup integrity / SQL restore reviewer заново не принимал.

## Новый codec: только локальная приёмка перед будущим retest

Прочитаны новый собственный `FactsProperty` и обе write/read integration ветви. Prefix `UPGRADE_FACTS:` однозначно отличается от raw JSON; envelope имеет точный version/encoding/shape, canonical base64, raw size/hash, finite decode limit 16 MiB. Stored representation ограничена 60 000 байт; legacy raw JSON читается до 65 535 байт. Unknown/malformed/truncated/incompressible data отклоняются. `fields()` проверяет encode во время dry-run, возвращая прежний raw JSON для managed hashing; Add и Update/SetPropertyValuesEx записывают encoded value; `Gateway::current()` и `Router::content()` декодируют перед использованием. Файлы подключают codec явно через `require_once`. Это source review, не новая серверная операция.

Независимый реальный PHP 8.3 запуск `review-codec.php` на **всех 103 entities из проверенного offline пакета**: 103/103 точных raw-byte и SHA roundtrip, 28 compressed, max raw **371 049 байт**, max stored **41 412 байт**, все stored <=60 000. Receipt `codec-review.json` SHA `e3a230d4687a32635c043539b9e9ad63b5c1ced194db2e4e62314c4bc4fe808b` содержит строки всех103 и raw/decoded SHA. Это не синтетическая подмена фактов и не исправление исходных bytes. У codec есть явная UX-граница: длинное S-property содержит storage envelope, его нельзя считать обычным редактируемым factual JSON; исходный canonical JSON остаётся в immutable пакете.

Проверенные implementation pins: factsproperty `e46150bc1f3a3ddc0eae4ca018ad67ebb288ea7eeed6b44706c5347fdedf7bd5`; Gateway `e909692206bc5543482d5afb98a4b0f7f83a63305873b499b73abe8ecd6edf73`; Router `5e6e941345df7100c99f07b19b8758dc613c2684d210e4115ca29d4932c8083e`. Полный негативный codec/gateway suite выполняет автор отдельно; здесь не повторялся. Новый HTTP verifier source SHA `364a42341297572d51523d3f1797c4343503331b7172a40247e8825e14f7b411` проверен статически, live HTTP нового пакета NOT_RUN.

## Следующий этап и неизменные ограничения

Старый r10 model intent PENDING и неуспешный r11 import сохраняются. Следующий шаг — отдельный sealed release с codec, полные негативные tests, новый проверенный dry-run и native apply/reconcile/repeat, затем factual HTTP, media и browser QA. Старые failure receipts и бюджеты не сбрасываются. Эта задача завершается **REJECT actual attempt + ограниченные local PASS**, а не ожиданием или объявлением исправленного target успешным.

Текущие native apply/reconcile — **FAIL**; успешный повтор, HTTP/browser и исправленный native retest — **NOT_RUN**. Нулевой missing count в entity assets не означает полного переноса 943 URL. Полнота, commerce/search/actions, активация лицензии, SQL restore и браузерное административное редактирование этим review не принимаются. Общий проект **NOT_READY**, capture/model **PARTIAL**, full source **UNKNOWN**.
