import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../packages/core/index.ts";
import { Pipeline } from "../../packages/core/pipeline.ts";
test("old pipeline dispatcher cannot publish after ownership was transferred", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-fence-"));
  const store = new Store(dir);
  try {
    store.createProject("pipeline", "https://example.com/");
    store.planRun();
    const pipeline = new Pipeline(store);
    await assert.rejects(pipeline.locked(async () => {
      const run = store.currentRun();
      store.transaction(() => {
        run.dispatcher_until = 0;
        store.put("run", run.run_id, run);
      });
      store.acquireDispatcher(run.run_id, "second-dispatcher");
      assert.throws(
        () => pipeline.save("bad.json", { late: true }),
        /ownership lost/,
      );
      assert.equal(store.list("artifact").length, 0);
    }), /ownership lost/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dispatcher renewal cannot revive an expired lease or replace another owner", () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-fence-"));
  const store = new Store(dir);
  try {
    store.createProject("pipeline", "https://example.com/");
    const run = store.planRun();
    store.acquireDispatcher(run.run_id, "first");
    const expired = store.currentRun();
    expired.dispatcher_until = Date.now() - 1;
    store.transaction(() => store.put("run", run.run_id, expired));
    assert.throws(() => store.renewDispatcher(run.run_id, "first"), /ownership lost/);
    store.acquireDispatcher(run.run_id, "second");
    assert.throws(() => store.renewDispatcher(run.run_id, "first"), /ownership lost/);
    assert.equal(store.currentRun().dispatcher_owner, "second");
    assert.ok(store.renewDispatcher(run.run_id, "second").dispatcher_until > Date.now());
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
