# Привязка native import evidence к операторской сборке

Задача `target-evidence-report-20260930`, вход `art-046af34c-b10d-4807-8614-9a6314354a58`. Это отчёт исполнителя; независимый review и принятие выполняет root. Сервер, source, Docker и целевая БД в этой задаче не использовались.

**История:** V1 отклонён независимым review по трём поведенческим ошибкам. Прежние результаты и SHA ниже сохранены как история V1, не как приёмка. Исправленная V2 и её проверки приведены в конце документа; принятие V2 выполняется отдельно.

## Поведение

Добавлен офлайн-ввод `target-evidence ingest`. Он принимает только явную пару COMMITTED operator build/model и точные immutable build/model/routes/scope артефакты, сверяет происхождение от принятого capture и сохранённого crawl, SHA исходной модели в package manifest, содержимое пакета и отсутствие его blockers. Число известных URL и неохваченные URL берутся из исходного scope, а не из успешных целевых страниц.

Копия последнего native reconcile должна содержать `_target` с теми же project/target/package, `DATABASE_RECONCILED` и пустой массив `defects`. Native head обязан иметь `CONFIRMED`, последнюю команду `reconcile`, совпадающий profile SHA, номер попытки и SHA response. Проверяются соответствующий request и его время, профиль demo, отдельный private state, а также `http_browser_admin: NOT_RUN`. JSON с дублирующимися ключами, неизвестные поля manifest/profile/response, дополнительные или отсутствующие файлы, traversal, symlink, hardlink, превышение размера и несовпадающие bytes отвергаются.

Операция использует dispatcher lease и состояние `PENDING → COMMITTED`. Сначала сохраняется намерение. При потере ответа после публикации повтор сверяет существующие immutable артефакты по типу и SHA и использует их; новые копии тех же bytes не создаются. COMMITTED replay повторно проверяет receipts и назначение. Повреждение сохранённого evidence не исправляется молча и не скрывается.

Отчёты JSON/HTML/Markdown показывают `RECORDED_NATIVE_IMPORT` с точными target/build/package/artifact IDs, датой reconcile, границей доверия и проверенными SHA. При отсутствии evidence сохраняется прежний `NOT_RUN`; PENDING и повреждённые записи видны отдельно. HTTP, browser, admin, restore и production-интеграции остаются независимыми. `NOT_READY`, source access block и неизвестный полный размер сайта не меняются. Историческое свидетельство для прежней сборки не считается импортом новой сборки.

## Формат bundle v1

В отдельном каталоге находятся `target-evidence.json` и ровно четыре файла, перечисленные в `files`. Имена profile/head свободны в пределах безопасных относительных путей. Request/response сохраняют native basename: `<package-sha>.<attempt-padStart-5>.reconcile.request.json` и `.response.json`. Содержимое всех четырёх файлов копируется без редактирования.

```json
{
  "schema_version": 1,
  "kind": "native-import-evidence",
  "project_id": "PROJECT",
  "target_id": "TARGET",
  "build_record_id": "BUILD_SHA256_ID",
  "model_record_id": "MODEL_SHA256_ID",
  "build_artifact": {"artifact_id": "ARTIFACT_ID", "sha256": "SHA256"},
  "model_artifact": {"artifact_id": "ARTIFACT_ID", "sha256": "SHA256"},
  "route_artifact": {"artifact_id": "ARTIFACT_ID", "sha256": "SHA256"},
  "scope_artifact": {"artifact_id": "ARTIFACT_ID", "sha256": "SHA256"},
  "package_manifest_sha256": "SHA256",
  "attestation": {
    "kind": "operator-copied-native-receipts",
    "recorded_at": "2026-09-30T06:00:00.000Z"
  },
  "files": {
    "profile": {"relative_path": "profile.json", "sha256": "SHA256", "size_bytes": 1},
    "journal_head": {"relative_path": "head.json", "sha256": "SHA256", "size_bytes": 1},
    "reconcile_request": {"relative_path": "PACKAGE_SHA.00005.reconcile.request.json", "sha256": "SHA256", "size_bytes": 1},
    "reconcile_response": {"relative_path": "PACKAGE_SHA.00005.reconcile.response.json", "sha256": "SHA256", "size_bytes": 1}
  }
}
```

Это пример формы с placeholders, не принимаемый receipt. Project/target — native lowercase IDs, artifact refs — из выбранных COMMITTED записей Store. `build_artifact` ссылается на `operator-release-manifest.json`; остальные три refs соответствуют `model.output_artifact_ids` и `output_sha256`. SHA всего `target-evidence.json` вычисляется отдельно после формирования и передаётся CLI как доверенный pin; pin из самого manifest не принимается как доказательство.

```bash
node --disable-warning=ExperimentalWarning packages/cli/index.ts target-evidence ingest \
  --project PROJECT --build BUILD_ID --directory /private/copied-native-evidence \
  --manifest-sha256 EXTERNAL_MANIFEST_SHA256 --data-dir /private/upgrade-projects
```

Команда не выполняет Docker/native CLI, не восстанавливает исходный доступ и не пишет на целевой сайт. После COMMITTED каталог ввода не нужен для обычного `report`; точные bytes уже сохранены в Store. Для повторного `ingest` требуется тот же bundle/pin. Смена manifest SHA создаёт отдельное историческое свидетельство и не переписывает предыдущее.

Ограничения ввода: manifest 128 KiB; profile/head по 64 KiB; request 16 KiB; response 4 MB; четыре роли, глубина каталогов менее восьми. Читаются и хешируются одни и те же ограниченные buffers с проверкой identity/mtime/ctime/size до и после чтения. Полный пакет дополнительно проверяет существующий `validateBitrixPackage`.

## Граница доверия

`OPERATOR_ATTESTED_COPIED_NATIVE_RECEIPTS` означает структурно и побайтно проверенную копию, переданную доверенным оператором. JSON без внешней подписи не доказывает правдивость злонамеренного оператора. Ни данные profile, ни local timestamp не являются независимой удалённой аттестацией. Состояние назначения после времени receipt — `NOT_RECHECKED`. Счётчики entities/routes/known/unresolved относятся к привязанной модели и scope; это не выдуманные результаты SQL-запросов.

`RECORDED_PASS` применяется только к сохранённому native `DATABASE_RECONCILED`; новые HTTP/admin/browser/restore receipts в этот контракт не включены. Readiness никогда не повышается только по импорту. Сохранённые head/profile остаются приватными артефактами, report выводит идентификаторы и выводы, а не private host paths или raw native response.

## Проверки

Исполнительные тесты создают настоящий Store, COMMITTED capture/model/package, настоящий native transport journal и запускают CLI в отдельных Node процессах. Native target response моделируется явно; Docker, PHP Битрикс и SQL не исполняются. Во всех CLI subprocess установлены сетевые tripwires.

Проверяются: pin/binding; restart и exact replay; PENDING после потерянного ответа публикации; отсутствие дублей; неизменность access gate/полного реестра; отдельные NOT_RUN; HTML/Markdown; чужие project/target/package/model/scope/build; UNKNOWN head; non-array/nonempty defects; fabricated runtime PASS; tamper; missing/extra receipts; duplicate JSON keys; traversal/hardlink; порча COMMITTED receipts/пакета/scope.

Первый прогон: 26/27 PASS; единственный FAIL был проверкой буквального underscore в Markdown, который корректно экранируется reporter. Исправлен assertion, код вывода не ослаблен. Следующий combined run: 60/60 PASS, 0 SKIP, 20.411 s (`target-evidence`, `operator-report`, `reporter-access`). После дополнительной проверки original crawl SHA/capture binding выполнен `npm run check`: PASS.

Итоговый повтор после заморозки кода: **71/71 PASS, 0 SKIP, exit 0, 44.492 s**:

```text
node --disable-warning=ExperimentalWarning --test tests/integration/target-evidence.test.ts tests/integration/operator-report.test.ts tests/integration/reporter-access.test.ts tests/e2e/operator-model.test.ts
npm run check
```

`npm run check`: PASS, exit 0. В 71 проверку входят 27 новых тестов/subtests, 33 прежних report/access теста и 11 прежних E2E operator model/build, в том числе восстановление в другой каталог и multipage selection. Полный suite и live ingest настоящего receipt выполняются root отдельно. Реальный native Bitrix import в тестах исполнителя: **NOT_RUN**.

```json
[
  {"id":"target-evidence-local-cli","status":"PASS","details":"Actual offline CLI/Store attach/restart/replay, PENDING publication reconciliation, immutable byte pins and report checks; 71/71 combined tests, zero skips."},
  {"id":"target-evidence-types","status":"PASS","details":"npm run check, exit 0."},
  {"id":"target-evidence-native-cms","status":"NOT_RUN","details":"Native target response is an explicit test double. No Docker, Bitrix SQL, target HTTP, admin or recovery execution by this author."}
]
```

Frozen code SHA-256:

- `packages/core/target-evidence.ts`: `eaee93a1f94d99b995838bbbeb89c6b5d131b6f65d5070e5dd83f026dc040c42`.
- `packages/reporter/index.ts`: `56eafaa0864123044e76922b41537b005ea734f91bf89591f085c96caf8096da`.
- `packages/cli/index.ts`: `05e3dae485d8a44c32facc45b131aded6402849d725fd564c68f53f7f01f639f`.
- `tests/integration/target-evidence.test.ts`: `6b8a6553b53dea8b50012f1c617ba8eda0afa3f498be99b48e5857f1fefa2abd`.

Следующий шаг: независимый review frozen файлов, затем root создаёт bundle из actual pinned native receipts, принимает его явной CLI-командой и отдельно продолжает остальные проверки назначения.

## V2 — исправление независимого REJECT

V1 author artifact `art-5edc5205-ad25-4649-83f9-4e566755f188`; independent REJECT artifact `art-02a46042-6d22-4706-bc5d-157989e9ce5a`. Задача возвращена исполнителю как attempt 2/fence 2. Разрешённое расширение scope: `packages/core/index.ts`, только optional guard публикации, amendment `art-e48b51bb-a3b1-4528-b268-df345e7e16f7`; актуальный input hash `dcb51ed1b299560bc833a56ebb1d26a4fa5a6f1fb38aab3521c955e7e36a04fb2`.

Независимый reviewer воспроизвёл три ошибки V1, несмотря на прежние 71/71 author tests и сообщённые root 407/407 + 25/25 полного локального прогона:

1. После сохранения immutable файла прежний владелец мог перезаписать receipt уже нового владельца, прежде чем следующий check lease обнаруживал потерю ownership.
2. Повреждённые bytes принятого capture не перечитывались при ingest: запись принималась, а reporter затем признавал её INVALID.
3. Поиск записи по `body.id` вместо авторитетного Store key позволял обойти повреждённый ID и заново записать receipt.

Все три регрессии сохранены также в постоянном `tests/integration/target-evidence.test.ts`. Независимый файл `var/evidence/target-evidence-review-20260930/independent.test.ts` не изменялся.

V2 использует `Store.get(kind, deterministicId)` и отвергает несовпадающий body ID. Любая запись receipt/event находится в транзакции с ownership check до и после мутации. Перед возвратом replay проверяется ownership. Необязательный шестой аргумент `Store.publishArtifact(..., publicationGuard)` проверяется перед записью файла и внутри существующей artifact metadata transaction до и после put/event. Потеря lease между file write и metadata transaction оставляет максимум непринятый orphan на диске; stale metadata не публикуется. Прежние вызовы Store без guard сохраняют API.

Перед публикацией проверяются все immutable payloads принятого capture: точная связь manifest/result/file map, file type, hash, size, cap и состав файлов. Один индекс artifact metadata строится на весь capture; последовательное чтение ограниченных файлов отдаёт управление через `setImmediate` и проверяет ownership между файлами. Тест с 64 media-файлами подтверждает ограниченное число metadata scans и yield для каждого файла. Отдельный takeover во время source validation прекращает работу до создания intent. Это локальная проверка алгоритма; фактический большой серверный ingest 2823 файлов здесь не выполнялся.

Итоговая команда V2:

```text
node --disable-warning=ExperimentalWarning --test tests/integration/target-evidence.test.ts var/evidence/target-evidence-review-20260930/independent.test.ts tests/integration/operator-report.test.ts tests/integration/reporter-access.test.ts tests/e2e/operator-model.test.ts
npm run check
```

Результат: **80/80 PASS, 0 SKIP, exit 0, 45.414 s**. Включены 33 author tests/subtests, три неизменённых независимых regression tests, 33 прежних report/access и 11 прежних E2E model/build. `npm run check` PASS, exit 0. Native CMS/SQL/network/HTTP: **NOT_RUN** исполнителем. Независимая приёмка V2 ещё требуется.

Frozen SHA-256 V2:

- `packages/core/target-evidence.ts`: `d4f77e0960787dbe201e7be59d23cc0441932d4a80e6ad39c8cce915a1dca280`.
- `packages/core/index.ts`: `fd87c117104267d3aaa8a67baef965be5c06b3f40df343eb83f21a29bbcf86c0`.
- `packages/reporter/index.ts`: `56eafaa0864123044e76922b41537b005ea734f91bf89591f085c96caf8096da` — без изменений после V1.
- `packages/cli/index.ts`: `05e3dae485d8a44c32facc45b131aded6402849d725fd564c68f53f7f01f639f` — без изменений после V1.
- `tests/integration/target-evidence.test.ts`: `2825e24979c7ccfff1ca7fdd2d9b4dde1b7983f9b9069f7d4385f523abbcc8d5`.
