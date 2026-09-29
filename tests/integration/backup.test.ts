import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../packages/core/index.ts";
import { backupProject, restoreProject } from "../../packages/core/backup.ts";
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
