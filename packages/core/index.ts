import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  realpathSync,
  lstatSync,
  chmodSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import { stringify } from "yaml";
import { resultSchema } from "../contracts/index.ts";
import { validateContract } from "../contracts/schemas.ts";
import type {
  Task,
  AgentResult,
  Artifact,
  Run,
  Project,
  Check,
} from "../contracts/index.ts";

const now = () => new Date().toISOString();
export const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export const uid = (prefix: string) => `${prefix}-${randomUUID()}`;
export class UpgradeError extends Error {
  code: number;
  constructor(message: string, code = 2) {
    super(message);
    this.code = code;
  }
}
export function inside(root: string, path: string) {
  const base = resolve(root),
    target = resolve(root, path);
  const rel = relative(base, target);
  if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel))
    throw new UpgradeError("Path outside project or root path");
  let cursor = target;
  while (cursor !== base) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new UpgradeError("Symlink path forbidden");
    cursor = dirname(cursor);
  }
  if (existsSync(base) && realpathSync(base) !== base)
    throw new UpgradeError("Project root must not be a symlink");
  return target;
}
export function projectRoot(data: string, id: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))
    throw new UpgradeError("Invalid project id");
  return inside(data, id);
}
export class Store {
  root: string;
  db: DatabaseSync;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(resolve(root, "state"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(resolve(root, "state/upgrade.db"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL,run_id TEXT,task_id TEXT,type TEXT NOT NULL,actor TEXT NOT NULL,timestamp_utc TEXT NOT NULL,correlation_id TEXT,causation_id TEXT,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT OR IGNORE INTO metadata VALUES('schema_version','1');`);
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get<T>(kind: string, id: string): T {
    const r = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { body: string } | undefined;
    if (!r) throw new UpgradeError(`${kind} not found: ${id}`);
    return JSON.parse(r.body);
  }
  list<T>(kind: string): T[] {
    return (
      this.db
        .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid")
        .all(kind) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  put(kind: string, id: string, v: unknown) {
    if (["task", "artifact", "project"].includes(kind))
      validateContract(kind as "task" | "artifact" | "project", v);
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
      )
      .run(kind, id, JSON.stringify(v));
  }
  event(
    type: string,
    actor: string,
    payload: unknown = {},
    run_id: string | null = null,
    task_id: string | null = null,
  ) {
    const p = this.list<Project>("project")[0];
    this.db
      .prepare(
        "INSERT INTO events(event_id,project_id,run_id,task_id,type,actor,timestamp_utc,correlation_id,causation_id,payload) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        uid("evt"),
        p?.project_id ?? "bootstrap",
        run_id,
        task_id,
        type,
        actor,
        now(),
        run_id,
        null,
        JSON.stringify(payload),
      );
  }
  events(): Array<
    Record<string, unknown> & { type: string; payload: unknown }
  > {
    return this.db
      .prepare("SELECT * FROM events ORDER BY sequence")
      .all()
      .map((r) => ({
        ...r,
        type: String(r.type),
        payload: JSON.parse(String(r.payload)),
      }));
  }
  exportEvents() {
    const path = inside(this.root, "events.jsonl");
    writeFileSync(
      path,
      this.events()
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    return path;
  }
  createProject(
    id: string,
    source: string,
    profile = "public",
    configuredProfile?: unknown,
  ): Project {
    const u = new URL(source);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new UpgradeError("HTTP(S) source without credentials required");
    if (configuredProfile !== undefined)
      validateContract("profile", configuredProfile);
    const p: Project = {
      schema_version: 1,
      project_id: id,
      source: {
        entry_url: source,
        allowed_hosts: [u.host],
        mode: "public-demo",
      },
      target: { platform: "bitrix", environment_profile: profile },
      created_at: now(),
    };
    this.transaction(() => {
      if (this.list("project").length)
        throw new UpgradeError("Project already initialized");
      this.put("project", id, p);
      if (configuredProfile !== undefined)
        this.put("profile", "configured", configuredProfile);
      this.event("project.created", "operator", { source });
    });
    writeFileSync(inside(this.root, "project.yaml"), stringify(p));
    return p;
  }
  planRun(maxUnits = 100, maxSeconds = 3600): Run {
    if (
      !Number.isSafeInteger(maxUnits) ||
      maxUnits < 1 ||
      !Number.isFinite(maxSeconds) ||
      maxSeconds < 1
    )
      throw new UpgradeError("Finite positive budget required");
    return this.transaction(() => {
      const p = this.list<Project>("project")[0];
      if (!p) throw new UpgradeError("Initialize project first");
      const prior = this.list<Run>("run").find(
        (r) =>
          !["COMPLETED", "CANCELLED", "FAILED"].includes(r.execution_status),
      );
      if (prior) return prior;
      const r: Run = {
        run_id: uid("run"),
        project_id: p.project_id,
        phase: "PREFLIGHT",
        execution_status: "ACTIVE",
        dispatcher_owner: null,
        dispatcher_until: 0,
        budget: {
          max_units: maxUnits,
          spent: 0,
          reserved: 0,
          unknown: 0,
          max_seconds: maxSeconds,
          started_at: Date.now(),
        },
        created_at: now(),
      };
      this.put("run", r.run_id, r);
      this.event("run.created", "operator", {}, r.run_id);
      return r;
    });
  }
  currentRun() {
    const rows = this.list<Run>("run");
    if (!rows.length) throw new UpgradeError("Plan run first");
    return rows.at(-1)!;
  }
  acquireDispatcher(runId: string, owner: string, ttl = 60000) {
    return this.transaction(() => {
      const r = this.get<Run>("run", runId);
      if (
        r.dispatcher_owner &&
        r.dispatcher_owner !== owner &&
        r.dispatcher_until > Date.now()
      )
        throw new UpgradeError("Dispatcher already owned", 3);
      r.dispatcher_owner = owner;
      r.dispatcher_until = Date.now() + ttl;
      this.put("run", runId, r);
      this.event("dispatcher.claimed", owner, {}, runId);
      return r;
    });
  }
  releaseDispatcher(runId: string, owner: string) {
    this.transaction(() => {
      const r = this.get<Run>("run", runId);
      if (r.dispatcher_owner !== owner)
        throw new UpgradeError("Not dispatcher owner");
      r.dispatcher_owner = null;
      r.dispatcher_until = 0;
      this.put("run", runId, r);
      this.event("dispatcher.released", owner, {}, runId);
    });
  }
  createTask(
    input: Partial<Task> & Pick<Task, "role" | "goal" | "stage">,
  ): Task {
    return this.transaction(() => {
      const r = this.currentRun();
      const existing = this.list<Task>("task").find(
        (t) =>
          t.run_id === r.run_id &&
          t.idempotency_key === (input.idempotency_key ?? input.task_id),
      );
      if (existing) return existing;
      const deps = input.depends_on ?? [];
      for (const id of deps) {
        const d = this.get<Task>("task", id);
        if (d.run_id !== r.run_id) throw new UpgradeError("Foreign dependency");
      }
      for (const path of input.allowed_paths ?? []) inside(this.root, path);
      for (const id of input.input_artifact_ids ?? [])
        this.validateArtifact(id);
      const t: Task = {
        schema_version: 1,
        task_id: input.task_id ?? uid("task"),
        project_id: r.project_id,
        run_id: r.run_id,
        stage: input.stage,
        role: input.role,
        goal: input.goal,
        input_artifact_ids: input.input_artifact_ids ?? [],
        depends_on: deps,
        allowed_paths: input.allowed_paths ?? [],
        allowed_tools: input.allowed_tools ?? [],
        acceptance_checks: input.acceptance_checks ?? [],
        status: deps.every(
          (id) => this.get<Task>("task", id).status === "ACCEPTED",
        )
          ? "READY"
          : "PENDING",
        attempt: 0,
        max_attempts: input.max_attempts ?? 3,
        lease_owner: null,
        lease_until: null,
        fencing_token: 0,
        budget: input.budget ?? { max_seconds: 300, reserved_units: 1 },
        idempotency_key: input.idempotency_key ?? input.task_id ?? uid("idem"),
        created_at: now(),
        updated_at: now(),
      };
      if (this.list<Task>("task").some((x) => x.task_id === t.task_id))
        throw new UpgradeError("Duplicate task id");
      if (
        t.max_attempts < 1 ||
        t.max_attempts > 3 ||
        t.budget.reserved_units < 1 ||
        t.budget.max_seconds < 1
      )
        throw new UpgradeError("Invalid task limits");
      this.put("task", t.task_id, t);
      this.event("task.created", "dispatcher", {}, r.run_id, t.task_id);
      return t;
    });
  }
  inputHash(t: Task) {
    return hash(
      JSON.stringify(
        t.input_artifact_ids.map((id) => {
          const a = this.validateArtifact(id);
          return [id, a.sha256];
        }),
      ),
    );
  }
  claimTask(id: string, worker: string, ttl = 60000): Task {
    if (!worker || !Number.isFinite(ttl) || ttl < 1)
      throw new UpgradeError("Worker and positive TTL required");
    // Expiry accounting commits even when the following retry cannot reserve more budget.
    this.transaction(() => {
      const t = this.get<Task>("task", id);
      if (t.status === "RUNNING" && t.lease_until! <= Date.now()) {
        const r = this.get<Run>("run", t.run_id);
        r.budget.reserved -= t.budget.reserved_units;
        r.budget.unknown += t.budget.reserved_units;
        t.status = t.attempt < t.max_attempts ? "RETRY_WAIT" : "FAILED";
        t.fencing_token++;
        this.put("run", r.run_id, r);
        this.put("task", id, t);
        this.event("task.lease_expired", "dispatcher", {}, t.run_id, id);
      }
    });
    const outcome = this.transaction(() => {
      const t = this.get<Task>("task", id),
        r = this.get<Run>("run", t.run_id);
      if (r.execution_status !== "ACTIVE")
        throw new UpgradeError("Run is not active", 3);
      if (!["READY", "PENDING", "RETRY_WAIT", "STALE"].includes(t.status))
        throw new UpgradeError("Task not claimable");
      if (t.retry_after && t.retry_after > Date.now())
        throw new UpgradeError("Retry backoff active", 3);
      if (t.attempt >= t.max_attempts)
        throw new UpgradeError("Task attempts exhausted", 3);
      if (
        !t.depends_on.every(
          (d) => this.get<Task>("task", d).status === "ACCEPTED",
        )
      )
        throw new UpgradeError("Dependencies not accepted", 3);
      if (
        Date.now() - r.budget.started_at >= r.budget.max_seconds * 1000 ||
        r.budget.spent +
          r.budget.reserved +
          r.budget.unknown +
          t.budget.reserved_units >
          r.budget.max_units
      ) {
        r.execution_status = "PAUSED";
        this.put("run", r.run_id, r);
        this.event(
          "run.paused",
          "dispatcher",
          { reason: "budget_exhausted" },
          r.run_id,
        );
        return null;
      }
      t.status = "RUNNING";
      t.attempt++;
      t.fencing_token++;
      t.lease_owner = worker;
      t.attempt_started_at = Date.now();
      t.lease_until = Math.min(
        Date.now() + ttl,
        t.attempt_started_at + t.budget.max_seconds * 1000,
      );
      t.input_hash = this.inputHash(t);
      t.updated_at = now();
      r.budget.reserved += t.budget.reserved_units;
      this.put("run", r.run_id, r);
      this.put("task", id, t);
      this.event(
        "task.claimed",
        worker,
        { fencing_token: t.fencing_token, attempt: t.attempt },
        t.run_id,
        id,
      );
      return t;
    });
    if (!outcome) throw new UpgradeError("Run budget exhausted", 3);
    return outcome;
  }
  lease(t: Task, worker: string, token: number) {
    if (
      t.status !== "RUNNING" ||
      t.lease_owner !== worker ||
      t.fencing_token !== token ||
      !t.lease_until ||
      t.lease_until <= Date.now() ||
      (t.attempt_started_at !== undefined &&
        Date.now() >= t.attempt_started_at + t.budget.max_seconds * 1000)
    )
      throw new UpgradeError("Expired or stale lease", 3);
    const run = this.get<Run>("run", t.run_id);
    if (["CANCELLED", "FAILED"].includes(run.execution_status))
      throw new UpgradeError("Run terminated", 3);
    if (Date.now() >= run.budget.started_at + run.budget.max_seconds * 1000)
      throw new UpgradeError("Run wall-time budget exhausted", 3);
  }
  heartbeatTask(id: string, worker: string, token: number, ttl = 60000) {
    return this.transaction(() => {
      const t = this.get<Task>("task", id);
      this.lease(t, worker, token);
      if (!Number.isFinite(ttl) || ttl < 1)
        throw new UpgradeError("Positive TTL required");
      t.lease_until = Math.min(
        Date.now() + ttl,
        (t.attempt_started_at ?? Date.now()) + t.budget.max_seconds * 1000,
      );
      t.updated_at = now();
      this.put("task", id, t);
      this.event("task.heartbeat", worker, {}, t.run_id, id);
      return t;
    });
  }
  publishArtifact(
    type: string,
    data: string | Buffer,
    taskId: string | null = null,
    worker?: string,
    token?: number,
  ): Artifact {
    const r = this.currentRun(),
      bytes = Buffer.from(data);
    if (taskId) this.lease(this.get<Task>("task", taskId), worker!, token!);
    const id = uid("art"),
      rel = `artifacts/${id}/${type.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      path = inside(this.root, rel);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = path + ".tmp";
    writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temp, path);
    chmodSync(path, 0o400);
    const a: Artifact = {
      artifact_id: id,
      project_id: r.project_id,
      run_id: r.run_id,
      type,
      relative_path: rel,
      sha256: hash(bytes),
      size_bytes: bytes.length,
      schema_version: 1,
      producer_task_id: taskId,
      input_hashes: taskId
        ? this.get<Task>("task", taskId).input_artifact_ids.map(
            (id) => this.validateArtifact(id).sha256,
          )
        : [],
      created_at: now(),
      validation_status: "VALID",
    };
    this.transaction(() => {
      if (taskId) this.lease(this.get<Task>("task", taskId), worker!, token!);
      this.put("artifact", id, a);
      this.event(
        "artifact.proposed",
        worker ?? "operator",
        { artifact_id: id, sha256: a.sha256 },
        r.run_id,
        taskId,
      );
    });
    return a;
  }
  validateArtifact(id: string): Artifact {
    const a = this.get<Artifact>("artifact", id),
      r = this.currentRun();
    if (a.project_id !== r.project_id)
      throw new UpgradeError("Foreign artifact");
    const bytes = readFileSync(inside(this.root, a.relative_path));
    if (bytes.length !== a.size_bytes || hash(bytes) !== a.sha256)
      throw new UpgradeError("Artifact hash mismatch", 5);
    return a;
  }
  validateArtifacts() {
    return this.list<Artifact>("artifact").map((a) =>
      this.validateArtifact(a.artifact_id),
    );
  }
  submitResult(id: string, worker: string, token: number, result: AgentResult) {
    const validate = new Ajv().compile(resultSchema);
    if (!validate(result))
      throw new UpgradeError(
        "Invalid result schema: " + JSON.stringify(validate.errors),
      );
    return this.transaction(() => {
      const t = this.get<Task>("task", id);
      this.lease(t, worker, token);
      if (
        result.task_id !== id ||
        result.attempt !== t.attempt ||
        result.input_hash !== t.input_hash ||
        result.input_hash !== this.inputHash(t)
      )
        throw new UpgradeError("Result does not match current inputs");
      for (const aId of result.artifact_ids) {
        const a = this.validateArtifact(aId);
        if (a.run_id !== t.run_id || a.producer_task_id !== id)
          throw new UpgradeError("Foreign task artifact");
      }
      t.result = result;
      t.status = "VALIDATING";
      t.updated_at = now();
      this.put("task", id, t);
      const r = this.get<Run>("run", t.run_id);
      r.budget.reserved -= t.budget.reserved_units;
      r.budget.spent += t.budget.reserved_units;
      this.put("run", r.run_id, r);
      this.event(
        "task.submitted",
        worker,
        { artifact_ids: result.artifact_ids, usage: result.usage },
        t.run_id,
        id,
      );
      return t;
    });
  }
  acceptTask(id: string, reviewer: string, checks: Check[]) {
    return this.transaction(() => {
      const t = this.get<Task>("task", id);
      if (t.status !== "VALIDATING" || !t.result)
        throw new UpgradeError("Task has no submitted result");
      if (reviewer === t.lease_owner)
        throw new UpgradeError("Author cannot accept own result");
      if (
        !checks.length ||
        checks.some((c) => c.status !== "PASS") ||
        t.acceptance_checks.some(
          (c) => !checks.some((x) => x.id === c && x.status === "PASS"),
        ) ||
        t.result.unresolved_issues.length ||
        t.result.checks.some((c) => c.status !== "PASS")
      )
        throw new UpgradeError("Required checks not passed", 5);
      if (this.inputHash(t) !== t.result.input_hash)
        throw new UpgradeError("Stale inputs", 5);
      for (const a of t.result.artifact_ids) this.validateArtifact(a);
      t.status = "ACCEPTED";
      t.updated_at = now();
      this.put("task", id, t);
      this.event("task.accepted", reviewer, { checks }, t.run_id, id);
      return t;
    });
  }
  rejectTask(id: string, reviewer: string, reason: string) {
    return this.transaction(() => {
      const t = this.get<Task>("task", id);
      if (reviewer === t.lease_owner)
        throw new UpgradeError("Independent reviewer required");
      if (t.status !== "VALIDATING")
        throw new UpgradeError("Task is not validating");
      t.status = t.attempt < t.max_attempts ? "RETRY_WAIT" : "FAILED";
      t.retry_after = Date.now() + 1000 * 2 ** t.attempt;
      t.updated_at = now();
      this.put("task", id, t);
      this.event("task.rejected", reviewer, { reason }, t.run_id, id);
      return t;
    });
  }
  invalidateArtifact(id: string, replacementId: string) {
    this.validateArtifact(replacementId);
    return this.transaction(() => {
      const affected = new Set<string>();
      for (const t of this.list<Task>("task"))
        if (t.input_artifact_ids.includes(id)) affected.add(t.task_id);
      let change = true;
      while (change) {
        change = false;
        for (const t of this.list<Task>("task"))
          if (
            t.depends_on.some((d) => affected.has(d)) &&
            !affected.has(t.task_id)
          ) {
            affected.add(t.task_id);
            change = true;
          }
      }
      for (const taskId of affected) {
        const t = this.get<Task>("task", taskId);
        if (t.status === "RUNNING") {
          const r = this.get<Run>("run", t.run_id);
          r.budget.reserved -= t.budget.reserved_units;
          r.budget.unknown += t.budget.reserved_units;
          this.put("run", r.run_id, r);
        }
        t.status = "STALE";
        t.fencing_token++;
        t.input_artifact_ids = t.input_artifact_ids.map((a) =>
          a === id ? replacementId : a,
        );
        this.put("task", taskId, t);
      }
      this.event("artifact.superseded", "operator", {
        id,
        replacementId,
        affected: [...affected],
      });
      return [...affected];
    });
  }
  setRunStatus(status: string) {
    if (
      !["ACTIVE", "PAUSED", "BLOCKED", "FAILED", "CANCELLED"].includes(status)
    )
      throw new UpgradeError(
        "Unsupported status: readiness requires independent evidence",
      );
    return this.transaction(() => {
      const r = this.currentRun();
      if (status === "ACTIVE" && r.execution_status === "CANCELLED")
        throw new UpgradeError("Cancelled runs cannot resume");
      r.execution_status = status;
      this.put("run", r.run_id, r);
      if (status === "CANCELLED") {
        for (const t of this.list<Task>("task").filter(
          (t) =>
            t.run_id === r.run_id &&
            !["ACCEPTED", "FAILED", "CANCELLED"].includes(t.status),
        )) {
          if (t.status === "RUNNING") {
            r.budget.reserved -= t.budget.reserved_units;
            r.budget.unknown += t.budget.reserved_units;
          }
          t.status = "CANCELLED";
          t.fencing_token++;
          this.put("task", t.task_id, t);
        }
        this.put("run", r.run_id, r);
      }
      this.event(
        status === "ACTIVE" ? "run.resumed" : `run.${status.toLowerCase()}`,
        "operator",
        {},
        r.run_id,
      );
      return r;
    });
  }
  resumeRun() {
    this.validateArtifacts();
    return this.setRunStatus("ACTIVE");
  }
  getStatus() {
    return {
      project: this.list<Project>("project")[0],
      run: this.list<Run>("run").at(-1),
      tasks: this.list<Task>("task"),
      artifacts: this.list<Artifact>("artifact"),
      last_event: this.events().at(-1),
    };
  }
  async runStage<T>(stage: string, fn: () => T | Promise<T>) {
    const r = this.currentRun();
    if (r.execution_status !== "ACTIVE")
      throw new UpgradeError("Run paused or blocked", 3);
    this.transaction(() => {
      r.phase = stage;
      this.put("run", r.run_id, r);
      this.event("stage.started", "dispatcher", { stage }, r.run_id);
    });
    try {
      const result = await fn();
      this.event("stage.completed", "dispatcher", { stage }, r.run_id);
      return result;
    } catch (e) {
      this.event(
        "stage.failed",
        "dispatcher",
        { stage, error: String(e) },
        r.run_id,
      );
      throw e;
    }
  }
  exportReport() {
    return {
      schema_version: 1,
      ...this.getStatus(),
      events: this.events(),
      generated_at: now(),
      readiness: "NOT_VERIFIED",
    };
  }
}
