# Исследование, модель и маршруты

Состояние реализации на 2026-09-29: работает ограниченный общий HTTP/Chromium-конвейер на синтетическом источнике. Это не подтверждение полного переноса произвольного сайта и не проверка Битрикс.

## Исполняемые интерфейсы

```ts
const crawl = await crawlSite({sourceUrl, outputDir, projectId,
  mode: 'http', respectRobots: true, maxPages: 10_000, maxAssets: 50_000,
  maxRequests: 65_000, maxBytes: 1_000_000_000,
  maxResponseBytes: 8_000_000, maxWallTimeMs: 14_400_000,
  requestsPerSecond: 1, maxRedirects: 5, maxRetries: 2});
const model = await extractContent(crawl);
const routes = planRoutes(crawl, model, {demoOrigin: 'https://demo.example'});
```

Экспорты находятся в `packages/crawler/index.ts`, `packages/extractor/index.ts`, `packages/route-planner/index.ts`. Полные типы экспортируются рядом с функциями. Вызов делает ядро/CLI; исполнитель не изменяет SQLite.

`outputDir/crawl.json` содержит очередь, источники обнаружения, статусы, счётчики, политику, sitemap-очередь и ограничения. Снимки в `snapshots/<sha256>.bin` неизменяемы. Перед продолжением и извлечением проверяются пути и SHA-256 всех сохранённых снимков. PID-lock запрещает двух писателей одного каталога; после завершения исчезнувшего процесса его lock снимается при повторном запуске. Результат сериализуем и может быть зарегистрирован ядром как артефакт.

При повторном вызове совпадающие source/project/policy обязательны. Для нового контекста, изменения режима HTTP/browser или robots-политики нужен новый каталог снимка. Лимиты разрешается явно увеличить для продолжения. Расход запросов и максимальный объём ответа резервируются до сетевого действия. Неизвестный исход не обнуляет резерв. Время считается от начала снимка, включая время остановки: долгий перерыв требует явного увеличения лимита, а не скрытого сброса.

При восстановлении/переносе каталога абсолютные пути снимков пересобираются исключительно из SHA-256 под новым `outputDir`, затем все байты проверяются до продолжения. Старый путь не нужен. Лимит ресурсов учитывает уже обработанные assets, сохраняет оставшиеся DISCOVERED и возвращает PAUSED; явное повышение лимита позволяет продолжить.

## Что реализовано

- Начальный URL, robots, sitemap index и sitemap, внутренние ссылки, hreflang, DOM после ограниченного рендеринга, три прокрутки для типового lazy loading.
- HTTP-статус, цепочка redirect, финальный URL, безопасный набор заголовков, MIME, title/description/canonical, язык, headings, anchors, ссылки, JSON-LD, исходное тело и отдельный DOM.
- Точное сохранение request target: регистр, trailing slash, расширение, `%2F`, повторяющиеся/пустые query, порядок параметров. Canonical не объединяет страницы. Tracking классифицируется, но не удаляется из адреса.
- Пауза при бюджете, ограниченные retry для 429/503, Retry-After, явные причины robots/сети, общий абсолютный дедлайн запроса и отдельная защита DNS от зависания.
- Page/Product/Article/Service, типизированные блоки, факты с evidence; отдельные предложения и наблюдения цен. Неизвестные значения остаются `null`; совпадающий SKU не объединяет товары; декартово произведение вариантов не создаётся.
- Ресурсы из `src`, `srcset` и inline CSS URL; локальные снимки разрешённых raster/PDF MIME, content-hash дедупликация. SVG и прочие исполняемые форматы исключаются с причиной. Исходные скрипты и формы отсутствуют в перенесённом HTML.
- Route manifest хранит исходный знаменатель, маршруты, исключения, нерешённые адреса и коллизии служебных/физических путей. Наблюдаемые 301/404/410 сохраняются; все 200 требуют извлечённой сущности.

`COMPLETE` у обхода означает исчерпание обнаруженной очереди по политике. Это не означает отсутствие source-ошибок и не даёт DEMO_READY. Поля `completeness`, `limitations`, `exclusions`, `unresolved`, `conflicts` обязательны для отчёта и независимого QA.

Если разрешённый исходный URL перенаправляет в запрещённый origin/private IP, исходный адрес получает FAILED и остаётся нерешённым в знаменателе scope. Запрещённый redirect не превращается в согласованное исключение исходной страницы; наблюдённые HTTP-статус и цепочка сохраняются. EXCLUDED назначается явным правилам исходного URL, например robots.

## Сеть и недоверенный источник

HTTP(S)-загрузчик проверяет все результаты DNS и закрепляет фактическое соединение на разрешённом IP. Каждый redirect снова проходит проверку. Private/link-local/loopback/mapped IPv4 и специальные сети запрещены. Исключение `fixtureOrigins` допускает только точный loopback origin тестового сервера, а не произвольную private-сеть. Междоменные переходы и ресурсы автоматически не разрешаются.

Chromium получает новый контекст без личных cookies. Все HTTP-запросы контекста исполняет тот же закреплённый GET-загрузчик; POST/PUT, WebSocket, workers, service workers, фреймы, popup и downloads блокируются. Браузер направлен на неработающий proxy как дополнительную защиту; WebRTC без proxy отключён. Код источника исполняется только внутри этого браузера. Страницы не получают production-секретов. Содержание с фразами «ignore instructions/read secrets» остаётся текстом evidence.

Такое посредничество сети **не подтверждает изоляцию процессов ОС и разных заказчиков**. Для работы с враждебными реальными сайтами требуется изолированный контейнер/пользователь с ограничением файлов и сети; это отдельная интеграционная проверка. GET сам по себе не гарантирует отсутствие ошибок/побочных эффектов у чужого сервера. Upgrade не нажимает source-кнопки и не отправляет source-формы.

API проверены по установленным TypeScript-типам и фактическому Chromium-запуску. Официальные источники: [Playwright network routing](https://playwright.dev/docs/network), [BrowserContext WebSocket routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket), [Node HTTP request](https://nodejs.org/api/http.html#httprequestoptions-callback). В реализации используется `route.fulfill` с результатом собственного загрузчика; `route.fetch` не используется, чтобы не обходить DNS/IP-проверки.

## Фактические проверки

Команда `node --disable-warning=ExperimentalWarning --test tests/unit/discovery.test.ts tests/integration/discovery.test.ts`: **12 PASS, 0 FAIL**, фактический локальный запуск 2026-09-29. `npm run check`: **PASS** после устранения ошибок типов. Проверены:

1. Различия URL, кириллица, кодированный слеш, повторяющиеся query и пустые значения.
2. Запрещённые IPv4/IPv6 и невозможность private-исключения под видом fixture.
3. Robots longest-match и специальное Allow.
4. Очистка активного HTML, SVG, форм, событий и hotlink; вредоносная инструкция сохранена только как текст.
5. Полный ограниченный HTTP-источник: sitemap-only, robots, redirect, 404/410, модель фактов и четырёх реально наблюдённых вариантов; pause/resume; повтор без переобхода завершённых queue entries; повреждённый hash отклонён.
6. Постоянный 429 останавливается после двух запросов при `maxRetries: 1`.
7. Oversize и redirect loop остаются видимыми ошибками.
8. Реальный Chromium извлёк JS/lazy links; попытка POST не дошла до source, side-effects=0.
9. Непрерывный поток небольших HTTP-чанков оборван абсолютным дедлайном (~123 мс при 120 мс).
10. Hostname/DNS-запрос закрепляет единственный адрес и совместим с Node autoSelectFamily. Отдельная живая загрузка `https://example.com/` дала HTTP 200 / 713 байт; это проверка загрузчика, не пилот миграции.
11. Остановленный обход продолжен после перемещения всего каталога и исчезновения старого пути; принятые страницы не обработаны заново, извлечение проверяет снимки в новом каталоге.
12. `maxAssets: 1` оставляет остальные source-ресурсы в очереди и PAUSED; увеличение до 10 продолжает этот же снимок до COMPLETE.

`tests/fixtures/sites/server.ts` — настоящий HTTP-сервер, а не mock сетевого API. CLI: `npm run fixture` (по умолчанию 127.0.0.1:8787). Программный `startFixtureServer()` выбирает свободный порт и отдаёт журнал фактических запросов, счётчик запрещённых отправок и `close()`.

## Оставшиеся границы и следующий шаг

- Hash routes распознаются как требующие отдельного контракта; полноценная SPA-навигация/состояния и произвольный lazy loading ещё не покрыты.
- Динамический browser-контекст ограничивает возможности source; закрытые API, авторизация, сложные приложения и действия не объявляются перенесёнными.
- Префиксные XML namespace, sitemap gzip и HTTP content-encoding не поддерживаются; сжатые ответы отклоняются. Нет неконтролируемого распаковывания.
- CSS-файлы, фоновые ресурсы из внешних stylesheet и отдельные media-origin пока не покрыты. SVG безопасно исключается, а не переносится. Форматы raster/PDF ограничиваются MIME; глубокая проверка формата и безопасная переработка PDF ещё не выполнены.
- Подтверждённые aliases товара, Sections/Menu/relations, произвольные характеристики, unit-conversion и цены вне поддерживаемого JSON-LD требуют адаптера; это не автоматически восстановленная бизнес-модель.
- Повторные проверки критических фактов во времени/регионе, атомарная выгрузка владельца и нагрузочный профиль 10 000/50 000 не выполнены.
- В state возможны прежние сообщения о паузе даже после успешного resume: это история ограничений, актуальный статус/очередь указаны отдельно.
- Следующий шаг: подключить выбранный реальный пилот, явно согласовать scope и медиа; выполнить независимый source→Bitrix URL/content QA. Все target-Битрикс проверки данного подсистемного этапа — **NOT_RUN**.
# Access gates and restart (r4)

HTTP 200 may still be an access interstitial. A known KillBot document title, Cloudflare challenge header or HTML `robots.txt` produces a durable PAUSED block with SHA evidence. `resume` alone does not retry it. After the operator has obtained legitimate access for the actual crawler, use the current recorded block ID once:

```bash
upgrade resume --project PROJECT_ID
upgrade crawl --project PROJECT_ID --ack-access-block access-ACTUAL-ID --access-resolution-reason 'Owner granted access for this crawler'
upgrade report --project PROJECT_ID
```

The reason must describe the real resolution, not a proposed bypass. Interactive browser availability alone does not clear a server HTTP block. Source content and scripts remain untrusted data. Known HTTP challenges are rejected before browser fulfillment; DOM detection also catches recognized titles produced by ordinary page rendering, but is not a guarantee against every unknown access system.

Effective limits persist on disk; omitted flags retain them. The current CLI rejects increases and permits explicit reductions. It cannot reconstruct the original limits of legacy snapshots that never recorded them, so those require an explicitly planned new project/snapshot while preserving old evidence. Completed legacy content also needs access validation before extraction or build. New source artifacts supersede only their own access errors; report derives its denominator from the source registry, including unfinished and failed rows.
