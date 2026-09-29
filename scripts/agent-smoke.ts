import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Store } from "../packages/core/index.ts";
import { CodexAdapter, atomicJson } from "../packages/codex-adapter/index.ts";
import { CodexDispatcher } from "../packages/codex-adapter/dispatcher.ts";

// Explicit env wins; otherwise resolve only the model name from the operator's installed config.
const config = resolve(
  process.env.CODEX_HOME ?? resolve(homedir(), ".codex"),
  "config.toml",
);
const model =
  process.env.UPGRADE_CODEX_MODEL ??
  (existsSync(config)
    ? readFileSync(config, "utf8").match(/^model\s*=\s*"([^"\r\n]+)"/m)?.[1]
    : undefined);
if (!model)
  throw new Error(
    "Set UPGRADE_CODEX_MODEL to a model available to your Codex CLI account",
  );
const runRoot = resolve(
  process.env.UPGRADE_AGENT_SMOKE_ROOT ?? `var/agent-smoke-${Date.now()}`,
);
mkdirSync(runRoot, { recursive: true });
const store = new Store(runRoot);
store.createProject("agent-smoke", "https://fixture.invalid/");
store.planRun(4, 300);
const input = store.publishArtifact(
  "smoke-input.json",
  JSON.stringify({
    paths: ["/", "/catalog/item/?size=M"],
    facts: [
      { source_id: "item-1", name: "Observed fixture item", price: null },
    ],
  }),
);
const tasks = [
  {
    task_id: "smoke-researcher",
    role: "researcher",
    goal: "Copy the two observed paths into a structured URL registry.",
    expected: { kind: "urls", values: ["/", "/catalog/item/?size=M"] },
  },
  {
    task_id: "smoke-analyst",
    role: "data-analyst",
    goal: "Return observed source_id and literal unknown price marker; preserve missing factual data.",
    expected: { kind: "facts", values: ["item-1", "price:unknown"] },
  },
];
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "values"],
  properties: {
    kind: { type: "string" },
    values: { type: "array", items: { type: "string" } },
  },
};
for (const task of tasks)
  store.createTask({
    task_id: task.task_id,
    idempotency_key: task.task_id,
    role: task.role,
    goal: task.goal,
    stage: "AGENT_SMOKE",
    input_artifact_ids: [input.artifact_id],
    allowed_paths: [`outputs/${task.task_id}`],
    allowed_tools: [],
    acceptance_checks: ["schema-and-facts"],
    budget: { max_seconds: 150, reserved_units: 1 },
    max_attempts: 1,
  });
const adapter = new CodexAdapter(resolve(runRoot, "agent-jobs"));
let report: Record<string, unknown> = {
  test: "AT-22",
  status: "NOT_RUN",
  root: runRoot,
  model,
  probe: adapter.probe(),
};
try {
  const results = await new CodexDispatcher(
    store,
    adapter,
    "smoke-dispatcher",
  ).execute(
    tasks.map((task) => ({
      taskId: task.task_id,
      model,
      workspace: runRoot,
      resultSchema: schema,
      prompt: `${task.goal}\nUse only the supplied fixture facts. Required output shape: ${JSON.stringify(task.expected)}. Return only JSON. Do not call tools.`,
    })),
  );
  for (const result of results) {
    const expected = tasks.find((t) => t.task_id === result.taskId)!.expected;
    if (JSON.stringify(result.result) !== JSON.stringify(expected)) {
      store.rejectTask(
        result.taskId,
        "deterministic-fact-checker",
        "Fixture facts differ",
      );
      throw new Error("Independent fact check failed");
    }
    store.validateArtifact(result.artifact.artifact_id);
    store.acceptTask(result.taskId, "deterministic-fact-checker", [
      {
        id: "schema-and-facts",
        status: "PASS",
        details:
          "Exact fixture facts, result schema and independently recomputed SHA-256 verified",
      },
    ]);
  }
  const start = Math.max(...results.map((r) => Date.parse(r.job.startedAt!))),
    end = Math.min(...results.map((r) => Date.parse(r.job.finishedAt!)));
  if (end <= start)
    throw new Error("Two actual Codex executions did not overlap");
  report = {
    ...report,
    status: "PASS",
    parallel_overlap_ms: end - start,
    results: results.map((r) => ({
      task_id: r.taskId,
      job_id: r.jobId,
      artifact_id: r.artifact.artifact_id,
      sha256: r.artifact.sha256,
      started_at: r.job.startedAt,
      finished_at: r.job.finishedAt,
      usage: r.job.usage,
      runtime_version: r.job.runtimeVersion,
    })),
    reviewer: "deterministic-fact-checker",
    scope:
      "Real Codex CLI parallel execution, schema/facts/hash review; no Bitrix integration and no tool-using agent workflow tested",
    cost_status: "UNAVAILABLE",
  };
} catch (error) {
  report = {
    ...report,
    status: "NOT_RUN",
    reason: error instanceof Error ? error.message : "Agent smoke failed",
  };
  process.exitCode = 1;
} finally {
  store.exportEvents();
  atomicJson(resolve(runRoot, "agent-smoke-report.json"), report);
  store.close();
  console.log(JSON.stringify(report, null, 2));
}
