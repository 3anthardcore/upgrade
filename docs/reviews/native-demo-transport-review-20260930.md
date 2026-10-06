# Независимый review native demo transport — 30.09.2026

**ACCEPT исправления A1 в ограниченной области own transport.** Новых блокирующих дефектов в проверенном изменении не найдено. Исторический **REJECT activation v1** остаётся в `native-demo-activation-review-20260930.md` и относится к старому router SHA `3b9b32e1ca9f123412bfff7ba057b1cc1b40f3c2bc3cbe1b1b96a161fa608c28`. Настоящие FPM/Битрикс/DB последствия и интерактивная активация этим reviewer — **NOT_RUN**.

Task `native-demo-transport-review-20260930`, reviewer `demo-engine`, fence 1, input `art-1512d5bc-5f89-4c50-af87-2a52fb1fd46a`. Изменены только этот документ и reviewer evidence в `var/evidence/native-demo-transport-review-20260930`. Source, server, Store, DB и vendor-код не менялись. Временный локальный PHP built-in server слушал только 127.0.0.1; fixture уничтожен после теста.

## Проверенные pins

| Файл | SHA-256 |
| --- | --- |
| `bitrix/module/upgrade.core/lib/demotransport.php` | `62f6d1268affb1983ad4b5cf7979c729d207c777f824ccc381545ac909256e5d` |
| `bitrix/local/upgrade-route.php` | `6b8211fb5a0201d4df995d87ed9a8f687741082e240dcfd1269e5d33e4f9f3aa` |
| `tests/integration/demo-transport.test.ts` | `b240964f85b89380b00a82212665d137e5b7d0f500ba91e2c04a3284b4f6f4c3` |

Pins сверены до и после проверок, совпали. Nginx/Web/Engine/View и предыдущие activation prerequisites здесь не переутверждаются как native PASS.

## Закрытие A1

Router подключает собственный `demotransport.php`, читает максимум8193 bytes и вызывает `capture`/`isolateGlobals` **до первого Bitrix include**. Сохранившийся transport содержит точный исходный method, URI, body, trusted host/TLS metadata, origin и выбранный opaque demo cookie. Router использует сохранённый request target для exact маршрута и передаёт сохранённый массив в DemoRuntime/DemoWeb; очищенный CMS URI его не подменяет.

До CMS отклоняются неподдерживаемые методы, неправильная форма URI, GET/HEAD с body, body больше8192 bytes, POST не на точный `/__upgrade/action`, неподдерживаемый content type и отсутствие/несовпадение exact Origin. В этой версии превышение body даёт400; это фактически проверенный результат, не413. Более строгие собственные form/CSRF/idempotency guards остаются далее, но CMS уже не видит их непроверенные поля.

`isolateGlobals` очищает GET/POST/REQUEST/COOKIE/FILES. Из SERVER удаляются cookie, Basic/Digest/auth headers, CONTENT_TYPE/LENGTH, PATH_INFO aliases, REDIRECT_QUERY_STRING, UPGRADE_COOKIE_HEADER/ORIGIN. CMS method становится GET, URI `/local/upgrade-route.php`, query пуст. Таким образом ранее подтверждённые root условия `$_POST['AUTH_FORM']`/`$_REQUEST['bx_hit_hash']` не получают клиентский ввод из этих источников. Новый helper загружается напрямую до autoload; package builder рекурсивно включает его в собственное дерево, deploy script копирует pinned module files. Для активации всё равно нужен **новый sealed package**, содержащий совпадающие helper и router, а не patch старого immutable package.

## Фактические проверки

```text
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-transport.test.ts
node var/evidence/native-demo-transport-review-20260930/http-review.mjs
var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demotransport.php
var/tools/php-8.3.35/php.exe -n -l bitrix/local/upgrade-route.php
```

**Root tests:2/2 PASS,0 SKIP**,819мс; первый использует настоящий PHP process и synthetic globals, второй проверяет wiring/порядок router. Raw output сохранён `root-tests.txt`. Оба PHP lint — PASS.

**Независимая проверка:20/20 HTTP assertions PASS**, включая16 отрицательных HTTP cases. `http-review.mjs` использует unmodified pinned helper; собственный небольшой PHP HTTP fixture воспроизводит trusted host/TLS/cookie/origin mapping Nginx и заменяет CMS только наблюдателем superglobals. Реальные PHP SAPI автоматически заполняют входные POST/GET/COOKIE из отправленных запросов. Это сильнее искусственного присваивания globals, но всё ещё **не реальный Bitrix или Nginx**. Raw machine result — `http-results.json`.

- POST содержит AUTH_FORM/REGISTRATION/USER_LOGIN/bx_hit_hash и synthetic PHPSESSID/Basic credentials. Observer подтверждает, что PHP действительно получил ключи до capture; после isolate все пять superglobals пусты, auth/cookie/content metadata отсутствует, method/URI/query нейтральны, известные action inputs false. Own capture сохраняет исходное тело и только demo cookie.
- GET `/Prod%2FCase?a=1&a=2&empty=&x=%252F&AUTH_FORM=Y&bx_hit_hash=synthetic` сохраняется **побайтно** в собственном request target; CMS GET/REQUEST/query пусты. Регистр, encoded slash, repeated/blank params и двойное encoding не нормализуются transport.
- До observer отвергнуты Origin `null`, другая схема, похожий чужой host, пустой Origin; query после action; encoded alias action; trailing slash; POST на source `/index.php`; JSON/multipart/text body types;8193-byte body; GET с body; DELETE/OPTIONS/TRACE. Каждый ответ имеет ожидаемый400/403/405/415 и `observer_invoked=false`.
- Два demo cookie дают `invalid-duplicate-cookie`, ни один не выбран; CMS cookie пусты. Body ровно8192 bytes сохраняется для последующей собственной проверки формы.

## Остаточные границы

**Исходный `php://input` остаётся физически читаемым внутри того же доверенного PHP-процесса.** Независимый HTTP fixture прямо подтвердил это. Очистка superglobals не является sandbox против злонамеренного vendor-кода или произвольного include, который самостоятельно читает сырой input/SAPI. Решение изолирует известные request/action интерфейсы штатного пролога при текущем trusted code allowlist. Source JS/PHP/модули не должны подключаться; future middleware, читающее raw input до/в обход этих interfaces, требует отдельного review. Не выдавать этот предел за отсутствие A1-исправления или абсолютную изоляцию процесса.

Trusted metadata приходит из fixed own Nginx profile: host canonical, TLS только от проверенного bridge peer, raw Cookie в отдельном UPGRADE field. HTTP fixture намеренно имитирует эти четыре поля; native FastCGI и создание D7 request context в установленной CMS этим не исполнены. Действующий prepend не загружает CMS до router; добавление bootstrap в prepend нарушило бы проверенный порядок.

Прежние pointer/schema/private-dir/import order/headers требования остаются в activation review. Root после собственного deployment должен сохранить фактические FPM worker/pointer/package pins, убедиться в нейтральном native request context, пройти canonical HTTPS/JS-disabled сценарии и сравнить native user/order/mail counts до/после, включая hostile auth-like query/body. Самостоятельно выполнять настоящую регистрацию/авторизацию для проверки не требуется. Checkout/lead остаются только synthetic local records; unknown totals не превращаются в реальные суммы или оплату.

Следующий шаг — новый sealed package и root-only native activation по ранее описанному порядку, с отдельными actual receipts. Приёмка transport не снимает неполноту source scope, native restore/admin/activation ограничения и не устанавливает DEMO_READY.
