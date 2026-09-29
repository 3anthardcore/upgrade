import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, hash, inside, projectRoot } from "../../packages/core/index.ts";
import type { Task, AgentResult } from "../../packages/contracts/index.ts";

function setup(t: test.TestContext, units = 10) {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-core-"));
  const s = new Store(dir);
  s.createProject("test", "https://source.example/");
  s.planRun(units, 3600);
  t.after(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return s;
}
function task(s: Store, id = "task-one") {
  return s.createTask({
    task_id: id,
    stage: "TEST",
    role: "researcher",
    goal: "Read synthetic data",
    acceptance_checks: ["independent"],
  });
}
function submitted(s: Store, id = "task-one") {
  task(s, id);
  const claim = s.claimTask(id, "worker-a");
  const a = s.publishArtifact(
    "result.json",
    '{"value":1}',
    id,
    "worker-a",
    claim.fencing_token,
  );
  const result: AgentResult = {
    task_id: id,
    attempt: claim.attempt,
    input_hash: claim.input_hash!,
    artifact_ids: [a.artifact_id],
    summary: "Synthetic result",
    checks: [{ id: "independent", status: "PASS" }],
    unresolved_issues: [],
    suggested_followups: [],
    usage: { tokens: null },
    runtime_version: process.version,
  };
  s.submitResult(id, "worker-a", claim.fencing_token, result);
  return { claim, a, result };
}
test("state and event persist together and resume after process recreation", (t) => {
  const s = setup(t);
  task(s);
  const run = s.currentRun();
  s.setRunStatus("PAUSED");
  const reopened = new Store(s.root);
  assert.equal(reopened.get<Task>("task", "task-one").status, "READY");
  assert.throws(() => reopened.claimTask("task-one", "worker"), /not active/);
  reopened.resumeRun();
  assert.equal(reopened.currentRun().run_id, run.run_id);
  assert.equal(reopened.events().at(-1)?.type, "run.resumed");
  reopened.close();
});
test("idempotent task creation and dependency gate", (t) => {
  const s = setup(t);
  const one = s.createTask({
    stage: "T",
    role: "R",
    goal: "G",
    idempotency_key: "same",
  });
  const two = s.createTask({
    stage: "T",
    role: "R",
    goal: "G",
    idempotency_key: "same",
  });
  assert.equal(one.task_id, two.task_id);
  const child = s.createTask({
    stage: "T",
    role: "R",
    goal: "G",
    depends_on: [one.task_id],
  });
  assert.throws(() => s.claimTask(child.task_id, "w"), /Dependencies/);
  assert.throws(
    () =>
      s.createTask({
        task_id: one.task_id,
        stage: "T",
        role: "R",
        goal: "G",
        idempotency_key: "different",
      }),
    /Duplicate/,
  );
});
test("concurrent lease cannot be stolen; expired worker is fenced", (t) => {
  const s = setup(t);
  task(s);
  const first = s.claimTask("task-one", "first");
  assert.throws(() => s.claimTask("task-one", "second"), /not claimable/);
  s.db
    .prepare(
      "UPDATE records SET body=json_set(body,'$.lease_until',0) WHERE kind='task' AND id='task-one'",
    )
    .run();
  const second = s.claimTask("task-one", "second");
  assert.ok(second.fencing_token > first.fencing_token);
  assert.throws(
    () =>
      s.publishArtifact(
        "bad.txt",
        "late",
        "task-one",
        "first",
        first.fencing_token,
      ),
    /stale/,
  );
  assert.equal(s.currentRun().budget.unknown, 1);
});
test("budget reservation survives pause and exhausted budget blocks retry", (t) => {
  const s = setup(t, 1);
  task(s);
  s.claimTask("task-one", "first");
  s.setRunStatus("PAUSED");
  s.resumeRun();
  assert.equal(s.currentRun().budget.reserved, 1);
  s.db
    .prepare(
      "UPDATE records SET body=json_set(body,'$.lease_until',0) WHERE kind='task' AND id='task-one'",
    )
    .run();
  assert.throws(() => s.claimTask("task-one", "second"), /budget exhausted/);
  assert.equal(s.currentRun().budget.max_units, 1);
});
test("only independent successful review accepts a result", (t) => {
  const s = setup(t);
  submitted(s);
  assert.throws(
    () =>
      s.acceptTask("task-one", "worker-a", [
        { id: "independent", status: "PASS" },
      ]),
    /Author/,
  );
  assert.throws(
    () =>
      s.acceptTask("task-one", "qa", [
        { id: "independent", status: "NOT_RUN" },
      ]),
    /not passed/,
  );
  assert.equal(
    s.acceptTask("task-one", "qa", [{ id: "independent", status: "PASS" }])
      .status,
    "ACCEPTED",
  );
  assert.equal(s.currentRun().budget.spent, 1);
});
test("corrupted accepted artifact blocks reuse and resume", (t) => {
  const s = setup(t);
  const { a } = submitted(s);
  s.acceptTask("task-one", "qa", [{ id: "independent", status: "PASS" }]);
  const path = inside(s.root, a.relative_path);
  chmodSync(path, 0o600);
  writeFileSync(path, "tampered");
  assert.throws(() => s.resumeRun(), /hash mismatch/);
});
test("schema, input hash and project ownership validated before result", (t) => {
  const s = setup(t);
  task(s);
  const c = s.claimTask("task-one", "w");
  assert.throws(
    () => s.submitResult("task-one", "w", c.fencing_token, {} as AgentResult),
    /schema/,
  );
  const a = s.publishArtifact("x.txt", "x");
  const r: AgentResult = {
    task_id: c.task_id,
    attempt: 1,
    input_hash: c.input_hash!,
    artifact_ids: [a.artifact_id],
    summary: "x",
    checks: [],
    unresolved_issues: [],
    suggested_followups: [],
    usage: {},
    runtime_version: "test",
  };
  assert.throws(
    () => s.submitResult(c.task_id, "w", c.fencing_token, r),
    /Foreign task/,
  );
});
test("replacement invalidates transitive dependent tasks with audit retained", (t) => {
  const s = setup(t);
  const old = s.publishArtifact("route.json", "old");
  const newA = s.publishArtifact("route.json", "new");
  const first = s.createTask({
    role: "qa",
    stage: "QA",
    goal: "verify",
    input_artifact_ids: [old.artifact_id],
  });
  const child = s.createTask({
    role: "qa",
    stage: "QA",
    goal: "verify",
    depends_on: [first.task_id],
  });
  assert.deepEqual(
    new Set(s.invalidateArtifact(old.artifact_id, newA.artifact_id)),
    new Set([first.task_id, child.task_id]),
  );
  assert.equal(s.get<Task>("task", child.task_id).status, "STALE");
  assert.equal(readFileSync(inside(s.root, old.relative_path), "utf8"), "old");
});
test("dispatcher cannot overlap; explicit release enables handoff", (t) => {
  const s = setup(t);
  const r = s.currentRun();
  s.acquireDispatcher(r.run_id, "interactive");
  assert.throws(
    () => s.acquireDispatcher(r.run_id, "automatic"),
    /already owned/,
  );
  s.releaseDispatcher(r.run_id, "interactive");
  assert.equal(
    s.acquireDispatcher(r.run_id, "automatic").dispatcher_owner,
    "automatic",
  );
});
test("cancellation fences active leases and preserves unknown expense", (t) => {
  const s = setup(t);
  task(s);
  const c = s.claimTask("task-one", "w");
  s.setRunStatus("CANCELLED");
  assert.equal(s.get<Task>("task", c.task_id).status, "CANCELLED");
  assert.equal(s.currentRun().budget.unknown, 1);
  assert.throws(
    () => s.heartbeatTask(c.task_id, "w", c.fencing_token),
    /stale/,
  );
  assert.throws(() => s.resumeRun(), /Cancelled/);
});
test("paths and URL credentials are bounded", (t) => {
  const s = setup(t);
  assert.throws(() => inside(s.root, "../../outside"), /outside/);
  assert.throws(() => projectRoot(s.root, "../other"), /Invalid/);
  assert.equal(hash("a").length, 64);
});
