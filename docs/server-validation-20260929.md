# Фактическая приёмка сервера Upgrade — 29 сентября 2026

**PASS для ограниченного CLI-контура. Продукт в целом PARTIAL; настоящая интеграция Битрикс NOT_RUN.**

Установлен `upgrade-0.1.0-foundation-20260929-r3`, исходный commit `1f67618460060143835ade5a7248c89a0f754a4e`. Архив SHA-256 `c3f85b3edc04181104b5c6360e0d99094d659afe620df8cfa8b5c9ad8992177b`; все 126 исходных файлов сверены с manifest и Git inventory. Установщик проверил root-owned manifest pin до/после npm и переключения. Код release после установки не редактировался. Последующие изменения документации могут описывать результаты, полученные уже после упаковки.

## Выполненные команды и результаты

| Команда / проверка | Фактический результат |
|---|---|
| `growpart /dev/sda 3`, `pvresize /dev/sda3`, `lvextend -l +100%FREE -r /dev/hk/root` | PASS; без перезагрузки, начало раздела сохранено. Итог `/` 157G; после runtime/проверок доступно 94G, занято 38%. |
| `bash -n deploy-app.sh`; `bash deploy-app.sh --check` | PASS; перед r3 доступно 100408320000 bytes, требуется 5000000000. |
| `bash deploy-app.sh --archive …/upgrade-foundation-20260929-r3.tar.gz --sha256 c3f85b3edc04181104b5c6360e0d99094d659afe620df8cfa8b5c9ad8992177b --release upgrade-0.1.0-foundation-20260929-r3 --install-browser` | exit 0; private Node 24.20.0, root-owned release, Chromium реально запущен. |
| Non-root `/opt/upgrade/bin/upgrade help`, `doctor`, `status` | Непустой валидный JSON; runtime Linux x64; state writable только выделенным пользователем, код/runtime ему не writable, root control не читается. |
| `/root/upgrade-install-20260929/server-qa-r3.sh` | exit 0; полный протокол ниже пройден. |
| `bash deploy-app.sh --rollback upgrade-0.1.0-foundation-20260929-r2` | Ожидаемый exit 1: старый CLI через current возвращал пустой help. Установщик отказал в активации и вернул r3; последующий JSON help PASS. Shared data не откатывались. Это проверка отказа активации, не production rollback. |
| `node --version`; `systemctl is-active nginx docker`; `nginx -t`; `docker ps` | Системный Node остался 22.13.1; службы active, Nginx config PASS, все 22 исходных контейнера работают. |
| HTTPS существующего `contenthub.help-ai-ru.ru/` | HTTP 200 после действий. Остальные пользовательские сценарии соседних сайтов не проходились. |
| Local `npm run check`, `npm test`, `npm run test:e2e` | PASS; 53 unit/integration и 4 E2E, 0 FAIL, 0 SKIP. Локальный PHP contract/template не равен тесту Битрикс. |

Протокол взят из `docs/review-server-deploy.md`, с заменой release/project/log suffix r2 на r3 и добавлением `/opt/upgrade/bin` в private PATH. Исходный проверочный документ сохранён для аудита. Все процессы CLI, fixture, browser, backup/restore выполнялись как **upgrade**, не root. Test fixture слушал только loopback и закрылся до offline-проверок.

Проект `server-smoke-r3-20260929` сохранил 19 сущностей и 23 URL в scope. Неудавшийся `/blocked-redirect` остаётся в исходном знаменателе и unresolved; verified target URLs = 0. Source side effects = 0. Получены модель, маршруты, проверенный пакет и честный отчёт `NOT_READY`, run `BLOCKED`. CLI `run` ожидаемо вернул 3.

После отключения источника source/crawl.json SHA сохранился; повтор build использовал старый пакет. Backup заблокированного run восстановлен в **новый отдельный каталог**; проверены 16 immutable artifacts, снята скопированная dispatcher lease, немедленные resume/extract/build/run работают. Content/route/release hashes, run ID и бюджет не изменились; package path пересвязан на восстановленную копию. Повторный отчёт также NOT_READY. Это **upgrade-state-only**, не восстановление БД/файлов Битрикс.

Linux Chromium integration: `node --test --test-name-pattern='browser discovers JS/lazy links' tests/integration/discovery.test.ts` — 1 PASS, 0 FAIL, 0 SKIP. Он фактически нашёл JS/lazy links, сохранил DOM и заблокировал POST источнику. Полный локальный тестовый набор на Linux не запускался.

## Сохранённые доказательства и продолжение

- Серверные QA JSON/logs/backup/restored copy: `/opt/upgrade/shared/logs/server-r3-YiJdwttY/`.
- Deployment receipt: `/opt/upgrade/current/deployment.json`; root installer logs `/opt/upgrade/deploy-logs/upgrade-0.1.0-foundation-20260929-r3.S8ZO3gcn/`.
- Локальная копия доказательств: `var/evidence/server-r3/`; архив `server-r3-evidence.tar.gz`, SHA-256 `f6904a49f63cddc7228c8b8bccd89e3c75f00c4a6c449711c38c80ad5d6e9aab`. Он содержит протокол/вывод/JSON проверок, без auth и без дубликатов дерева backup/restored copy.
- CLI: `runuser -u upgrade -- /opt/upgrade/bin/upgrade status --project server-smoke-r3-20260929`. Не пересоздавать этот проект для будущего smoke; выбрать новое имя или явно продолжить его состояние.

Public listener не запускался, домен `upgrade.help-ai-ru.ru` пока не публикует инструмент или сайт Битрикс. Это соответствует первому внутреннему CLI-этапу.

Codex CLI 0.154.0 установлен отдельно, executable и exec flags PASS. На момент doctor серверная auth NOT_AUTHENTICATED, двухагентный серверный запуск NOT_RUN. Авторизация описана в `docs/runbooks/server-codex.md`; локальный двухагентный AT-22 ранее PASS. Учётные данные соседних сервисов и личного Codex не копировались.

Нужны URL исходного пилота, лицензия/редакция либо отдельная тестовая установка Битрикс. Отдельный изолированный target потребует PHP/БД, pin image digests и фактических проверок исходящей сети до запуска CMS. Импорт/reconcile/admin/HTTP routes/commerce/demo isolation/Bitrix restore всё ещё NOT_RUN; никакой DEMO_READY не присваивался. Следующий этап — маленький настоящий импорт с этими проверками после получения необходимых входов.
