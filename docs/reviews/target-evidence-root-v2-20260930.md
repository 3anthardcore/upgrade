# Target evidence V2 — независимая проверка root

ACCEPT в пределах offline operator attestation. V1 REJECT и его три воспроизведения сохранены в `target-evidence-independent-20260930.md`; root не был автором V2. Реальный native receipt ещё не загружен этой проверкой.

Прочитаны `Store.publishArtifact` и весь изменённый путь `ingestTargetEvidence`: guard вызывается до файловой публикации и внутри transaction до/после artifact metadata/event. Receipt mutations выполняются в transaction с проверкой действующей ownership; exact deterministic Store key отличает отсутствующую запись от повреждённого body.id. Capture payloads сверяются по manifest/type/project/size/SHA, с одним индексом и передачей управления между файлами. Файловый orphan после отказа допустим; регистрация stale artifact в Store — нет. Остальные вызовы publisher сохраняют прежний API.

Команда root:

```text
node --disable-warning=ExperimentalWarning --test var/evidence/target-evidence-review-20260930/independent.test.ts tests/integration/target-evidence.test.ts tests/unit/pipeline-lock.test.ts
```

Фактически **38/38 PASS,0SKIP**,23.634s. Три неизменённых независимых V1 safety assertions теперь PASS. Новые случаи отдельно проверяют takeover непосредственно у artifact metadata transaction, линейное чтение64media/yield, прежние corrupted receipt/package/scope/capture, PENDING resume/replay и lease expiry. Лог `var/evidence/continuation-20260930/target-evidence-root-v2.log`. Авторский combined80/80 PASS — дополнительное, а не замена этой проверки.

Принятые pins: core/target-evidence `d4f77e0960787dbe201e7be59d23cc0441932d4a80e6ad39c8cce915a1dca280`; core/index `fd87c117104267d3aaa8a67baef965be5c06b3f40df343eb83f21a29bbcf86c0`; test `2825e24979c7ccfff1ca7fdd2d9b4dde1b7983f9b9069f7d4385f523abbcc8d5`; reporter `56eafaa0864123044e76922b41537b005ea734f91bf89591f085c96caf8096da`; CLI `05e3dae485d8a44c32facc45b131aded6402849d725fd564c68f53f7f01f639f`.

Граница: оператор явно утверждает происхождение копий, а CLI проверяет bytes/bindings/COMMITTED provenance. Это не защита от недостоверного утверждения самого доверенного оператора. RECORDED_NATIVE_IMPORT относится к историческому exact package/target; HTTP/browser/admin/restore остаются самостоятельными проверками, полный source UNKNOWN и NOT_READY сохранены. Следующий шаг: sealed app release, фактический native reconcile bundle, ingest/replay/report на сервере как upgrade.
