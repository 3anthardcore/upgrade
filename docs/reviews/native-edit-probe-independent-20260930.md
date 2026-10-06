# Независимая проверка native edit probe — 30.09.2026

**Вердикт: ACCEPT в области локальной реализации и проверенного CLI-контракта.** Блокирующих дефектов в замороженной версии не найдено. Реальное редактирование Битрикс, Linux uid33/права/fsync, HTTP H1 и финальная native сверка этим reviewer **NOT_RUN**. Этот ACCEPT не является завершением native edit proof или browser admin acceptance.

Задача `native-edit-probe-review-20260930`, owner `demo-engine`, fence1; вход `art-e8e3cf03-78c2-489b-8f57-76d033794874` — принятый план. Запись только в этот документ и `var/evidence/native-edit-probe-review-20260930`. Сервер, БД, Store, source code, исходные снимки и Git history не изменялись. Root остаётся единственным native writer.

## Закреплённые входы

| Файл | SHA-256 |
| --- | --- |
| `scripts/verify-native-edit.php` | `65ba3bc0ffbcfcf73d4c45ebbb54e910afe796d6b3f7704beca2acc3bc937343` |
| `tests/integration/native-edit-probe.test.ts` | `fcf7d0cb351099f8a56759579da3654eff742989a48a89ffaa7e70b148ef34fa` |
| `docs/reviews/native-edit-probe-20260930.md` | `d5e8b43e52ae83c45be2c700eb581aa6b0389463f57155c8446460011bc89fbd` |
| `docs/reviews/native-edit-proof-plan-20260930.md` | `18cdf1b63248dfddbfc456233e6eeed71fe9c06104315c047393fdbbef9c7b2f` |
| Собственный Gateway | `e909692206bc5543482d5afb98a4b0f7f83a63305873b499b73abe8ecd6edf73` |
| Собственный Router | `5e6e941345df7100c99f07b19b8758dc613c2684d210e4115ca29d4932c8083e` |
| Собственный page template | `95c5290ec05addbe828d365b250c3321d32aa6b456b5516de9abed26073327a2` |

Три авторских FREEZE pin совпали перед выполнением и после проверок. Gateway/Router/template соответствуют прочитанным смежным API и принятому плану. Все pins входов и evidence сохранены в `var/evidence/native-edit-probe-review-20260930/pins.json`.

## Предварительные замечания и результат

До FREEZE reviewer сообщил две проблемы незавершённой реализации: отсутствие fingerprints служебных route/mapping/operations/counters и зависимость строгого сравнения binding от порядка CLI argv. Автор исправил их в собственной области до окончательной заморозки. Это предварительное review, не REJECT уже принятой ревизии.

Замороженный helper сохраняет полные route/mapping rows с SHA, `MANAGED_HASH`/`PAYLOAD_HASH`, canonical ordered operation fingerprint/count и отдельные user/order/mail-event counts. Они входят в baseline, сравнение перед API-записью и после неё; изменение приводит к остановке, не восстановлению поверх нового состояния. Binding строится в фиксированном порядке ключей. Авторский regression с обратным argv и дополнительные независимые drift cases проходят.

## Фактически выполнено

Переменные окружения указывали на локальный PHP8.3.35 и его extension directory:

```powershell
$env:UPGRADE_PHP_BIN=(Resolve-Path var/tools/php-8.3.35/php.exe).Path
$env:UPGRADE_PHP_EXT_DIR=(Resolve-Path var/tools/php-8.3.35/ext).Path
node --disable-warning=ExperimentalWarning --test tests/integration/native-edit-probe.test.ts
node var/evidence/native-edit-probe-review-20260930/build-independent.mjs fcf7d0cb351099f8a56759579da3654eff742989a48a89ffaa7e70b148ef34fa
node --disable-warning=ExperimentalWarning --test var/evidence/native-edit-probe-review-20260930/independent.test.ts
& $env:UPGRADE_PHP_BIN -n -l scripts/verify-native-edit.php
```

- Авторский suite независимо повторён: **6/6 PASS, 0 SKIP**, 4610.6015ms. Actual PHP subprocesses, package validator и DemoTransport; CMS/D7 APIs и `posix_geteuid` являются fixture doubles.
- Дополнительный reviewer suite: **7/7 PASS, 0 SKIP**, 4434.6429ms. Проверены семь отдельных сценариев ниже. Fixture prefix взят только после проверки точного авторского test SHA; один reviewer-only fault переключает doubled dry-run в ошибочный clean result. Production helper не изменён.
- PHP lint: **PASS**, `No syntax errors detected`.

| Независимый негативный/восстановительный сценарий | Фактический результат |
| --- | --- |
| Original+intent из другого proof каталога, передан их правильный pin | `INTENT_BINDING_MISMATCH`; ни один элемент fixture не изменён |
| Потерян ответ после edit, затем H1 изменён третьей стороной | `RESTORE_CONFLICT`, третье значение сохранено, всего одна прежняя API-запись; inspect возвращает CONFLICT без записи |
| Mapping hash, route metadata, operation rows, users/orders/events изменены между prepare и первой edit | Все шесть вариантов отклонены `OTHER_FIELDS_OR_IDENTITY_CHANGED` до API-записи |
| К точному source path добавлен query, включая повторные/пустые значения | `PACKAGE_ROUTE_INVALID` до CMS bootstrap; cache-busting alias не принят |
| У установленного собственного router изменён один байт | `FILE_PIN_MISMATCH` до CMS bootstrap, 0 writes |
| Свойство записано, но doubled Gateway не возвращает ожидаемый conflict | Ошибка `EXPECTED_CONFLICT_NOT_CONFIRMED`; подтверждённого успеха нет. Повтор сверяет текущее значение и возвращает replay без второй записи, затем восстанавливает original |
| Другой настоящий PHP-процесс держит тот же file lock | Edit отклонена, 0 writes; после завершения владельца edit и restore проходят. Процесс и lock принадлежали только временному fixture |

Дополнительно проверены реальные собственные Gateway/Router/template без запуска vendor CMS:

```powershell
node --disable-warning=ExperimentalWarning --test --test-name-pattern='(property drift|mapping:MANAGED_HASH|mapping:PAYLOAD_HASH|route-key|route-query)' tests/integration/gateway-reconcile.test.ts
node var/evidence/native-edit-probe-review-20260930/gateway-conflict-check.mjs
node var/evidence/native-edit-probe-review-20260930/template-check.mjs
```

- **5/5 PASS, 0 SKIP**, 444.7864ms — maintained own-PHP cases: H1, mapping hashes и точные routes не могут дать ложный DATABASE_RECONCILED после drift.
- **2/2 PASS** — дополнительные assertions поверх actual own Gateway/Router с DB doubles: исходный элемент clean; изменённый UG_H1 даёт ровно `USER_EDIT_CONFLICT:<stable_key>` нужного source_id, `created/updated/reconciled/skipped=0`, 0 DB writes, прежние ID/XML_ID и route binding.
- **4/4 PASS** — настоящий PHP rendering текущего page template с synthetic content. Exact `article.document[data-upgrade-entity] > h1` равен UG_H1; изменение NAME при заполненном UG_H1 не меняет HTML; тестовый суффикс виден; `<script>`, амперсанд и кавычки остаются экранированным текстом, дочерних HTML-элементов в H1 нет. Это локальный render, не HTTP целевого FPM.

Полный suite и TypeScript check reviewer не повторял без изменений source. Root отдельно сообщил свой повтор6/6; это не добавлено к независимым тестовым числам выше.

## Проверенные границы реализации

Prepare принимает новый private каталог, exact project/target/package, отдельный writer lock, route/stable key/id/XML_ID, scalar single UG_H1 с пустым DESCRIPTION. Нужны clean full-package dry-run и прежний managed hash. До первой мутации сохраняются exact original managed values, служебные fingerprints, immutable intent и file hashes. Existing proof не перезаписывается.

Единственная разрешённая API-мутация передаёт только `UG_H1`. Readback через GetProperty/Router и expected conflict проверяются независимо от возвращаемого значения SetPropertyValuesEx. До записи и после dry-run выполняется повторный snapshot. Original/test/third value различаются; третье значение и другой drift блокируют перезапись. Успех restore не выводится из одного return value.

Потеря ответа после edit/restore проверена реальным завершением PHP процесса внутри write double. Следующий запуск сверяет сохранённый intent и текущее значение, не повторяет уже совершённую запись. Отсутствие stdout после SIGKILL/timeout всё равно является неизвестным исходом, даже если shutdown handler не смог вывести UNKNOWN. После durable restore intent новый edit cycle по прежнему intent запрещён. Подмена original/intent/restore intent или установленного pinned helper должна разрешаться исправлением входной целостности оператором, а не удалением receipt ради повтора.

Локальный renderer подтверждает правильный выбор UG_H1, однако helper сам HTTP не выполняет. Успешные ответы оставляют `native_http: NOT_RUN`, конечная сверка пакета — `full_reconcile: REQUIRED_SEPARATELY`. UNKNOWN/ошибка также не содержат утверждения о пройденном HTTP. Поэтому нельзя принять только `EDIT_READBACK_CONFLICT_CONFIRMED` за полное завершение плана.

## Native условия, которые остаются отдельными

1. Выполнить helper от настоящего uid33 в уже изолированном PHP service, с фактическими accepted prepend/code/package pins и новым private proof каталогом. Windows fixture-defined uid33 не доказывает Linux permissions. Linux file/directory fsync может прекратить prepare при неподдерживаемой среде; это безопасный отказ до API-мутации, не local PASS этой платформы.
2. Сохранить native `prepare → edit → exact authenticated HTTP H1 → expected conflict → restore → exact original HTTP H1 → full reconcile`. Pins берутся из реально принятых bytes/receipts, а не переписываются вручную. HTTP свидетельство требует exact article/ENTITY_KEY/H1 и status200; наличие строки где-либо в HTML недостаточно.
3. Сверить service fingerprints/counts и внешние фактические receipts. Один count snapshot не доказывает отсутствия всех vendor side effects, а эти четыре счётчика не покрывают всю БД. Во время proof исключить параллельного стороннего редактора: Gateway lock координирует собственный importer, не даёт CAS против произвольной стандартной админки.
4. Не считать этот proof браузерным входом администратора, полным admin editing coverage, проверкой лицензии/commerce/restore или DEMO_READY. Root сообщил выполненный импорт389 отдельно; reviewer не проверял его в этой задаче и не переносит этот PASS на новую API-мутацию.

## Evidence и FREEZE

| Evidence | SHA-256 |
| --- | --- |
| `author-suite.log` | `3e3fc21eade7bb976e35aaaaebeaa3347edf9bd9b05d9228d9c5a158a9c68796` |
| `independent.log` | `215ace767bc6a601b8251b0e40f17948136c8f235e059a42c3b95770e3055b76` |
| `independent.test.ts` | `d78829e32f0ca66bb8049ecef850b5709fe95dd9ef0c80f4f688d42134badd13` |
| `template-result.json` | `4bed7f3068eedf83f54be9bcf3824b630c53f38c547ccb8dff060a90fd04a2fe` |
| `gateway-conflict-result.json` | `4bbd100d914089c1ce6330f38cb05e8fd731652e8dee8465d2c8acb7e3316f12` |
| `gateway-targeted.log` | `07f8f416a638e4df7850da936f2834470f565dc93d1c504251dbdaec6bf8179f` |

Все evidence находятся под `var/evidence/native-edit-probe-review-20260930`. Очистка затрагивала только созданные тестом временные каталоги с проверенными absolute parent/prefix. Итоговый SHA этого отчёта передаётся root отдельно; после FREEZE он не редактируется без нового задания.
