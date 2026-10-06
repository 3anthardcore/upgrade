# Независимая приёмка native transport probe — 30.09.2026

**ACCEPT ограниченного диагностического probe.** Он проверяет request isolation/context и возвращает один снимок счётчиков. Успех не доказывает отсутствие предшествующих записей, подлинность native deployment или готовность демо. Настоящий Битрикс этим reviewer не запускался — **NOT_RUN**.

Task `native-transport-probe-review-20260930`, owner/reviewer `demo-engine`, fence1, input `art-5d105c27-d4ac-4f68-8e93-18c6b0f592cf`. Запись только в этот report и ignored `var/evidence/native-transport-probe-review-20260930`. Исходники, сервер, target/DB и Store не изменялись. Исторический A1 REJECT и последующая приёмка own transport остаются в отдельных отчётах; данный probe их не переписывает.

## Проверенные входы

| Файл | SHA-256 |
| --- | --- |
| `scripts/verify-native-transport.php` | `c9c725747a65093f350d45e0da6913e63308940c43a657ad12650ab080349982` |
| `tests/integration/native-transport-probe.test.ts` | `0653633310084731177c587a1b92654ab4a6cb68f3b544e1717e58316e4fd607` |
| `docs/reviews/native-transport-probe-20260930.md` | `bf43d98d161aa6952e2fa55dffff3311d4c2f2fd30429c6650ec8d8fcce123ab` |

Все pins совпали с фактическими файлами. Использованный own helper — уже принятый `demotransport.php`, SHA `62f6d1268affb1983ad4b5cf7979c729d207c777f824ccc381545ac909256e5d`.

## Проверенная граница

CLI-only guard, точные аргументы/environment project/target/demo, canonical file/path и external helper/prepend pins проверяются до подключения CMS. Непривязанный или уже загруженный Application/helper запрещён; mail/process functions отсутствуют, URL streams и background-work constants запрещены. Script не принимает произвольный helper path; он вычисляет собственный путь от document root. Наличие active prepend constant само по себе недостаточно: проверяются ini realpath и bytes SHA.

Synthetic AUTH_FORM/REGISTRATION/query/cookie/auth/upload данные проходят через принятый helper до prolog. Capture сохраняет исходные targets/body, а globals и vendor method/URI/query нейтральны. После prolog script читает D7 query/post/cookie dictionaries, method и URI; любое несовпадение останавливает проверку **до COUNT SQL**. Только затем выполняются три фиксированных SELECT COUNT для b_user/b_sale_order/b_event. Параметры клиента не подставляются в SQL. Неполные/нечисловые/выходящие за предел count results не публикуются как успешный snapshot.

Buffer подавляет штатный stdout bootstrap, arbitrary exception и PHP diagnostic заменяются фиксированными reason. Abrupt exit проходит shutdown handler и даёт ERROR/exit1, а не молчаливый exit0/PASS. External timeout/kill/malformed stdout по-прежнему обязан классифицировать вызывающий transport; такой outcome не равен CHECKS_PASSED.

## Фактические команды и результаты

```text
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
node --disable-warning=ExperimentalWarning --test tests/integration/native-transport-probe.test.ts
var/tools/php-8.3.35/php.exe -n -l scripts/verify-native-transport.php
node var/evidence/native-transport-probe-review-20260930/independent.mjs
```

Checked-in suite: **5/5 PASS,0 SKIP**,1,676с. Четыре группы запускают настоящий PHP process с явно synthetic D7 fixtures; пятая проверяет CLI/installed-helper/bootstrap wiring. Покрыты14 pre-bootstrap отказов, пять загрязнённых D7 полей, vendor output/throw/exit и malformed counts. PHP lint — PASS. Это не native Битрикс.

Reviewer harness: **14/14 дополнительных actual PHP cases PASS**. Он запускает неизменённый pinned script с отдельными временными файлами, accepted helper и D7 stand-in; использует fixture body из frozen test, а новые сценарии и assertions принадлежат reviewer. Raw results сохранены `var/evidence/native-transport-probe-review-20260930/results.json`.

- Нормальный результат сохраняет `READ_ONLY_SNAPSHOT`, `before_after_comparison:NOT_PERFORMED`, `native_deployment_attestation:REQUIRED_SEPARATELY`, `readiness:NOT_EVALUATED`.
- Пропущенный обязательный аргумент, неверный target env, предварительно загруженный D7 Application/own helper и NO_AGENT_CHECK=false отвергнуты **без bootstrap marker и без SQL**.
- Неверный D7 URI или cookie dictionary отвергнуты после bootstrap и **до первого COUNT**.
- Ошибка второго COUNT после успешного первого не выдаёт partial counts; snapshot NOT_VERIFIED. Дополнительно отклонены integer1000000000001, отрицательный и дробный counts.
- Bootstrap throw редактируется в PROBE_FAILURE_REDACTED; exit превращается в PROCESS_TERMINATED/exit1. Synthetic PRIVATE sentinel не попадает в stdout/stderr.
- Во всех сценариях зафиксированный SQL состоит только из разрешённых фиксированных COUNT SELECT; native mutations/API не выполнялись fixture или самим probe.

## Что требует отдельного настоящего доказательства

Probe специально допускает корректный локальный fixture: его CHECKS_PASSED **не аутентифицирует установленный Битрикс**. Root отдельно закрепляет image/container/реальный document-root, script/helper/prepend pins и фактический uid33. Script выводит effective_uid, но не требует33 сам; запуск root/fixture нельзя переименовывать в FPM-worker acceptance. Prepend path/hash — trusted arguments; пример native SHA в авторском report получен ранее от root и должен совпасть с текущей attested конфигурацией.

Prolog SHA измеряется, не проверяется против заранее поданного vendor pin; подлинность CMS и совместимость подтверждаются внешней deployment attestation. Environment labels и canonical path сами этого не доказывают. CLI context test также не заменяет FastCGI/Nginx HTTP/browser POST с реальными cookies, Origin, CSRF и PRG.

Три счётчика сняты **после** CMS bootstrap. Из одного такого snapshot нельзя заключать «записей не было», сравнивать дельту, доказывать отсутствие UPDATE с неизменным count или сетевого эффекта. Для native этапа нужны отдельно сохранённые before/after данные, рамки наблюдения, network controls и проверка actual context. Данный report не объявляет count равенство полной DB-equivalence. Raw php://input остаётся технически читаемым доверенному PHP; accepted transport изолирует известные request interfaces, а не произвольный вредоносный vendor-код.

Результат относится только к собственному диагностическому исполняемому файлу. Не открывать probe через web и не ослаблять sandbox для native запуска. Следующий шаг — root исполняет accepted script в отдельно attested PHP-контуре с bounded timeout и публикует фактический receipt вместе с внешними baseline/counts/isolation доказательствами. Native activation, recovery V5 и общий DEMO_READY данным review не подтверждаются.
