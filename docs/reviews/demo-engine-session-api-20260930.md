# DemoEngine: существующие сессии и receipts, 30 сентября 2026

Task `demo-engine-session-api-20260930`, owner `demo-engine`, fence1. Закреплённый вход `art-a39b7e76-54c0-4b5f-bd69-fd71c514285f`; исходный engine SHA256 `35b1e854e7d4dbd3fe18b59b047dbb48d10ca8e56e9655c94b663878873a9a8a` проверен до изменений. Область: только собственный engine, его integration tests и этот документ. Сервер, Store, целевая БД, Git и другие исходники не менялись.

Локальный результат: **26/26 настоящих PHP contract tests PASS, 0 SKIP**, включая прежние18 проверок; PHP lint и TypeScript PASS. HTTP/native Bitrix integration в этой задаче **NOT_RUN**. Отдельную web-интеграцию выполняет другой исполнитель; его результаты не засчитываются здесь как мои.

## API

```php
public function resumeSession(string $session): ?array;
public function receipt(string $session, string $operationId): ?array;
```

`resumeSession` возвращает существующие `['csrf' => ..., 'cart' => ...]`, причём cart — представление по **текущему** доверенному снимку. Метод не создаёт сессию, не меняет revision, количество, операционные receipts или CSRF. Неизвестная сессия возвращает null.

`receipt` принимает operation ID — **64 lowercase hex SHA256 от idempotency key**, который ранее вернул `mutate`. Это не сырой idempotency key и не произвольный клиентский идентификатор. Метод возвращает исходный сохранённый полный response из той же project/session, без повторного выполнения, пересчёта цены или смены snapshot. Поле `replayed` сохраняет первоначальное false: это чтение исторического ответа, а не `mutate` replay. Неизвестная сессия/операция возвращает null. Некорректный operation ID — `OPERATION_ID_INVALID`, некорректная session — `SESSION_INVALID`.

Исторический receipt может иметь старый `snapshot_id` и прежнюю сумму; это точная запись произошедшей операции. `resumeSession` одновременно показывает текущий snapshot и текущую оценку корзины. Новый POST по-прежнему требует актуальный `expected_snapshot_id`. Нельзя использовать исторический receipt как разрешение нового заказа, оплаты или обход текущих blockers.

## Отсутствие побочных записей

В общем приватном исполнителе добавлен режим `existingOnly`. До открытия lock проверяется наличие canonical JSON. Для неизвестной сессии нет JSON, temp или lock creation; существующий orphan lock сам по себе не восстанавливает сессию и не удаляется. Конструктор, как раньше, может создать project-подкаталог0700; это не session artifact.

У существующей сессии открывается **существующий** lock через `r+b`, а не создающий файл `c+b`. В режиме чтения нет chmod или save. Если canonical JSON существует, но lock отсутствует/не открывается, метод отказывает `STATE_LOCK_FAILED`; он не изготовляет новый inode под потенциально активного writer. При backup/restore/переносе нужно сохранять соответствующий `.json.lock` вместе с `.json`, не удалять lock-файлы живых сессий. Сам факт missing-lock ошибки не является разрешением ремонтировать состояние запросом HTTP.

Используется тот же bounded exclusive flock: чтение ждёт текущего writer до примерно3секунд, затем `STATE_BUSY`, не перехватывая владение. После получения lock сбрасывается stat cache и снова проверяются symlink/canonical path; сравниваются dev/inode открытого lock и его текущего имени. Подменённое имя — `STATE_LOCK_CHANGED`. Если canonical JSON исчез, existing-only чтение возвращает null без его повторного создания. Иные типы canonical path отвергаются `STATE_PATH_INVALID`.

Checksum и project/session binding сверяются до callbacks. Corrupt JSON остаётся без ремонта/reset (`STATE_CORRUPT`/`STATE_BINDING_INVALID`). Для receipt дополнительно проверены request hash shape, operation ID binding, исходный `replayed=false`, snapshot shape, совпадение snapshot ответа/его cart и положительная cart revision не больше текущей сохранённой. Некорректная операция — `STATE_RECEIPT_INVALID`. Это проверка целостности приватного состояния, а не защита от злоумышленника с правами изменять все файлы от имени владельца процесса; stateDir остаётся доверенной приватной границей.

Atomic commit и прежняя логика idempotency не изменились. Receipt, cart и synthetic record по-прежнему находятся в одном canonical JSON. Поэтому потерянный после commit ответ доступен через `receipt`, не требуя повторного POST.

## Требования к HTTP-адаптеру

`resumeSession` не создаёт новую cookie. При отсутствии или неизвестной cookie сервер должен сгенерировать **новый** случайный opaque session ID для `openSession`; нельзя передавать в create-path неизвестный ID, предложенный клиентом. На POST перед mutation нужна существующая session, валидный CSRF, input bounds и актуальный snapshot pin. Неизвестный POST не должен автоматически открывать сессию.

После успешного POST PRG может передать только operation ID в фиксированный собственный GET route; чтение receipt всегда привязано к серверной session из защищённой cookie и текущему project. Нельзя выбирать чужую session/project через query или превращать query в произвольный redirect. Ошибки/неизвестный receipt не являются успешной операцией. Пользовательские названия и текст из receipt остаются недоверенными данными и экранируются при HTML-рендере. Secure/HttpOnly/SameSite, no-store/noindex, запрет session/CSRF/PII в логах и внешняя изоляция остаются обязанностью web/runtime.

## Фактически выполненные проверки

Windows, PHP8.3.35, Node24.20.0. Временные локальные каталоги; production-класс исполняется напрямую. Все18 прежних tests сохранены. Новые8 tests:

1. Unknown session/resume/receipt и malformed IDs не создают JSON/lock; orphan lock не оживляет сессию.
2. Три повторных process reads возвращают точный cart/response; canonical bytes, mtime и список имён файлов неизменны. Unknown operation также ничего не записывает.
3. При новом snapshot и другой цене resume показывает новую оценку, receipt остаётся полностью равным исходному ответу и старому pin.
4. Corrupt JSON, скопированная другая session и missing lock дают отказ без reset/repair.
5. Operation ID не работает в другой session/project; raw idempotency key не принимается как operation ID.
6. Даже пересчитанный checksum envelope не разрешает receipt с чужим operation_id.
7. Реальный PHP writer удерживается в тестовом harness непосредственно перед atomic rename; два других PHP reader-процесса ожидают lock. После release оба видят целое новое состояние/receipt; revision1 и одна операция, промежуточное состояние не прочитано.
8. После настоящего exit процесса сразу после rename receipt читает ровно одну синтетическую запись и исходный response без повторной mutation; canonical bytes неизменны.

Fault injection и barrier находятся только в test harness. Arithmetic, filesystem, flock, production class и отдельные процессы настоящие. Прежние проверки concurrency/crash/CSRF/unknown total/no-send также повторно прошли. Это локальное доказательство поведения, не доказательство NFS/multi-host или power-loss recovery.

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-engine.test.ts
# 26/26 PASS, 0 FAIL, 0 SKIP; 15.18s
& var/tools/php-8.3.35/php.exe -n -l bitrix/module/upgrade.core/lib/demoengine.php
# No syntax errors detected
npm run check
# PASS
```

Замороженные implementation pins:

| Файл | SHA256 |
|---|---|
| `bitrix/module/upgrade.core/lib/demoengine.php` | `132e5dd295a680156bf8234f58e0b8014fdd9ea16666ab56d5c8a60cd9978134` |
| `tests/integration/demo-engine.test.ts` | `3ba9574f060de2ca7d7eed44975707a57a8960f77d2a3e432ea82c4dd0d00637` |

Следующий шаг — независимый bounded review, затем root-owned HTTP/native integration и её собственные фактические receipts. Создание пользователя, коммерческий заказ, платёж, отправка сообщения, полнота source scope и `DEMO_READY` этим изменением не подтверждаются.
