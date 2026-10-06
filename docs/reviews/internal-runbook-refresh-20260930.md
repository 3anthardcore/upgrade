# Обновление внутреннего runbook — 30.09.2026

Задача `internal-runbook-refresh-20260930`, owner `demo-engine`, fence1, вход `art-3ca1a527-a863-4c69-8ca3-84d056f72033`. Область записи: только `README.md`, `docs/compatibility.md`, `docs/runbooks/internal-demo.md` и этот отчёт. Это отчёт автора документации; независимая приёмка выполняется root. Сервер, target, Store, исходный код, PROGRESS, матрица требований и Git history не изменялись.

## Изменения

- README теперь различает рабочий CLI/пакетирование, исторически проверенный native CMS r12 / 103 страницы, app r15 и новый stage389 с установленным own code / успешным dry-run / RUNNING apply. Удалены устаревшие утверждения об отсутствующих установке, лицензии/пилотном URL и нереализованном собственном demo engine.
- Совместимость разделяет runtime/dependencies, локальные PHP/Chromium проверки, реальные ограниченные Bitrix результаты и дальнейшие native gates. Указаны реальные версии модулей из входа root и ограничение local license flags: remote activation NOT_RUN.
- Новый runbook описывает существующие команды и операторские этапы: HTTP/source gate; portable operator capture; model/build; собственный код/migration; отдельный privileged journal и native validate/dry-run/apply/reconcile; private snapshot/HTTP activation; receipts/report; раздельные Upgrade-state и SQL/CMS restore. Указаны кто пишет, путь состояния, принимаемые pins, результаты стадий и действия при неизвестном исходе.
- Явно обозначены текущие ограничения: generic `run`/`doctor` не завершают native цикл, pilot packer зависит от teplypol legacy seed, дизайн не вызывается автоматически для каждого operator build, verifier scripts содержат пилотные предпосылки, immutable пакет не патчат, source denominator не заменяется selected scope. Код без native исполнения не получает native PASS.
- Итоговый срез обновлён по дополнительным фактам root на **06:50 UTC**: 948 DOM / 2742 известных URL / 389 выбранных / 559 отложенных / 299 недостающих PDF / full UNKNOWN. Apply ещё RUNNING. V5 restore имеет общий FAILED после успешных промежуточных SQL/files/counts/isolation/HTTP проверок: comparator отверг только порядок Docker Mounts; отдельная canonical identity/guard сверка PASS не подменяет исходный FAIL. V6 local44PythonPASS, новый native план ожидается. Target-evidence V2 принят root после38checks с тремя прежними независимыми воспроизведениями, но новая версия приложения ещё не развёрнута. История V1 REJECT сохранена.

## Использованные доказательства

Прочитаны актуальные CLI help/branches, `packages/bitrix-adapter/native.ts`, package code-copy path, pilot packer positional flags и legacy seed, own migration/deploy helper, DemoRuntime/pointer и собственный router, аргументы HTTP verifiers, recovery report. Их источники имеют ссылки в runbook.

Исторические native утверждения ограничены `docs/reviews/catalog-target-r12.md` и `docs/reviews/admin-completion.md`. Текущая стадия сверена с `docs/pilots/completion-20260930.md`, входом root и `docs/reviews/target-evidence-independent-20260930.md` (история V1 REJECT). Версии CMS/license и обновление06:50 переданы root как фактические наблюдения; в этой задаче автор не обращался к серверу и самостоятельно их заново не измерял.

В дополнении06:50 root сообщил actual native DemoTransport probe uid33/exit0, neutral D7 query/post/cookie0/methodGET/own URI и сохранённый own request. Users1/orders0/event0 — один snapshot, не доказательство отсутствия всех записей. Первая попытка probe остановилась до bootstrap из-за ошибочно переписанного pin; V2 взял pin из baseline и прошёл. Runbook поэтому требует брать pins из принятых bytes/receipts и не публикует вручную набранный prepend pin. Native HTTP/browser сценарии не объявлены выполненными.

Общий suite не повторялся для изменения Markdown. Независимо прочитаны завершения двух уже выполненных root журналов:

| Журнал | Фактический итог | SHA-256 |
| --- | --- | --- |
| `var/evidence/continuation-20260930/full-test-v5.log` | 407 tests / 407 PASS / 0 FAIL / 0 SKIP | `5e46c96f76fdf1efeb576a3f184ff2e05967eccc8ddc47ed4cafbe2fdbbb57104` |
| `var/evidence/continuation-20260930/e2e-v6.log` | 25 tests / 25 PASS / 0 FAIL / 0 SKIP | `2394acf49ff1c26a8cfc59c7a2f5d753b53aae62cca281a54da69ceaa9760060` |

`npm run check` PASS — результат root из входа задачи. Он не запускался автором повторно и не заменяет независимую проверку target-evidence; его V2 приёмка зафиксирована отдельно дополнительным сообщением root. Общие тестовые числа привязаны к сохранённым логам, а не ко всем будущим изменениям рабочего дерева.

## Проверки документации

- `node --disable-warning=ExperimentalWarning packages/cli/index.ts help` — exit0, реальные названия `operator-capture`, `operator model/build --all-observed`, `target` и `target-evidence` совпали. Help выполняется до открытия Store; authoritative данные не затрагивались.
- Read-only Node `fs/path/assert` по трём пользовательским документам: **39 локальных Markdown-ссылок, 0 отсутствующих файлов**, balanced fenced blocks PASS. После добавления этого отчёта повторная проверка включает все четыре файла.
- `git diff --check -- README.md docs/compatibility.md docs/runbooks/internal-demo.md docs/reviews/internal-runbook-refresh-20260930.md` — PASS. Предупреждение Git о нормализации CRLF/LF не является провалом проверки.
- Статическое сопоставление: 15 полей NativeTargetProfile, migration path `code/migrations/install.php`, полные target flags, package path mapping и pointer pattern сверены с исполнителем; shell-примеры не исполнялись на target.

Первый вызов apply_patch с delete/add одного пути отвергнут инструментом до записи; после этого файлы записаны в разрешённой области. Первоначальные широкие read-only `rg` glob-запросы в PowerShell дали ошибку пути и были заменены чтением точных имён. Эти инструментальные ошибки не являются тестами приложения и не помечены PASS.

## Результат и следующий шаг

Документация готова к независимой приёмке. Она не создаёт нового разрешения на production, не принимает сама собственный результат и не присваивает DEMO_READY. Root сверяет этот diff с текущим состоянием и публикует новые native/evidence receipts отдельно; незакрытые PDF/scope/restore/HTTP/admin/license и другие критерии ТЗ остаются видимыми.

Frozen pins пользовательских документов:

| Файл | SHA-256 |
| --- | --- |
| `README.md` | `065dcf329215337e710718e878648f595b576b9b783a3dc71df1850628e96b16` |
| `docs/compatibility.md` | `29fcf8ccff7794eec79c98817227d46284e84a1a683aebc4e8a36015bd39a4b3` |
| `docs/runbooks/internal-demo.md` | `9979f61b0d2c6bae3eac07ba397493469405ff71f4d436b2a56a579cf15d155c` |

SHA данного отчёта передаётся отдельно при FREEZE; self-referential hash в его bytes не включается.
