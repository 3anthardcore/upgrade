# Native demo activation — независимый review v1, 30.09.2026

**REJECT активации интерактивного POST для проверенной версии.** Блокирующий дефект A1: штатный Bitrix prolog получает непроверенные клиентские параметры раньше собственной проверки DemoWeb. Root подтвердил соответствующие обработчики чтением установленного vendor-кода и остановил активацию POST. Сам рецензент сервер, Store и БД не трогал. Это не отменяет ранее принятые локальные контракты DemoEngine/DemoWeb/View, но они не доказывают безопасную интеграцию с native bootstrap.

Задача `native-demo-activation-review-20260930`, owner/reviewer `demo-engine`, fence 1, input `art-f68613fb-93b5-44e7-b5d0-78955fd214c7`. Scope записи: этот документ и `var/evidence/native-demo-activation-review-20260930`. Подготовленный новый scope источника — 389 страниц по сообщению root; настоящий новый import/activation этим review не проверен. Исходная рабочая CMS на момент входа — r12/103 страницы; полный source scope и готовность магазина не подменяются новым выбранным множеством.

## Зафиксированные входы

SHA вычислены до передачи root найденного дефекта. Последующие изменения root относятся к новой попытке и не входят в этот verdict.

| Файл | SHA-256 v1 |
| --- | --- |
| `bitrix/module/upgrade.core/lib/demoruntime.php` | `0758645c7e8dd31a337ff1301fb4496521402068a4056c3f27ea86da45203e53` |
| `bitrix/module/upgrade.core/lib/demoweb.php` | `f17ada1ccb2aa00cb13c70f7a36574f33a879556ab324426a0c275de6c52bd16` |
| `bitrix/module/upgrade.core/lib/demoengine.php` | `132e5dd295a680156bf8234f58e0b8014fdd9ea16666ab56d5c8a60cd9978134` |
| `bitrix/module/upgrade.core/lib/demoview.php` | `1e91f7986b7499d44ad22d061ee959083921b269e0a241f51667a172961eafd8` |
| `bitrix/local/upgrade-route.php` | `3b9b32e1ca9f123412bfff7ba057b1cc1b40f3c2bc3cbe1b1b96a161fa608c28` |
| `infra/nginx/interactive-demo.conf` | `5e75addb001ff94c250968e387b1367ddff79c2faa47223615d4a314c68f51e6` |
| `infra/provisioning/deploy-code.sh` | `8f3546d53cfce45e9601c0956ea09b663aadb1ecc5259916177bd4952862720b` |

Дополнительно прочитаны importer CLI, Package, Gateway/Router mapping, module autoload, demo projection, component template/header/footer, prepend/FPM/INI и compose/preflight. Общий compose template не считается фактической конфигурацией сервера: root сообщает действующие bridge gateway `.1`, DB `.2`, PHP `.3`, Nginx `.4`.

## A1 — блокер: параметры проходят в CMS до own guards

В `interactive-demo.conf` точный `/__upgrade/action` разрешает POST и включает `fastcgi_pass_request_body on`, передаёт исходный `QUERY_STRING`, method, content type/length и `REQUEST_URI`. Запрет пересылки произвольных headers и отдельный `UPGRADE_COOKIE_HEADER` полезны, однако тело формы всё равно автоматически становится PHP `$_POST`/`$_REQUEST`.

В проверенном `upgrade-route.php` строка 8 вызывает `prolog_before.php`. Считывание raw body и вызов `DemoRuntime::handle`/`DemoWeb::handle` находятся ниже bootstrap. Никакой предварительной очистки `$_GET`, `$_POST`, `$_REQUEST`, `$_COOKIE`, `$_FILES` или нейтрализации request metadata нет. Следовательно, собственные Origin/CSRF/allowed-fields/idempotency guards исполняются **после** возможных штатных действий пролога. Аналогичный путь GET/query нельзя считать изолированным только из-за запрета POST на остальных URL.

Root выполнил разрешённое read-only чтение **реального** `/bitrix/modules/main/include.php` и сообщил: строка 312 проверяет `!empty($_POST['AUTH_FORM'])`, строка 554 — REGISTRATION, строка 415 использует `$_REQUEST['bx_hit_hash']`, строка 423 вызывает `CheckAuthActions`. Никакие auth/registration действия для доказательства не выполнялись. Эти конкретные строки — свидетельство root, не собственный native запуск рецензента. Общее наличие служебного пролога и порядок его выполнения также описаны в [официальной документации Битрикс](https://www.dev.1c-bitrix.ru/api_help/main/general/pageplan.php); она не заменяет проверку установленной версии.

**Риск:** отклонённая собственная форма ещё до отказа может попасть в штатную обработку auth/registration и изменить native state. Выключенный `mail()` не доказывает отсутствие DB-записей или очередей. Basic Auth ограничивает аудиторию, но не устраняет смешение собственного synthetic endpoint с vendor обработчиками. Успешные отдельные unit/browser tests DemoWeb не покрывают этот порядок bootstrap.

Root принял отдельное исправление собственного transport: сохранить точные ограниченные raw method/URI/query/body/cookie/origin до CMS; очистить клиентские superglobals и auth headers; дать CMS нейтральный GET/request path/query; передать сохранённый request только собственному DemoWeb. Vendor-код не менять. Новая версия требует отдельного pin и review, в том числе доказательства того, что сам D7 Request не получает старые данные при создании контекста. Этот документ исправление не принимает заранее.

## Точные предпосылки и порядок активации после исправления

1. Проверить новый immutable package pin и package blockers, current backup для `target-teplypol-20260929`, фактический guarded PHP runtime. Развернуть именно package own code в dedicated `/local`, сохранив предыдущие bytes/pins. `deploy-code.sh` держит тот же filesystem writer lock, что Gateway, проверяет backup provenance и копирует только manifest-listed bytes с повторной проверкой SHA. Он обновляет файлы по одному, а не переключает весь webroot атомарно: на время копирования нельзя считать конкурентный HTTP согласованным release.
2. Native CLI `validate` проверяет package, но не CMS и не активацию. Затем `dry-run`, свежий `claim` с finite TTL3600 и правильным owner/fence, `apply`, строгий `reconcile`, повторный apply/readback. После неизвестного результата сначала reconcile. `--target-id`, env project/target, private state и accepted package/backup pins должны совпадать. Native Gateway не устанавливает demo pointer.
3. Новый `data/demo-snapshot.json` должен существовать в этом же accepted package: builder создаёт его только при переданном commerce model. Сверить exact items/source IDs/request targets с успешно сверенными routes/entities, snapshot SHA с manifest и отсутствие выдуманных commerce facts. Runtime не сверяет pointer автоматически с текущим DB package: включение snapshot до завершения import может смешать новые controls со старым контентом.
4. Private container root — `/var/lib/upgrade`, host bind — `/opt/upgrade/targets/teplypol-market/state`. Root сообщает uid33:33/mode0700; это нужно подтвердить для фактического FPM worker, не только root CLI. Заранее создать `/var/lib/upgrade/demo-private`, uid33:33/mode0700, не symlink. Сам Engine не создаёт этот base; он создаёт только вложенный `demo-teplypol-market`. Global `admission.lock`, session/operation files остаются под этим private base.
5. Сначала разместить и прочитать snapshot под допустимым single-level release directory, затем атомарно переключить `demo-active.json` с сохранением прежнего pointer. Runtime требует точную схему ниже. Не использовать `packages/<release>/data/...`, абсолютный путь или symlink: такие пути не соответствуют контракту. Pointer не является автоматическим importer output.
6. Проверить новый own transport в отдельной приёмке; только затем заменить GET-only installer Nginx profile на reviewed interactive profile, выполнить `nginx -t` и перечитать реально загруженную конфигурацию. Актуальный `install.conf` не обеспечивает synthetic POST, наличие forms ничего не меняет. Effective PHP code/opcache и class autoload должны соответствовать new package.
7. Выполнить реальные HTTP и JS-disabled browser сценарии с canonical HTTPS origin: search/empty result/filter/sort, product→cart add/update/remove→synthetic checkout/receipt и synthetic lead, restart/replay, invalid Origin/CSRF/query/duplicates/body, no side effects в native order/mail/user counts. До этих receipts — native interaction NOT_RUN, source coverage PARTIAL/NOT_READY сохраняется.

Container pointer, все значения кроме release name/SHA фиксированы текущим target:

```json
{
  "schema_version": 1,
  "project_id": "teplypol-market",
  "target_id": "target-teplypol-20260929",
  "relative_path": "RELEASE_SAFE_NAME/data/demo-snapshot.json",
  "sha256": "ACTUAL_64_LOWERCASE_HEX_SHA256_OF_SNAPSHOT_BYTES"
}
```

Это пример схемы, не готовые deploy bytes. Допустимый `RELEASE_SAFE_NAME` соответствует `[a-zA-Z0-9_-]+`; размер pointer ≤4096 bytes, snapshot ≤64MiB. Snapshot schema_version1/project совпадают, snapshot_id — 64hex. Runtime повторно хеширует snapshot. Результат загрузки следует проверить от UID33 с `DOCUMENT_ROOT=/var/www/html` и правильным `UPGRADE_TARGET_ID`; затем отдельно фактическим HTTP.

## Headers, proxy и сохраняемые ограничения

- Nginx жёстко задаёт `HTTP_HOST=upgrade.help-ai-ru.ru`. TLS считается достоверным только от TCP peer `172.30.50.1` с перезаписанным host proxy `X-Forwarded-Proto=https`; тогда scheme=https/port443. Alternate preview/tunnel hostname не совместим с exact Origin policy без отдельного trusted configuration. Не ослаблять Origin до `null` и не доверять произвольному X-Forwarded-*.
- `Referrer-Policy:same-origin` требуется и на внешнем ответе. Прежний `no-referrer` в настоящем JS-disabled браузере дал `Origin:null`; этот исторический дефект уже исправлен в Web/Nginx. Проверить, что outer proxy не добавляет конфликтующий header. Cookie: Secure при TLS, HttpOnly/SameSite=Strict, только opaque `upgrade_demo_session`; raw Cookie не передаётся CMS как `HTTP_COOKIE`.
- Basic Auth, noindex/no-store, script-src none, form-action self, ограниченные hashed assets и fixed own SCRIPT_FILENAME сохранены. POST разрешён только exact `/__upgrade/action`; другие URL не должны выбирать vendor/source PHP. Logs внешнего proxy тоже не должны сохранять body/credentials.
- Nginx допускает тело до16KiB, DemoWeb принимает до8192 bytes и возвращает413 выше своего предела. Query/body повторяющиеся keys отвергаются собственным parser. Сначала нужно закрыть A1, иначе это происходит слишком поздно для native prolog.
- Runtime ограничивает private state: ≤1000 sessions, ≤5000 files, общий резерв 8MiB перед новым session/POST в128MiB quota, global admission flock с3s ожиданием. Pending/lock files учитываются и не удаляются автоматически. Все клиенты через host proxy делят его адрес для rate2r/s/burst10; временный429/503 — возможная фактическая граница, не успешный checkout.
- Unknown/ambiguous/from prices остаются nonchargeable; synthetic checkout с null total/REQUIRES_CONFIRMATION допустим как локальный сценарий. Реальные заказы, платежи, доставка, письма и произвольные персональные данные этим не реализованы.
- Переход snapshot сохраняет существующие private sessions и receipts; stale form должен получать409, а не молча подтверждать старые условия. SQL+CMS-files backup старого r12 не включает поздние private demo sessions/pointer/package; их восстановление — отдельный scope.

## Выполненные проверки и следующий шаг

Фактически выполнены `Get-FileHash` семи входов, чтение перечисленных PHP/TS/nginx/shell контрактов и `rg` по bootstrap/claim/state/mapping. Точные pins и A1 сохранены в `var/evidence/native-demo-activation-review-20260930/checks.json`. Новые PHP, HTTP, browser, Docker и native DB tests в этой задаче **не запускались**: блокирующий порядок bootstrap доказан исходником, native обработчики подтверждены root read-only, который прямо запросил завершить v1 до исправления. Исторические component tests не переименованы в текущие PASS.

Итог v1 **REJECT activation**. Следующий шаг — отдельный сохранённый input исправленного transport и независимая проверка pre-bootstrap isolation, затем root выполняет перечисленную активацию и сохраняет действительные native receipts. Эта приёмка не создаёт новый permission flow и не меняет уже разрешённую область проекта.
