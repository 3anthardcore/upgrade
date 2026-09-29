import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, hash } from "../../packages/core/index.ts";
import { backupProject, restoreProject } from "../../packages/core/backup.ts";
import { Pipeline } from "../../packages/core/pipeline.ts";
import type { Task, AgentResult } from "../../packages/contracts/index.ts";
test("state backup restores independently with verified immutable artifacts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-backup-"));
  const store = new Store(join(dir, "a"));
  try {
    store.createProject("site-a", "https://example.org/");
    store.planRun();
    const artifact = store.publishArtifact("facts.json", '{"fact":"source"}');
    const manifest = await backupProject(store, join(dir, "backup"));
    assert.equal(manifest.kind, "upgrade-state-only");
    const result = await restoreProject(
      join(dir, "backup"),
      join(dir, "restored"),
    );
    assert.equal(result.status, "RESTORED");
    assert.equal(result.bitrix_restore, "NOT_RUN");
    const restored = new Store(join(dir, "restored"));
    assert.equal(
      restored.validateArtifact(artifact.artifact_id).sha256,
      artifact.sha256,
    );
    restored.close();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("restore refuses drive paths and path escapes before creating a destination", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-backup-escape-"));
  try {
    const source = join(dir, "bad");
    mkdirSync(source);
    for (const path of [
      "C:/outside.txt",
      "../outside.txt",
      "/outside.txt",
      "state/../outside",
    ]) {
      writeFileSync(
        join(source, "backup-manifest.json"),
        JSON.stringify({
          schema_version: 1,
          kind: "upgrade-state-only",
          files: { "state/upgrade.db": "a".repeat(64), [path]: "b".repeat(64) },
        }),
      );
      await assert.rejects(restoreProject(source, join(dir, "destination")));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("locked backup restores and reacquires immediately without stealing source dispatcher or changing budget/history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-locked-restore-"));
  const source = new Store(join(dir, "source"));
  try {
    source.createProject("site-a", "https://example.org/");
    source.planRun(7, 3600);
    source.setRunStatus("BLOCKED");
    await new Pipeline(source).locked(async () => {
      const snapshotEvents = source.events();
      const manifest = await backupProject(source, join(dir, "backup"));
      const before = source.currentRun();
      const sourceEvents = source.events();
      assert.ok(before.dispatcher_owner);
      assert.ok(before.dispatcher_until > Date.now());
      const result = await restoreProject(join(dir, "backup"), join(dir, "restored"));
      assert.deepEqual(result.recovery.detached_run_ids, [before.run_id]);
      assert.deepEqual(result.recovery.reconciliation_required_task_ids, []);
      const restored = new Store(join(dir, "restored"));
      try {
        assert.deepEqual(restored.currentRun(), {
          ...before, dispatcher_owner: null, dispatcher_until: 0,
        });
        assert.deepEqual(restored.events().slice(0, snapshotEvents.length), snapshotEvents);
        restored.resumeRun();
        await new Pipeline(restored).locked(async () => {
          assert.ok(restored.currentRun().dispatcher_owner);
          assert.notEqual(restored.currentRun().dispatcher_owner, before.dispatcher_owner);
          assert.deepEqual(restored.currentRun().budget, before.budget);
          return { immediate: true };
        });
        assert.equal(restored.currentRun().dispatcher_owner, null);
        assert.deepEqual(restored.currentRun().budget, before.budget);
      } finally { restored.close(); }
      // Source still owns its live lock while the restored copy already completed work.
      assert.deepEqual(source.currentRun(), before);
      assert.deepEqual(source.events(), sourceEvents);
      assert.ok(before.dispatcher_until > Date.now());
      assert.equal(hash(readFileSync(join(dir, "backup/state/upgrade.db"))), manifest.files["state/upgrade.db"]);
      return result;
    }, { maintenance: true });
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restored workers are fenced and blocked with unknown expense; submitted review provenance and source leases survive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-worker-restore-"));
  const source = new Store(join(dir, "source"));
  try {
    source.createProject("site-a", "https://example.org/");
    source.planRun(10, 3600);
    const submitted = (id: string, owner: string) => {
      source.createTask({ task_id: id, role: "researcher", stage: "TEST", goal: "Synthetic completed work", acceptance_checks: ["facts"] });
      const claim = source.claimTask(id, owner);
      const artifact = source.publishArtifact("result.json", '{"fact":1}', id, owner, claim.fencing_token);
      const result: AgentResult = {
        task_id: id, attempt: claim.attempt, input_hash: claim.input_hash!, artifact_ids: [artifact.artifact_id],
        summary: "Synthetic result", checks: [{ id: "facts", status: "PASS" }], unresolved_issues: [],
        suggested_followups: [], usage: { cost: "UNAVAILABLE" }, runtime_version: process.version,
      };
      source.submitResult(id, owner, claim.fencing_token, result);
      return source.get<Task>("task", id);
    };
    const validating = submitted("review-pending", "review-author");
    submitted("accepted", "accepted-author");
    source.acceptTask("accepted", "independent-reviewer", [{ id: "facts", status: "PASS" }]);
    const accepted = source.get<Task>("task", "accepted");
    source.createTask({ task_id: "active", role: "importer", stage: "TEST", goal: "Unknown side effect", budget: { max_seconds: 300, reserved_units: 3 } });
    const active = source.claimTask("active", "source-worker");
    source.createTask({ task_id: "ready", role: "researcher", stage: "TEST", goal: "Never started" });
    const ready = source.get<Task>("task", "ready");

    await new Pipeline(source).locked(async () => {
      await backupProject(source, join(dir, "backup"));
      const sourceRun = source.currentRun();
      const sourceEvents = source.events();
      const result = await restoreProject(join(dir, "backup"), join(dir, "restored"));
      assert.deepEqual(result.recovery.reconciliation_required_task_ids, [active.task_id]);
      const restored = new Store(join(dir, "restored"));
      try {
        const recoveryRun = restored.currentRun();
        const task = restored.get<Task>("task", active.task_id);
        assert.equal(recoveryRun.execution_status, "BLOCKED");
        assert.deepEqual(recoveryRun.budget, {
          ...sourceRun.budget,
          reserved: sourceRun.budget.reserved - active.budget.reserved_units,
          unknown: sourceRun.budget.unknown + active.budget.reserved_units,
        });
        assert.deepEqual(task, {
          ...active, status: "BLOCKED", lease_owner: null, lease_until: null,
          fencing_token: active.fencing_token + 1, updated_at: task.updated_at,
        });
        assert.deepEqual(restored.get<Task>("task", validating.task_id), validating);
        assert.deepEqual(restored.get<Task>("task", accepted.task_id), accepted);
        assert.deepEqual(restored.get<Task>("task", ready.task_id), ready);
        assert.throws(() => restored.heartbeatTask(active.task_id, "source-worker", active.fencing_token), /stale lease/);
        assert.throws(() => restored.publishArtifact("late.json", "{}", active.task_id, "source-worker", active.fencing_token), /stale lease/);
        restored.resumeRun();
        assert.throws(() => restored.claimTask(active.task_id, "replacement"), /not claimable/);
        assert.throws(() => restored.acceptTask(validating.task_id, "review-author", [{ id: "facts", status: "PASS" }]), /Author cannot accept/);
        restored.acceptTask(validating.task_id, "independent-reviewer", [{ id: "facts", status: "PASS" }]);
        assert.deepEqual(restored.currentRun().budget, recoveryRun.budget);
        assert.equal(restored.events().filter(event => event.type === "task.restore_reconciliation_required").length, 1);

        // A second independent restore does not refund or double-charge the same unknown attempt.
        await new Pipeline(restored).locked(async () => backupProject(restored, join(dir, "backup-again")), { maintenance: true });
        const repeated = await restoreProject(join(dir, "backup-again"), join(dir, "restored-again"));
        assert.deepEqual(repeated.recovery.reconciliation_required_task_ids, []);
        const again = new Store(join(dir, "restored-again"));
        try {
          assert.deepEqual(again.currentRun().budget, recoveryRun.budget);
          assert.deepEqual(again.get<Task>("task", active.task_id), task);
        } finally { again.close(); }
      } finally { restored.close(); }
      assert.deepEqual(source.currentRun(), sourceRun);
      assert.deepEqual(source.get<Task>("task", active.task_id), active);
      assert.deepEqual(source.get<Task>("task", validating.task_id), validating);
      assert.deepEqual(source.events(), sourceEvents);
      source.heartbeatTask(active.task_id, "source-worker", active.fencing_token);
      return result;
    }, { maintenance: true });
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
