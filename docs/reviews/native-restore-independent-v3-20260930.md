# Независимый review restore V3 — 30.09.2026

**ACCEPT в ограниченной области локальных контрактов V3. Настоящее восстановление Docker/MySQL/Битрикс этим рецензентом — NOT_RUN.** Новых блокирующих дефектов в заявленном изменении не найдено. Root может отдельно принять свежий план и выполнить его в новом пустом назначении; результат этого выполнения требует собственных native receipts.

Задача `native-restore-review-v3-20260930`, reviewer `demo-engine`, fence 1, вход `art-61d3956d-2422-4d90-9d16-97169f5d86c8`. Проверка — offline чтение и реальные локальные Python/файловые операции. Сервер, Docker, целевая БД, firewall, Store и Git не изменялись. Область записи — этот документ и `var/evidence/native-restore-review-v3-20260930`.

Отдельная разрешённая коррекция прежнего registry report выполнена до review: ошибочный проверочный путь с датой `20260929-v7` не является доказательством отсутствия пакета; правильный путь — `var/pilots/teplypol-catalog-package-20260930-v7`. SHA исправленного `docs/reviews/capture-registry-inheritance-20260930.md`: `590b048cf4790804a7e22d227611c234f813458f17df26e9b29758bd2466cfe5`. Код registry и его тесты не менялись.

## Входы и сохранённая история

Все три SHA независимо сверены с фактическими файлами:

| Файл | SHA-256 |
| --- | --- |
| `scripts/recovery-target.py` | `1bf1c8f84ecbe7548b676b81b5fbec633e0ebeacd8d40f57b6b72fb15bdbac5e` |
| `tests/integration/recovery-target.test.ts` | `90e4557f8674345ee0ed326c690e31e83b940b1b712e1a90bb6a49709b070f16` |
| `docs/reviews/native-restore-runner-20260930.md` | `e0b614d8af74072fc46fe47c0650d0b9e6b489244c00d182cb2ba55d0974e97e` |

V1 имел REJECT из-за допуска динамических/комментарных settings и записи событий в чужой destination после гонки. V2 исправил эти локальные дефекты и получил ограниченную приёмку; история остаётся в `native-restore-independent-20260930.md`. Сообщённый root **настоящий V2 запуск FAILED на FILES_RESTORE**, до firewall/SQL: поддерживался только literal `db`, а фактические восстановленные settings содержали `172.30.50.2`. Это не переименовано в PASS. Старый неудачный destination остаётся отдельной непереиспользуемой копией.

## Проверенное изменение

`compose_plan` требует явный IPv4 исходного сервиса `db` в pinned Compose: адрес той же подсети, отличный от Nginx, gateway, network и broadcast. `source_inspect` требует три работающих контейнера с правильным Compose project и набором сервисов. Перед созданием clone destination исполнитель отдельно разрешает pinned DB image через `docker image inspect`; `attest_source_db` сверяет service `db`, container ID, image ID, единственную исходную сеть и точный статический адрес. Совпадение одного IP без этих привязок недостаточно. Эти вызовы прочитаны в настоящем execute path; Docker-ответы в локальных тестах являются fixtures, а не доказательством серверного состояния.

Свежий accepted plan содержит `configuration_derivation` с точным разрешённым исходным адресом и политикой `CLONE_ONLY_LITERAL_DB_HOST`. Его hash включает эту политику и изменившийся executor SHA. Прежний plan pin не разрешает новый код. Сохранились эксклюзивное создание нового destination, ownership intent/nonce/inode и запрет adoption после частичного выполнения.

После extraction собственный readback ledger ещё описывает **оригинальные backup bytes**. `derive_clone_settings` сначала сверяет ownership, политику плана, attested IP/network, SHA всего ledger и ровно одну запись `bitrix/.settings.php` с исходными размером/SHA. Строгий инертный PHP literal parser не исполняет PHP. Разрешены только единственный `connections.value.default`, database `upgrade` и host `db` либо точный attested source IP.

При статическом IP меняется только диапазон строкового токена `connections.value.default.host` на `'db'` в **новой clone-копии**. Комментарии, Unicode, CRLF, пароль и другие совпадения IP остаются точными исходными bytes. Если host уже `db`, bytes не меняются. Перед заменой сохраняется эксклюзивный fsync intent; перед atomic replace повторно проверяются ownership, inode и исходный SHA. После замены выполняются повторный parse, SHA derived settings и SHA неизменённого ledger. Receipt и intent приватны, содержат hashes/host/runtime attestation, а не body settings или пароль. Старый archive и ledger не переписываются; финальная формулировка scope явно отделяет первичный readback от разрешённой clone configuration derivation.

Guard apply/check по execute ordering остаётся до запуска clone DB, проверка guard и собственная prepend/isolation-проба — до первого CMS PHP. Копия использует новую сеть, named DB volume и новые mount paths. Положительный контроль доступности source DB выполняется с host, отрицательный — из clone PHP. SQL импорт, ограниченные counts/entity/HTTP проверки и отсутствие автоматического retry сохранены. Полнота backup за пределами перечисленных SQL/files не расширена этим исправлением.

## Фактические команды и результаты

```text
Get-FileHash scripts/recovery-target.py, tests/integration/recovery-target.test.ts, docs/reviews/native-restore-runner-20260930.md
node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts
```

Pins совпали. **36/36 настоящих Python unittest PASS, 0 SKIP; Node wrapper 1/1 PASS**, Python 1,063 с, Node 1,331 с. Сохранились исходные archive/path/hash/ownership/race/settings/timeout/SQL-stdin проверки; новые V3 группы покрывают source binding, token-only derivation, private receipts, preservation и no-adoption.

Независимый дополнительный harness сохранён в `var/evidence/native-restore-review-v3-20260930/independent_review.py`. Он импортирует frozen runner и только synthetic fixture helpers из теста; новые сценарии принадлежат reviewer. Никакой реальный settings/password-файл не читался и PHP не исполнялся.

```text
C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B var/evidence/native-restore-review-v3-20260930/independent_review.py C:/Users/root/Documents/ChatGPT/upgrade
wsl --exec python3 -B /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/native-restore-review-v3-20260930/independent_review.py /mnt/c/Users/root/Documents/ChatGPT/upgrade
```

**7/7 дополнительных групп PASS на Windows (1,248 с) и 7/7 PASS на Linux (0,041 с), 0 SKIP.** Raw outputs сохранены как `windows-independent.txt` и `linux-independent.txt`. Linux проверка использовала настоящие `/tmp` файлы, atomic replace, directory fsync и mode0600, без Docker/network/server команд.

- 7 отрицательных вариантов runtime attestation: IP без правильного service, ID, image или sole network не принят; отдельный положительный точный binding принят.
- 6 отрицательных Compose вариантов: gateway, Nginx, границы подсети, другая подсеть и отсутствующий static IP отвергнуты.
- 8 отрицательных settings-вариантов: оба точных V1 свидетеля, другой адрес той же сети, чужая database, duplicate host, concatenation, getenv и второй connection отвергнуты. PHP не исполнялся.
- Точное одиночное изменение host проверено на Unicode/CRLF/comments/password с тем же IP; три совпадения вне host сохранились. Повтор pure byte derivation уже `db` — no-op.
- Настоящие временные archive extraction и derivation сохранили archive, весь ledger и сторонний файл; receipt привязан к исходным SHA и не содержит synthetic password. Linux mode обоих receipt-файлов — 0600.
- Второй executor не принял уже созданную копию; byte inventory всей копии до/после попытки совпал. Изменённый ledger отвергнут до появления derivation intent и без изменения settings.
- Независимый UNKNOWN-сценарий: `os.replace` действительно меняет файл, затем имитируется потеря подтверждения исключением. Intent сохранён, успешного receipt нет, settings уже derived; повтор отвергается как `RESTORED_SETTINGS_READBACK_MISMATCH`. Archive и ledger остались неизменны. Успех не выдуман и автоматического продолжения нет.

## Вердикт и границы

**ACCEPT V3 — локальный код и перечисленные контракты.** Замечания к заявленной статической source DB совместимости закрыты поведением: чужой host не подменяется, доверие к IP привязано к источнику, только новая owned clone-копия меняется, исходные backup bytes/ledger сохраняются. Старый failed destination требует сохранения для расследования; этот runner не умеет его усыновлять, чистить или продолжать.

**NOT_RUN этим review:** настоящий Docker image/container binding, применение firewall, импорт MySQL, CMS bootstrap, восстановленный HTTP/FPM/Nginx, live positive/negative controls и source-preservation на сервере. Их выполнит root по новому pinned plan и свежему destination. Даже успешные smoke/counts не будут полным сравнением всех таблиц/файлов после PHP, production switchover, восстановлением поздней private Upgrade state/sessions или основанием DEMO_READY. Сохранённый backup определяет временной срез; новые изменения вне него не возникают при восстановлении.

Машиночитаемые фактические Check сохранены рядом в `checks.json`. Следующий шаг — root принимает свежий план и публикует реальные результат/events/readback/derivation receipts, включая любой FAIL/UNKNOWN без стирания предыдущей истории.
