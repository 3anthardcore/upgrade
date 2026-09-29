import { backup } from "node:sqlite";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
  stat,
  lstat,
} from "node:fs/promises";
import { resolve, relative, sep, dirname } from "node:path";
import { Store, hash, UpgradeError, inside } from "./index.ts";
import type { Run, Task } from "../contracts/index.ts";

/** Process leases belong to the source instance, not to an independently restored copy. */
function detachRestoredOwnership(store: Store) {
  return store.transaction(() => {
    const runs = new Map(store.list<Run>("run").map((run) => [run.run_id, run]));
    const running = store.list<Task>("task").filter((task) => task.status === "RUNNING");
    const detachedRuns: string[] = [];
    const unknownTasks: string[] = [];
    for (const task of running) {
      const run = runs.get(task.run_id);
      if (!run || run.budget.reserved < task.budget.reserved_units)
        throw new UpgradeError("Restored task reservation is inconsistent", 5);
      const previous = {
        lease_owner: task.lease_owner,
        lease_until: task.lease_until,
        fencing_token: task.fencing_token,
      };
      // The attempt may still be running on the source host. Do not silently retry,
      // refund its reservation, reset attempt/deadline, or accept its old token here.
      run.budget.reserved -= task.budget.reserved_units;
      run.budget.unknown += task.budget.reserved_units;
      task.status = "BLOCKED";
      task.fencing_token++;
      task.lease_owner = null;
      task.lease_until = null;
      task.updated_at = new Date().toISOString();
      if (run.execution_status === "ACTIVE") run.execution_status = "BLOCKED";
      store.put("task", task.task_id, task);
      store.event(
        "task.restore_reconciliation_required",
        "restore",
        { reason: "SOURCE_WORKER_OUTCOME_UNKNOWN", previous, reserved_units_to_unknown: task.budget.reserved_units },
        task.run_id,
        task.task_id,
      );
      unknownTasks.push(task.task_id);
    }
    for (const run of runs.values()) {
      if (run.dispatcher_owner !== null || run.dispatcher_until !== 0) {
        const previous = { owner: run.dispatcher_owner, until: run.dispatcher_until };
        run.dispatcher_owner = null;
        run.dispatcher_until = 0;
        detachedRuns.push(run.run_id);
        store.event("dispatcher.restore_detached", "restore", { previous }, run.run_id);
      }
      store.put("run", run.run_id, run);
    }
    store.event("restore.completed", "restore", {
      kind: "upgrade-state-only",
      detached_run_ids: detachedRuns,
      reconciliation_required_task_ids: unknownTasks,
      bitrix_restore: "NOT_RUN",
    });
    return { detached_run_ids: detachedRuns, reconciliation_required_task_ids: unknownTasks };
  });
}

export async function backupProject(store: Store, destination: string) {
  const root = resolve(destination);
  if (root === store.root || root.startsWith(store.root + sep))
    throw new UpgradeError("Backup must be outside project");
  await mkdir(root);
  const files: Record<string, string> = {};
  await mkdir(resolve(root, "state"));
  await backup(store.db, resolve(root, "state/upgrade.db"));
  files["state/upgrade.db"] = hash(
    await readFile(resolve(root, "state/upgrade.db")),
  );
  const copy = async (dir: string) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const from = resolve(dir, item.name),
        rel = relative(store.root, from).split(sep).join("/");
      if (item.isSymbolicLink())
        throw new UpgradeError("Backup symlink forbidden");
      if (
        ["state", "reports"].includes(rel) ||
        rel.endsWith(".lock") ||
        rel.endsWith(".tmp")
      )
        continue;
      if (item.isDirectory()) await copy(from);
      else {
        const to = resolve(root, rel);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(from, to);
        files[rel] = hash(await readFile(to));
      }
    }
  };
  await copy(store.root);
  const manifest = {
    schema_version: 1,
    project_id: store.getStatus().project.project_id,
    created_at: new Date().toISOString(),
    kind: "upgrade-state-only",
    files,
    bitrix_restore: "NOT_RUN",
  };
  await writeFile(
    resolve(root, "backup-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  store.event("backup.completed", "operator", {
    path: root,
    kind: manifest.kind,
    file_count: Object.keys(files).length,
  });
  return manifest;
}
export async function restoreProject(source: string, destination: string) {
  const root = resolve(source),
    target = resolve(destination);
  if (root === target || target.startsWith(root + sep))
    throw new UpgradeError("Restore must use separate empty path");
  const manifest = JSON.parse(
    await readFile(resolve(root, "backup-manifest.json"), "utf8"),
  );
  if (manifest.schema_version !== 1 || manifest.kind !== "upgrade-state-only")
    throw new UpgradeError("Invalid backup");
  if (
    !manifest.files ||
    Array.isArray(manifest.files) ||
    !manifest.files["state/upgrade.db"]
  )
    throw new UpgradeError("Backup file registry required");
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (
      typeof path !== "string" ||
      path.includes("\\") ||
      !/^[a-zA-Z0-9_.\/-]+$/.test(path) ||
      path.startsWith("/") ||
      path
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..") ||
      typeof expected !== "string" ||
      !/^[a-f0-9]{64}$/.test(expected)
    )
      throw new UpgradeError("Backup path escape");
    const file = inside(root, path);
    if (
      !(await lstat(file)).isFile() ||
      hash(await readFile(file)) !== expected
    )
      throw new UpgradeError("Backup hash mismatch", 5);
  }
  await mkdir(target);
  for (const path of Object.keys(manifest.files)) {
    const file = inside(target, path);
    await mkdir(dirname(file), { recursive: true });
    await copyFile(resolve(root, path), file);
  }
  const store = new Store(target);
  try {
    store.validateArtifacts();
    const recovery = detachRestoredOwnership(store);
    store.exportEvents();
    const status = store.getStatus();
    return {
      status: "RESTORED",
      kind: "upgrade-state-only",
      project_id: status.project.project_id,
      artifacts: status.artifacts.length,
      recovery,
      bitrix_restore: "NOT_RUN",
    };
  } finally {
    store.close();
  }
}
