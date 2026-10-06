# Независимая проверка изолированного restore — 30.09.2026

Задача `native-restore-review-20260930`, owner `demo-engine`, fence 1, вход `art-64122ede-f9e7-4324-8a2e-d6a08bd487a0`. Область записи — только этот документ, тестовые файлы только в OS temp. Исходники исполнителя, Store, сервер и реальные БД рецензент не изменял. Реальный Docker/MySQL/Bitrix restore **NOT_RUN**.

## V1 — REJECT

Офлайн-контрактный набор проходит, но обнаружены два воспроизводимых дефекта: ложная приёмка динамических PHP settings и запись журнала в destination, созданный другим исполнителем. До исправления запуск v1 не принят.

Независимо сверенные входы:

| Файл | SHA-256 |
| --- | --- |
| `scripts/recovery-target.py` | `821dd261da42513a7bc3b3b2902dafc615ae4e0719c76cd824859d902a48d181` |
| `tests/integration/recovery-target.test.ts` | `4caeb344a2a0842ab83f0528edd944c56d95eadbeee86682740a16edaeb08163` |
| `docs/reviews/native-restore-runner-20260930.md` | `9bdd7037220b9ca577c08c0958b6af7641bf4fc981c0e640ff32e3b01df1f8c3` |

### R1 — P2: settings-проверка не подтверждает буквальную конфигурацию

`verify_settings()` извлекает пары host/database регулярными выражениями из всего PHP-текста. Следующие два файла независимо поданы настоящей неизменённой функции во временном каталоге, оба **ACCEPTED**:

```php
<?php return ['host'=>'db'.'.foreign','database'=>'upgrade'];
```

```php
<?php /* 'host'=>'db','database'=>'upgrade' */ return require '/unrelated/private/config.php';
```

В первом действительное значение host является выражением, во втором найденные пары существуют только в комментарии. Обещанный отказ для dynamic/ambiguous settings не обеспечен. PHP-код источника при воспроизведении не исполнялся; это проверка инертных байтов. Доказательство не утверждает, что реальная текущая резервная копия содержит такие settings, или что firewall уже пропускает чужую БД.

Требуется ограниченный инертный tokenizer/parser поддерживаемой документированной формы return-array: комментарии должны обрабатываться как комментарии; выражения, include/require, вызовы, переменные, неоднозначные/повторные ключи и дополнительные инструкции отвергаться. Нужно проверять путь фактического default connection и его literal host/database, не любые совпавшие пары в другом разделе. Не исполнять settings для получения массива. Реальные стандартные settings должны остаться поддержаны отдельной fixture-проверкой.

### R2 — P2: preflight-журнал может попасть в чужую частичную копию

`Executor.record()` пишет в `events.jsonl`, когда `self.root.exists()`, без проверки `self.created` или своего immutable intent. Между начальным absence-check в `execute()` и `mkdir()` другой исполнитель с отличающимся clone_project может создать тот же destination. Project flock у них разный. Первый ожидаемо отказавший процесс успевает изменить чужой журнал до отказа.

Независимый прямой свидетель: Executor с `created=False` и временным существующим каталогом с `OTHER_OWNER_INTENT` создал там `events.jsonl`. Затем проверен полный путь **настоящего `Executor.execute`** в локальном WSL Python под root, без сервера: только ответы Docker subprocess и свободное место заменены ограниченными заглушками. Во время fake `docker info`, после первоначального absence-check, другой исполнитель создал destination и `intent.json=OTHER_EXECUTOR_INTENT`. Volume/network inspect возвращали отсутствие; source inspection был задан локальным словарём. Результат:

```json
{
  "actual_execute_outcome": "FileExistsError",
  "this_executor_created": false,
  "foreign_intent": "OTHER_EXECUTOR_INTENT",
  "foreign_log_created": true,
  "foreign_log_events": 7,
  "commands": "stub only; no Docker/server"
}
```

Все файлы были внутри собственного `/tmp/upgrade-recovery-race-review-*` и удалены после проверки. Первый диагностический запуск от штатного WSL uid 1000 не достиг этого сценария: root-предусловие исполнителя сработало; попытка harness прочитать ещё не созданный intent дала FileNotFoundError. Этот запуск не засчитывается как PASS. Повтор локальным WSL root воспроизвёл описанный race. Производственные команды или реальные контейнеры не вызывались.

Требуется держать preflight-события в памяти до собственного эксклюзивного создания destination и сохранения принятого intent. Перед каждым persisted event/result проверять собственное владение и binding intent; не перенимать каталог по одному факту существования. При необходимости блокировать по canonical destination дополнительно к project. Отказ чужого/racing процесса не должен добавлять ни events, ни failure result в чужую копию.

## Фактически выполненные проверки v1

```text
node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts
```

Результат: **Node wrapper 1/1 PASS, 0 SKIP; настоящий Python unittest 21/21 PASS**, Python 0,578 с, wrapper 0,803 с. Использован bundled Python `C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`. Внутренние fixture-тесты выполняли настоящие tar/gzip, файловый readback, хеширование, stdin и timeout; Docker inspections в них синтетические. Они не проверяли два найденных сценария.

Дополнительные независимые команды — Python stdin harness с `-B`, импорт замороженного runner через `importlib`, собственные OS temp; для execute race — `wsl --user root --exec python3 -B -`. Вызовы Docker были целиком заменены внутри процесса, shell/SSH/network для runner не выполнялись. R1 и R2 воспроизведены, не помечены успешными тестами реализации.

## Подтверждённые чтением и офлайн-тестами границы

- План связывает принятые внешние SHA receipt/SQL/archive/compose/baseline/guard/config/executor и новые destination/project/target/network. Execute требует точный SHA детерминированного плана, повторно хеширует скопированные SQL/archive/config. Собственные конфиги и изображения закреплены; пароль не попадает в argv/plan. Секреты читаются отдельно из приватных файлов, их неизменность должен обеспечить root.
- Source tree не монтируется в clone. Compose собирается через allowlist: новый named DB volume, новая внутреняя сеть, новые bind paths, pinned images, без опубликованного порта, restart no и DNS loopback. Непредусмотренные source overlays, socket, ports, privilege, host networking и entrypoint отвергаются либо не копируются в новый профиль.
- Архив предварительно сканируется и извлекается вручную: запрет traversal, symlink/hardlink/special/sparse, дубликатов, file-parent conflict и overwrite; конечные limits. Извлечённые bytes перечитываются и сравниваются с хешами потока, ledger fsync. Это восстановление файлов с документированными изменениями UID/mode, не точное восстановление исторических владельцев и не доказательство power-loss recovery.
- Guard apply/check находится до запуска DB и PHP. DB attestation предшествует SQL. Перед CMS предусмотрены host-positive source DB и clone-negative source DB, положительный собственный DB, проверка prepend/hash/disabled functions и DNS outcome. Guard должен иметь отдельный принятый SHA; G1 из другой задачи не закрывается самим runner.
- SQL поступает через stdin только в новую attested DB, mysql defaults лежит в отдельном приватном файле. Это исполнитель доверенного pinned mysqldump, не анализатор произвольного SQL. Нативные readback queries фиксированы и допускают только ограниченные имена таблиц/числовой ID.
- HTTP обращается к фиксированному IP clone, сохраняет trusted Host и exact request target, не следует redirect. Требуются unauthenticated 401, factual 200, negative 404, protected-path 404, privacy headers; затем повторные DB counts и сравнение source runtime metadata. Такое сравнение покрывает прочитанные IDs/images/mounts/networks, не доказывает отсутствие любых конкурентных изменений source DB/files третьими лицами.
- Timeout помечается UNKNOWN; состояние/partial destination сохраняются. Нет автоматического удаления, остановки source, повторного SQL import или adoption частичной копии. Ошибки не печатают сырые subprocess stderr/stdout, пароли и исходный HTML. Недостаток владения журналом R2 остаётся исключением, которое нужно исправить.

## Следующий шаг и предел результата

Root передал оба findings автору попытки 2 с раздельной областью записи. После новой заморозки требуется закрепить новые входы и повторить два свидетеля плюс положительные literal settings/ownership-path. История REJECT v1 должна сохраниться. До настоящего server execution всё ниже остаётся **NOT_RUN**: MySQL import, реальное файловое восстановление этой CMS, native bootstrap, FPM/NGINX, HTTP clone, живые firewall-пробы, полное data-equivalence и production disaster recovery.

Backup r12 описывает SQL и CMS-файлы. Private Upgrade state/packages/sessions и последующие r13 изменения автоматически из него не восстанавливаются. Даже успешное восстановление r12 нельзя называть восстановлением более поздних сессий или DEMO_READY.

## V2 — ACCEPT в локальной компонентной области

Повторная сохранённая задача `native-restore-review-v2-20260930`, owner `demo-engine`, fence 1, вход `art-cd23a31e-1bf9-4852-a1ce-f2f1f8eb58d5`. Проверка выполнена 2026-09-30 в 05:15–05:18 UTC. Предыдущий REJECT v1 не переименован в PASS и относится к прежнему коду.

Независимо сверены:

| Файл | SHA-256 v2 |
| --- | --- |
| `scripts/recovery-target.py` | `c33a8f4777e2c623cc843bbc5b77e6b08863bc3b4ae1dbf201b01aae7d3112e1` |
| `tests/integration/recovery-target.test.ts` | `0b839c800bef0f36888857582edf7531994848d9f76a134b2b6748bc2d3fab49` |
| `docs/reviews/native-restore-runner-20260930.md` | `7e303b6e516efa94e605bfed35b0e22136aac27f64c916cc7ab11c4e2d0419d8` |

### Команды и фактические результаты

```text
node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts
```

**Node wrapper 1/1 PASS, 0 SKIP; настоящий Python unittest 30/30 PASS.** Python 2,021 с, общий Node 3,430 с. Повторены исходные 21 области, добавлены literal grammar, вложенная DB binding, racing claim, сохранность чужих событий/результатов, замена intent/log и корректное сохранение собственных preflight-событий. Реальные файловые операции/потоки/дочерние процессы локальны; контейнерные fixtures не считаются настоящей проверкой Docker.

Отдельная независимая матрица через bundled Python `-B -` и настоящий `verify_settings`: **10/10 соответствий ожиданию**. Оба точных свидетеля R1 повторены; также отвергнуты вложенная конкатенация host, вызов getenv для database, дубли host в обоих порядках, дополнительный echo после return и дополнительный connection. Две положительные формы — bracket array и `array(...)` с inert comment, обычным className и literal flags — приняты. Все input bytes после проверки остались неизменными. Ни один PHP-фрагмент не исполнялся.

Повтор полного R2-свидетеля: `wsl --user root --exec python3 -B -`, отдельный `/tmp/upgrade-recovery-race-review-v2-*`, настоящий `Executor.execute`, только Docker subprocess/disk/source-inspection ответы замещены локальными данными, как в v1. В момент fake docker info другой исполнитель создал destination с `OTHER_EXECUTOR_INTENT` и `FOREIGN_EVENT`. Теперь результат:

```json
{
  "actual_execute_outcome": "NEW_RECOVERY_DESTINATION_REQUIRED",
  "this_executor_created": false,
  "foreign_intent_and_events_unchanged": true,
  "foreign_result_absent": true,
  "preflight_events_memory_only": 8,
  "commands": "stub only; no Docker/server"
}
```

Дополнительно вызван `write_result` проигравшего исполнителя: ожидаемый `RECOVERY_DESTINATION_NOT_OWNED`, файл результата не появился. Это воспроизводит прежний дефект через весь execute preflight, не только напрямую через record. Реальные серверные процессы, firewall, MySQL или контейнеры не запускались.

### Закрытие замечаний

**R1 закрыт для поддерживаемой literal grammar.** Новый `LiteralPhpSettings` разбирает единственный `return` литерального массива, ограничивает глубину/количество элементов и отвергает переменные, интерполяцию, вызовы, конкатенацию, spread, дубли ключей и последующий PHP/output. Комментарии больше не являются источником DB-пар. `verify_settings` проверяет именно `connections.value.default`, единственный connection, literal host=`db` и database=`upgrade`. Неизвестные/динамические штатные варианты не угадываются и требуют отдельной поддержки; парсер не исполняет CMS для нормализации конфигурации.

**R2 закрыт.** `record` до владения сохраняет события только в памяти. `claim_destination` использует исключительное mkdir и собственный случайный nonce в immutable intent, фиксирует inode/device каталога. Перед persisted events/result проверяются канонический собственный каталог, идентичность и точные bytes intent. Журнал создаётся эксклюзивно; после создания контролируется его inode/device, тип файла и single link. Проигравшая гонка не перенимает destination. Успешный результат теперь записывается внутри project flock; failure result также проходит ownership gate. Негативные тесты подтверждают отсутствие записи после подмены intent/event и возможность обычного сохранения только владельцем.

### Итог и следующий шаг

**ACCEPT v2 означает приёмку кода и перечисленных локальных контрактов, не успешное восстановление CMS.** Новых блокирующих дефектов в исправленной области не найдено. Root может отдельно сформировать, сохранить и принять план на фактических pinned backup/SQL/compose/baseline/config и отдельно принятом guard, затем выполнить его в новом изолированном назначении. Сам этот рецензент execute против Docker/сервера не вызывал.

Все native-границы выше остаются NOT_RUN до настоящих receipts: импорт и readback БД, реальное содержимое восстановленной CMS, FPM/Nginx/HTTP, живые network positive/negative controls, source-preservation evidence. Принятый runner не снимает эти проверки, не выполняет production switchover, не доказывает поздние r13 private state/sessions и не устанавливает DEMO_READY.
