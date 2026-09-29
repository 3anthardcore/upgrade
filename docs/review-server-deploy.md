# Проверка установленного CLI Upgrade на сервере

Подготовлено независимым reviewer для задачи `review-server-deploy-20260929`. Команды ниже **не выполнялись reviewer на сервере**; их запускает root-исполнитель после установки. Основание: сохранённый `server-stage-inputs.json`, текущие CLI, fixture и backup/restore. Проверяется приложение Upgrade, не готовый Битрикс.

Принятый release: `upgrade-0.1.0-foundation-20260929-r2`. SHA-256 входного архива: `c060210578c84b80bafe2a0254c17e684dea261ed83745b517da6c9a55e4e454`. Каталог `/opt/upgrade`. Системный Node 22 и чужие сайты должны остаться без изменений. Проверки не запускают агентов/LLM, публичный listener, Docker или импорт Битрикс.

## 1. Выбранный release, runtime и права

Root выполняет только чтение метаданных; не выводить содержимое Codex auth/secrets:

```bash
test "$(readlink -f /opt/upgrade/current)" = /opt/upgrade/releases/upgrade-0.1.0-foundation-20260929-r2
node --version
/opt/upgrade/runtime/node-v24.20.0-linux-x64/bin/node --version
stat -c '%U:%G %a %n' /opt/upgrade /opt/upgrade/bin/upgrade /opt/upgrade/deployment-control /opt/upgrade/deploy-logs
stat -c '%U:%G %a %n' /opt/upgrade/shared/{home,projects,cache,browser-cache,codex,logs}
/opt/upgrade/runtime/node-v24.20.0-linux-x64/bin/node -e 'const fs=require("node:fs"),assert=require("node:assert/strict"),p="/opt/upgrade/current/deployment.json",r=JSON.parse(fs.readFileSync(p,"utf8"));assert.equal(r.status,"CLI_BASELINE_VERIFIED");assert.equal(r.archive_sha256,"c060210578c84b80bafe2a0254c17e684dea261ed83745b517da6c9a55e4e454");assert.equal(r.node_version,"v24.20.0");assert.equal(r.public_listener,false);assert.equal(r.bitrix,"NOT_RUN");console.log(JSON.stringify(r,null,2));'
```

PASS: current указывает ровно на выбранный release; private Node — `v24.20.0`; системный `node` совпадает с зафиксированным до установки Node 22. Код/runtime принадлежат root и недоступны на запись `upgrade`; shared-пути принадлежат `upgrade:upgrade`, mode 0700. `deployment-control` и `deploy-logs` — root:root, 0700. Receipt совпадает с принятым архивом. Это не заменяет ранее выполненную проверку manifest pin/всех source SHA при deployment.

## 2–5. Smoke, отключённый источник, backup/restore и Chromium

Следующий блок запускается из root shell, но **весь код приложения, source fixture, Chromium и создание тестовых файлов выполняются как `upgrade`**. Требуется свободный loopback-порт 8787; при занятом порте остановиться, не завершать чужой процесс. `scripts/fixture-demo.ts` сам закрывает только свой источник в `finally`. Тестовый project ID должен отсутствовать; существующий проект не удалять и не перезаписывать.

```bash
runuser -u upgrade -- env -i \
  HOME=/opt/upgrade/shared/home CODEX_HOME=/opt/upgrade/shared/codex \
  PATH=/opt/upgrade/runtime/node-v24.20.0-linux-x64/bin:/usr/bin:/bin \
  UPGRADE_DATA_DIR=/opt/upgrade/shared/projects \
  PLAYWRIGHT_BROWSERS_PATH=/opt/upgrade/shared/browser-cache \
  NPM_CONFIG_CACHE=/opt/upgrade/shared/cache \
  /bin/bash --noprofile --norc <<'QA'
set -euo pipefail
umask 077
cd /opt/upgrade/releases/upgrade-0.1.0-foundation-20260929-r2
test "$(id -un)" = upgrade
test ! -w packages/cli/index.ts
test ! -w /opt/upgrade/runtime/node-v24.20.0-linux-x64/bin/node
test -w "$UPGRADE_DATA_DIR"
test ! -r /opt/upgrade/deployment-control
PROJECT=server-smoke-r2-20260929
PROJECT_ROOT="$UPGRADE_DATA_DIR/$PROJECT"
test ! -e "$PROJECT_ROOT"
command -v ss >/dev/null
test -z "$(ss -H -ltn 'sport = :8787')"
QA_DIR=$(mktemp -d /opt/upgrade/shared/logs/server-r2-XXXXXXXX)
export PROJECT PROJECT_ROOT QA_DIR
printf 'QA evidence: %s\n' "$QA_DIR"

# Первый source -> immutable model -> Bitrix package -> честный NOT_READY.
/opt/upgrade/bin/upgrade help > "$QA_DIR/help.json"
/opt/upgrade/bin/upgrade doctor > "$QA_DIR/doctor.json"
UPGRADE_FIXTURE_PROJECT="$PROJECT" node --disable-warning=ExperimentalWarning scripts/fixture-demo.ts > "$QA_DIR/fixture.json"
/opt/upgrade/bin/upgrade status --project "$PROJECT" --json > "$QA_DIR/status-first.json"
test -z "$(ss -H -ltn 'sport = :8787')"
sha256sum "$PROJECT_ROOT/source/crawl.json" > "$QA_DIR/source-before.sha256"

node --disable-warning=ExperimentalWarning --input-type=module - <<'NODE'
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import {validateBitrixPackage} from './packages/bitrix-adapter/index.ts';
const {QA_DIR:q,PROJECT_ROOT:p,PROJECT:id}=process.env;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const status=read(path.join(q,'status-first.json'));
const latest=type=>{const a=status.artifacts.filter(a=>a.type===type).at(-1);assert.ok(a,type);return read(path.join(p,a.relative_path));};
assert.equal(read(path.join(q,'doctor.json')).runtime.node,'v24.20.0');
assert.equal(read(path.join(q,'fixture.json')).source_side_effects,0);
assert.equal(status.run.execution_status,'BLOCKED');
assert.equal(read(path.join(p,'reports/report.json')).readiness,'NOT_READY');
const model=latest('content-model.json'),scope=latest('scope-manifest.json'),routes=latest('route-manifest.json'),qa=latest('qa-report.json'),release=latest('release-manifest.json');
assert.ok(model.entities.length>0);assert.ok(scope.urls.some(x=>x.request_target==='/blocked-redirect'));
assert.ok(routes.unresolved.some(x=>x.source_url.endsWith('/blocked-redirect')));
assert.equal(qa.coverage.total_in_scope,scope.urls.length);assert.equal(qa.coverage.verified_in_scope,0);
assert.equal(qa.checks.find(x=>x.id==='bitrix-runtime').status,'NOT_RUN');
const manifest=await validateBitrixPackage(release.package_dir,id,release.manifest_sha256);
assert.ok(manifest.entity_count>0);assert.ok(manifest.route_count>0);assert.equal(manifest.runtime_verification,'NOT_RUN');
fs.writeFileSync(path.join(q,'release-first.json'),JSON.stringify({id:release.release_id,hash:release.manifest_sha256,files:manifest.files}));
console.log(JSON.stringify({source_model_package:'PASS',entities:model.entities.length,scope:scope.urls.length,readiness:qa.readiness}));
NODE

# Fixture уже остановлен. Повторный полный run обязан использовать снимок.
/opt/upgrade/bin/upgrade resume --project "$PROJECT" > "$QA_DIR/resume.json"
/opt/upgrade/bin/upgrade build --project "$PROJECT" > "$QA_DIR/build-offline.json"
set +e
/opt/upgrade/bin/upgrade run --project "$PROJECT" > "$QA_DIR/run-offline.json"
offline_code=$?
set -e
test "$offline_code" -eq 3
sha256sum -c "$QA_DIR/source-before.sha256"
/opt/upgrade/bin/upgrade status --project "$PROJECT" --json > "$QA_DIR/status-offline.json"

# Backup BLOCKED-проекта поддержан maintenance lock; новое отдельное назначение.
/opt/upgrade/bin/upgrade backup --project "$PROJECT" --to "$QA_DIR/state-backup" > "$QA_DIR/backup.json"
mkdir "$QA_DIR/restored-projects"
/opt/upgrade/bin/upgrade restore --from "$QA_DIR/state-backup" --to "$QA_DIR/restored-projects/$PROJECT" > "$QA_DIR/restore.json"
/opt/upgrade/bin/upgrade resume --project "$PROJECT" --data-dir "$QA_DIR/restored-projects" > "$QA_DIR/restored-resume.json"
/opt/upgrade/bin/upgrade extract --project "$PROJECT" --data-dir "$QA_DIR/restored-projects" > "$QA_DIR/restored-extract.json"
/opt/upgrade/bin/upgrade build --project "$PROJECT" --data-dir "$QA_DIR/restored-projects" > "$QA_DIR/restored-build.json"
set +e
/opt/upgrade/bin/upgrade run --project "$PROJECT" --data-dir "$QA_DIR/restored-projects" > "$QA_DIR/restored-run.json"
restored_code=$?
set -e
test "$restored_code" -eq 3
/opt/upgrade/bin/upgrade status --project "$PROJECT" --data-dir "$QA_DIR/restored-projects" --json > "$QA_DIR/status-restored.json"

node --input-type=module - <<'NODE'
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const q=process.env.QA_DIR,read=name=>JSON.parse(fs.readFileSync(path.join(q,name),'utf8'));
const first=read('status-first.json'),offline=read('status-offline.json'),restored=read('status-restored.json');
assert.equal(read('build-offline.json').reused,true);assert.equal(read('run-offline.json').qa.readiness,'NOT_READY');
assert.equal(read('restore.json').status,'RESTORED');assert.equal(read('restore.json').kind,'upgrade-state-only');assert.equal(read('restore.json').bitrix_restore,'NOT_RUN');
assert.equal(read('restored-extract.json').reused,true);assert.equal(read('restored-build.json').reused,true);
assert.ok(read('restored-build.json').packageDir.startsWith(path.join(q,'restored-projects')+path.sep));
assert.deepEqual(read('restored-build.json').manifest.files,read('release-first.json').files);
assert.equal(read('restored-run.json').qa.readiness,'NOT_READY');
for(const status of [offline,restored]){assert.equal(status.run.run_id,first.run.run_id);assert.deepEqual(status.run.budget,first.run.budget);assert.equal(status.run.execution_status,'BLOCKED');}
for(const type of ['content-model.json','route-manifest.json','release-manifest.json']){const digest=s=>s.artifacts.filter(a=>a.type===type).at(-1).sha256;assert.equal(digest(offline),digest(first));assert.equal(digest(restored),digest(first));}
console.log(JSON.stringify({offline_reuse:'PASS',state_restore:'PASS',budget_preserved:'PASS',bitrix_restore:'NOT_RUN'}));
NODE

# Реальный Chromium и browser transport; один выбранный integration test.
node --disable-warning=ExperimentalWarning --test --test-name-pattern='browser discovers JS/lazy links' tests/integration/discovery.test.ts > "$QA_DIR/chromium.txt" 2>&1
printf 'Server checks completed. Preserve evidence: %s\n' "$QA_DIR"
QA
```

Если Chromium ещё не установлен или отсутствуют Linux-библиотеки, последняя команда завершится ошибкой. Оставить browser check **BLOCKED/NOT_RUN** с фактическим сообщением; не подменять его успешным `doctor.browser.ok`: doctor проверяет наличие executable, а не его запуск. Установка браузера/пакетов не является частью этого набора команд.

## Критерии приёмки и границы

| Проверка | PASS только при фактическом результате |
|---|---|
| Non-root baseline | `id=upgrade`, private Node 24.20.0; code/runtime не writable, shared projects writable; root control недоступен service user. |
| Source → model → package | Script exit 0; непустые сущности/маршруты, валидный принятый manifest SHA и package hashes; `source_side_effects=0`. Report `NOT_READY`, run `BLOCKED`, Bitrix `NOT_RUN` являются **ожидаемым** результатом. |
| Полный исходный scope | `/blocked-redirect` остаётся в scope и unresolved, verified HTTP = 0 без target. Robots-exclusion не означает потерю проблемного redirect. Ошибки fixture и SVG-blockers не скрыты. |
| Повтор без источника | Port 8787 закрыт, `run` exit **3**, source/crawl.json SHA неизменён; build reused=true, прежние model/routes/release SHA и run/budget сохранены. |
| Отдельный restore | Restore exit 0/RESTORED; назначение было новым; schema/artifact SHA проверены ядром; повторная сборка в новом пути reused=true, hashes и бюджеты равны исходным; report снова NOT_READY. |
| Chromium | Выбранный реальный тест PASS: DOM сохранён, JS/lazy links найдены, source POST не отправлен. Остальные тесты, пропущенные `--test-name-pattern`, не засчитывать как повторно пройденные. |

`fixture-demo.ts` возвращает process exit 0 при ожидаемом `BLOCKED`; CLI `run` возвращает exit 3 при ожидаемом неполном результате. `doctor` exit 0 подтверждает подходящий Node, но не все его checks. Не интерпретировать эти разные коды без проверки JSON.

Проверки следует выполнить в пределах сохранённого бюджета run (fixture — 7200 секунд с момента создания). Продолжение не сбрасывает время; при истечении сохранить результат и начать отдельный явно названный smoke-проект, не править SQLite/лимиты вручную. Если project ID уже существует, не удалять его: выбрать новый уникальный ID в блоке.

Backup здесь — только **upgrade-state-only**. Он не подтверждает восстановление БД/файлов Битрикс, production rollback, работу admin, интеграций или межклиентскую OS-изоляцию. Restore намеренно сохраняет отдельный путь и пересвязывает snapshot/release paths; абсолютные значения происхождения внутри неизменяемых артефактов не переписываются. Исходные reports в backup не копируются, новый run формирует их заново.

Набор не устанавливает Битрикс, не принимает реальный пилот, не вызывает Codex agents и не доказывает готовность переноса произвольного сайта. Server Codex auth/двухагентный запуск, реальный target Nginx/Bitрикс, initial egress isolation и полный сайт restore остаются **NOT_RUN**. Отдельно сохранить фактическое сравнение системного Node, служб и HTTPS соседних сайтов до/после дисковых/установочных действий; этот документ не проверял их.

Доказательства не удалять автоматически: сохранить путь QA_DIR, stdout/stderr, исходный deployment receipt и server-stage input artifact. Итоговый серверный PASS заполняет root-исполнитель после команд; данный документ является подготовленным проверочным протоколом, а не отчётом о выполнении.
