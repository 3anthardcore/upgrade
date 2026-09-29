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
    const status = store.getStatus();
    return {
      status: "RESTORED",
      kind: "upgrade-state-only",
      project_id: status.project.project_id,
      artifacts: status.artifacts.length,
      bitrix_restore: "NOT_RUN",
    };
  } finally {
    store.close();
  }
}
