# Независимая проверка изолированного runtime Битрикс

Дата: 29.09.2026. Задача `review-bitrix-runtime`, worker `runtime-reviewer`, вход `art-062cdb75-62e9-4e72-9092-aed73d1b3712` серверного Store `teplypol-market`. Reviewer пишет только этот документ; сервер, целевая БД, лицензионный ключ, source/CMS и Git не изменяются.

**Статус: PRE_CMS_PASS в пределах перечисленных ниже проверок и просмотренных серверных receipts.** Итоговые guard/probe прошли независимый static review и локальные синтаксические проверки. Reviewer самостоятельно сравнил сохранённые правила, конфигурацию и результаты root, но не исполнял серверные команды. Новых блокирующих замечаний для одного проекта и own-code probes нет. Настоящий Битрикс, его первый bootstrap, установка, активация и импорт — `NOT_RUN` в этом review; `DEMO_READY` не подтверждён.

## Вход и доверенная граница

Корень первоначально указал network `upgrade-teplypol-isolated`, bridge `br-upgrade-tp`, subnet `172.30.50.0/24`, HTTP `127.0.0.1:8090`; основной IP выдан DHCP. Существующие production-контейнеры не являются целями изменений или тестов. Наличие скачанного Business-архива не означает установку и успешный первый запуск.

После review имя исправлено на `upgrade-teplypol-market-isolated`, чтобы Store, environment, label и guard marker использовали один project ID `teplypol-market`. Исправление подтверждено финальным network inspect: ID `d67e1db5c8952c5703648901de303ed18d6028e5a38045c3495780906137fc0e`, Driver `bridge`, `Internal=true`, `EnableIPv6=false`, label `upgrade.project=teplypol-market`, нужные bridge/subnet.

Существующий `infra/compose/compose.yaml` задаёт `internal: true`, PHP/DB/nginx на одной сети, loopback publication, отдельные mounts и secret files. PHP не получает Docker socket, host networking или `NET_ADMIN`. Prepend включает собственную привязку demo/project и запреты hit-triggered jobs; PHP mail/process functions выключены. Это прочитано в коде; просмотренный live inspect отдельно подтверждает одну сеть, собственные mounts, `privileged=false`, DNS `127.0.0.1` и restart `no` у всех трёх контейнеров. Состав caps/security options в выбранный inspect receipt не включён и отдельным live PASS здесь не объявляется.

`internal` не закрывает весь доступ к хосту: у внутреннего bridge обычно есть адрес, и контейнеры могут обращаться к слушающим на нём host services. Следовательно, ограничения forwarded-трафика недостаточно для container→host; нужна отдельная проверка `INPUT`. Docker описывает это прямо в [gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes). Локальная публикация порта тоже требует проверки установленной версии: для Docker до 28 документация отмечает особую доступность localhost-published ports из того же L2.

Docker обрабатывает `DOCKER-USER` до собственных forwarding rules; поздний append в `FORWARD` может не увидеть уже принятый пакет. В `DOCKER-USER` адрес назначения уже может быть изменён DNAT. Поэтому проверяется фактический путь пакета, а правила должны совпадать с исходящим интерфейсом/изолированной подсетью, включая путь через published host port к другой bridge. Источник: [Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/).

## Критерии статического review скрипта

- Fail closed до первого запуска лицензионного PHP: автор проверяет точную сеть, bridge, subnet, IPv4/IPv6, единственную сеть PHP и отсутствие пересечений с существующими маршрутами. Ошибка или неизвестный firewall backend останавливает запуск.
- Только собственные цепочки/jumps и scoped matches `br-upgrade-tp`/выделенной подсети. Никакого flush общих `INPUT`, `FORWARD`, `DOCKER-USER`, правил Docker или production chains. Повторное применение не плодит jumps. Откат удаляет только собственные записи.
- `INPUT` запрещает новые соединения контейнеров к любым адресам host; forwarding запрещает выход из изолированной сети и переход к другим bridge. Ответы на разрешённое host-originated соединение к demo не должны ошибочно блокироваться.
- DB-peer разрешён только в пределах выбранной сети; root принимает точный состав подключённых контейнеров. Нельзя случайно разрешить всю ранее существующую Docker-подсеть или добавить PHP вторую сеть.
- IPv6 либо явно выключен и отсутствие маршрута подтверждено, либо ограничен эквивалентными правилами. Проверяется embedded DNS отдельно: host-side resolver не должен оказаться непротестированным внешним каналом.
- Порядок восстановления после перезапуска Docker/хоста описан явно: утрата firewall guard не должна оставлять auto-start PHP без повторной проверки. Global Docker daemon settings ради этого пилота не меняются.

## План поведенческих проб до source/CMS

Проба исполняет только собственный PHP без bootstrap Битрикс и без source HTML. Payload фиксированный, без секретов, писем, заказов и платежей. Для отрицательной проверки недостаточно `ECONNREFUSED` от несуществующей службы: нужен доступный контрольный listener, подтверждённый разрешённым путём, и отсутствие соединения/пакетов от тестового PHP.

| Граница | Контроль и ожидаемое поведение | Нужное свидетельство |
|---|---|---|
| Внутренний peer | TCP к выделенному DB/canary доступен, внутреннее имя разрешается | Фактические peer IP, результат connect; без вывода DB credentials |
| Host→demo | Host обращается к loopback 8090; штатная Basic Auth/ответ nginx действует | Bind/inspect и HTTP-код; пароль не выводится |
| PHP→host bridge | Выделенный canary слушает на host bridge, host-side positive check проходит; PHP connect запрещён | Адрес/порт, positive control, outcome и counters собственного INPUT rule |
| PHP→другие host IP | Проверяется основной host IP и адрес другого bridge без обращения к production-сервису | Выделенный listener/counters; смена DHCP не создаёт разрешённый обход |
| PHP→внешняя сеть | Ограниченная TCP-проба к согласованному безвредному endpoint не соединяется | Таймаут/запрет, маршрут и scoped forwarding counters; без source/CMS запросов |
| PHP→другая bridge | Одноразовый canary в отдельной тестовой сети, доступный host, недоступен PHP | Positive control и отсутствие TCP; 22 production-контейнера не используются |
| Внешний DNS | Отдельно проверяется external DNS/embedded resolver; имя не из source | Результат и при необходимости capture/counters, исключающие незаметную пересылку через host |
| IPv6 | Адреса/маршруты отсутствуют либо проверен аналогичный запрет IPv6 | Inspect и scoped protocol probe |
| Запрещённые PHP функции | Prepend действительно исполнен; mail/process unavailable; URL fopen выключен | Собственная probe JSON, точная SAPI/version/ini; без вызова реальной отправки |
| Повторное применение | Script повторно применён, собственные jumps ровно по одному, остальные правила не изменились | До/после ruleset diff, exit codes, идентичность чужих правил |

Желательная полнота provenance: SHA проверенного скрипта/probe, runtime image ID/digest, network ID, время и коды выхода. Внешнее `BLOCKED` без положительного control и точной цели не превращается в `PASS`. Receipt подтверждает наблюдение исполнителя; ниже указано, какие outputs просмотрены, какие поля отсутствуют и какие проверки reviewer не запускал.

## Замечания и повторная проверка

1. **Порядок firewall rules пока не проверяется.** Скрипт использует `iptables -C`, то есть наличие нужных строк. Jump после существующего `INPUT ACCEPT` / `DOCKER-USER RETURN` либо дополнительный `ACCEPT` раньше REJECT внутри своей цепочки всё равно допускает `SCOPED_NETWORK_RULES_PRESENT`. Для надёжного `check` нужны точные ordered contents собственных цепочек, ровно один собственный jump в первой позиции и отказ при неизвестных правилах в своей цепочке. Re-apply может переместить только свой exact jump; общие цепочки не очищаются.
2. **Negative probes нуждаются в control.** Предварительный probe проверяет host bridge:22 и host public:443, но эти сокеты могут изначально не слушать; ложный `PASS` на connection refused не доказывает firewall. Автору предложены отдельные живые canary/positive controls и вывод `errno`, error, elapsed. Peer за пределами сети должен быть отдельным disposable canary, не production DB. Корень подтвердил план отдельной тестовой сети `172.30.51.0/24` и listener 5432 на ней.
3. **DNS и PHP результат не должен быть шире проверки.** `gethostbyname('example.org')` без адреса подтверждает неуспешное разрешение, но сам по себе не исключает исходящие DNS-пакеты через host resolver. Требуется честное поле resolution_failed или дополнительный traffic/rules evidence. Mail/exec проверяются, но утверждение о всех запрещённых process functions требует проверки также `shell_exec`, `system`, `popen`, `proc_open`, `passthru` и точного configured prepend path.
4. **Идентификаторы проекта расходятся.** Предварительный script требует `network=upgrade-$project-isolated`. При Store/UPGRADE_PROJECT_ID `teplypol-market` это не совпадает с именем `upgrade-teplypol-isolated` в плане. Нужно одно имя или явная зафиксированная связь network alias с проектом; молчаливое использование `project=teplypol` недопустимо как доказательство binding.

В исправленном FREEZE пункты 1, 3 и 4 закрыты чтением итогового кода: свои цепочки сверяются с точным ordered набором (во время apply допускается только его начальный префикс после прерывания), чужие/переставленные правила отклоняются; свой jump устанавливается первым до удаления только exact-дубликатов, а check требует ровно один first jump. Функции проверяются полным списком, точный prepend path включён в вывод, DNS явно имеет `dns_packet_egress=NOT_VERIFIED_BY_THIS_PROBE`. Название сети выровнено. TCP probe сохраняет errno/error/elapsed; пункт 2 закрыт просмотренными actual positive controls для всех четырёх отрицательных TCP-целей. Все четыре группы первоначальных замечаний закрыты в указанной границе.

Официальная документация подтверждает, что `--dns=127.0.0.1` означает loopback самого контейнера; на custom network Docker сохраняет embedded resolver `127.0.0.11` для внутренних имён, а upstream задаётся отдельно. Поэтому предлагаемый `dns: [127.0.0.1]` имеет смысл как local-only upstream, но actual `HostConfig.Dns`, `/etc/resolv.conf` и успешное разрешение `db` надо сверить. Источник: [Docker DNS services](https://docs.docker.com/engine/network/#dns-services). Версия также существенна: [Docker Engine 26 release notes](https://docs.docker.com/engine/release-notes/26.0/) отмечают исправление CVE-2024-29018, когда internal-only контейнеры могли передавать DNS через host loopback resolver. Неуспешный DNS lookup по-прежнему не заменяет packet evidence.

На свежем применении рассмотренные правила ограничены выделенным bridge. Глобальный jump в `DOCKER-USER` сам по себе не даёт широкого REJECT: внутри проверяется только вход/выход выделенного bridge, чужой трафик возвращается в вызывающую цепочку. Правило INPUT допускает ESTABLISHED/RELATED ответы для разрешённого host-originated соединения. Просмотренные HTTP receipts подтверждают работающий host→nginx ответ при действующих guard rules; отдельные packet counters конкретного INPUT rule не сохранены.

## Наблюдения корня и уточнение loopback-доступа

Корень сообщил о live Engine 29.1.3 и успешных guard apply/check. Reviewer затем получил и прочитал перечисленные ниже серверные receipts: четыре доступных host-side negative-canary controls и probe `PASS`, внутренний DB доступен, host SSH/HTTPS, отдельный canary и внешний TCP недоступны, prepend/functions подтверждены. Самостоятельного server execution reviewer не выполнял; версия Engine и exit codes guard известны из отчёта root, а фактические rulesets и сетевые результаты просмотрены непосредственно.

Одновременно root обнаружил, что заявленный `HostConfig.PortBindings` для `127.0.0.1:8090` не создал действующего listener: `NetworkSettings.Ports[8080]=null`, `ss` не показывает 8090. Наличие ports в конфигурации не является PASS доступности. Это согласуется с точным исходником Engine 29.1.3: [default gateway logic](https://github.com/moby/moby/blob/docker-v29.1.3/daemon/libnetwork/default_gateway.go#L107-L137) пропускает Internal endpoints, а [bridge port binding logic](https://github.com/moby/moby/blob/docker-v29.1.3/daemon/libnetwork/drivers/bridge/bridge_linux.go#L1434-L1505) связывает обычные NAT bindings с gateway endpoint. Объяснение — вывод из кода и сообщённых наблюдений, не самостоятельный запуск Engine reviewer.

Итоговый путь host nginx `127.0.0.1:8090` → nginx-контейнер `172.30.50.4:8080` сохраняет одну internal network; второй сетевой интерфейс PHP для этого не нужен. Фактический адрес/роль nginx и working HTTP/Basic Auth/noindex через loopback подтверждены receipts. Backup host config и `nginx -t`/reload указаны root в runtime runbook, но их отдельные raw outputs не входят в выбранные 14 файлов. Отдельной TCP-пробы PHP→host:8090 в receipt нет: этот порт покрывается общим правилом INPUT на уровне static review, а отрицательная live host-проба выполнена для 22.

Для сохранения исходных URL host proxy должен передавать неизменённый request URI без rewrite: вариант `proxy_pass` только с адресом upstream сохраняет форму исходного клиентского URI при обработке исходного запроса. Это подтверждает [документация Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass). Receipt подтверждает точный `//Exact%2FPath?x=&x=2&v=one%2Ftwo` в принятом request target и ожидаемый 404 собственного инертного endpoint; это проверка проксирования, ещё не маршрутизации Битрикс.

По запросу другого исполнителя дополнительно прочитаны `infra/nginx/install.conf`, `infra/provisioning/bitrix.ini` и описание временного профиля. Блокирующих статических замечаний к шести exact PHP endpoints, фиксированному SCRIPT_FILENAME, унаследованной Basic Auth, раннему запрету sensitive файлов, additive INI и `cgi.fix_pathinfo=0` не выявлено. Повторно просмотрены два exact JS пути из официального пакета и шесть явных FastCGI наборов без дубликатов HTTPS/SERVER_PORT: доверие к `X-Forwarded-Proto` ограничено точным peer `172.30.50.1`; для остальных значение нормализуется к HTTP. Root должен подтвердить overwrite заголовка host proxy и actual FPM HTTPS behavior отдельной проверкой. Последнее добавление `/bitrix/legal/license.php` также прочитано: exact путь, GET/HEAD-only, фиксированный script и прежние параметры; остальные legal PHP не разрешены. Сам vendor legal файл reviewer не исполнял. Проверенный SHA installer profile: `55d706045613ad5d05e043da0c5aa688ba09428f5f7fa1d528d9db8497e06f90`. Это смежный static review, а не успешная установка; профиль остаётся отдельным этапом.

## Независимая сверка сохранённых receipts

Просмотрены все runtime JSON и три `firewall-*.txt` в `var/evidence/server-r4/`, затем выполнено сравнение Node-скриптом через stdin, без записи кода или серверных действий. SHA-256 `receipts.tar.gz` совпал с переданным root: `511d8cfe89daa9e48c806928b5e40897f50a8a8715346bcf4784b02e6438bd64`. Прямое чтение tar после gunzip подтвердило побайтовое совпадение **14/14** файлов архива с выбранными локальными receipt-файлами. Два source access test outputs включены в архив, но не используются как доказательство изоляции CMS.

При сравнении `firewall-before-upgrade.txt` → `firewall-after-upgrade.txt` отброшены только комментарии iptables-save с временем. Получены **11 добавлений, 0 удалений**: две собственные цепочки, два своих jumps, четыре своих правила и три правила Docker для нового internal bridge. После исключения этих 11 строк все прежние строки и их порядок побайтово совпадают. Общие политики и существующие raw/NAT/fail2ban правила не изменились в этом непосредственном интервале применения.

В `firewall-current-upgrade.txt` собственные ordered chains и уникальные first jumps остаются теми же. Есть три правила disposable-canary bridge `172.30.51.0/24`, два новых raw правила `docker0`, четыре новых и одно удалённое fail2ban-правило; также переставлены две прежние raw строки. Root сообщил о параллельной работе другого проекта. Review не приписывает эти последующие изменения Upgrade и не утверждает, что IDs всех production-контейнеров или все правила хоста неизменны на протяжении всей сессии. Утверждение о сохранности прежнего ruleset ограничено непосредственным before/after diff.

Network inspect содержит ровно три target-контейнера: DB `172.30.50.2`, PHP `172.30.50.3`, nginx `172.30.50.4`; у каждого единственная сеть `upgrade-teplypol-market-isolated`, IPv6-адрес пуст. PHP image ID `sha256:e6d7ed68e9316db9240eacfc60d319a6ce77ff45ad0476a094a348b90c378935` совпадает с указанным root; версия probe — 8.3.35. Mounts содержат собственный document-root/state, конфигурацию и secret files без раскрытия значений; `cms-root` и Docker socket отсутствуют. Extraction receipt помечен `EXTRACTED_NOT_MOUNTED_OR_EXECUTED`: 88 870 members, 762 134 704 bytes; это не запуск vendor PHP.

`runtime-positive-controls.json` показывает доступность с host всех четырёх тех же endpoint, которые недоступны из PHP: `172.30.50.1:22`, `148.135.208.53:443`, disposable listener `172.30.51.2:5432`, `1.1.1.1:443`. PHP TCP к DB успешен; bridge SSH возвращает errno 111, остальные три errno 101. Таким образом, отрицательные результаты не объясняются отсутствующими сервисами. Они подтверждают совместное поведение internal network и guard для проверенных целей; errno 101 не доказывает срабатывание конкретного REJECT, и счётчики отдельных правил здесь не собраны.

`runtime-dns-packet-probe.json` содержит два разных безопасных nonce-домена, interface `ens1`, по 12 секунд наблюдения: **8 пакетов** host positive control и **0 пакетов** isolated PHP, обе команды exit 0. Это ограниченное наблюдение для данных имён, интерфейса и окон. Raw packet payloads не сохранены; reviewer не может независимо переразобрать capture или утверждать отсутствие всех DNS/сетевых путей при любой будущей конфигурации. Основная PHP probe корректно сохраняет `dns_packet_egress=NOT_VERIFIED_BY_THIS_PROBE`; отдельный receipt закрывает только описанную packet-пробу.

В receipt JSON не везде есть timestamp, script SHA или полная команда. Время создания сети и iptables-save доступно, image/network IDs согласованы, root передал архив с SHA; это достаточная привязка для ограниченного review полученных наблюдений, но не криптографическая аттестация процесса или каждой команды. Reviewer самостоятельно не проверял серверный Engine version, секреты, host config backup, nginx reload и здоровье соседних приложений.

## Итоговые результаты

`PASS` ниже означает либо выполненную локальную проверку, либо явно обозначенную проверку просмотренного receipt. Это не повторное исполнение серверной команды reviewer.

| Check | Статус | Свидетельство / граница |
|---|---|---|
| Итоговые guard/probe/runtime plan | STATIC_REVIEW_PASS | Четыре первоначальные группы замечаний закрыты; финальный `docs/pilots/bitrix-runtime.md` прочитан |
| PHP-синтаксис probe | PASS, локально | `var/tools/php-8.3.35/php.exe -n -l infra/provisioning/probe-isolation.php`: exit 0; PHP-код не исполнялся |
| Shell-синтаксис guard | PASS, локально | `wsl.exe -d Ubuntu -- bash -n /mnt/c/Users/root/Documents/ChatGPT/upgrade/infra/provisioning/isolate-network.sh`: exit 0; firewall-команды не исполнялись |
| Receipt archive | PASS, локально | SHA совпал; 14/14 файлов побайтово совпали с содержимым архива |
| Scoped firewall / сохранение прежних правил | PASS, receipt diff | 11 additions, 0 removals; прежний порядок сохранён в непосредственном before/after; current own chains/jumps также корректны |
| Target network и mounts | PASS, receipt review | Internal IPv4 bridge, три контейнера на одной сети, собственные mounts, restart `no`, без CMS mount |
| PHP ограничения и prepend | PASS, receipt review | Точный prepend `/opt/upgrade/prepend.php`, sentinel true, URL fopen false, все семь mail/process functions disabled |
| TCP own DB / четыре отрицательные цели | PASS, receipt review | 5/5 PHP checks и 4/4 host positive controls, точные адреса/ошибки/elapsed сохранены |
| DNS resolution | PASS, receipt review | Внешнее имя не разрешилось; внутренний DB доступен |
| DNS packet probe | PASS, ограниченный receipt | Host 8, isolated 0, два 12-секундных окна `ens1`; raw payloads не сохранены |
| Direct nginx / loopback auth и noindex | PASS, receipt review | Неавторизованный 401, авторизованный 200 с pre-CMS notice; это не CMS |
| Сохранение raw request target | PASS, receipt review | Encoded slash, double slash, empty/duplicate query переданы точно; own inert 404 |
| Authenticated public HTTPS | PASS, receipt review | TLS validation PASS, 200 и noindex/pre-CMS notice; отдельный unauthenticated HTTPS результат в selected receipt отсутствует |
| Отдельная live IPv6 / PHP→host:8090 probe | NOT_RUN в selected receipts | IPv6 выключен по inspect; 8090 охвачен static INPUT rule, но отдельного socket outcome нет |
| Firewall persistence / unattended restart | NOT_IMPLEMENTED | Restart `no`; перед новым запуском требуется повторная проверка guard и probes |
| Первый bootstrap, установка, активация, импорт, admin, rollback Битрикс | NOT_RUN | Own-code pre-CMS проверки не заменяют настоящую интеграцию |

Проверенные SHA-256: `isolate-network.sh` — `3110097549b77db3255d3aef8cff8004ad158c6499b2d7bddb920b90efa307dc`; `probe-isolation.php` — `e2f1c9e51ee111ca2dfbbf7e20bc99ed56b60f24ab5972c6371bb1032974790e`. Основные receipt hashes: container config `c0c9b19e6ba02f1a966952e9b034c75a303e522b60ac63b61feccba9c6032319`; network `a4d99260e5657f50ed2472c230f263419d0cec119a02f13a812057b1605534b4`; isolation `a50ed85da7c0badc5f9d3c1db332f7802843c5b359de6bc677da465651d43bee`; positive controls `c947f5fc350f7ba0053ae5ef471dbf7d48b0482c44db516680096286248128fe`; DNS packets `aaaaecf378233f300e3d12c18502e3aaa51dc56c811d6c45e8009db3b7ad0f8a`.

Следующий шаг корня: отдельная проверка private installer profile и actual FPM trust/HTTPS, затем контролируемый первый CMS bootstrap с сохранением исходящей изоляции и новым evidence. Данный review принимает подготовительный runtime в перечисленной границе; сайт на Битрикс, перенос пилота и `DEMO_READY` остаются непроверенными.
