# Stable source inspect comparison — 2026-09-30

Task `native-recovery-stable-inspect-20260930`, worker `commerce-model`, fence 1; input `art-5bc557fd-dc22-4df6-b133-634fc165d2b4`. Scope: recovery runner, its existing Python contract harness, and this report. No server, Store, target DB, previous result/receipt or failed recovery directory was modified.

Root reports native V5 performed SQL/files restore, isolation checks and HTTP checks, then failed the final `SOURCE_RUNTIME_CHANGED_DURING_RECOVERY` comparison. Root's independent before/fresh comparison found only reordered `Mounts` arrays for db/php; sorting by Destination left every field equal. These native observations are input evidence from root, not a native execution by this author. The original V5 result remains FAILED and is not rewritten as PASS.

The sole implementation change is inside `Executor.source_inspect()`: construct `mounts = sorted(item['Mounts'], key=lambda mount: mount['Destination'])`, then preserve the complete mount dictionaries in the existing snapshot. No fields are removed or normalized. The returned service list remains sorted as before. The final exact source-before/source-after equality check, all runtime ID/image/network bindings, baseline pins, path guards, strict settings parser, clone-only derivation and no-adoption rules are unchanged. No live source configuration is modified to make the comparison pass.

Three added fixture tests call the actual `source_inspect()` method with simulated read-only Docker JSON responses:

- Reversed mount enumeration and reversed container enumeration compare equal; original input remains unchanged; an unknown nested future mount field survives exactly.
- Changed Source, RW, Destination, Propagation, an unknown nested field, image ID, container ID, network IP or NetworkID still compare unequal and fail the unchanged final equality predicate.
- Added or removed mount entries remain unequal.

Actual command: `node --disable-warning=ExperimentalWarning --test tests/integration/recovery-target.test.ts` — **44/44 real Python tests PASS, 1/1 Node wrapper PASS, 0 SKIP**; Python1.792s, wrapper1937ms. Existing41 tests remain included. `npm run check` — **PASS**. These tests invoke no Docker, SSH, SQL, firewall or native CMS process.

Author status: **code/tests frozen for root review; new native restoration NOT_RUN**. Root must compute a new executor/plan pin and use a fresh absent V6 destination; the failed copy cannot be adopted/retried/deleted by this runner. Per root's sequencing, capture the V6 source configuration before any later interactive Nginx activation so an actual configuration change is not confused with inspect ordering. The source system must remain unchanged during the new restoration; real drift should still fail.
