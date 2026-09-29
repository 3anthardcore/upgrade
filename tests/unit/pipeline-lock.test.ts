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
    await pipeline.locked(async () => {
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
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
