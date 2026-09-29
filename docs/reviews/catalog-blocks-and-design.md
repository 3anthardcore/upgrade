# Карточки каталога, ссылки и фактическое предложение дизайнера

Задача `catalog-blocks-design-review-v1`. Reviewer изменяет только этот документ и `tests/integration/catalog-review.test.ts`; не обращается к источнику, браузеру, Store, серверу и БД. CSS/header/template root меняет отдельно: их внешний вид и применение предложения **не приняты** этим review.

Итог: **ACCEPT локальных link/card и package контрактов после двух исправлений root; 18/18 PASS**. Предложение дизайнера: **ACCEPT как предложение на закреплённом старом частичном входе из одной страницы**. Состояние реального расширенного каталога/Битрикс и дизайн в браузере **NOT_RUN**.

Первоначальные проверенные SHA256:

- Gateway: `6edf42e2cfb9af3169f45dee8909829dc2a1f3f7345a7e0b7cc4fbbb351205b5`.
- PHP Package: `856d07540cefb157a44c0c29c76359fc3f4179032ae581836e01e6086c8a2afe`.
- TS adapter: `bebe251abf102a36eeb0171e35a5e3b78f95b6f2f790b2e844eb5df71ce32be9`.

## Конкретные findings

**P2 — безымянная ссылка изображения карточки.** При исходном `alt=""` отдельный focusable `<a class="card-image">` содержит только `<img alt="">`; название товара находится в другой ссылке. Первый Tab-stop карточки не имеет доступного имени. Воспроизведено реальным PHP renderer → DOM: новый тест `image-only card link retains an accessible name when captured image alt is empty` падает на исходном Gateway. Исправление в области root: дать ссылке aria-label из экранированного фактического текста карточки либо объединить её с именованной ссылкой, без выдумывания описания картинки. Reviewer исходник не менял.

**P2 — асимметрия preflight card.items.** TS build проверяет безопасный request target и наличие изображения, но не требует `items:string[]`; PHP Package уже отказывает `CONTENT_CARD_ITEMS_INVALID` при числах/объектах. Целевая запись защищена PHP-валидацией, однако пакет с некорректными items не должен выглядеть как package без blockers на этапе TS. Рекомендация: симметричный TS blocker. Локальный PHP regression подтверждает отказ до renderer; ниже различается PHP PASS и граница TS preflight.

Оба finding **закрыты root и перепроверены**: Gateway даёт card-image экранированный aria-label из фактического card text; TS builder выставляет `CONTENT_CARD_ITEMS_INVALID`. Regression пустого alt больше не падает; новый malformed-items variant подтверждает TS blocker. Дополнительных блокирующих findings в ограниченной области не обнаружено. Финальные совпавшие SHA: Gateway `f838989c8dcc2c1f7372731d4116ff1b2b6dcb7098a2bb83ed55dd82acffacb4`, TS adapter `5b2b39f543ab2dc7091ecff5be3794b4d0240851d34919cdc3bba044d9dee5ff`; PHP Package остался `856d07540cefb157a44c0c29c76359fc3f4179032ae581836e01e6086c8a2afe`.

## Поведенческие проверки собственных PHP-контрактов

Тесты вызывают настоящий `Package::read` и Reflection `Gateway::fields` в PHP 8.3.35 CLI с mbstring/fileinfo. Bitrix bootstrap/DB/constructor не запускаются. Node/Cheerio разбирает полученный собственный HTML как данные; исходный HTML и scripts не исполняются.

- Корректные card/link проходят PHP Package, сохраняют `/Catalog/a%2Fb.php?x=&x=1&x=2&name=%D0%A2%20%D0%9C` без нормализации порядка/пустых/повторных параметров; HTML escaping обратимо сохраняет href после разбора DOM.
- Заголовок со script-текстом, факты с SVG/onload, кавычки в alt остаются текстом/значением атрибута; script/svg/event-handler/form/button элементов нет. Цены 3350/2178 и наличие сохраняются в обычных абзацах, без del/s/itemprop=price и вывода старой/новой цены.
- Последовательность card/card/link/card формирует две отдельные catalog-grid, две карточки в первой и одну во второй; link находится вне grid; no-image показывает явный текст, не фиктивную фотографию.
- Одиннадцать unsafe targets отклонены и PHP package, и renderer: javascript, внешний origin, protocol-relative URL, fragment, backslash, encoded traversal, encoded reserved /bitrix, /upload, /robots.txt, malformed percent и newline.
- Отсутствующий SHA и PDF в card image отвергнуты обоими PHP-слоями. PDF, переименованный в PNG вместе с пересчитанными manifest hashes, отвергнут по фактическому finfo MIME — тест не сводится к устаревшему checksum.
- Нестроковые card items отвергнуты PHP до rendering. TS builder сохраняет корректные поля и точные links, ставит blockers на unsafe links и отсутствующие card images; runtime_verification остаётся NOT_RUN.

Первый запуск: **17/17 PASS, 0 SKIP**, 2581 ms. Отдельный добавленный regression доступного имени: **1 FAIL**, 444 ms, до исправления root. После исправлений финальный запуск: **18 tests, 18 PASS, 0 FAIL, 0 SKIP**, 2458 ms; `npm run check` повторно PASS. Старый FAIL сохранён как доказательство регрессии, не как текущий результат. Файл тестов FREEZE SHA256 `ed754767cd879451d1337f9d1c1ed83deb5df919e75cb9800b966d9dabaad148`. Команды:

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path 'var/tools/php-8.3.35/php.exe').Path
$env:UPGRADE_PHP_EXT_DIR = (Resolve-Path 'var/tools/php-8.3.35/ext').Path
node --test tests/integration/catalog-review.test.ts
node --test --test-name-pattern='accessible name' tests/integration/catalog-review.test.ts
npm run check
```

Безопасная ссылка не означает существование импортированной страницы. Допустимый same-origin request target может оставаться unresolved; исходный URL registry/полнота не заменяются списком renderable cards. Эти тесты не доказывают browser layout, реальный ввод/покупку, полное покрытие каталога или CMS deployment.

## Независимая приёмка результата фактического designer CLI

Проверены локальные `var/design-run-20260929/design-execution.json`, job directory, оба input artifact и published result, без чтения/изменения SQLite.

- Job `job-66f374a7-fdfb-46bd-b95a-ee161bd3b3bc`, task `designer-real-pilot-v1`, role designer, codex-cli 0.154.0, model gpt-6-astra, recorded process exit 0 / SUCCEEDED. События agent.started → turn_completed → process_finished согласованы; это фактический исполняемый adapter job, не только Markdown role.
- SHA файла `agents/designer.md` совпал с job.roleHash `4c13436f2d7f7ab11daf16d2610b84ba274063a2e5f09b18194c016f2b896751`; prompt bytes — с job.promptHash `7dedecbdf5aba3f79400d66f3646bb4eb0e384e5ec8c5fd5f9a7b018844c70f4`. Job в execution семантически равен отдельному job.json.
- Два input `content` из явно помеченной untrusted секции prompt совпали по SHA со своими сохранёнными артефактами и input_hashes output metadata: модель `6219f647d52110234f4cacd801f15264f565677fc3310cbaf6aa9bfabeced3ff`, brief `4976fa9191a219c732d4869d766b278cb1f91bf2b884ecacdd0f2120879140c8`.
- Output `art-a632a85f-5a52-4f4e-b85d-4d0794fa4a59`, 15244 bytes, SHA `115baf4f3380052832a51fedafa8394a2ca545152fd426c8159e74ea5692234f`. Published JSON, raw job result и execution.result семантически совпали. Ajv повторно проверил результат по фактическому job result.schema.json: VALID.
- Политика job — read-only/no tools; recorded args отключают web search, shell, apps, plugins, browser, image generation, multi-agent и прочие инструменты. Review подтверждает сохранённые параметры/результат исполнения, не независимую аттестацию ОС.

Требуемые состояния **7/7** присутствуют с конкретной обработкой: 360px, long-title, no-image, unknown-price, keyboard-focus, readonly-demo, 404. Дополнительно empty-data, document-unavailable, reduced-motion. `preserve_facts=true`, `real_submissions=false`. Четыре композиции home/catalog/product/information заданы как правила, не как утверждение полного восстановления.

Независимый расчёт по линейной sRGB яркости: канал `c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`, `L=0.2126R+0.7152G+0.0722B`, ratio `(Lmax+0.05)/(Lmin+0.05)`. Сравнение делалось без округления; в таблице значения показаны до 4 знаков. Порог обычного текста 4.5:1 взят из [W3C WCAG 2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

| Цвет | На paper #FAF6EF | На surface #EEE7DD |
| --- | --- | --- |
| ink #29231F | 14.3919 | 12.6321 |
| muted #665B51 | 6.1296 | 5.3801 |
| accent #9C3E1C | 6.2491 | 5.4850 |
| border #897B6C | 3.8122 | 3.3461 |

Все шесть предусмотренных пар текста >=4.5. Border предназначен для границ, не обычного текста; его нельзя подставлять как мелкий текстовый цвет. Контраст focus accent на светлых фонах достаточен численно, но видимость/геометрию фокуса в браузере этот расчёт не подтверждает.

Модель действительно содержит **одну** Page, state PARTIAL, full_source_denominator UNKNOWN. Числа `3350 р.`, `2178 р.`, `-35%` и `В наличии` присутствуют во входных наблюдениях; facts.price и facts.availability остаются UNKNOWN. Proposal сохраняет их как атрибутированные строки снимка, запрещает покупку/оплату/реальные заявки, домысливание SKU/отзывов/сертификатов и превращение произвольных изображений в товары. Название сайта передано отдельным brief с описанием DOM evidence; logo должен материализоваться и сверяться по SHA, одного пути в предложении недостаточно. Новые captures и текущая расширенная модель **не входят** в этот designer input.

Предложение принято для реализации, но не подменяет последующий review фактических новых данных, URL completeness, адаптивности/клавиатуры и изолированного Bitrix. Оно также не даёт права заново показывать технические raw field keys вместо уже согласованных публичных подписей: значения/raw provenance сохраняются независимо от представления.
