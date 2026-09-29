# Отдельный Codex CLI для серверного Upgrade

Проверено 29 сентября 2026: `/opt/upgrade/tools/codex-0.154.0` содержит npm package `@openai/codex@0.154.0`. `/opt/upgrade/bin/codex` указывает на его `bin/codex.js`. Бинарники принадлежат root:upgrade, группе разрешены чтение/исполнение, запись запрещена. Системный Node/npm и чужие приложения не меняются. Private Node — 24.20.0.

Установка выполнялась через private npm как upgrade, в отдельный staging, с `--save-exact --ignore-scripts --no-audit --no-fund`. После проверки package-lock integrity и `codex --version` staging передан root, права нормализованы и каталог перемещён в окончательное назначение. Повторная установка поверх существующего каталога запрещена: сначала сверить его состояние.

Принятый npm integrity: `sha512-FV/x1OHXYv/ifjf3mXj9ThTTAWcUZN6cGIRQRhRxkKNOPuImu1WW0c8ev1vUkE9XGH90dEnYG1tBjIkxRikg0w==`. Версия executable: **codex-cli 0.154.0**; `exec --help` проверен. Контроль версии пакета не заменяет проверку auth/агентного запуска.

Серверный `CODEX_HOME=/opt/upgrade/shared/codex` принадлежит upgrade, mode 0700. Личные auth-файлы Windows и сессии соседних сервисов не копируются. Последний `codex login status`: **Not logged in**. Это блокирует только серверные LLM-задачи, не fixtures/build/backup/restore.

Для отдельной авторизации оператор выполняет в SSH:

```bash
runuser -u upgrade -- env -i \
  HOME=/opt/upgrade/shared/home CODEX_HOME=/opt/upgrade/shared/codex \
  PATH=/opt/upgrade/runtime/node-v24.20.0-linux-x64/bin:/opt/upgrade/bin:/usr/bin:/bin \
  codex login --device-auth
```

Открыть выданную CLI официальную страницу и подтвердить короткий код в нужной учётной записи. Не публиковать auth.json, токены или API key в чате/репозитории. Если device auth отключён политикой аккаунта, выбрать поддерживаемый официальный способ; не копировать личные сессии автоматически. См. [официальную документацию авторизации Codex](https://learn.chatgpt.com/docs/auth).

После входа `runuser -u upgrade -- /opt/upgrade/bin/upgrade doctor` должен показать AUTHENTICATED. Затем зафиксировать разрешённую модель и бюджет и выполнить два реальных агента через адаптер проекта. Локальный AT-22 уже пройден; серверный AT-22 остаётся **NOT_RUN** до фактического запуска. Не считать один успешный login или вывод версии успешным агентным тестом.
