import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../../packages/core/index.ts";

function storeFor(t: test.TestContext) {
  const root = mkdtempSync(resolve(tmpdir(), "upgrade-core-review-"));
  const store = new Store(root);
  store.createProject("review", "https://source.example/");
  store.planRun(10, 3600);
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return store;
}

test("heartbeats cannot extend a task beyond its persisted absolute time budget", (t) => {
  const store = storeFor(t);
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const task = store.createTask({
    task_id: "deadline",
    role: "researcher",
    goal: "bounded task",
    stage: "TEST",
    budget: { max_seconds: 1, reserved_units: 1 },
  });
  const claim = store.claimTask(task.task_id, "worker", 1000);
  clock += 900;
  store.heartbeatTask(task.task_id, "worker", claim.fencing_token, 1000);
  clock += 200;
  assert.throws(
    () =>
      store.publishArtifact(
        "result.json",
        "{}",
        task.task_id,
        "worker",
        claim.fencing_token,
      ),
    "A heartbeat must not turn a one-second task into an unbounded task",
  );
});

test("generic status setter cannot grant readiness without verified evidence", (t) => {
  const store = storeFor(t);
  for (const status of [
    "DEMO_READY",
    "PRODUCTION_READY",
    "LIVE_VERIFIED",
    "not-a-real-status",
  ])
    assert.throws(
      () => store.setRunStatus(status),
      `Unsupported readiness/status transition: ${status}`,
    );
  assert.equal(store.currentRun().execution_status, "ACTIVE");
});

test("async stage failure produces failed event and never an early completed event", async (t) => {
  const store = storeFor(t);
  let rejectStage!: (error: Error) => void;
  const operation = new Promise<void>((_resolve, reject) => {
    rejectStage = reject;
  });
  const stage = Promise.resolve(store.runStage("ASYNC_CHECK", () => operation));
  const premature = store.events().some((e) => e.type === "stage.completed");
  rejectStage(new Error("Synthetic asynchronous failure"));
  await assert.rejects(stage, /Synthetic asynchronous failure/);
  assert.equal(
    premature,
    false,
    "Completion cannot be emitted before the promise settles",
  );
  assert.equal(
    store.events().filter((e) => e.type === "stage.failed").length,
    1,
  );
  assert.equal(
    store.events().filter((e) => e.type === "stage.completed").length,
    0,
  );
});
