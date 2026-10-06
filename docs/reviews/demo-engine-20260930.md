# DemoEngine: локальное поведение, 30 сентября 2026

Результат этой задачи: **локальный PHP contract PASS**, интеграция с HTTP/сессиями и настоящим Битрикс **NOT_RUN в этой задаче**. Собственный класс `Upgrade\Core\DemoEngine` выполняет поиск, фильтрацию, сортировку, изменение корзины и сохранение исключительно синтетических тестовых обращений/оформлений. Никаких CUser/CEvent/Sale, HTTP-клиентов, почты или native orders внутри класса нет. Это не основание для `DEMO_READY`, полного переноса исходника, готовности оплаты или коммерческого checkout.

Область автора: только `bitrix/module/upgrade.core/lib/demoengine.php`, `tests/integration/demo-engine.test.ts` и этот документ. Server, Store, целевая БД, исходные факты и идентификаторы страниц не изменялись. Независимый review и runtime-интеграцию выполняет родительская задача.

## Вход и API

Конструктор:

```php
$engine = new \Upgrade\Core\DemoEngine($snapshot, $privateStateDir, $projectId);
```

`$snapshot` — доверенный серверный адаптером нормализованный снимок:

```text
schema_version: 1
project_id: точный projectId
snapshot_id: 64 lowercase hex, pin проверенного снимка
items: [{
  id: неизменный entity_source_id,
  title, body_text, request_target,
  is_product: boolean,
  category_ids: string[],
  attributes: { observed_attribute: string[] },
  prices: CommercePrice[],
  purchase: CommercePurchase,
  variants: CommerceVariant[]
}]
```

Адаптер должен сверять pin с проверенным артефактом до передачи объекта. Сам движок проверяет форму pin и binding project, но не доказывает, что переданные items получены из конкретного артефакта. Категории/атрибуты и `is_product` проецируются только из подтверждённых наблюдений; схема commerce не меняет `ContentEntity.type` и `source_id`. `request_target` сохраняется точно, включая повторяющиеся и закодированные параметры. Это данные для собственного рендера, а не разрешение на HTTP-запросы или redirect.

Методы:

| Метод | Поведение |
|---|---|
| `search(string $query, array $filters=[], string $sort='relevance', int $page=1, int $perPage=20)` | UTF-8 поиск по title/body, все слова запроса, точные наблюдаемые фильтры, результаты либо `NO_RESULTS` |
| `openSession(string $session)` | Создаёт/читает приватную сессию, возвращает `csrf` и `cart` |
| `cart(string $session)` | Читает состояние и пересчитывает представление по текущему снимку |
| `mutate(string $session, string $csrf, string $idempotencyKey, string $action, array $payload)` | Проверяет CSRF и intent, атомарно сохраняет результат либо возвращает прежний receipt |

Фильтры: `category_id`, `attributes: {name: string[]}`, `products_only`. Между атрибутами AND, внутри значений одного атрибута OR. Sort: `relevance`, `title_asc`, `title_desc`, `price_asc`, `price_desc`. Неизвестные цены в конце. Сортировка по цене отказывает `PRICE_SORT_INCOMPARABLE`, если известные цены различаются валютой или единицей; пересчёт валют и смешение цены за метр/штуку не выполняются. Title sort детерминированный, не лингвистическая collation.

Каждая новая мутация требует `expected_snapshot_id` из текущей формы/`cart.snapshot_id`. При изменившемся снимке — `SNAPSHOT_CHANGED`. Существующий idempotency receipt проверяется раньше этого guard: повтор **того же** запроса возвращает фактически сохранённый результат прежнего снимка, не пересчитывает его задним числом и не выполняет запись ещё раз. Одинаковые JSON objects с другим порядком ключей считаются тем же intent; порядок массивов сохраняет значение. Повтор ключа с другим action/payload — `IDEMPOTENCY_CONFLICT`.

Допустимые action-specific поля (плюс общий `expected_snapshot_id`):

```text
cart.add:    item_id, variant_id?: string|null, quantity: decimal string
cart.update: line_id, quantity: decimal string
cart.remove: line_id
demo.lead:   synthetic:true, identity:'demo-customer', consent:true,
             topic:'general'|'product-question'|'delivery', item_id?: known ID
demo.checkout: synthetic:true, identity:'demo-customer', consent:true,
               delivery:'demo-pickup', payment:'demo-none'
```

Любые дополнительные поля отвергаются, включая переданные клиентом price, email, phone и свободный текст обращения. Фиксированная синтетическая identity имеет имя «Демо-покупатель», адрес `demo@example.invalid`. Пользовательские персональные данные не принимаются. Для продукта с вариантами обязателен один реальный наблюдаемый `variant_id`; неизвестный вариант и выдуманные комбинации полей не создаются. Цены/purchase берутся из выбранного варианта, а не из запроса.

## Деньги, неизвестные факты и тестовое оформление

Количество — строка с максимум 6 знаками после точки. Сложение и умножение выполняются целыми числами, без PHP float. Предел безопасности движка: положительное количество ≤10000; он не объявляется фактом min/max исходного магазина. Известные source min/max/step проверяются, step считается от min. Неизвестные min/step/unit остаются неизвестными и блокируют итог, но разрешают тестовое изменение количества в пределах безопасности.

Расчёт возможен только для единственного выбранного `CommercePrice` с `status=OBSERVED`, `role=CURRENT`, `totals_eligible=true`, без условий и maximum. Проверяются согласованные decimal/minor, явная непустая единица и известные min/step. Поддерживаются RUB/USD/EUR с двумя денежными знаками, положительная цена ≤1 000 000. Нулевая, другая валюта или более точная цена в этой версии не рассчитывается; это ограничение, а не замена исходной цены. `FROM`, `OLD`, `RANGE`, неизвестная, неоднозначная или повреждённая цена никогда не превращается в ноль или текущую стоимость.

Округление half-up применяется к каждой строке в минимальных денежных единицах: пример `0.05 × 0.1 = 0.01`, `0.05 × 0.3 = 0.02`. Затем суммируются округлённые строки. Несколько валют показываются раздельно в `known_subtotals`; единый total отсутствует.

По уточнению родительской задачи тестовое оформление разрешено для непустой корзины с валидными наблюдаемыми позициями даже при неизвестном итоге. Оно **не означает коммерческий заказ**:

- `status=RECORDED_LOCALLY_SYNTHETIC`;
- `pricing_status=REQUIRES_CONFIRMATION`, `total=null`, непустые `pricing_blockers`, если расчёт невозможен;
- при полном расчёте `pricing_status=CALCULATED_FROM_OBSERVED_FACTS`, точный total;
- `native_order_created=false`, `message_sent=false`, `payment_attempted=false` всегда;
- запись и очистка корзины сохраняются атомарно в одной операции;
- пустая корзина, исчезнувшая позиция/вариант или невалидное теперь количество блокируют оформление.

`checkout_available` означает только возможность локального синтетического сценария, а не готовность оплаты. UI обязан подписать его как тестовый сценарий и явно показать «Сумма требует уточнения» при `REQUIRES_CONFIRMATION`; скрывать blockers или заменять null нулём нельзя.

## Состояние и восстановление

Приватный stateDir должен существовать вне document root; на POSIX требуется mode0700. Создаются project-подкаталог0700, session JSON0600 и отдельный lock0600. Имя файла — SHA256(project + NUL + opaque session). Session должен быть случайным серверным идентификатором 32–128 URL-safe символов. CSRF — случайные 32 bytes; сравнение `hash_equals`. Другой project/session не может применить чужой файл или CSRF. Symlink canonical state/lock отвергается.

Каждая операция получает `flock(LOCK_EX|LOCK_NB)` с ожиданием до примерно3 секунд. Занятый writer получает `STATE_BUSY`; владение не перехватывается и история не обнуляется. JSON envelope содержит checksum всего body, project/session binding и revision. Коррупция даёт `STATE_CORRUPT`/`STATE_BINDING_INVALID`, исходные байты остаются для диагностики.

Commit: новый файл в том же каталоге, mode0600, полная запись, `fflush`, доступный `fsync`, atomic rename. Cart, synthetic records и operation receipt находятся в одном commit. Сбой после rename восстанавливается точным replay сохранённого receipt; сбой до rename оставляет прежнее состояние, повтор применяет намерение один раз. Orphan `.pending-*` не считается committed и не продвигается автоматически. Tests действительно завершают PHP-процесс на обеих границах. Directory fsync не реализован; доказана процессная crash-recovery, не переживание потери питания/сбоев файловой системы. NFS/multi-host locking не проверялись и не поддерживаются этим утверждением.

Движок ограничивает snapshot64MiB/10000items, cart100lines,512receipts,100syntheticrecords, state8MiB, payload8192bytes, query200UTF-8characters, page_size100. При достижении предела — отказ до commit, без удаления receipts. Общая квота всех сессий, TTL/retention и HTTP rate limit — обязанность runtime-адаптера; движок не удаляет пользовательское состояние сам.

## Требования к runtime-адаптеру

Нужны PHP64-bit + mbstring, отдельный приватный каталог с корректным uid/mode и register/autoload собственного класса. Серверный snapshot формируется из hash-verified immutable content/commerce, а не из клиента. Интегратор сохраняет исходные source IDs/routes и независимость исходного URL-реестра.

HTTP-адаптер обязан: только POST для mutate; собственный random opaque cookie с Secure/HttpOnly/SameSite; origin/CSRF protection; input/content-type/body limits; передача expected_snapshot_id и устойчивого idempotency key; обработка STATE_BUSY/INVALID без vendor HTML; отсутствие CSRF/сессии в access/error logs; no-store/noindex/доступ к закрытому демо; экранирование всех source title/attribute/route значений в HTML. GET не должен выполнять mutate. Файл состояния и класс не публикуются напрямую. Engine JSON не считается безопасным HTML. Сетевое ограждение, отключённая почта/process functions и запрет real orders сохраняются на уровне runtime независимо от этих unit checks.

## Фактические проверки

30.09.2026, Windows, настоящий PHP8.3.35, временные локальные приватные каталоги, неизменённый production-класс. Только fault injection `rename` находится в test harness; отсутствуют подмены арифметики/flock/файлового хранилища. Native CMS не запускается.

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-engine.test.ts
# 18 tests, 18 PASS, 0 FAIL, 0 SKIP; duration 14.1s
& var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demoengine.php
# No syntax errors detected
npm run check
# PASS
```

Проверено поведением: UTF-8/empty search, exact query URL, AND/OR facets, price sorting/несопоставимые единицы; decimal addition/rounding/update/remove;13 невалидных количеств без записи;15 типов непригодной цены; реальные варианты; reject PII/неявных synthetic claims; scope и CSRF; semantic idempotency/changed snapshot; аварии до/после commit; synthetic checkout UNKNOWN после потери ответа;12 competing PHP writers (6одинаковых +6разных ключей) без lost update; active flock boundary; corruption без reset; исчезнувший item/empty cart; currency separation; unexpected fields и state-inside-webroot.

PHP runs отключают mail/process/socket functions; дополнительно исходник проверен на отсутствие этих вызовов и native CMS send/order API. Это подтверждает локальный путь без таких вызовов, но не заменяет packet capture/реальный HTTP/Bitrix review. Следующий этап: независимая проверка класса, root-owned adapter и реальная проверка изолированного HTTP-сценария. Target/CMS/browser/mail-network integration этой задачи: **NOT_RUN**.
