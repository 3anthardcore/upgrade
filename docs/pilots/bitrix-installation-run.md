# Изолированная установка Битрикс: фактическое исполнение

29 сентября 2026. Target `target-teplypol-20260929`, project `teplypol-market`, отдельный корень `/opt/upgrade/targets/teplypol-market/cms-root`. Это продолжение принятого PRE_CMS runtime, не готовый сайт. Исходный HTTP crawl по-прежнему PAUSED, browser observations — отдельный частичный ввод.

## Входы и сохранённые задачи

- Runtime source archive `art-f6311e4d-41e0-461e-ab7a-fd46c17f913c`, SHA `cb805ff8d4c1c440ba5956da845476f3d3da0db1d2437e4fdd6d007263cc92ee`.
- Проверенные предварительные receipts `art-38d927e2-88d1-4abd-a1f9-c57d86350587`.
- Installation intent `art-cb139b7a-53c3-48d9-9bbd-fad5af09472b`; задача `execute-bitrix-private-installer`, исполнитель `root-bitrix-integrator`; reviewer `review-private-installer-execution` / `installer-execution-reviewer` пишет отдельный файл.
- Runtime preparation, independent review и installer profile приняты через Store. Run сохраняет начальное время `2026-09-29T03:25:11.993Z`, 20 task units / 7200 seconds; счётчики не сбрасывались.

## Первые инертные проверки

Временный профиль `infra/nginx/install.conf` разрешает шесть фиксированных PHP endpoints, два наблюдавшихся в архиве JS, read-only iframe лицензии и ограниченную статику. `nginx -t` внутри контейнера и Compose up — exit 0. Новый PHP INI подключён перед `zz-upgrade-demo.ini`. Ни один vendor PHP при этих пробах не монтировался.

Первый authenticated GET `/index.php` вернул HTTP 500. FPM сообщил, что `www-data` не может прочитать `/opt/upgrade/prepend.php`: первоначальный Docker COPY сохранил root:root 0640 из release. Предыдущий root CLI probe это не проверял. Ошибка сохранена в `art-9a528a3a-751f-4461-b78c-04e777b67c79b`; отдельная задача `fix-fpm-runtime-permissions` меняет только собственные Dockerfile/FPM config. Выполняемый vendor-код и БД не затронуты.

Первая исправленная сборка с `COPY --chmod` завершилась exit 1: фактический сервер использует legacy builder без buildx, требуемый BuildKit отсутствует. Тяжёлый extension layer взят из cache. Результат не принят как работающий image; следующий вариант задаёт конечные режимы собственных файлов через совместимый RUN, без смены сетевого профиля.

`check-installer-inert.py` перед HTTP сверяет выделенный inert root, SHA всех шести собственных PHP-файлов, ровно два ожидаемых контейнера и их actual mounts, запрещает overlay внутри web root. После этого проверяет FPM/INI/prepend/functions, все auth routes, URI/query, HTTPS/scheme/port, заголовки, отрицательные пути конфигурации и ограничения методов JS/legal. Требует нового output path, чтобы старый PASS не пережил новый аварийный запуск под тем же именем. Это проверка доверенного собственного inert root при единственном операторе конфигурации, не защита от враждебного root/Docker daemon.

## Проверенный FPM и фактическая точка остановки

Совместимый legacy build с обычным COPY и точным RUN chown/chmod завершился exit 0. Применён image `sha256:1fdc8caa05fb6badb8bef7c316f968523cfcbc476ac5c1ef1c48929e32a84d6d`. Checker SHA `db514abae6f2163b80a500b52ee8a1e82f55f2cc0c542f26402864072cd051e2` выполнил 108 assertions над 45 HTTP-запросами: **108 PASS, 0 FAIL**, exit 0. Проверены настоящий FPM, prepend, INI, disabled functions, HTTP/TLS, auth, точные URI/query и запрет служебных файлов на собственном inert root. Отдельная CLI-проба от www-data подтверждает пять TCP cases. Это подготовительная проверка, без vendor PHP.

Команда: `python3 /root/upgrade-install-20260929/fpm-fixed-build/provisioning/check-installer-inert.py --password-file /opt/upgrade/private/bitrix/demo-access-password --tls-host upgrade.help-ai-ru.ru --project teplypol-market --inert-root /opt/upgrade/targets/teplypol-market/document-root --inert-php-sha256 31f163b0baed18fcc5e126f5bcf6fc77db23f85fabb333c4916d0ff16bdc6562 --output /root/upgrade-install-20260929/installer-inert-v2-receipt.json`. Не повторять с текущим CMS mount: preflight обязан её отклонить.

Архив пяти receipts: `var/evidence/bitrix-installer/receipts.tar.gz`, SHA `13297496a5b4074b3a5a65bb2cbce68395a6fbe63e55a17cf2daeb41aa040378`. Независимый reviewer проверил 5/5 exact files, привязку image/checker, 25 mock regressions и actual receipt; границы описаны в `bitrix-installation-review.md`.

После guard check в 05:00:30 UTC активирован профиль `/opt/upgrade/targets/teplypol-market/config/compose.cms-installer.json`: PHP и Nginx монтируют `cms-root`, прежний inert root сохранён отдельно. Первый контролируемый GET в 05:01:22 UTC вернул HTTP 200, 14874 bytes, заголовок мастера «Бизнес», response SHA `b16ce3e3a71fdb5ad782053a4d9d8a55efbd206b0158a45f657f1b63fda93176`.

Packet capture первого GET **INCONCLUSIVE / REQUIRES_REVIEW**: на выбранном bridge не было даже положительных внутренних кадров (0), поэтому отсутствие внешних кадров (0) не доказывает изоляцию этого первого запроса. Предварительные TCP/DNS tests не заменяют AT-28 реального клона. Сохранён `cms-first-wizard-receipt.json`; private HTML с session fields не публикуется.

Во встроенном браузере открыт мастер по операторскому SSH tunnel. Выполнен переход с приветствия на шаг 2. Флажок принятия EULA остаётся снятым; запрос отдельного согласия пользователя ожидает ответа. Это правило browser tool непосредственно перед принятием соглашения. License key остаётся в приватном root-only файле и ещё не копировался в CMS. Артефакт остановки `art-50adcf70-d379-4c06-87ae-cfeac2e90982` сохранён через Store.

Активация, установка БД/admin, import, Bitrix URL/function checks, restore и commerce остаются **NOT_RUN**. Следующий шаг: после ответа пользователя продолжить мастер с текущего шага, сохраняя ограниченный сетевой профиль, затем выполнить отдельный настоящий импорт. Не запускать старый image или прежний compose поверх текущего состояния.
