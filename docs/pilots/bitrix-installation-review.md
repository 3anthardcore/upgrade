# Независимая проверка private installer execution

29.09.2026. Задача `review-private-installer-execution`, worker `installer-execution-reviewer`, вход `art-cb139b7a-53c3-48d9-9bbd-fad5af09472b`. Reviewer изменяет только этот документ. Сервер, БД, браузер, лицензионный ключ и vendor PHP reviewer не использует; Store изменяет только root.

**Статус: INERT_INSTALLER_ONLY / PRE_CMS_FPM_PASS по независимо просмотренным receipts нового образа.** Итоговая actual HTTP/FPM проверка root дала 108/108 PASS; SHA checker, image/container binding и receipt archive сверены reviewer. Reviewer не исполнял серверные команды. Полная установка, активация, импорт и работа Битрикс не подтверждены. Первая live FPM-проба остановилась HTTP 500 до CMS: prepend оказался недоступен пользователю FPM. Этот дефект исправлен и проверен новым запуском, а первая неудачная попытка не переименована в PASS.

## Что проверяется

Временный `install.conf` допускает шесть фиксированных PHP-путей, root/admin rewrites и ограниченную статику официального установщика. `SCRIPT_FILENAME` постоянен для каждого пути; произвольный PHP/PATH_INFO, файлы ключа, settings, архивы и скрытые файлы запрещены. Каждый разрешённый путь наследует Basic Auth. Правила исполняются сначала на собственном инертном document root: содержимое лицензированного `cms-root` ещё не должно быть смонтировано.

HTTPS map доверяет только точному TCP peer `172.30.50.1` с `X-Forwarded-Proto: https`. Host proxy должен перезаписывать входной заголовок. В каждом FastCGI наборе отсутствуют дубликаты `HTTPS`, `SERVER_PORT`, `REQUEST_SCHEME`, а `HTTP_X_FORWARDED_PROTO` заменяется проверенной схемой. Это static review; реальное прохождение через HTTP/TLS/FPM должно быть подтверждено новым инертным запуском.

`bitrix.ini` добавляет short tags и совместимые параметры ввода/PCRE/cache, загружается до demo INI и не отменяет prepend, запреты функций/URL fopen, egress или лимиты памяти/времени. Полный CLI от root не заменяет FPM-проверку: рабочий пользователь и права чтения могут различаться.

## Ошибка первого запуска и правильная граница повторения

По сообщению root, Docker `COPY` сохранил `root:root` mode `0640` для `/opt/upgrade/prepend.php`. CLI root успешно читал prepend, а FPM `www-data` получил 500. Первый checker не принял такой ответ за инертный JSON и не продолжил перебор путей. Значения секрета и полный runtime error log reviewer не получает.

Исправленный собственный Dockerfile прочитан независимо. Первый вариант с `COPY --chmod` не собрался на фактическом legacy builder без Buildx, поэтому не считается успешной сборкой. Итоговый вариант выполняет три plain COPY и один RUN: `chown 0:0`/`chmod 0644` только для несекретных demo.ini, fpm.conf и prepend.php; отдельный `chmod 0755` касается только `/opt/upgrade`. Рекурсивной смены прав, повышения worker до root или изменения vendor нет. FPM pool добавляет `access.log=/dev/null`, сохраняя stderr/error logging и остальные ограничения. Это закрывает стандартный request log, но не гарантирует redaction любого текста, который CMS сама запишет в error log. **Изменение исходников принято independent static review**, что передано root для приёмки отдельной fix-задачи. Для поведенческой приёмки требуются новый image ID, подтверждённая доступность prepend для FPM и новый HTTP/FPM receipt; прежний CLI preflight не переносится в PASS нового установщика автоматически.

## Область checker и замечания автору

`check-installer-inert.py` читает Basic credential из отдельного файла, не выводит его, использует стандартный HTTPS certificate verification и не следует redirects. Сначала выполняет один `/index.php` GET и требует scope `INERT_INSTALLER_PREFLIGHT`; до его получения дальнейших HTTP-запросов нет. Затем проверяет FPM SAPI/project/prepend/disabled functions и INI, Basic Auth на разрешённых PHP-путях, query, TLS, отрицательные URI, два exact JS и запрет POST к статике/legal. Body ограничен одним MiB; timeout на запрос 15 секунд. В отчёте сохраняются время, SHA checker, результаты и общий статус.

Ответ после первого GET не является защитой от ошибочного первого CMS bootstrap. Обязателен отдельный проверенный mount собственного инертного дерева **до любого HTTP-запроса**. Это входное условие checker, а не свойство, которое он способен доказать своим response marker.

Автору переданы следующие границы первой версии: noindex/no-store проверялся только на 404; TLS assertion первоначально проверял HTTPS/port/query, но не REQUEST_SCHEME и нормализованный forwarded header; individual permitted paths сравнивались только по scope, без FPM script filename/project. В следующей прочитанной версии все эти assertions добавлены, а до HTTP проверяются exact host inert root, одинаковый внешний pin шести собственных PHP-файлов, отсутствие symlink и соответствующие PHP/nginx mounts.

К промежуточному pre-HTTP guard передано уточнение: вложенный mount `/var/www/html/bitrix` или `/var/www/html/index.php` должен отклоняться. Иначе правильные host hashes не описывают фактические байты внутри контейнера. Также обнаружен риск принятия старого PASS: при раннем исключении первая версия не перезаписывала существующий output. Финальная версия отклоняет вложенные/родительские web mounts, требует ровно два контейнера с ожидаемыми именами и новый receipt path; output создаётся исключительно для этого запуска. Эти пункты закрыты повторным чтением frozen checker. Root по-прежнему учитывает exit code: ранний отказ до создания receipt означает отсутствие нового результата, а не PASS.

Проверка не устанавливает и не активирует Битрикс, не принимает лицензионное соглашение, не создаёт администратора и не проверяет БД/import/catalog. Запреты POST проверяются исключительно на собственных инертных canaries; запуск этого checker против настоящего CMS root не разрешается его названием или наличием Basic Auth.

## Результаты и следующий шаг

Локально выполнены AST parse Python и три независимых in-memory negative checks первой версии: HTTP500, чужой scope, повреждённый JSON. Затем для **итогового SHA `db514aba…`** выполнен отдельный mock-only regression **13/13 PASS**: существующий output, чужой root, неверный pin, symlink, вложенные script/directory mounts, родительский mount, неверный mount source, неверное число контейнеров и duplicate container names остановились до любого HTTP; HTTP500, чужой scope и повреждённый JSON остановились после одного запроса. Использованы `unittest.mock` и запуск исходника в памяти через `wsl.exe -d Ubuntu -- python3 -`; сеть, Docker, PHP/CMS и файловые записи отсутствовали. Это проверка control flow checker, не имитация успешного FPM или Битрикс.

Прочитанные итоговые hashes: Dockerfile `70de16beabed6deb72b63440032bbaf55d139e670f2d3268d5280f9f3f84f2cf`; FPM pool `c9ab41ee3e5ad186a20651b2310588dbd8d0d093dd2973165356a532245fbecd`; install.conf `55d706045613ad5d05e043da0c5aa688ba09428f5f7fa1d528d9db8497e06f90`; bitrix.ini `9ed935d30f448f02f7ed062695c750307855a013750f6581d161bb933c257c34`; checker `db514abae6f2163b80a500b52ee8a1e82f55f2cc0c542f26402864072cd051e2`.

Дополнительно выполнена in-memory модель ответа для всего frozen checker: **12/12 PASS** как проверки самого checker. Один согласованный baseline даёт 108 PASS; 11 намеренных нарушений — отсутствие headers на 200/401/404, выключенный prepend, разрешённый proc_open, неверный INI, чужие script/project, неправильные TLS scheme/forwarded proto и secret canary в 404 — дают exit 1 и FAIL. Эти проверки не обращаются к сети/Docker/FPM и не создают файлы; синтетический baseline не включён в число настоящих HTTP-проверок. Всего независимый финальный mock regression — **25/25**, отдельно от actual FPM.

## Просмотренные actual receipts

Root передал `var/evidence/bitrix-installer/receipts.tar.gz`, SHA-256 `13297496a5b4074b3a5a65bb2cbce68395a6fbe63e55a17cf2daeb41aa040378`. Reviewer прочитал все пять файлов и Node-скриптом через stdin проверил archive SHA и побайтовое совпадение **5/5** файлов с содержимым tar. Изменения сервера или извлечение файлов этим скриптом не выполнялись.

`installer-inert-v2-receipt.json` создан `2026-09-29T04:57:40.020149+00:00`, scope `INERT_INSTALLER_ONLY`; его script SHA совпадает с независимо проверенным `db514aba…`, pin собственного PHP — `31f163b0baed18fcc5e126f5bcf6fc77db23f85fabb333c4916d0ff16bdc6562`. До HTTP подтверждены PHP и nginx с одним и тем же `/opt/upgrade/targets/teplypol-market/document-root`. PHP image `sha256:1fdc8caa05fb6badb8bef7c316f968523cfcbc476ac5c1ef1c48929e32a84d6d`, container `ea24f8d93533f210e93f873e32df8ad515d87724ccc4a73668735511e2fc9dbc`. Nginx container `6df9aec8530e34184b05acc49b3b01bf554f8e48e7e460da264ac2e55bfec94b`, image `sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236`.

Все 108 записей checks имеют PASS; число и отсутствие FAIL перепроверены программно. Это 108 assertions над 45 HTTP-запросами собственного checker, включая повторные проверки headers, а не 108 независимых сценариев CMS. В observed actual FPM: `sapi=fpm-fcgi`, правильные project/script, prepend true, десять ожидаемых INI-значений, все семь запрещённых функций недоступны. Через HTTP переданы `scheme=http`, `forwarded_proto=http`, пустой HTTPS и port8080 несмотря на поддельный входной proto; через TLS — `https/on/443`. Query с пустым, повторяющимся параметром и `%2F` сохраняется точно.

Восемь разрешённых URL (шесть fixed PHP и два rewrite) дают 401 без Basic Auth и 200 с правильным project/script после неё. Девятнадцать forbidden URI дают 404 без secret/PHP marker; noindex/no-store проверены для всех полученных 200/401/404. Два exact JS доступны с auth и запрещены без неё; POST к ним и legal endpoint даёт 403. Это собственные инертные файлы: настоящий license key ради проверки отказа не читался.

`bitrix-php-fpm-fixed-build-v2.log` показывает успешный legacy build с обычными COPY и точным RUN chown/chmod, final image `1fdc8caa05fb`; эта часть соответствует frozen Dockerfile. `fpm-fixed-permission-log-receipt.json` от `04:58:55.797704+00:00` содержит тот же полный image/container ID, `nonroot_prepend_readable=true`, `post_probe_request_log_lines=0`, PASS. Это ограниченное наблюдение request logging после данного прогона; оно не гарантирует отсутствие любого будущего секрета в error log. Отдельный raw stat owner/mode и полная команда сбора логов в выбранные пять receipts не включены; работоспособность worker подтверждается actual FPM-сентинелом, а 0644/0755 — frozen Dockerfile и build log.

`runtime-fpm-fixed-isolation.json` повторно показывает PHP8.3.35, действующий prepend, семь disabled функций, выключенный URL fopen и пять TCP checks PASS: own DB доступен, host bridge/public HTTPS, disposable canary `172.30.51.2:5432` и public HTTPS недоступны. По сообщению root эта CLI-проба запускалась как www-data; сам JSON не содержит UID/SAPI, поэтому reviewer не приписывает ей FPM execution. FPM-поведение отдельно подтверждено основным inert receipt. `guard-after-fpm-fixed.txt` показывает ожидаемые собственные правила и `SCOPED_NETWORK_RULES_PRESENT` для нужных project/network/bridge.

Свежий isolation JSON честно оставляет `dns_packet_egress=NOT_VERIFIED_BY_THIS_PROBE`. Ранее просмотренный DNS capture с host positive control описан в `bitrix-runtime-review.md`; он не считается новым capture для образа `1fdc8…`. Свежие host positive controls также не включены в эту пятёрку: повторная TCP-проба относится к тем же ранее проверенным endpoint и сочетанию неизменённой internal network/guard. Первые HTTP500 и неподдержанный COPY--chmod build известны из сообщений root и заметки fix-автора; raw failed logs в этот архив не включены.

| Check | Статус | Граница доказательства |
|---|---|---|
| Frozen Dockerfile/pool/install.conf/INI | STATIC_REVIEW_PASS | Собственные изменения, точные права и allowlist; vendor не меняется |
| Checker syntax / negative control flow | PASS, локально | AST parse; 13 preflight/first-response cases + 12 итоговых result cases, всего 25/25 mock-only |
| Archive и привязка checker/image/container | PASS, локально | SHA, 5/5 exact files, идентичность между двумя receipts |
| Новый образ | PASS, просмотренный build log | Legacy builder завершил сборку `1fdc8…`; полный image ID указан в receipts |
| HTTP/FPM на собственных canaries | PASS, просмотренный receipt | 108/108 assertions, фаза `INERT_INSTALLER_ONLY` |
| Прочтение prepend worker и request log | PASS, ограниченный receipt | nonroot readable true; actual FPM prepend true; 0 request log lines после прогона |
| Повторная CLI isolation/guard | PASS, просмотренные receipts | Пять TCP cases и текущие собственные правила; не новый packet capture |
| Реальное отображение первого wizard | NOT_RUN в данной приёмке | Root продолжает отдельным контролируемым первым запросом; evidence ещё не просмотрено |
| Лицензионные условия/активация, установка БД/admin | NOT_RUN | Инертные PHP canaries этих действий не выполняют |
| Импорт, маршруты/контент Битрикс, commerce, backup/restore | NOT_RUN | Требуют отдельной интеграционной проверки |
| Готовность сайта / DEMO_READY | NOT_CONFIRMED | Подготовительный installer runtime не является работающим сайтом |

SHA отдельных receipts: main `03c651a2a96b715edaafee5dbaf3b721c3faa472b8c62940ed26c087232cd6dc`; isolation `b5b80fa57af21aaedbc1a546b06a4e7c8cd1a1950596d8fd9a3be051919e4c5e`; permission/log `7872f24604e41c02bb3b7a846c23e4d409674b1461239a3211232aa9a0579476`; guard `0e8752059b2cde20d1da3debae48754d29b495df4541ac22d1d5c8dce63497c2`; build `f8409bc5eb5a0b36c7595abe45db9fcc4f88e290022d6bb689c86bd063822dac`.

Все переданные замечания к checker и правам FPM закрыты в описанной границе; открытых блокирующих code findings для инертного этапа нет. Следующий шаг root — отдельный first-wizard evidence после контролируемой смены mount, затем явная фиксация фактически выполненного шага и остановки. Данный review принимает новый инертный runtime и не принимает заочно установку CMS, активацию или весь перенос.
