# Фактический частичный импорт в Битрикс

Пилот `teplypol-market`, target `target-teplypol-20260929`. Это работающий фрагмент на настоящей CMS, а не завершённый перенос сайта или магазина. Исходный серверный access block сохраняется. Принятая операторская выборка содержит25 известных URL, одну страницу с выбранными полями и152 файла; полное число URL источника неизвестно.

## Принятый r7 и результат

Application commit `51b53cb`, release `/opt/upgrade/releases/upgrade-0.1.0-foundation-20260929-r7`, archive SHA `a8d1d0e094be82512de8c6cd857a9fc17e083c04c4b37bb434fd77e7eeda58c5`, install exit0. Прежний r6 сохранён. Системный Node, соседние сайты и CMS compose не менялись.

Принятое назначение импорта: `art-8ac954d2-2f3a-45a1-886d-b70e4a591c89`, серверный `/root/upgrade-install-20260929/r7-import-intent.json`. Пакет `operator-release-1be67d5af8158bc5ed7255`, manifest SHA `a0f32ca62adb6b24d488dcf93af7870e85c74a79d13015832ca12632e8e76637`, build artifact `art-8070567d-06fb-456c-9553-f035d7f2c031`. Внутри контейнера пакет находится в `/var/lib/upgrade/`;171 manifest files. Ни один ранее запечатанный пакет не исправлялся на месте.

Единственным писателем был root operator через собственный PHP CLI, исполняемый как33:33 в выделенном `teplypol-market-php-1`. Порядок:

1. `deploy-code.sh`: accepted package/backup pins, настоящий PHP validator, проверка байтов, копирование только собственных13 `/local` файлов. Host PHP отсутствует, поэтому Bash-функция разрешает только точную команду validate и вызывает её в выделенном контейнере; остальной скрипт остаётся штатным.
2. `php <package>/code/migrations/install.php --document-root=/var/www/html --project=teplypol-market --site=s1 --state-dir=/var/lib/upgrade`: два отдельных процесса вернули `INSTALLED`, `iblock_id=1`. Исправленная миграция не регистрирует повторно существующий модуль.
3. `php <package>/code/importer/cli.php --command=dry-run ...`: created1, conflicts[], blockers[]. Общие аргументы — package, project, manifest-sha256, document-root и private state-dir из принятого intent.
4. `--command=claim --owner=root-bitrix-integrator`: fence1. `--command=apply --fence=1 --owner=... --backup-receipt=... --backup-receipt-sha256=...`: created1/routes1/errors0, verification `DATABASE_RECONCILED`.
5. Отдельный `--command=reconcile`: defects[], unreferenced_files[]. Повтор `apply` при том же lease: created0/updated0/skipped1/routes1/errors0, `DATABASE_RECONCILED`.

После этого прямой readback подтвердил:1 инфоблок,1 элемент,1 проект,1 mapping,1 маршрут,1 операция; users0, mail_events0, orders0. Это фактическое отсутствие дубликатов при обычном повторе. Убийство процесса до/после commit, административная правка/конфликт и восстановление целевой БД ещё не испытаны. Неизвестный результат нельзя повторять по отсутствию stdout: сначала `reconcile`, затем проверка назначения и новый claim при истёкшем lease.

Доказательства: `art-850cca3d-9cdb-483e-afe7-2b9b633823b2`;13 очищенных файлов в `var/evidence/server-r7/`, архив SHA `74897550b63d185c8e339dfa2afbb0d4b677416146b659feec787489255b22a3`. Файлы содержат результаты и хеши, без Basic credentials, license key и Set-Cookie.

## HTTP, браузер и текущая изоляция

Активен закрытый `infra/nginx/partial-demo.conf`, SHA `1c4f65ee0000b87764ea7be0d069143317f4753633df2f303e346a681ddf081e`. Внутри контейнера проверены те же байты и `nginx -t`; затем reload. Bind mount остался на прежнем host `config/install.conf`, содержимое изменено с сохранением inode. Прежний installer profile сохранён в `/root/upgrade-install-20260929/r7-before-partial-install.conf`. Это выбор нового профиля, не удаление vendor-файлов. Не запускать install profile как демо.

Адрес: `https://upgrade.help-ai-ru.ru/termoregulyatory/grand-meyer-hw-500`. Без Basic Auth —401. Встроенный браузер использует операторский SSH tunnel к loopback18091; публичного обхода авторизации нет. Соседний ContentHub после переключения — HTTPS200.

Фактические224 HTTP-запроса проверили19 точных значений, partial banner, GET/HEAD,152 media SHA/MIME, CSS hash, все25 известных request targets и варианты query/case/encoded slash, private/admin/installer paths, методы изменения и spoofed headers. Импортированный адрес200;24 неперенесённых URL404 и остаются UNRESOLVED. Их404 не означает успешного переноса. Регистр и значимые query не теряются: варианты без точного mapping404.

Первый отчёт HTTP имеет `FAIL`:221 наблюдение прошло общий набор, три TRACE405 не содержат privacy headers. TRACE отвергнут Nginx до страницы, одинаковый стандартный ответ166bytes; содержимое CMS не возвращено. Исходный FAIL сохранён, оценка этой границы вынесена в независимый review; не превращать его молча в224 PASS.

IAB подтвердил H1, четыре загруженных изображения, PDF download и клавиатурное раскрытие/закрытие `<details>`. При viewport360 CSS document width345/scrollWidth345, таблица271/271: горизонтального переполнения страницы не обнаружено. Изображения имеют пустой исходный alt; полноценная accessibility-приёмка не проведена. В r7 найдены технические имена выбранных полей — это открытый UI-дефект, исправляемый отдельным последующим пакетом. Представление одной таблицы не является завершённым дизайном магазина.

Отдельный observer `capture-runtime.py` SHA `c6157b3524667db40e4b3913e4678b3e22d7ee9e6791e806a68dd12430d0947a` запускался в фактическом network namespace PHP через `nsenter --target <verified PID> --net`, с expected namespace/IP, fixed eth0 и private output. Наблюдение07:47:03.516662 UTC,20seconds:127 frames_read=socket_received,117 валидных TCP кадров к/от собственной БД, внешних IPv4/IPv6, malformed/unsupported и dropped —0. Реальный HTTP200 внутри окна подтверждён отдельным receipt. Payload не сохраняется. Это **CURRENT_PHP_NAMESPACE_OBSERVATION_WINDOW_ONLY**: loopback/Docker DNS, другой интерфейс, будущее поведение и исторический первый bootstrap не доказаны. Старый AT-28 INCONCLUSIVE остаётся историческим результатом.

## Восстановление и ограничения

Backup до собственной миграции: SQL1516143bytes и archive752537983bytes, integrity PASS. `restore-prepare.py` фактически извлёк108264 файла в новый `/opt/upgrade/recovery-checks/teplypol-market-20260929T0700Z-files`; пять не изменявшихся файлов совпали при readback. Назначение вне web root, рабочая CMS не откатывалась. SQL import, восстановленный PHP/HTTP smoke и production recovery **NOT_RUN**.

Email администратора ожидается; пользователей0. Обновление продукта не выполнено при сетевой изоляции, активация лицензии NOT_VERIFIED. Нет корзины, заказа, оплаты, действующей проверки цены/остатка, поиска/фильтров и импорта offers. Источник предоставляет только ограниченные наблюдения; состояние магазина не выводится из кнопок или текста. Кнопок реальных операций в этом preview нет.

Верхнеуровневый production executor не реализован: этот интеграционный путь пока проходит через CLI сборки, принятый intent и собственный PHP importer по runbook, с единственным оператором. Документ не объявляет ручной серверный вызов готовым автоматическим deploy/import адаптером. Серверный Codex остаётся не авторизован; ранее подтверждённый локальный двухагентный smoke не заменяет серверный запуск.

Следующее: применить проверенные публичные подписи без изменения фактов, сохранить конечный target receipt и checkpoint Upgrade; затем получить email, завершить admin/activation, расширить исходный scope и модель, довести дизайн/функции и провести настоящую DB recovery/административные конфликтные проверки. Общая готовность остаётся **NOT_READY**.
