# Offline review медиа каталога — 29.09.2026

Задача `catalog-media-review-v1`. Исходный каталог `var/pilots/teplypol-catalog-package-20260929`, accepted `operator-capture.json` SHA256 **`a114591f0bfd0706c335284332741036f14095fc403ec837eeadfeb93f5e438d`**. Выполнены только чтение, `validateOperatorCapture`, `extractOperatorContent` и анализ сохранённых DOM. Ни источник, ни браузер, ни сервер/БД/Store reviewer не вызывал. Исходные файлы и требования не изменены.

**Validation/extraction PASS, медиаполнота не достигнута.** 103 наблюдения дали 103 сущности; известный реестр содержит 941 URL. Проверены 782 asset URL и 885 файлов (103 observation + 782 media). Модель остаётся **PARTIAL**, source access NOT_VERIFIED, полный исходный знаменатель **UNKNOWN**. Это производная модель для анализа; она не ingested в core, не очищает исходный access block и не объявляет готовность.

| Результат | Количество |
| --- | --- |
| URL без verified bytes | 112 |
| Из них присутствуют в entity.assets | 35 |
| Реальные недостающие файлы текущих сущностей | **34: 12 PDF + 22 изображения** |
| Ошибочная media identity из пустого src | 1 |
| Только глобальный реестр, отсутствуют в entity.assets | **77**, все gallery href на *-500x500 |
| Missing URL без найденного свидетельства в DOM | 0 |

Проверенный снимок не доказывает, что отсутствующие локальные bytes недоступны на исходном сервере: сетевых запросов здесь не было. Следующий шаг root — получать только наблюдённые media URL через разрешённый IAB, сохранять новые bytes и новый manifest pin, затем повторять валидацию и извлечение.

## Результаты и воспроизводимость

В `var/evidence/catalog-media-review/` сохранены:

- `review.mjs` — воспроизводимая offline команда; читает исходные bytes и проверяет SHA реализации до/после выполнения. Новый запуск требует новых выходных файлов/директории: существующие результаты открываются с `wx`, не перезаписываются.
- `validated-capture.json` — SHA `b8ad8b15f6fb18fa0570b9049d1601551e6659286b3baa281b1fbb9cc75813fa`, 2560033 bytes.
- `derived-model.json` — SHA **`3dcb1d8dc7b2bbf6ca8f7b87ac595f415a3799b4ee636bc64736811d429d3d0d`**, 16787839 bytes. Сохраняет исходное извлечение, включая найденную аномалию; ничего не удалено для получения зелёного результата.
- `missing-assets.json` — SHA **`4dfdee37fb62c5328b05fcc2243c16ce4d2a0aaf5c5e127352909349d049ec6b`**, 741392 bytes. Полные `mandatory`/`global_only`: source_url, kind, page_urls сущностей, observed_page_urls, entity IDs, DOM selector/attribute/raw value, текст ссылки, snapshot SHA, observation path и время.
- `media-actions.json` — SHA **`c8c5a92d6b9432d846b66582f84a7984c2a2af44d2bee8cf5039e06abcb025fa`**. Практическая очередь 34 файлов с page/selector evidence, отдельная аномалия `should_download=false`, отдельный список 77 галерейных ссылок. Это уточнение анализа, не правка initial missing set или derived model.
- `summary.json` — компактная сводка исходного результата и полные списки URL.

Команда: `node var/evidence/catalog-media-review/review.mjs` — **exit 0**. Затем отдельный Node read-only пересчёт подтвердил 34 downloadable entries, единственный пустой src, 77/77 gallery suffix и 77/77 `a[href]` witnesses; дополнительная запись — `media-actions.json`. Полный test suite не повторялся, потому что исходники не менялись. File reads разрешаются внутри исходного каталога, extractor повторно сверяет длину/SHA каждого файла; source manifest и SHA реализации совпали после выполнения. К исходному runtime это не относится.

## Обязательные PDF: точные наблюдённые пути

Общий origin — `https://teplypol-market.ru`. Все URL скопированы из сохранённых DOM; регистр, запятые и percent-encoding сохранены. Полные URL/селекторы лежат в `media-actions.json`.

| PDF под /download/ | Страница-свидетель под /aksessuary/ |
| --- | --- |
| AS-10_AS-10M_instrukciya.pdf | datchik-temperaturi-as-10m |
| datchik-osadkov-tsp02_instrukciya.pdf | datchik-osadkov-tsp02; datchik-osadkov-tsp02-10m; datchik-osadkov-tsp02-5m |
| etf-744-99a_instrukciya.pdf | narujniy-datchik-temperaturi-vozduha-etf-744-99a |
| etog-55_instrukciya.pdf | datchik-temperaturi-i-vlajnosti-dlya-grunta-etog-55 |
| etor-55_instrukciya.pdf | datchik-vlajnosti-dlya-jelobov-i-vodostokov-etor-55 |
| kovrik-caleo-40%D1%8560_instrukciya.pdf | kovriki-s-podogrevom/caleo-40%D1%8560-korichneviy; kovriki-s-podogrevom/caleo-40%D1%8560-seriy |
| PS-2__instrukciya.pdf | datchik-osadkov-ps-2 |
| PS-5__instrukciya.pdf | datchik-osadkov-ps-5 |
| terneo-osa_instrukciya.pdf | analogoviy-datchik-osadkov-terneo-osa |
| tsp01-10,0_instrukciya.pdf | datchik-tsp01-10 |
| tst01-2-0-p_instrukciya.pdf | tst01-2-0-p |
| tsw01_instrukciya.pdf | datchik-vodi-tsw01-10m; datchik-vodi-tsw01-5m; tsw01 |

## Обязательные изображения: группы для браузерного получения

| Страница-свидетель | Missing URLs |
| --- | --- |
| /termoregulyatory?page=4 | 15 thumbnails 200x200 |
| /aksessuary/termoizolyaciya-lavsanovaya-podlojka-eastec-3-mm | 1 изображение 326x326 |
| /aksessuary/datchik-temperaturi-tsm-11 | 1 изображение 326x326 |
| /aksessuary/montaj-nabor-lamipol-c160 | 1 изображение 326x326 |
| /aksessuary/narujnaya-montajnaya-korobka | 1 изображение 326x326 |
| /novosti | 2 изображения 120x120: bf и s-novim-2025-godom |
| /kontakty | /image/catalog/ogrnip.jpg |

Это группировка уже наблюдённых файлов, не разрешение угадывать URL и не утверждение содержимого отсутствующих изображений. Названия 200x200/326x326/120x120 здесь обозначают суффикс наблюдаемого URL; фактические dimensions неизвестных bytes не проверены.

## Ошибка извлечения: пустой src превратился в главную

На `/aksessuary/adapter-welrok-bk`, observation `observations/2dbdc50c62391b8ce108db452d555ca6c0549572e8f42eacf47738d79fe3c8dd.html`, SHA `57d9feace5b4234e0b819027667dd3d990541e0d795f7fb59a72773c5f90605a`, сохранены `<base href="https://teplypol-market.ru/">` и `<a class="thumbnail" href=""><img src="" ...></a>`. В текущем extractor `mediaFor('')` разрешает пустую строку относительно base и записывает `https://teplypol-market.ru/` в entity.assets. Это точный текущий blocker модели, но **не файл для скачивания**.

Полный structural selector и исходные пустые значения находятся в `media-actions.json.extractor_anomalies`. Root уведомлён: исправить собственную обработку empty media reference с regression, сохранить missing-image limitation и исходный DOM, затем заново извлечь модель под новым pin/результатом. Нельзя получать HTML главной как картинку, молча вырезать требование в существующем derived JSON или объявлять пустой src подтверждённым изображением.

## 77 global-only gallery links

У всех 77 URL есть точное свидетельство `a[href]` в сохранённом DOM, все оканчиваются на `-500x500` с расширением изображения. Они находятся в source inventory/unverified media, но **не входят в entity.assets** текущего извлечения. Страницы и селекторы сохранены в `missing-assets.json.global_only[].observed_page_urls/evidence`.

Текущий core operator build собирает media input из verified `capture.assets`, а entity assets проверяются отдельно builder; поэтому эти 77 сами по себе не дают `ENTITY_ASSET_MISSING` для данного набора сущностей. Это вывод из прочитанного кода, **build здесь не запускался**. Ссылки и их отсутствие остаются частью evidence/limitations; полноту галерей считать доказанной нельзя. Они не должны исчезнуть из source scope и не получают PASS за наличие маленького preview. В случае реализации открытия полного изображения эти файлы станут функционально обязательными и потребуют фактического получения/проверки.

Итоговая граница: offline целостность/извлечение приняты; 34 реальных файла требуют получения, 1 ошибка extractor требует исправления, 77 галерейных URL остаются явно не полученными. **PARTIAL / UNKNOWN; готовый каталог или DEMO_READY не заявляются.**
