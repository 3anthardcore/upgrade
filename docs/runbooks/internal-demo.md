# Внутренний запуск: источник → пакет → Битрикс → evidence

Срез исполнения07:44UTC: описанный native путь реально выполнен для389 страниц; app r16, `target-evidence ingest` и его повтор EXIT0 с одним result artifact. HTTPS/Chromium synthetic сценарии, API-edit/conflict/restore и историческое восстановление V6 подтверждены в [контрольной точке](../pilots/completion-20260930.md). Упоминания текущего r12/app r15/ожидаемого restore ниже относятся к предыдущему срезу runbook. Current runtime backup и общий native QA ingest ещё разрабатываются; не применять непроверенные новые процедуры по одному наличию файла.

Контрольная точка документа: **30.09.2026, 06:50 UTC**. Это воспроизводимая последовательность существующих CLI и операторских этапов. Автоматического provisioning и единой команды, которая уже завершает весь путь до DEMO_READY, пока нет. Исходный код и локальный PASS не означают, что новая версия работает на целевом сайте.

Текущий пилот: app r15, исторически проверенный CMS r12 / 103 страницы. Own code пакета389 установлен и сверён, dry-run прошёл (286 created / 1 updated / 102 skipped, conflicts0/blockers0), **apply RUNNING**, принятого результата импорта ещё нет. Полный capture содержит 948 DOM и 2742 известных URL; 559 DOM отложены, 299 PDF не получены, весь источник UNKNOWN. Restore V5 имеет общий FAILED после успешных SQL/files/counts/isolation/HTTP этапов; V6 ожидает нового native плана. `target-evidence ingest` V2 принят после исправления трёх находок V1, но приложение с этим изменением ещё не развёрнуто. Ни одна из этих стадий не снимает остальных gates. Новые результаты публикуются отдельно в [контрольных точках](../pilots/completion-20260930.md).

## Владение и входы

| Контур | Кто исполняет | Сохраняемое состояние |
| --- | --- | --- |
| Исследование / capture / model / build / report | Обычный пользователь приложения (`upgrade` на пилотном сервере) | `DATA_DIR/PROJECT/state/upgrade.db`, immutable artifacts, source snapshots, releases, reports |
| Подготовка сервера и установка CMS | Единственный уполномоченный оператор | Принятые profile/compose/image/code pins, backup, network receipts; секреты вне webroot/Git |
| Native target transport | Оператор с доступом к Docker; PHP в контейнере от `33:33` | Отдельный private transport journal, target state; content Store не открывается |
| Приём результатов | Независимый reviewer, затем ядро через CLI | Checks с PASS/FAIL/NOT_RUN, task/artifact IDs и принятые SHA |

На пилоте приложение находится в `/opt/upgrade`, Store — `/opt/upgrade/shared/projects/teplypol-market`, CMS — `/opt/upgrade/targets/teplypol-market/cms-root`, target state — соседний `state`. Это разные области записи даже на одном сервере. Приватный state внутри PHP монтируется в `/var/lib/upgrade`, CMS — в `/var/www/html`. Пути, контейнеры, DB identity и домен нового проекта определяются из его профиля, не копируются из пилота автоматически.

Нужны Node 24 и закреплённые зависимости. Для native этапа дополнительно нужны разрешённый Business/другая отдельно проверенная редакция, отдельная БД и document root, закрытый HTTPS endpoint, принятый backup и проверенная изоляция до первого PHP bootstrap. Значения лицензии, паролей, ключей и cookies не помещают в команды, Git, публичные отчёты или сообщения агентов. Файлы credentials передаются по приватным путям.

Все примеры ниже — для shell на Linux, из корня принятого app release. Заглавные `PROJECT`, `DATA_DIR`, `SHA256`, `BUILD_ID` и подобные слова являются placeholders. Их заменяют значениями из сохранённых JSON-ответов/принятых артефактов, а не предположениями. Команды не предназначены для запуска целиком без проверки результатов между стадиями.

## 1. Создание и исследование

```sh
node packages/cli/index.ts doctor --json
node packages/cli/index.ts init --source https://example.com/ --id PROJECT --data-dir DATA_DIR
node packages/cli/index.ts plan --project PROJECT --data-dir DATA_DIR
node packages/cli/index.ts status --project PROJECT --data-dir DATA_DIR --json
node packages/cli/index.ts crawl --project PROJECT --data-dir DATA_DIR
```

Для существующего проекта сначала `status`, затем чтение сохранённых receipts и продолжение незавершённой стадии. Не создавайте новый run, чтобы обнулить расход или скрыть FAIL. Прежние пределы HTTP crawl сохраняются; неявное повышение и неподтверждённые legacy limits блокируются.

Автоматический crawl сохраняет исходный URL inventory, HTTP/DOM и причины ошибок. Known challenge или HTML вместо robots приводит к PAUSED / REQUIRES_ACCESS. Не превращайте HTTP 200 challenge в страницу сайта. `resume` не снимает access gate. После фактического разрешения доступа повтор допускается с точным сохранённым `--ack-access-block BLOCK_ID --access-resolution-reason TEXT`; это подтверждение оператора, не обход защиты.

Для обычного завершённого crawl используются `extract`, `build`, `import --dry-run`, `verify`, `report`. `run --until demo-ready` объединяет обычные стадии, но пока возвращает контролируемый BLOCKED и не заменяет native процедуры ниже. У `doctor` нет доказательства установленного target только по наличию Docker CLI. Для своего синтетического localhost допускается точный `--fixture-origin`; это исключение не переносится на private production-сети.

## 2. Переносимый operator capture

Если публичные данные доступны в разрешённом браузере, оператор сохраняет наблюдения по [контракту capture](../operator-capture.md): исходный/final URL, время, точные DOM/selected fields, все наблюдаемые ссылки и доступные asset bytes с SHA. HTTP status не выводится из DOM. Чужие JS/HTML остаются данными и не исполняются вне ограниченного браузера. Не решайте CAPTCHA и не переносите auth/cookies в crawler для неразрешённого обхода.

Codex IAB/CUA может использоваться оператором текущей задачи; Upgrade не вызывает внутренние desktop API как внешний программный интерфейс. Для автоматических аналитических ролей существует документированный Codex CLI adapter. Сбор через браузер и приём capture — разные операции, ни одна не отправляет исходные формы.

`scripts/pack-browser-observations.ts` — существующий **пилотный** offline packer, а не универсальный экспортёр любого браузера: он пока использует зафиксированный teplypol legacy seed в `var/pilots/teplypol-operator-capture-media-20260929`. Для другого проекта нужен корректный portable capture по контракту. Нельзя выдавать этот путь за автономное получение всех данных по любой ссылке.

Для пилотного packer порядок аргументов такой:

```sh
node scripts/pack-browser-observations.ts RAW_DIRECTORY NEW_CAPTURE_DIRECTORY CAPTURE_ID \
  SCOPE_FILE SCOPE_SHA256 \
  --registry-manifest PRIOR_CAPTURE_DIRECTORY/operator-capture.json \
  --registry-sha256 PRIOR_MANIFEST_SHA256 \
  --report-dir NEW_PACK_REPORT_DIRECTORY
```

Для всех наблюдений вместо scope/pin передают два пустых аргумента `'' ''`; flags начинаются после этих позиционных аргументов. Дополнительные raw directories допускаются после scope/pin. Выходной каталог должен быть новым. `--registry-manifest` теперь валидирует весь закреплённый предыдущий capture и наследует весь URL inventory, включая derived media/PDF; отложенные страницы не получают OBSERVED в новом stage. Manifest pin вычисляется по окончательным байтам и принимается отдельно. Файл с собственным self-declared hash не является внешним pin.

```sh
node packages/cli/index.ts operator-capture ingest --project PROJECT --data-dir DATA_DIR \
  --directory CAPTURE_DIRECTORY --manifest-sha256 CAPTURE_MANIFEST_SHA256
```

Критерий этой стадии: COMMITTED receipt с capture ID, исходным manifest SHA и artifact IDs всех точных bytes. Повтор того же ID/SHA проверяет прежние артефакты и возвращает replay; неизвестная публикация сначала сверяется. Повреждённые байты и конфликт ID не исправляются молча. Исходный crawl/access block и бюджеты остаются; operator inventory расширяет знаменатель, не заменяет его списком успешно выбранных страниц.

## 3. Модель, дизайн и immutable пакет

```sh
node packages/cli/index.ts operator model --project PROJECT --data-dir DATA_DIR \
  --capture CAPTURE_ID --manifest-sha256 CAPTURE_MANIFEST_SHA256 --all-observed
node packages/cli/index.ts operator build --project PROJECT --data-dir DATA_DIR \
  --capture CAPTURE_ID --manifest-sha256 CAPTURE_MANIFEST_SHA256 --model MODEL_ID --all-observed
node packages/cli/index.ts report --project PROJECT --data-dir DATA_DIR
```

`MODEL_ID` — поле `id` ответа model. Build возвращает `id`, `package_dir`, `manifest_sha256_package`, `result_artifact_id`; сохраняйте JSON целиком. Для одной страницы вместо `--all-observed` у model задаётся `--page ABSOLUTE_URL`; выбор build обязан совпадать. Старые документы V1 с правилом «ровно одна страница» описывают историческую версию: текущий явный multipage режим проверен отдельно.

Стадия создаёт COMMITTED model/build records и `operator-content-model.json`, `operator-route-manifest.json`, `operator-scope-manifest.json`, `operator-release-manifest.json`. Они связаны пинами capture/result/source и fingerprint кода. Пакет содержит `data/operator-scope.json` со всем известным реестром и собственный `/local` код. `PARTIAL` и full-source UNKNOWN сохраняются. Ненаблюдаемые URL остаются unresolved; «expected 200» целевого маршрута не доказывает исходный HTTP 200.

Дизайн — проверенное предложение роли designer на закреплённой модели, принятые tokens/структура и собственный шаблон. `operator build` сам не вызывает дизайнера для каждого нового проекта; повторяемая orchestration дизайна для произвольного URL ещё ограничена. На новом проекте отдельно фиксируют input model SHA, реальный agent job/result, независимое review и проверку шаблона на фактическом содержимом. Дизайн не добавляет выдуманные отзывы, сертификаты, цены или наличие.

Перед staging нужны: правильные source/project bindings, accepted package manifest SHA, `blockers=[]`, полный исходный scope, отсутствие исполняемых исходных файлов и проверенные assets. Missing PDF/image не превращается в перенесённый файл. Можно явно выбрать stage с подтверждёнными обязательными media, сохранив excluded/unresolved в полном реестре. Принятый пакет неизменяем: исправления создают новый model/build/package pin, не патчат sealed каталог.

## 4. Изолированный target и установка собственного кода

Это отдельный операторский этап с одним writer. Приложение не устанавливает лицензионный CMS из произвольного архива автоматически. [Bitrix runbook](../bitrix.md), [runtime пилота](../pilots/bitrix-runtime.md) и [installation run](../pilots/bitrix-installation-run.md) сохраняют фактическую процедуру и её границы.

Последовательность обязательных результатов:

1. Приняты отдельные document root/DB/private state, pinned images/Compose, принадлежность контейнеров и свободная подсеть. Guard проверен и применён **до bootstrap**. Docker internal network сам по себе не доказывает запрет доступа к host/соседним сервисам.
2. Actual PHP-FPM от uid33 читает защищённый prepend; запреты outbound/mail/process/agents проверены с положительными и отрицательными контролями. Host bridge INPUT и forwarding входят в проверку. Подлинные CMS/лицензию монтируют только после pre-CMS проверки.
3. Сделаны SQL+files backup и private receipt, его SHA принят; есть отдельная процедура реального restore. `INTEGRITY_VERIFIED` не равно успешному восстановлению.
4. Точный пакет скопирован под `host_package_root` в новый каталог; повторно сверены manifest и все bytes. Ввод проекта не может выбирать произвольный путь/контейнер.
5. `infra/provisioning/deploy-code.sh` копирует только перечисленные manifest собственные `/local` files с copy-time SHA и общим target flock. Требуются Bash, Python3 и PHP validator в контролируемой среде с правильными путями; этот helper не устанавливает зависимости и не является универсальным host deploy одной командой. На пилотном host PHP в PATH не предполагается.

Контракт переменных deploy helper: `UPGRADE_DOCUMENT_ROOT`, `UPGRADE_PROJECT_ID`, `UPGRADE_DEMO=1`, `UPGRADE_PACKAGE`, `UPGRADE_MANIFEST_SHA256`, `UPGRADE_BACKUP_RECEIPT`, `UPGRADE_BACKUP_RECEIPT_SHA256`, `UPGRADE_TARGET_ID`, `UPGRADE_STATE_DIR`. В каждой среде пути receipt/архива должны разрешаться в той же файловой области, где выполняется проверка. Backup receipt должен соответствовать target/project, проверенным bytes и возрасту до 24 часов. Helper заменяет собственные файлы атомарно по одному, не весь release целиком; до конца копирования и проверки сохраняют закрытый maintenance-профиль.

После собственного кода миграция выполняется внутри уже изолированного PHP service:

```sh
docker exec -u 33:33 PHP_CONTAINER php CONTAINER_PACKAGE/code/migrations/install.php \
  --document-root=/var/www/html --project=PROJECT --site=s1 --state-dir=/var/lib/upgrade
```

`site` берётся из actual CMS. Миграция создаёт own tables/module/iblock/properties через API и использует тот же writer lock. Повтор должен завершаться корректным JSON без дублей; exit0 с vendor exception HTML не считается успехом. Установка own module не означает full content import, браузерную админку или активацию лицензии.

## 5. Native validate → dry-run → apply → reconcile

Профиль имеет точный контракт [NativeTargetProfile](../../packages/bitrix-adapter/native.ts):

```json
{
  "schema_version": 1,
  "environment": "demo",
  "project_id": "PROJECT",
  "target_id": "TARGET",
  "driver": "docker-exec",
  "docker_executable": "/usr/bin/docker",
  "container": "PHP_CONTAINER",
  "host_package_root": "/private/target/state",
  "container_package_root": "/var/lib/upgrade",
  "document_root": "/var/www/html",
  "state_dir": "/var/lib/upgrade",
  "backup_receipt": "/var/lib/upgrade/backups/ACCEPTED/receipt.json",
  "backup_receipt_sha256": "ACCEPTED_BACKUP_RECEIPT_SHA256",
  "timeout_seconds": 900
}
```

Это шаблон, не валидный готовый профиль: project/target должны быть допустимыми lowercase IDs, pin — 64 lowercase hex, реальные пути/images/контейнер/backup сверены. Package лежит **под** host root, относительный путь соответствует container root. Private state вне webroot. JSON bytes профиля отдельно закрепляются SHA. Timeout 10–3600 секунд; это предел ожидания клиента, не доказательство остановки PHP после timeout.

Оператор выполняет каждую команду отдельно, сохраняя JSON и exit code в новый private evidence каталог:

```sh
node packages/cli/index.ts target validate --environment demo \
  --target-profile PROFILE_JSON --profile-sha256 PROFILE_SHA256 \
  --package HOST_PACKAGE --manifest-sha256 PACKAGE_SHA256 --journal-dir PRIVATE_JOURNAL
node packages/cli/index.ts target dry-run --environment demo \
  --target-profile PROFILE_JSON --profile-sha256 PROFILE_SHA256 \
  --package HOST_PACKAGE --manifest-sha256 PACKAGE_SHA256 --journal-dir PRIVATE_JOURNAL
node packages/cli/index.ts target apply --environment demo \
  --target-profile PROFILE_JSON --profile-sha256 PROFILE_SHA256 \
  --package HOST_PACKAGE --manifest-sha256 PACKAGE_SHA256 --journal-dir PRIVATE_JOURNAL
node packages/cli/index.ts target reconcile --environment demo \
  --target-profile PROFILE_JSON --profile-sha256 PROFILE_SHA256 \
  --package HOST_PACKAGE --manifest-sha256 PACKAGE_SHA256 --journal-dir PRIVATE_JOURNAL
```

`validate` проверяет пакет и создаёт/проверяет private journal, но не вызывает target PHP. `dry-run` действительно читает целевой CMS; требуются пустые conflicts/blockers. `apply` последовательно сверяет неизвестный исход, выполняет dry-run, claim/fence, контролируемую запись и строгую финальную сверку. Принимается только корректный ответ с совпавшими project/target/package и `DATABASE_RECONCILED`, `defects=[]`. Новый пакет не может обойти UNKNOWN прежнего в том же target journal.

После crash/timeout не удаляйте journal, pending, target mapping или lease ради повтора. Начните с `target reconcile` того же manifest; если чужой writer ещё работает, дождитесь его результата/ограниченного lease. Повтор `target apply` уже подтверждённого пакета может вернуть replay после reconcile без записи. Это доказывает клиентское reconcile-first; доказательство повторной идемпотентной операции самого PHP Gateway сохраняется отдельно. Количество `ug_operation` не равно количеству entities: история нескольких пакетов даёт несколько операций для прежнего ID.

Privileged transport никогда не запускает `operator-*` или `artifact add` от root в content Store. Native журнал имеет собственный SQLite OS lock, не является проектной `state/upgrade.db`. PHP вызывается через Docker CLI с `shell:false`, а не через Codex desktop API.

## 6. Включение собственных HTTP-сценариев

Выполнять после accepted native import/readback, с тем же immutable snapshot/package. Собственный `DemoTransport` обязан перехватить и проверить bounded request **до** CMS bootstrap, очистить vendor GET/POST/REQUEST/COOKIE/FILES/auth headers и передать точный retained request только собственному DemoWeb. Старый router без этого gate был отклонён: поля AUTH_FORM/REGISTRATION могли попасть в Bitrix раньше собственного handler. [Независимый transport review](../reviews/native-demo-transport-review-20260930.md) принимает локальное исправление. К 06:50 root также выполнил actual CMS probe от uid33: exit0, D7 query/post/cookie0, methodGET, URI собственного router, исходный own request сохранён. Это отдельная проверка контекста, не завершённые native HTTP/browser сценарии.

Порядок активации:

1. Сверить SHA фактически установленного собственного router/Transport/Engine/Web/View/Runtime и snapshot. Снять baseline native users/orders/mail до испытания, проверить guard и актуальные права FPM.
2. Создать private base `/var/lib/upgrade/demo-private` вне webroot, без symlink, uid/gid33:33, mode0700. Engine создаёт в нём только собственный `demo-PROJECT`; admission учитывает canonical/pending/lock files, не удаляет их для обхода квоты.
3. Подготовить `demo-active.json` в private state и атомарно заменить pointer после проверки. Сохранить прежний pointer и его SHA. Формат:

```json
{
  "schema_version": 1,
  "project_id": "PROJECT",
  "target_id": "TARGET",
  "relative_path": "PACKAGE_DIRECTORY/data/demo-snapshot.json",
  "sha256": "EXACT_SNAPSHOT_FILE_SHA256"
}
```

`PACKAGE_DIRECTORY` — одно имя из букв/цифр/`_`/`-`, непосредственно под state. Nested `packages/release/data/...`, absolute path и symlink не принимаются. Pointer ≤4096 bytes; snapshot ≤64 MiB, schema1/project/snapshot_id сверяются. SHA файла не равен автоматически логическому `snapshot_id`: проверяются оба. Snapshot и pointer не переключают БД сами; связь с accepted native package фиксируется оператором.

4. Проверить собственный `infra/nginx/interactive-demo.conf`, canonical host и доверенного TLS proxy peer, затем `nginx -t` и управляемый reload только target-конфигурации. Пилотный профиль содержит host `upgrade.help-ai-ru.ru` и bridge peer `172.30.50.1`; это не generic defaults нового проекта. Basic Auth остаётся обязательным; только точный `/__upgrade/action` принимает POST. Cookie передаётся own transport через `UPGRADE_COOKIE_HEADER`, не в CMS auth cookie.
5. Проверить через настоящий HTTPS/FPM: noindex, no-store, nosniff, CSP и `Referrer-Policy: same-origin` на всём proxy-пути. `no-referrer` ломал native same-origin POST в JS-disabled Chromium (Origin:null); strict Origin проверку не ослабляют. Installer/admin/private PHP endpoints остаются закрытыми, если отдельно не назначен их ограниченный профиль.

Cart/lead/checkout используют CSRF, existing-only session, immutable snapshot, idempotency key и локальную durable запись. Разрешены только явные синтетические поля. Нет реальных заказов/писем/платежей; неизвестная/неоднозначная/from цена даёт `total:null`, `REQUIRES_CONFIRMATION`, а не выдуманный ноль. Сохранённая receipt не означает «оплачено» или «отправлено». Native catalog offers/SKU и stock не создаются этим движком.

## 7. Проверки и отчёт

Native acceptance включает разные доказательства; одно не заменяет другое:

| Проверка | Минимальный результат |
| --- | --- |
| Import/repeat/reconcile | Правильные bindings/fence, errors0, defects0, stable IDs, отсутствие дублей и несогласованных route mappings |
| Native facts/readback | Фактические raw facts/hash, entities/routes/counts, прежние IDs; baseline и after users/orders/mail |
| HTTP по package и исходному scope | Точные paths/query/redirects, status/title/H1/prose facts, обязательные media bytes/SHA, сохранённый denominator и deferred |
| Сценарии | Search empty/result/filter/sort, наблюдаемые варианты, quantity validation, cart add/update/remove, replay/receipt, synthetic lead/checkout; ошибки и stale snapshot |
| Browser | Реальные desktop/mobile, фото, меню, отсутствие overflow, keyboard/touch/form POST; локальный PHP fixture не равен native CMS |
| Изоляция | Guard+runtime policy, положительные/отрицательные контроли и ограниченное capture-окно с трафиком DB; отсутствие positive control делает наблюдение неубедительным |
| Admin/license/restore | Отдельные actual receipts; API login не доказывает browser edit, local license flags не доказывают remote activation, backup SHA не доказывает restore |

Примеры существующих проверяющих инструментов (отдельные принятые inputs и новые output каталоги):

```sh
python3 -I -B scripts/verify-pilot-http.py --intent ACCEPTED_HTTP_INTENT \
  --origin HTTPS_ORIGIN --username BASIC_USER --password-file PRIVATE_PASSWORD_FILE \
  --output NEW_HTTP_RECEIPT
python3 -I -B scripts/verify-demo-http.py --base-url HTTPS_ORIGIN --trusted-host TRUSTED_HOST \
  --auth-user BASIC_USER --auth-password-file PRIVATE_PASSWORD_FILE \
  --snapshot-id SNAPSHOT_ID --product-route EXACT_PRODUCT_REQUEST_TARGET \
  --output NEW_SCENARIO_DIRECTORY
```

Первый script и `scripts/verify-pilot-bitrix.php` содержат пилотные предпосылки; PHP readback, в частности, проверяет сохранённый HW500 ID1 и `/var/www/html`. Они не являются универсальной приёмкой любого источника. Demo HTTP verifier ограничен собственными формами, не выполняет source actions и не заменяет native DB counters/изоляцию. `scripts/verify-native-transport.php` подтверждает очищенный D7 request context и даёт один read-only count snapshot; он не доказывает отсутствие всех записей по единственному измерению.

Сохранённые raw receipts не переписываются при FAIL. Исправление получает новый pin, попытку и независимый review. Приём native receipts в общий отчёт получил [REJECT V1](../reviews/target-evidence-independent-20260930.md); V2 принят root после 38 checks, включая три сохранённых независимых воспроизведения. Обновлённое приложение ещё не развёрнуто: до deployment именно принятой версии не используйте старый ingest для приёмки. Native evidence продолжает храниться отдельными immutable артефактами/отчётами.

После deployment принятой V2 используется offline bundle `target-evidence.json` + ровно четыре файла profile, journal head, exact reconcile request/response. Поля/лимиты — в [описании evidence](../reviews/target-evidence-20260930.md). Привязка к выбранным COMMITTED build/model/capture, всем payload SHA и scope обязательна. От unprivileged пользователя:

```sh
node packages/cli/index.ts target-evidence ingest --project PROJECT --data-dir DATA_DIR \
  --build BUILD_ID --directory NATIVE_EVIDENCE_DIRECTORY --manifest-sha256 EVIDENCE_MANIFEST_SHA256
node packages/cli/index.ts report --project PROJECT --data-dir DATA_DIR
node packages/cli/index.ts status --project PROJECT --data-dir DATA_DIR --json
```

Копия native receipt — свидетельство доверенного оператора с проверенной структурой/байтами, не внешняя подпись и не online-проверка текущего target. Старый импорт не доказывает новый build. Report сохраняет JSON/HTML/Markdown, source gate, unresolved URL и отдельные HTTP/browser/admin/restore статусы. Даже принятый `RECORDED_NATIVE_IMPORT` не даёт DEMO_READY. `verify --target-url` обычного pipeline не является универсальным runner всех этих закрытых Basic Auth/native сценариев.

## Восстановление и откат

Для приложения: `backup --project PROJECT --to NEW_BACKUP` и `restore --from BACKUP --to NEW_PROJECT_ROOT` сохраняют бюджеты/историю/артефакты, очищая непереносимое process ownership только в восстановленной копии. Source не меняется. Не возобновляйте неопределённые worker writes без reconcile.

Для CMS: `infra/backup/backup.sh` сохраняет SQL+document-root и integrity receipt; `restore-prepare.py` лишь проверяет/извлекает файлы и явно не импортирует SQL. Реальный clone runner — `scripts/recovery-target.py`, [описание и история](../reviews/native-restore-runner-20260930.md). Он сначала строит план без target mutation, затем исполняет только точный принятый plan SHA:

```sh
python3 -I -B scripts/recovery-target.py \
  --project PROJECT --target-id SOURCE_TARGET \
  --source-root SOURCE_CMS_ROOT --source-compose PINNED_COMPOSE_JSON --source-compose-sha256 COMPOSE_SHA256 \
  --receipt BACKUP_RECEIPT --receipt-sha256 BACKUP_RECEIPT_SHA256 \
  --baseline BASELINE_JSON --baseline-sha256 BASELINE_SHA256 \
  --destination NEW_ABSENT_DESTINATION --clone-project NEW_CLONE_PROJECT --clone-target-id NEW_CLONE_TARGET \
  --subnet VERIFIED_FREE_SUBNET --bridge UNIQUE_BRIDGE \
  --guard GUARD_SCRIPT --guard-sha256 GUARD_SHA256 --auth-password-file PRIVATE_PASSWORD_FILE
```

Execute повторяет те же inputs плюс `--execute --accept-plan-sha256 ACCEPTED_PLAN_SHA256`. До создания clone проверяются exact running source DB container/image/network/IP, backup/archive/SQL/Compose/baseline/guard pins и владение destination. Сеть и БД создаются новыми, guard применяется до PHP. Допускается только объявленная замена разобранного DB host literal на `db` в **clone** settings; original archive/readback ledger не изменяются. Старые failed destinations/volumes не усыновляются для повтора. Несовпадение runtime identity требует нового baseline/плана, а не снятия guard.

Native V2/V3/V4 failures сохранены. V5 в новой подсети 172.30.52.0/24 прошёл SQL/files/counts/isolation/HTTP, но финально **FAILED** на сравнении порядка Docker Mounts. Независимая canonical identity/guard сверка PASS не изменяет исходный результат. Исправление V6 сортирует Mounts, root повторил 44 Python tests; новый native план ещё ожидается. Даже успешное восстановление r12 SQL/files не включает автоматически новые private packages, `demo-active.json`, sessions/receipts или content Store: они вне CMS document root и требуют собственной согласованной копии/сверки. Clone smoke/counts — ограниченная проверка, не доказательство полного равенства всей БД и не production-switch.

При неисправности демо закрывают только собственный interactive endpoint, сохраняют unknown journal/receipts и прежние pins. Возврат pointer/кода допустим лишь к проверенной совместимой версии; он не откатывает БД. Не заменяйте это live SQL overwrite без отдельного плана восстановления. Соседние проекты и production в процедуру не входят.

## Критерий завершения этапа

Сохранены команды и exit codes, входные/выходные SHA, task/run/build/target IDs, реальные checks, исходный denominator, ограничения и следующий шаг. Независимый reviewer принимает только выполненную область. Root обновляет PROGRESS/матрицу; historical FAIL/REJECT/NOT_RUN остаются. Для этого пилота до следующего native evidence статусы **PARTIAL / NOT_READY** обязательны; source PDF/fullness, новый import/HTTP/admin/restore и оставшиеся критерии ТЗ не снимаются количеством локальных PASS.
