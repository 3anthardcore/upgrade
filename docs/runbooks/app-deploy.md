# Размещение CLI Upgrade на Linux

Этот runbook размещает само приложение Upgrade. Он не устанавливает Битрикс, не меняет Nginx, работающие сайты или системный Node и не запускает публичный listener. Предварительно требуется проверить полномочия на выбранный хост и свободное место; разметка диска/LVM не изменяется скриптом.

## Состав и предпосылки

`scripts/package-app.ts` создаёт архив исходников с явным allowlist деревьев и SHA-256 каждого файла. В staging записываются те же однажды прочитанные байты, для которых вычислен хеш. Включаются инфраструктурные Python-скрипты, `Dockerfile`, `.gitattributes`, `.nvmrc` и `runtime-manifest.json`. Клиентское состояние `var/`, `.git`, `node_modules`, секреты, ключи, БД, дистрибутив Битрикс и бинарные архивы не включаются. Произвольные локальные файлы в корне не подхватываются. JSON receipt содержит release ID, source hash, объём и список файлов.

`scripts/deploy-app.sh` предназначен для Linux x86_64 и `/opt/upgrade`, требует root только для установки собственных каталогов/пользователя и переключения ссылки. До изменений проверяет не менее **5 000 000 000 свободных байт** на `/opt`. Нужны Bash, GNU coreutils/tar, curl, xz, timeout, flock, runuser/useradd/groupadd и HTTPS к официальным Node/npm endpoints. Отсутствующие системные пакеты автоматически не устанавливаются. Существующая учётная запись `upgrade` с другим home и чужой `/opt/upgrade` вызывают отказ.

Node.js **24.20.0** ставится в собственный runtime; глобальные `node`, `npm`, PATH других сервисов не меняются. Источник: [официальный архив Node.js](https://nodejs.org/en/download/archive/v24.20.0), [официальные SHA-256](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt). Проверенный Linux x64 `.tar.xz` checksum: `2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2`. Скрипт проверяет именно этот зафиксированный checksum перед распаковкой, не вычисляет новый доверенный хеш из скачанного файла.

| Путь                                           | Владелец и назначение                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/opt/upgrade/runtime/node-v24.20.0-linux-x64` | root:upgrade; приватный Node runtime                                                                    |
| `/opt/upgrade/releases/<release>`              | root:upgrade, read-only для исполнителя; код и lockfile dependencies                                    |
| `/opt/upgrade/current`                         | root; атомарная ссылка выбранного release                                                               |
| `/opt/upgrade/bin/upgrade`                     | root:upgrade; wrapper CLI, запрещает запуск приложения как root                                         |
| `/opt/upgrade/shared/projects`                 | upgrade, 0700; SQLite, source snapshots, artifacts                                                      |
| `/opt/upgrade/shared/home`, `codex`            | upgrade, 0700; отдельный home и Codex auth без копирования личных токенов                               |
| `/opt/upgrade/shared/cache`, `browser-cache`   | upgrade, 0700; npm и Playwright caches                                                                  |
| `/opt/upgrade/shared/logs`                     | upgrade, 0700; только журналы приложения, установщик сюда не пишет                                      |
| `/opt/upgrade/deploy-logs/<release>.<random>`  | root, 0700; installer diagnostics, help/doctor, принятый manifest и ограниченная копия исходного архива |
| `/opt/upgrade/deployment-control`              | root, 0700; независимые SHA-256 принятых manifest для install/retry/rollback                            |
| `/opt/upgrade/downloads`                       | root:upgrade; проверенный Node archive                                                                  |

## Упаковка и проверка

Из локального корня проекта после тестов:

```bash
node scripts/package-app.ts --output /absolute/output/upgrade-app.tar.gz
```

Сохрани напечатанные `release_id` и `sha256`, а также соседние `.sha256` и `.manifest.json`. Повторная упаковка в существующий файл запрещена. Перенеси архив и проверенный `scripts/deploy-app.sh` на сервер штатным SCP/SFTP; скрипт не содержит доступа к серверу и ничего не передаёт сам. Перед выполнением проверь его содержимое и SHA транспортируемого архива против локального receipt.

Read-only preflight:

```bash
bash /absolute/deploy-app.sh --check
```

Запуск установки с фактическими значениями из receipt:

```bash
sudo bash /absolute/deploy-app.sh --archive /absolute/upgrade-app.tar.gz --sha256 TRUSTED_ARCHIVE_SHA256 --release RELEASE_ID
```

Никакой `curl | bash`: runtime скачивается отдельно, SHA проверяется, затем распаковывается. Загрузка имеет timeout/retry, распаковка — timeout, `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` — предел 600 секунд. npm запускается как `upgrade`; lifecycle scripts отключены. Код после установки принадлежит root. Архив копируется с ограничением 200 MiB в новый закрытый каталог root, и SHA сверяется именно у этой копии. Все дальнейшие чтения используют её, поэтому изменение переданного пути не меняет принятый пакет. До распаковки проверяется metadata: не более 20 000 записей, 20 MiB на файл и 200 MiB суммарно; ссылки, traversal и special files отклоняются.

До передачи staging пользователю `upgrade` хеш manifest из принятого архива сохраняется отдельно в закрытом каталоге root. Проверки перед/после npm, повторный install и rollback требуют совпадения с этим хешем; пересчитать manifest вместе с изменёнными исходниками недостаточно. Установщик проверяет исходные хеши, CLI help и doctor до переключения. Root открывает журналы только в новом собственном каталоге и не делает `chown` пользовательских log-файлов. `deployment.json` фиксирует archive/runtime checksum, версию Node, размеры release/runtime/shared, путь installer logs, запрос browser install и статус `CLI_BASELINE_VERIFIED`. Это не готовность Битрикс или авторизация Codex.

## Chromium и запуск задач

Опционально тот же вызов дополнить `--install-browser`; после базовой установки повторно требуется 5 GB свободного места. Playwright ставит Chromium в приватный cache, затем реально запускает пустой headless browser. Системные библиотеки автоматически не устанавливаются; если их не хватает, текущий release не переключается, причина остаётся в browser log. `doctor` отдельно показывает состояние PHP/Docker/Bitrix/Codex.

```bash
sudo -u upgrade /opt/upgrade/bin/upgrade help
sudo -u upgrade /opt/upgrade/bin/upgrade doctor
sudo -u upgrade /opt/upgrade/bin/upgrade status --project PROJECT_ID
```

Wrapper очищает окружение, задаёт отдельный `CODEX_HOME`, persistent data path и private runtime. Codex CLI и его авторизация на этом сервере — отдельный этап: локальная подписка/сессия не копируются. Для реальных агентных задач нужен документированный Codex executable, доступная модель, учётные данные отдельного service user и ограниченный бюджет. Сам deploy не запускает LLM, не принимает pilot URL и не исполняет исходный сайт.

## Возобновление и откат приложения

Установка сериализована `flock`. Проверенный runtime используется повторно; уже завершённый release допускает повторную проверку с тем же архивом/hash/release ID. Оставшийся после обрыва staging всегда блокирует продолжение: он мог быть доступен пользователю `upgrade`, поэтому root не распаковывает в него архив повторно и не доверяет его marker. Администратор должен отдельно изучить и переместить staging в карантин перед повторным запуском. Скрипт не удаляет его и не останавливает чужие процессы. Неожиданный файл, небезопасный pin или другой checksum также блокируют продолжение. Ошибки сохраняют current и shared state; автоматическая рекурсивная очистка отсутствует.

Активация заменяет `current` атомарным rename symlink. Предыдущий target запоминается на время операции; если финальная smoke-проверка после переключения падает, ссылка возвращается обратно. Для последующего явного отката выбери существующий проверенный release:

```bash
sudo bash /absolute/deploy-app.sh --rollback PREVIOUS_RELEASE_ID
```

Rollback повторно проверяет исходный manifest относительно root-owned pin и CLI help. Release без такого pin не принимается; автоматически создавать доверие из установленного дерева запрещено. Это откат кода приложения; SQLite, бюджеты, клиентские данные, внешние эффекты и БД Битрикс не откатываются. Перед несовместимой миграцией состояния нужна отдельная backup/restore-процедура. Скрипт не удаляет старые releases/runtime/cache и root-owned копии архивов в deploy-logs: очистка требует отдельного проверенного плана.

## Граница проверки

Локально должны быть выполнены упаковка реального репозитория, проверка состава архива и Bash syntax check. Linux installation/rollback/root permissions отмечаются PASS только после фактического запуска на разрешённом хосте и проверки receipt. При 521 MB свободного пространства установка обязана остановиться; добавление диска/расширение LVM является отдельным разрешённым системным действием, не частью deploy-app.sh.

29 сентября 2026 выполнены: `bash -n scripts/deploy-app.sh` — PASS; read-only `--check` в локальном WSL — PASS; `npm run check` — PASS. Review package `var/app-packages/upgrade-app-deploy-review.tar.gz`: 113 файлов, 642 935 байт исходников, 199 628 байт архива; архив распакован в отдельную локальную область и все 113 SHA-256/размеров повторно сверены. Запрещённые `var/node_modules/.git/secrets/distribution` отсутствуют. После последующих изменений кода для сервера нужен новый package; этот review package не является автоматически принятой финальной сборкой. Linux установка и rollback на сервере на момент этой проверки — NOT_RUN.

Дополнительно исполнен именно JavaScript-код `verify_source` из deploy-скрипта на распакованном архиве: целый пакет принят, изменённый runtime в manifest и изменённые байты исходного файла отвергнуты. Это PASS проверки валидатора; фактическим Linux deployment оно не считается. Упаковка повторена после добавления `.nvmrc`, `runtime-manifest.json` в allowlist и строгой проверки абсолютного временного пути перед cleanup.

После security review выполнен локальный negative harness в отдельном временном дереве WSL (`wsl --user root --exec python3 .../var/deploy-security-test.py`), без установки приложения: PASS. Проверены неизменность root sentinel при подставленном symlink в пользовательских logs; запрет записи `nobody` в installer logs; отказ для чужого владельца/symlink control directory; отказ при замене manifest пользователем `nobody`; отказ от повторного использования его staging; сохранение принятого snapshot при замене внешнего архива; отказ при неверном SHA; отказ до распаковки настоящего сжатого файла размером более 20 MiB, metadata суммарно более 200 MiB и более 20 000 записей. Это проверка отдельных механизмов, не интеграционный deployment.

Manifest-only harness (`node --disable-warning=ExperimentalWarning var/manifest-only-check.mjs`) выполнил реальный обход и staging, сверил все 122 staged SHA и наличие `infra/provisioning/Dockerfile`, `infra/backup/restore-prepare.py`, `infra/backup/test_restore.py`, `.gitattributes`, `.nvmrc`, `runtime-manifest.json`: PASS. Он остановился до tar и не создавал новый архив. Финальную упаковку следует выполнить после завершения общего checkpoint. Повторные Bash syntax check и TypeScript check — PASS; server install/rollback — NOT_RUN.
