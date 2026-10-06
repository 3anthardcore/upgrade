# Demo HTTP verifier — 30 сентября 2026

Результат: исполняемый Python stdlib verifier собственных синтетических HTTP-сценариев Upgrade. Локальная проверка настоящих `DemoEngine` + `DemoWeb` + `DemoView` через PHP 8.3 HTTP server — PASS; запуск на сервере и native Bitrix — **NOT_RUN автором**. Автор не принимает собственный результат: независимый review и целевой запуск выполняет root. Полнота исходника, рабочая коммерция, native orders/mail/payment counters и сетевая изоляция этим результатом не подтверждаются.

Область записи: `scripts/verify-demo-http.py`, `tests/integration/demo-http-runner.test.ts`, этот документ. Сервер, Store, БД, исходные снимки и vendor-код не изменялись. Входы: `docs/pilots/demo-http-contract.md` и фактические собственные PHP-классы. Данные HTML остаются данными: скрипты не выполняются, чужие формы вне `.demo-view` игнорируются, непредусмотренные формы внутри собственного блока прекращают проверку.

## Запуск после независимого review

Linux, Python 3.10+; только stdlib. Выходной каталог должен быть новым, его родитель должен существовать. Пример предназначен для оператора, автор его на целевом сервере не выполнял:

```sh
python3 -I -B scripts/verify-demo-http.py \
  --base-url 'https://upgrade.help-ai-ru.ru' \
  --trusted-host 'upgrade.help-ai-ru.ru' \
  --auth-user upgrade \
  --auth-password-file /opt/upgrade/private/bitrix/demo-access-password \
  --snapshot-id "$ACCEPTED_SNAPSHOT_ID" \
  --product-route '/termoregulyatory/grand-meyer-hw-500' \
  --output /opt/upgrade/verification/http-demo-20260930
```

`ACCEPTED_SNAPSHOT_ID` — принятый оператором pin снимка, ровно 64 lowercase hex. Проверка сравнивает его со всеми отправляемыми собственными формами; она не принимает предоставленный HTML за доказательство происхождения снимка. Файловый SHA и происхождение deployed snapshot сверяются отдельным target review.

`--base-url` допускает HTTPS origin с обычной проверкой TLS либо HTTP **только literal loopback IP**. Для HTTPS `--trusted-host` совпадает с authority базового URL. Нет insecure TLS, прокси из окружения, произвольных redirect, смены сайта по ссылкам, скачивания медиа или выполнения исходных action. Loopback используется локальным fixture; произвольный private IP по HTTP не разрешён. Для native рекомендуется публичный HTTPS endpoint, а не подмена доверенного TLS-маркера.

Варианты: `--search-query` (до 200 символов), `--variant-id` (точный ID наблюдаемой формы), `--quantity`, `--update-quantity`. Без variant override выбирается первая фактически представленная собственная форма варианта. Первое количество берётся из формы; отличное количество обновления вычисляется в пределах её min/max/step, либо задаётся явно. Невозможность отличного допустимого обновления — ошибка, не PASS и не основание выдумывать исходные условия.

## Реальные сценарии

| Проверка | Условие успеха |
| --- | --- |
| Auth | GET собственного поиска без Basic возвращает 401 с Basic challenge, redirect не выполняется |
| Search/sort | Собственная GET-форма; непустые результаты, сохранённый query/sort, фактический порядок заголовков первой страницы `title_asc`; случайный непопадающий query возвращает пустые результаты |
| Filter | Одна наблюдаемая category/attribute option принимается, сохраняется selected, результаты непусты; при отсутствии наблюдаемых facets честный `NOT_APPLICABLE` |
| Product/session | Только явно заданный точный product request target, включая порядок/повторы query; собственная add-форма с pin/CSRF; новый opaque cookie с Path=/, HttpOnly, SameSite=Strict и Secure при HTTPS |
| CSRF/Origin | Изменённый CSRF и чужой Origin дают 403; последующее чтение корзины подтверждает отсутствие строк |
| Add/replay | POST только `/__upgrade/action`; 303 Location равен own operation route с SHA256 фактического idempotency key; повтор exact body возвращает тот же operation, одну строку с прежними ID/количеством |
| Update/remove | Изменяется количество той же строки, затем корзина становится пустой |
| Synthetic checkout | Новое добавление и только `demo-customer`, `synthetic=1`, `consent=1`, `demo-pickup`, `demo-none`; собственный receipt, его reload и очистка корзины |
| Synthetic lead | Только фиксированный `general` topic и синтетическая identity/consent; собственный сохранённый receipt |
| Readback | Оба receipt остаются доступны после следующих запросов той же сессии |

Verifier не отправляет имя, email, телефон, свободный текст, цену или платёжные реквизиты. Их добавление в форму или сохранённый intent отвергается перед сетью. HTMLParser не отправляет `submit`/`formaction` исходных кнопок; фактический POST всегда строится из собственного строгого контракта. Vendor cookies, например PHPSESSID, игнорируются и никогда не сохраняются/не отправляются. Дубликаты **upgrade_demo_session** и ослабленные атрибуты этого cookie отвергаются.

Семантика фильтра ограничена HTTP-наблюдением: принятый параметр, selected option и непустые результаты. Без полного доверенного списка item attributes этот verifier не доказывает математическое равенство всего результата фильтра исходной модели. Unit/PHP engine tests проверяют вычисления отдельно. Сортируется видимая первая страница, не весь корпус. Receipt проверяет собственный маркер и точный текст синтетического сценария; реальное отсутствие native DB/mail/payment effects проверяется root отдельными счётчиками и изоляцией. Ручной Origin в HTTP-клиенте не заменяет actual browser native-form test.

## Ограничения и сохранение состояния

- Defaults: 15 секунд абсолютного ожидания одного запроса, 300 секунд суммарного активного времени, 80 запросов, 4 MiB response body; CLI caps: 30 секунд, 1200 секунд, 200 запросов, 8 MiB. Размер request body ≤8192, формы ≤32 controls, HTML ≤150000 tags/depth256, options ≤250 на select. HTTP headers/body bounded; медленный drip не продлевает абсолютный deadline. Окружение `HTTP_PROXY`/`HTTPS_PROXY` не используется.
- Все запросы учитываются **до** I/O. Счётчик запросов и прошедшее активное время сохраняются; `--resume` не обнуляет бюджет. Абсолютная задержка ограничивает также DNS/TLS/чтение: запрос выполняется в daemon worker с ограниченным join, после timeout процесс не начинает следующий запрос.
- Output directory `0700`, `checkpoint.json`, `receipt.json`, `.lock` — `0600` на POSIX; проверяются owner, отсутствие group/other permissions, symlinks/hardlinks для читаемых private файлов. Atomic replace + fsync, OS lock исключает второго исполнителя того же checkpoint. Windows тестирует поведение, но не доказывает POSIX-права; для этого выполнен отдельный WSL прогон.
- `checkpoint.json` **секретен**: хранит cookie, CSRF, точные idempotency keys и ожидающий intent. Пароль Basic в нём отсутствует и читается заново из private file. `receipt.json` редактирован: нет auth/cookie/CSRF/idempotency key, сырых response bodies или server exception. Сохраняются method, exact request target, HTTP status, byte count и body SHA256, а также check results. SHA operation в URL не равен открытому idempotency key.
- Конфигурация, snapshot, product route, лимиты и SHA256 самого verifier входят в binding. Изменившийся binary/config не может молча продолжить старый checkpoint. Новая версия требует отдельного принятого recovery/migration решения.
- После завершения повтор `--resume` только читает прежний результат и не отправляет запросы. Код выхода 0 означает `HTTP_SCENARIOS_VERIFIED`; 3 — `FAILED` или `UNKNOWN_WRITE`, никогда DEMO_READY.

Если процесс прерван либо ответ POST неизвестен, повторить **ту же** команду с `--resume` и прежним private output. До первого POST intent/operation target сохранены на диск. Новый процесс сначала GET точного operation: 200 — использует сохранённый receipt; 404 — повторяет **тот же** intent/key; иной ответ — останавливается. Повтор остаётся защищён серверной идемпотентностью даже при позднем завершении первого запроса. Никакого автоматического нового ключа, новой сессии, нового каталога или молчаливого обхода исчерпанного бюджета. Каталог/секреты после проверки автоматически не удаляются.

Стандартный fixture создаёт 6 уникальных собственных операций, 2 синтетические записи, 0 строк в конечной корзине; exact retry не является седьмой операцией. Обычный прогон отправляет около 29 HTTP requests, из них 9 POST. Native rate limiting/квоты могут остановить сценарий; verifier не отключает их и не ретраит бесконечно.

## Проверки автора

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path 'var/tools/php-8.3.35/php.exe').Path
$env:UPGRADE_PHP_EXT_DIR = (Resolve-Path 'var/tools/php-8.3.35/ext').Path
node --disable-warning=ExperimentalWarning --test tests/integration/demo-http-runner.test.ts
npm run check
git diff --check -- scripts/verify-demo-http.py tests/integration/demo-http-runner.test.ts docs/reviews/demo-http-runner-20260930.md
```

Последний прогон перед freeze: **6/6 Node tests PASS, 0 SKIP, 37.595 s**, включая **16 настоящих Python behavioral tests** и **5 actual PHP HTTP fixture tests** с заданным PHP binary. `npm run check` и scoped `git diff --check` — PASS. Проверены successful flow, post-commit response loss/reconcile-first, pre-commit response loss/404/exact retry, неизвестная сумма `null`, foreign action/неизменяемый snapshot binding. Сам fixture независимо читает собственные PHP state files и сверяет 6 операций/2 synthetic records/пустую корзину и флаги no-order/no-mail/no-payment — без native Bitrix или SQL. По уточнению root добавлен отдельный actual HTTP regression: vendor+own cookies, отправка только own cookie в следующий запрос, отказ duplicate own и malformed own, отсутствие vendor token в checkpoint/report.

Python policy harness дополнительно выполнен WSL Ubuntu root с `python3 -I -B` и временными файлами вне repo: реальные POSIX permissions/symlink refusal, flock, exhausted checkpoint budget, malformed forms, resume intent PII guards, redirects/cookies, oversize/incomplete body, absolute timeout при медленном HTTP drip. Предварительный WSL прогон нашёл ResourceWarning закрытия lock при повреждённом checkpoint; добавлено явное закрытие при ошибке constructor, затем выполнен повтор. Первый fixture draft имел ошибочное ожидание 7 операций; оно исправлено на 6, поскольку exact replay не создаёт запись. История не объявляется исходным PASS.

Финальный WSL результат: **16/16 PASS, 6.668 s, без ResourceWarning**, exit 0. Повторяемый harness встроен в test-файл; извлечённая копия и raw stdout/stderr находятся вне repo в `C:/Users/root/AppData/Local/Temp/upgrade-demo-http-proof-GByghB/` (`policy.py`, `linux.stdout.txt`, `linux.stderr.txt`). Команда:

```sh
wsl.exe -d Ubuntu --user root -- python3 -I -B \
  /mnt/c/Users/root/AppData/Local/Temp/upgrade-demo-http-proof-GByghB/policy.py \
  /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/verify-demo-http.py
```

Следующий шаг: независимый review root → закрепление SHA → исполнение на принятом private native demo → сохранение receipt/checkpoint вне Git и сравнение native счётчиков/изоляции до и после. Browser, исходная полнота, media, фактические маршруты вне выбранного продукта и disaster recovery остаются отдельными проверками.
