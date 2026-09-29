/** Deterministic target for protocol tests. This is NOT Bitrix. */
import { DatabaseSync } from "node:sqlite";
import { hash, UpgradeError } from "./index.ts";
export interface ImportEntity {
  source_id: string;
  type: string;
  fields: Record<string, unknown>;
}
export interface ImportPackage {
  schema_version: 1;
  project_id: string;
  source_version: string;
  entities: ImportEntity[];
  sha256: string;
}
export const packageHash = (p: Omit<ImportPackage, "sha256">) =>
  hash(JSON.stringify(p));
export class FixtureTarget {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS ownership(project TEXT PRIMARY KEY,token INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS entities(project TEXT,type TEXT,source_id TEXT,fields TEXT,baseline TEXT,PRIMARY KEY(project,type,source_id));`,
    );
  }
  close() {
    this.db.close();
  }
  fence(project: string, token: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT token FROM ownership WHERE project=?")
        .get(project) as { token: number } | undefined;
      if (prior && token <= prior.token)
        throw new UpgradeError("Fence must increase");
      this.db
        .prepare(
          "INSERT INTO ownership VALUES(?,?) ON CONFLICT(project) DO UPDATE SET token=excluded.token",
        )
        .run(project, token);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  read(project: string) {
    return this.db
      .prepare("SELECT * FROM entities WHERE project=? ORDER BY type,source_id")
      .all(project)
      .map((r) => ({ ...r, fields: JSON.parse(String(r.fields)) }));
  }
  edit(
    project: string,
    type: string,
    id: string,
    fields: Record<string, unknown>,
  ) {
    this.db
      .prepare(
        "UPDATE entities SET fields=? WHERE project=? AND type=? AND source_id=?",
      )
      .run(JSON.stringify(fields), project, type, id);
  }
  apply(
    project: string,
    token: number,
    p: ImportPackage,
    { dryRun = false, crashAfterCommit = false } = {},
  ) {
    const { sha256, ...body } = p;
    if (
      p.schema_version !== 1 ||
      p.project_id !== project ||
      packageHash(body) !== sha256
    )
      throw new UpgradeError("Invalid package/project/hash", 5);
    if (
      new Set(p.entities.map((e) => e.type + "\0" + e.source_id)).size !==
        p.entities.length ||
      p.entities.some(
        (e) => !e.source_id || !e.type || !e.fields || Array.isArray(e.fields),
      )
    )
      throw new UpgradeError("Invalid or duplicate entity", 5);
    this.db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const owner = this.db
        .prepare("SELECT token FROM ownership WHERE project=?")
        .get(project) as { token: number } | undefined;
      if (owner?.token !== token)
        throw new UpgradeError("Stale target fence", 3);
      const report = {
        target: "fixture-only",
        created: 0,
        updated: 0,
        skipped: 0,
        conflicts: [] as string[],
        dry_run: dryRun,
      };
      for (const e of p.entities) {
        const row = this.db
          .prepare(
            "SELECT fields,baseline FROM entities WHERE project=? AND type=? AND source_id=?",
          )
          .get(project, e.type, e.source_id) as
          { fields: string; baseline: string } | undefined;
        const desired = JSON.stringify(e.fields);
        if (!row) {
          report.created++;
          if (!dryRun)
            this.db
              .prepare("INSERT INTO entities VALUES(?,?,?,?,?)")
              .run(project, e.type, e.source_id, desired, desired);
        } else if (row.fields === desired) {
          report.skipped++;
        } else if (row.fields !== row.baseline) {
          report.conflicts.push(e.source_id);
        } else {
          report.updated++;
          if (!dryRun)
            this.db
              .prepare(
                "UPDATE entities SET fields=?,baseline=? WHERE project=? AND type=? AND source_id=?",
              )
              .run(desired, desired, project, e.type, e.source_id);
        }
      }
      this.db.exec("COMMIT");
      committed = true;
      if (crashAfterCommit)
        throw new UpgradeError(
          "Simulated lost acknowledgement after COMMIT",
          99,
        );
      return report;
    } catch (e) {
      if (!committed) this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
