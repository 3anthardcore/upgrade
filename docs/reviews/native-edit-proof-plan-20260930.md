# План нативного доказательства редактирования и сохранения конфликта

**Статус: PLAN, проверки не выполнены; никаких PASS для Битрикс.** Задача `native-edit-proof-plan-20260930`, исполнитель `commerce-model`, fence 1, вход `art-a2d49b50-89d7-48e0-924e-91a6c56fa99e`. Изменён только этот документ. Сервер, Store, CMS и БД автор не изменял.

Назначение: проект `teplypol-market`, target `target-teplypol-20260929`, точный маршрут `/termoregulyatory/grand-meyer-hw-500`, ожидаемый существующий `BITRIX_ID=1`. Пакет: `4141b1d86b294520f2a2dc02d668c0153924caa9d76ce6c74941b15e6a9a6a9b`. Начинать **только после** успешного нативного импорта заявленных 389 сущностей, соответствия фактических счётчиков manifest и defect-free reconcile этого точного пакета. Более ранний пакет не подходит. Существующего администратора ID1 не создавать повторно и не менять его учётные данные.

## Что действительно редактировать

Выбрать **только строковое одиночное свойство `UG_H1`**, а не `NAME`. Собственный шаблон `bitrix/local/components/upgrade/page/templates/.default/template.php` выводит H1 как `UG_H1 ?: NAME`; изменение NAME при заполненном UG_H1 не доказывает изменение заголовка страницы. Компонент получает данные из `$GLOBALS['UPGRADE_CONTENT']`, которые `Router::content()` читает через `CIBlockElement::GetByID` и `GetProperty`.

`Gateway::current()` включает UG_H1 в `managed.properties`. `planEntity()` сравнивает SHA256 текущих управляемых полей с `ug_entity.MANAGED_HASH`: если ручное изменение отличается и от желаемого пакета, и от ранее записанного managed hash, возвращается `USER_EDIT_CONFLICT:<entity_key>`. `dryRun()` помещает эту ошибку в массив `conflicts`; сам CLI может завершиться с кодом0. Проверять JSON, а не один exit code.

Прочитанные исходники закреплены: Gateway `e909692206bc5543482d5afb98a4b0f7f83a63305873b499b73abe8ecd6edf73`, Router `5e6e941345df7100c99f07b19b8758dc613c2684d210e4115ca29d4932c8083e`, шаблон H1 `95c5290ec05addbe828d365b250c3321d32aa6b456b5516de9abed26073327a2`. При нативном запуске root сверяет соответствующую установленную ревизию. Существующий ENTITY_TYPE, в том числе Page для ранее импортированной HW-500, не менять.

## Последовательность root

1. **Зафиксировать назначения и отсутствие второго писателя.** Только sandbox CLI от uid33 с действующими prepend/disabled-functions/env guards и точным target. В каждом изменяющем этапе сохранять живой объект `new \Upgrade\Core\Gateway($project, '/var/lib/upgrade')`: он удерживает существующий `upgrade-<project>.lock`. Не запускать второй Gateway/importer одновременно с этим объектом. Между этапами root приостанавливает обычный импорт и ручные изменения данной страницы. Публичный HTTP только читает страницу через уже изолированный BasicAuth ingress.

2. **Проверить пакет и идентичность через чтение.** `\Upgrade\Importer\Package::read($packageDir, $project, $expectedManifestSha)`; `\Upgrade\Core\Router::resolve($project, $exactTarget)`. Требовать ровно этот `REQUEST_TARGET`, STATUS200, BITRIX_ID1, существующий ENTITY_KEY. Пакет должен содержать соответствующий exact route и entity/stable_key. `CIBlockElement::GetByID(1)->Fetch()` должен вернуть ACTIVE=Y, нужный IBLOCK_ID и XML_ID=`upgrade:<entity_key>`. Проверить единственность элемента по IBLOCK_ID/XML_ID, единственность свойства UG_H1, `PROPERTY_TYPE=S`, `MULTIPLE=N`, без USER_TYPE. Не полагаться только на числовой ID1.

3. **Durable prepare до первой записи.** В новом частном каталоге операции вне document-root записать эксклюзивный `original.json` (0600, файл `xb`, flush/fsync, затем SHA). Сохранить operation_id, project/target/package SHA, exact route, entity_key, ID1, IBLOCK_ID, XML_ID, исходные NAME/ACTIVE и управляемые поля, исходный UG_H1, его DESCRIPTION, PROPERTY_VALUE_ID, хеши route/mapping и текущие MANAGED_HASH/PAYLOAD_HASH из разрешённого SELECT. Для минимального скалярного сценария требовать непустой UTF-8 UG_H1 и пустой/отсутствующий DESCRIPTION; при ином формате остановить подготовку, не угадывать сериализацию. Сохранить исходные значения точно, а не только хеш: они нужны для восстановления.

   Отдельный неизменяемый `intent.json` с SHA original receipt содержит единственное разрешённое поле, исходный SHA, заранее выбранное новое значение и SHA. Значение — исходный H1 плюс короткий явно тестовый суффикс `[проверка редактирования <operation_id>]`; ограничить итог до512 UTF-8 байт. Не добавлять цену, наличие или рекламное утверждение. При слишком длинном исходном H1 остановиться. До мутации выполнить `$gateway->dryRun($package)` и требовать `conflicts=[]`, `created=updated=reconciled=0`, `skipped=manifest.entity_count`, blockers=[]; сохранить ответ и его SHA.

4. **Одна проверочная API-мутация.** Под тем же writer lock повторно прочитать идентичность, исходный UG_H1 и mapping; значения должны совпасть с original receipt. Затем выполнить только:

   ```php
   \CIBlockElement::SetPropertyValuesEx(1, $iblockId, ['UG_H1' => $testH1]);
   ```

   Не вызывать `Update()` для всего элемента, не передавать остальные свойства, не менять managed hash, operation rows или routes. Это документированный API, который сохраняет неуказанные свойства; его возвращаемое значение не является доказательством успеха. Немедленно читать `GetProperty($iblockId, 1, [], ['CODE'=>'UG_H1'])`, проверять единственность и точное VALUE, затем `Router::content(1)` и неизменность остальных управляемых полей. При необходимости вызвать только scoped `CIBlock::clearIblockTagCache($iblockId)`; не делать глобальный сброс кешей и не переиндексировать поиск ради H1.

5. **HTTP и conflict proof без второй записи.** Зафиксировать EDIT_READBACK_CONFIRMED, завершить процесс/освободить lock, получить BasicAuth GET по точному исходному пути. Сохранить код200, hash HTML и DOM-свидетельство `article.document[data-upgrade-entity="<key>"] > h1`: точный текст равен testH1. Проверка вхождения строки где-либо в HTML недостаточна. Не добавлять cache-busting query к маршруту: точные query значимы для Router. Повторное чтение может использовать `Cache-Control: no-cache`.

   Затем штатный read-only dry-run того же package pin:

   ```sh
   php bitrix/importer/cli.php --command=dry-run \
     --project=teplypol-market --target-id=target-teplypol-20260929 \
     --document-root=/var/www/html --state-dir=/var/lib/upgrade \
     --package=<точный установленный каталог пакета> \
     --manifest-sha256=4141b1d86b294520f2a2dc02d668c0153924caa9d76ce6c74941b15e6a9a6a9b
   ```

   Это существующий CLI, не новая команда proof runner. Для package CLI path использовать собственный реально установленный/проверенный importer. Проверить ровно один ожидаемый conflict с соответствующим source_id и `USER_EDIT_CONFLICT:<entity_key>`, отсутствие посторонних conflicts и изменений. Повторно прочитать UG_H1: ручное значение сохранилось; mapping hashes и ug_operation count неизменны. **Не запускать apply** для демонстрации отказа: dryRun уже проверяет ту же `planEntity()` и не требует второй импортирующей записи.

6. **Compare-before-restore только того же поля.** Новый guarded CLI-процесс получает writer lock, читает pinned original/intent и проверяет project/target/package/route/ID/XML_ID. Если текущий UG_H1 строго равен testH1 из intent, восстановить только `['UG_H1' => $originalH1]` через `SetPropertyValuesEx`. Если уже равен originalH1, это сверяемый исход ранее неизвестного restore: повторная запись не нужна. Если равен третьему значению — **RESTORE_CONFLICT, остановка без перезаписи**. Не восстанавливать слепо сохранённый массив всего элемента. Если обнаружились изменения других полей, сохранить их и отдельный drift-результат; не чинить их этим сценарием.

7. **Подтвердить восстановление.** `GetProperty` и `Router::content` читают точный originalH1; HTTP200 и exact H1 восстановлены. `dryRun` снова без conflicts и updated/created/reconciled, `reconcile` снова DATABASE_RECONCILED/defects=[] для всего пакета; ID1/XML_ID/route/mapping hashes/ug_operation count прежние. Число b_user/b_sale_order/b_event сверить с подготовительным снимком; HTTP/admin вход по ранее проверенному существующему ID1 отдельно не подменяет этот API proof. Сохранить RESTORED_AND_RECHECKED и все receipts/hashes. Не удалять исходный receipt, intent, неизвестные/неудачные попытки.

## Неизвестный исход процесса

Состояния: PREPARED → EDIT_REQUESTED → EDIT_READBACK_CONFIRMED → HTTP_CONFIRMED → CONFLICT_CONFIRMED → RESTORE_REQUESTED → RESTORED_AND_RECHECKED. Каждое состояние — новая неизменяемая receipt с input pin и наблюдавшимся SHA; advisory состояние не заменяет чтение CMS.

После потери ответа edit сначала сверить текущее значение: original означает запись не подтверждена (повтор возможен только после остальных identity/mapping guards); testH1 означает уже совершённый edit (не повторять); третье значение означает конфликт и запрет записи. После потери restore: original означает восстановлено, testH1 означает ещё не подтверждено и может быть восстановлено после повторных guards, третье значение — конфликт. Нельзя трактовать timeout как отказ записи или автоматически запускать весь сценарий заново с новым original receipt поверх изменённого значения.

Файловый Gateway lock координирует собственный importer, но не блокирует произвольного редактора стандартной админки. Поэтому root обеспечивает отсутствие другого редактора на короткое окно. Если это невозможно, сценарий не даёт атомарного compare-and-set относительно сторонней админской записи: не обещать такую гарантию и не вводить прямой SQL UPDATE ради теста.

## Критерий и ограничения

PASS этого будущего этапа возможен только при наличии API readback + фактического HTTP H1 + ожидаемого dryRun conflict + сохранённого ручного значения + точного восстановления и финальной сверки. До выполнения все перечисленные проверки **NOT_RUN**. Это доказательство редактируемости одной существующей страницы и политики сохранения её конфликта, не общего покрытия админки, каталога, заказов, платежей или production recovery. Тестовое изменение и восстановление — две отдельные записи через документированный API; остальное чтение.

Официальные API: [SetPropertyValuesEx](https://dev.1c-bitrix.ru/api_help/iblock/classes/ciblockelement/setpropertyvaluesex.php) допускает передачу только изменяемых свойств и не возвращает подтверждающий boolean; [CIBlockElement API](https://docs.1c-bitrix.ru/api/classes/CIBlockElement.html) описывает методы чтения/записи элемента. Нативная семантика и побочные события конкретной установки должны подтверждаться readback и счётчиками, а не выводиться из одной документации.
