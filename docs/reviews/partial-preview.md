# Закрытое частичное демо: профиль Nginx

Задача `prepare-partial-preview-v1`, worker `preview-engineer`, fence 1. Входы назначены root: `art-716e924f-ee3c-48d5-8d03-899b4cf18ad3`, результат пакета `art-96a56788-47a5-4dbd-94dd-4869c67ecf30`. Исполнитель этого профиля не подключался к серверу, Store или БД и не запускал лицензированный PHP.

Профиль: `infra/nginx/partial-demo.conf`. Его выбирают **вместо** `install.conf`, а не добавляют вторым server block. Назначение — отдельный закрытый просмотр одной импортированной страницы проекта `teplypol-market`; полный сайт, завершённая настройка администратора и DEMO_READY этим не заявляются. Исходный access block и неизвестная полнота сохраняются в Upgrade независимо от результата HTTP целевого preview.

## Политика

- Контейнер слушает внутренний `8080`, document root `/var/www/html`, FastCGI `php:9000`. Внешний listener, TLS и private ingress уже принадлежат хосту; конфигурация их не создаёт. Docker-сеть остаётся internal. Basic Auth `/etc/nginx/demo.htpasswd` обязателен для всего выдаваемого контента.
- Единственный FastCGI handler находится в `location /` и всегда выполняет `/var/www/html/local/upgrade-route.php`. `try_files` проверяет только существование этого собственного файла. Исходные `.php`-адреса тоже являются данными router, а не выбором физического PHP. Нет rewrite, arbitrary PHP handler, index lookup, PATH_INFO, alias или выдачи файлов через общий `try_files $uri`.
- Router получает исходные `$request_uri`, `$query_string`, `$http_host`. Он ищет маршрут по SHA исходного request target и проверяет точное равенство. Неизвестный путь остаётся настоящим 404; исходный `/index.php` не открывает установщик. `fastcgi_intercept_errors off` сохраняет собственную страницу 404 router. Отказы Nginx и отсутствующая разрешённая статика получают отдельный постоянный ответ 404 без чтения секретных файлов.
- Статически доступен ровно `/local/templates/upgrade/styles.css` и `/upload/upgrade/teplypol-market/<64 lowercase hex>.(png|jpg|gif|webp|avif|pdf)`. Это namespace принятого проекта, не разрешение всех проектов на диске. SVG, HTML, JSON, JS, карты исходников, произвольные имена, подкаталоги, файлы других проектов и дополнительные суффиксы закрыты. Имена по SHA не заменяют проверку содержимого принятым package/import manifest; профиль сам хеши файлов не вычисляет.
- `/bitrix`, прочие `/local` и `/upload`, установщики, прямой own router/resume, скрытые файлы, `license_key*`, `.settings*`, `php_interface`, backups, конфиги, дампы и архивы закрыты. Защита от symlink дополняет проверенный ограниченный document root. Профиль не удаляет и не изменяет vendor-файлы.
- `limit_except GET { deny all; }` установлен во всех трёх выдающих контент locations; HEAD разрешён вместе с GET. POST/PUT/PATCH/DELETE/OPTIONS/TRACE не достигают PHP/статики. FastCGI тело запроса отключено. Request headers передаются только по явному списку: Host, Accept, Accept-Language, User-Agent и нормализованный forwarded scheme. Basic Authorization, cookies, proxy headers и REMOTE_USER в CMS не передаются: preview не наследует административную сессию браузера.
- `X-Robots-Tag`, `Cache-Control: no-store`, `nosniff`, `Referrer-Policy: no-referrer` и CSP действуют также на ошибки. CSP запрещает скрипты, формы, connect, frames и objects; собственный шаблон использует HTML/CSS. Его дополнительная PHP CSP не ослабляет Nginx CSP. Нет request access/error log. На host proxy и FPM должна сохраняться уже проверенная политика отсутствия request logs; конфигурация Nginx контейнера не управляет их настройками.

TLS-признак принимается только при **одновременном** совпадении TCP peer `172.30.50.1` и заголовка `https`. Host proxy обязан перезаписывать `X-Forwarded-Proto`, не дополнять его пользовательским значением. `$remote_addr` не подменяется real-IP модулем. При совпадении `HTTPS=on`, `REQUEST_SCHEME=https`, `SERVER_PORT=443`; иначе HTTPS отсутствует, схема http, порт внутренний 8080. Тот же нормализованный scheme передаётся как `HTTP_X_FORWARDED_PROTO`. Ранее подтверждённый root peer применим только к этой сети; изменение ingress требует нового probe.

Семантика сверена с первичными документами: [приоритет locations, internal URI, limit_except и переменные Nginx](https://nginx.org/en/docs/http/ngx_http_core_module.html), [FastCGI request headers/body и intercept_errors](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html), [access deny](https://nginx.org/en/docs/http/ngx_http_access_module.html). Regex проверяются по нормализованному URI; исходный request target для маршрутизации берётся отдельно из `$request_uri`.

## Локальная проверка

`node --disable-warning=ExperimentalWarning --test tests/integration/partial-preview.test.ts` — **5/5 PASS**. Тест читает именно поставляемый конфиг, разбирает директивы и проверяет границы политики: единственный фиксированный PHP, raw URI/query/Host, уникальные FastCGI параметры, запрет forwarding auth/cookies, приоритет точной/regex статики, media namespace и misleading suffixes, кодированные private paths, методы, Basic inheritance, TLS pair и privacy headers. Это статическая проверка ограниченного набора директив; она не подменяет парсер Nginx и не доказывает HTTP-поведение.

`npm run check` — **PASS**. На Windows/WSL локальный Nginx не найден; `nginx -t`, реальные HTTP/TLS/FPM, рендер браузера и проверка настоящего CMS router в этой задаче — **NOT_RUN**. PHP isolation, импорт и поведение целевой БД оценивает отдельный исполнитель root.

## Приёмка действующего runtime

Root выполняет следующие действия с очищенными результатами, без дампов лицензии, заголовка Authorization, cookie, тела административных запросов или request tracing. Имена контейнеров, URL, путь маршрута, CSS и media SHA берутся из проверенного текущего окружения и принятого package manifest; примеры ниже используют переменные, а не выдуманные адреса.

1. Перед переключением сохранить выбранный профиль/его SHA и снимок целевого состояния по существующему runbook. Подключить только новый профиль, оставить private ingress/Basic Auth, PHP prepend, mail/process restrictions, internal network, отключённые агенты/cron и проектную привязку. До выдачи доступа проверить конфигурацию и затем перечитать её:

   ```sh
   docker exec "$UPGRADE_NGINX_CONTAINER" nginx -t
   docker exec "$UPGRADE_NGINX_CONTAINER" nginx -s reload
   ```

   При file bind mount замена inode на хосте может не изменить уже смонтированный файл: исполнитель проверяет SHA именно файла внутри контейнера и при необходимости пересоздаёт только выделенный Nginx-контейнер существующим способом. Не считать exit 0 reload доказательством выбора нового профиля. При ошибке восстановить предыдущий проверенный профиль; окно установки остаётся закрытым для публичного доступа.

2. На **инертном отдельном** корне, не в лицензированном document root, проверить fixed FastCGI endpoint и CGI-параметры. Запрос `'/Product/%D1%82.html?color=red&color=blue&empty='` должен дать точный REQUEST_URI, исходный QUERY_STRING и Host. Через подтверждённый TLS proxy — on/https/443; с другого peer даже с `X-Forwarded-Proto: https` — off/http/8080. Без Basic ожидается 401 до FastCGI. Cookies и Authorization должны отсутствовать в PHP, POST — не достигать backend. Не создавать диагностический PHP в лицензированном корне и не выводить значение реальных секретных заголовков.

3. Без авторизации проверить действительный импортированный маршрут, CSS и существующий asset: ожидается 401, без тела исходного контента. Разрешённые данные с credentials проверяются только через закрытый curl config с правами 0600 (например, содержащий `user`, без помещения пароля в argv). Не применять `curl -v`, trace или `set -x`:

   ```sh
   curl --silent --show-error --max-time 20 --path-as-is \
     --output /dev/null --write-out '%{http_code}\n' "$UPGRADE_BASE_URL$UPGRADE_TARGET"
   curl --silent --show-error --max-time 20 --path-as-is \
     --config "$UPGRADE_PRIVATE_CURL_CONFIG" \
     --dump-header "$UPGRADE_RECEIPTS/page.headers" --output "$UPGRADE_RECEIPTS/page.html" \
     "$UPGRADE_BASE_URL$UPGRADE_TARGET"
   curl --silent --show-error --max-time 20 --path-as-is --head \
     --config "$UPGRADE_PRIVATE_CURL_CONFIG" "$UPGRADE_BASE_URL$UPGRADE_TARGET"
   ```

   Каталог receipts принадлежит исполнителю и закрыт (0700); ответы могут содержать session cookie, поэтому перед приложением к отчёту удалить Set-Cookie и любые секреты. GET принятого маршрута ожидается 200 с явным partial banner и фактическими полями. HEAD — такой же статус/заголовки без тела. Проверить CSS MIME, один PNG/JPG и PDF из принятого manifest; их SHA после GET должны совпасть с принятым importer file registry. PDF не заменять пустым заглушечным файлом. Наблюдавшиеся тексты двух цен остаются сырыми фактами, не обещанием действующей цены/склада.

4. С Basic: неизвестный URL и варианты с изменённым регистром пути, иным порядком/значением/повтором query должны дать 404, если **именно такой** request target не входит в принятые маршруты. Корень `/` может быть 404 при пакете только одной карточки; не перенаправлять его молча на карточку. Проверить direct `/local/upgrade-route.php`, `/local/upgrade-installer-resume.php`, `/bitrix/admin/index.php`, `/bitrix/legal/license.php`, `/bitrix/license_key.php`, `/bitrix/.settings.php`, `/bitrixsetup.php`, `/.git/config`, `/backup/site.zip` и `/upload/upgrade/other-project/<sha>.png`: 404 без PHP/тела файла. Повторить с `--path-as-is` и кодированными сегментами `%62itrix`, `%2egit`, `bitrix%2flicense_key.php`, `local/%75pgrade-route.php`; malformed escapes могут получить безопасный 400. Проверять ответы по отсутствию canary из инертного корня, а не чтением реального ключа.

5. POST/PUT/PATCH/DELETE/OPTIONS/TRACE к существующей карточке, CSS и asset должны дать отказ 4xx (обычно 403), без попадания в PHP и без изменений целевой БД/очередей. В Nginx нет обработчика реальных форм, заказов или платежей; frontend controls сами по себе не считаются функцией. Проверить noindex/no-store/nosniff на 200/401/403/404, отсутствие request log canary на host/container/FPM и отсутствие сетевой активности PHP. Сам профиль не даёт доказательства отсутствия побочных действий лицензированного bootstrap — для этого нужна проверка действующей изоляции.

6. Проверить браузером карточку на desktop/mobile, изображения, скачивание PDF, partial banner, отсутствие активных vendor/admin controls и ошибок CSS; сохранить очищенные результаты вместе с выбранным profile SHA и accepted package SHA. При необходимости создать администратора вернуть **временно** прежний проверенный installer profile в закрытом режиме, затем снова выбрать partial profile и повторить запрещённые endpoint/Basic/CGI проверки. Этот workflow не превращает установщик в публичную страницу и не меняет readiness Upgrade автоматически.
