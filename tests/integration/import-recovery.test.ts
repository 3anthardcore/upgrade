import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FixtureTarget,
  packageHash,
} from "../../packages/core/fixture-target.ts";
import type { ImportPackage } from "../../packages/core/fixture-target.ts";
function pack(project = "a", name = "First"): ImportPackage {
  const p = {
    schema_version: 1 as const,
    project_id: project,
    source_version: "snapshot-1",
    entities: [
      { type: "Page", source_id: "stable", fields: { name, price: null } },
    ],
  };
  return { ...p, sha256: packageHash(p) };
}
test("unknown write reconciles from destination after process restart with no duplicates", () => {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-import-"));
  try {
    const path = join(dir, "target.db");
    let target = new FixtureTarget(path);
    target.fence("a", 1);
    assert.throws(
      () => target.apply("a", 1, pack(), { crashAfterCommit: true }),
      /lost acknowledgement/,
    );
    target.close();
    target = new FixtureTarget(path);
    const actual = target.read("a");
    assert.equal(actual.length, 1);
    assert.equal(actual[0].fields.price, null);
    const report = target.apply("a", 1, pack());
    assert.equal(report.created, 0);
    assert.equal(report.skipped, 1);
    target.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("fencing, three-way conflicts, dry run and project boundary", () => {
  const t = new FixtureTarget(":memory:");
  try {
    t.fence("a", 1);
    assert.equal(t.apply("a", 1, pack(), { dryRun: true }).created, 1);
    assert.equal(t.read("a").length, 0);
    t.apply("a", 1, pack());
    t.edit("a", "Page", "stable", { name: "Owner edit", price: null });
    assert.deepEqual(t.apply("a", 1, pack("a", "Changed source")).conflicts, [
      "stable",
    ]);
    assert.equal(t.read("a")[0].fields.name, "Owner edit");
    t.fence("a", 2);
    assert.throws(() => t.apply("a", 1, pack()), /Stale target/);
    assert.throws(() => t.apply("a", 2, pack("b")), /project/);
    assert.equal(t.read("b").length, 0);
    const corrupt = pack();
    corrupt.entities[0].fields.name = "tampered";
    assert.throws(() => t.apply("a", 2, corrupt), /hash/);
  } finally {
    t.close();
  }
});
