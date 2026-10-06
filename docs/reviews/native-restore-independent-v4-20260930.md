# Независимый review native restore V4 — 30 сентября 2026

**Verdict: ACCEPT в пределах локальной проверки V4 и разрешения на отдельный контролируемый native запуск. Новых блокирующих замечаний в проверенной ревизии не найдено.** Этот отчёт не подтверждает фактическое восстановление Docker/MySQL/Битрикс, готовность демо или production recovery. Сервер, Docker daemon, сеть, БД и Store reviewer не использовал.

Задача `native-restore-review-v4-20260930`, input `art-e06bc435-0015-4734-b632-ca24c7ce4050`. Области записи: только этот отчёт и `var/evidence/native-restore-review-v4-20260930/`; временные локальные fixtures. Source/test/author doc не изменялись. Reviewer автор исторического V1 skeleton; текущие V2–V4 parser/ownership/configuration/runtime исправления выполнены другим исполнителем. Этот review самостоятельно проверяет именно frozen V4; окончательное принятие и native execution выполняет root.

## Frozen inputs

| Файл | SHA256 |
| --- | --- |
| `scripts/recovery-target.py` | `4a9370663ca3112a30feb1702a18e6b53889f223415db98a84cfe768101947fd` |
| `tests/integration/recovery-target.test.ts` | `669b2bc085750ccf19b9e451d4b535f162db3984dfa280b0e0e617088cc30a57` |
| `docs/reviews/native-restore-runner-20260930.md` | `85664b2ae2fb475406cd38dcc41cd1aabbb292a86ba21fdcb62d1a9e6f455c84` |
| Локально сохранённый actual source Compose | `feca7f0b43284e5eae8f88bd63c563eb11cf83b39e2a06cd024054a5afa593ba` |

Pins сверены до и после тестов. Actual source Compose из `var/evidence/continuation-20260930/restore-input/source-compose.json` действительно содержит `services.db.networks.isolated=null`. Исходные bytes остались неизменными. Совместимость этой формы проверена с **синтетическими** полными Docker IDs; actual свежий серверный baseline и его доверие reviewer не устанавливал.

## Проверка исправления

`validate_source_database` принимает ровно пять полей: `container_id`, `image_id`, `network_id`, `network_name`, `ip_address`. Полные lowercase ID, namespace `sha256:` для image ID, ожидаемое имя сети и canonical private IPv4 проверяются явно через exceptions, без зависимости от Python assertions. Missing/extra/short/foreign values отвергаются.

`compose_plan` использует только переданный pinned baseline. Значения `.2` или иных свободных адресов не выбираются. `isolated:null` допустим; явный `ipv4_address` в Compose обязан совпадать с baseline. Проверяются source subnet и занятые/специальные адреса. Baseline целиком включён в plan и projection; изменение любого участвующего значения меняет принимаемый plan hash. Bare image ID сравнивается непосредственно; repository digest разрешается через Docker image inspect, а не превращается в image ID заменой строки.

В actual `Executor.execute` порядок следующий: принятый plan → read-only проверки ресурсов/диска → `source_inspect` → `docker image inspect` → `attest_source_db` → `claim_destination`. Attestation требует совпадения всех пяти полей, единственной ожидаемой сети и соответствия resolved image ID. Пять отдельных drift, смена resolved image, добавление второй сети и остановленный source container проверены собственным независимым harness: отказ произошёл **до claim**, новый каталог, intent, events и result не появились. Положительный control с точной привязкой достиг claim только после read-only inspection; тестовый spy остановил его до создания каталога.

Это проверка порядка настоящего Python метода с подставленными readonly Docker observations; Docker команды и SQL не выполнялись. Штатный parent-level OS lock в `main` является отдельным механизмом сериализации и может быть создан до этих проверок; он не является клонированной БД, содержимым назначения или разрешением принять существующий partial destination.

## Сохранённые границы V2/V3

- Строгая инертная PHP literal grammar осталась. Старые concat/comment/require, переменные, duplicate keys, сторонний host/DB и trailing code отвергаются; PHP для чтения настроек не запускается.
- Меняется только parsed literal `connections.value.default.host` внутри **новой** копии с exact pinned source IP на `'db'`. Синтетические Unicode/CRLF/comments и такое же значение внутри другого поля/пароля сохранены побайтово. Already-`db` bytes не меняются.
- Полная пятикомпонентная attestation повторно проверяется перед derivation. До её записи сверяются original settings SHA/length с ledger, policy в accepted plan и ownership destination. Оригинальный archive и file readback ledger остаются неизменными; отдельный derivation receipt сообщает изменение, без тела настроек/пароля.
- Старые проверки archive traversal/link/device/sparse/duplicate/размера, ограниченного Compose, новых volume/network/target, подмены intent/events и гонки разных clone-project владельцев проходят. Existing/failed/derived destination не принимается для повторного импорта. Unknown command outcome не становится PASS или автоматическим replay.
- Изоляция по accepted guard предшествует запуску clone DB и PHP. SQL идёт только через stdin в аттестованный clone DB; success зависит от readback, runtime probe, auth/noindex/HTTP, прежних orders/events и final checks. Фактическое выполнение этих команд этим review не доказано.

## Фактические команды и результаты

```text
node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts
  PASS: 1/1 Node wrapper, 41/41 actual Python tests, 0 SKIP.
  Python 2.309 s; Node total 2.584 s (локальный Windows runtime).

node var/evidence/native-restore-review-v4-20260930/run-review.mjs
  Exit 0. Проверяет frozen pins, запускает оба локальных Linux harness,
  сохраняет stdout/stderr и execution-results.json, повторно сверяет pins.
  Author harness: 41/41 PASS, 0 SKIP, actual WSL Ubuntu root, Python 0.259 s.
  Independent harness: 7/7 PASS, 0 SKIP, actual WSL Ubuntu root, Python 0.042 s.
```

Driver использует `wsl.exe -d Ubuntu --user root -- python3 -I -B`; полные аргументы и elapsed wall time находятся в `execution-results.json`. Запуск Linux дистрибутива включён в wall time, отдельно от времени unittest. Нет сетевых вызовов, firewall, реального Docker или CMS bootstrap. Без доступного настоящего Python тесты не помечаются PASS.

Независимые 7 групп покрывают: actual dynamic Compose without mutation; positive preclaim ordering; отдельный drift каждого из пяти полей; resolved repository image drift; extra network/stopped source; отказ угадывать/принимать conflicting IP; старые parser witnesses и точечную clone-only derivation. Для каждого preflight case внешний executor command заменён fail-closed моделью только семи ожидаемых readonly операций; любая попытка мутации/непредусмотренной команды провалила бы тест. Временный каталог проверен после вызова: только подготовленные инертные SQL/archive fixtures, без назначения.

Raw proof сохранён в разрешённой evidence directory:

- `author-harness.py` — точная извлечённая копия frozen checked-in Python suite;
- `independent.py` — новые независимые негативные случаи;
- `run-review.mjs`, `execution-results.json` — повторяемый driver/команды/pins;
- `author-harness.py.stderr.txt` SHA `cbec0f01d6f923e2a38ed3a29eb4d5bd980a949c4ede1ca01d235a34c44277ea`;
- `independent.py.stderr.txt` SHA `ae0b968938bbcd15f1a3a9afd22d994d91ab655d29dbf4f7cc866100a9346ef8`.

Оба stdout пусты. Raw proof не содержит actual credentials/settings. Immutable outputs создаются `wx`: повтор driver поверх тех же evidence filenames намеренно запрещён.

## Решение и следующий шаг

```json
[
  {"id":"restore-v4-frozen-inputs","status":"PASS","details":"Code/test/author-doc exact pins confirmed before and after independent execution."},
  {"id":"restore-v4-dynamic-compose-plan","status":"PASS","details":"Actual locally saved db.isolated=null supported without modifying source bytes; synthetic runtime IDs only."},
  {"id":"restore-v4-drift-before-claim","status":"PASS","details":"Five identity fields, resolved image drift, extra network and stopped source reject before destination claim in actual Executor.execute with readonly Docker observations modeled."},
  {"id":"restore-v4-regressions","status":"PASS","details":"41 existing tests repeated on Windows and Linux; 7 independent Linux tests. Parser/token-only clone settings/ledger/ownership/noadopt remain enforced."},
  {"id":"restore-v4-native-docker-sql-http","status":"NOT_RUN","details":"Reviewer has not executed Docker/firewall/SQL/HTTP or read actual server credentials/baseline."},
  {"id":"restore-v4-production-recovery","status":"NOT_RUN","details":"No source switchover, deletion, adoption of failed copy or later private session recovery."}
]
```

Root может продолжить **новый pinned plan** с фактически собранным source_database baseline и новым отсутствующим destination после собственной фиксации acceptance. V3 `SOURCE_FIXED_DB_IP_REQUIRED` остаётся failed plan, V2 failed copy сохраняется; ни один не превращён в успешное восстановление. Legitimate runtime drift требует нового baseline/plan, не автоматической подмены pin. Только фактический успешный native result/readback/HTTP может подтвердить ограниченное восстановление отдельной копии; совместимость всех данных/vendor runtime заранее не гарантируется локальными тестами.
