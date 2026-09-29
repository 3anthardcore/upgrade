import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CodexAdapter,
  buildExecArgs,
  normalizeEvent,
  cancelPersistedJobs,
} from "../../packages/codex-adapter/index.ts";
import { CodexDispatcher } from "../../packages/codex-adapter/dispatcher.ts";
import { Store } from "../../packages/core/index.ts";

test("Codex args are shell-free, explicit, read-only and retain untrusted punctuation literally", () => {
  const args = buildExecArgs(
    {
      taskId: "one",
      role: "researcher",
      model: "configured-model",
      workspace: "space path; $(no)",
      prompt: "untrusted",
      resultSchema: { type: "object" },
      timeoutMs: 1000,
      allowedTools: [],
    },
    "/tmp/jobs/example",
  );
  assert.equal(args[0], "exec");
  assert.equal(args.at(-1), "-");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("--model") + 1], "configured-model");
  assert(args.includes("--ignore-user-config"));
  assert(args.includes("shell_tool"));
  assert(!args.some((a) => a.includes("untrusted")));
  assert(args[args.indexOf("--cd") + 1].includes("$(no)"));
});
test("Codex event adapter drops reasoning, raw errors, messages, commands and unknown fields", () => {
  assert.equal(
    normalizeEvent({
      type: "item.completed",
      item: { type: "reasoning", text: "private chain" },
    }),
    null,
  );
  assert(
    !JSON.stringify(
      normalizeEvent({ type: "error", message: "secret-value" }),
    ).includes("secret-value"),
  );
  assert(
    !JSON.stringify(
      normalizeEvent({
        type: "item.completed",
        item: { type: "agent_message", text: "private message" },
      }),
    ).includes("private message"),
  );
  assert.equal(
    normalizeEvent({
      type: "item.started",
      item: { type: "command_execution", command: "dangerous" },
    })?.type,
    "agent.tool_policy_violation",
  );
  assert.deepEqual(
    normalizeEvent({
      type: "turn.completed",
      usage: { input_tokens: 3, output_tokens: 4, secret: "do not persist" },
    })?.usage,
    { input_tokens: 3, output_tokens: 4 },
  );
});
test("durable worker result survives a new adapter, cancellation and timeout stop actual child processes", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "upgrade-codex-"));
  try {
    const fake = resolve(root, "fake.mjs");
    writeFileSync(
      fake,
      `import fs from 'node:fs';const a=process.argv.slice(2);if(a[0]==='--version'){console.log('fixture-cli 1');process.exit(0)}if(a.includes('--help')){console.log('--json --output-schema --output-last-message --sandbox --cd --ignore-user-config --ephemeral');process.exit(0)}console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-only'}));let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{if(s.includes('WAIT'))setInterval(()=>{},1000);else {fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({ok:true}));console.log(JSON.stringify({type:'turn.completed',usage:{output_tokens:2}}));}});`,
    );
    mkdirSync(resolve(root, "roles"));
    writeFileSync(resolve(root, "roles/researcher.md"), "Fixture role");
    const options = {
      command: { executable: process.execPath, prefixArgs: [fake] },
      rolesRoot: resolve(root, "roles"),
    };
    const adapter = new CodexAdapter(resolve(root, "jobs"), options);
    const request = {
      taskId: "fixture",
      role: "researcher",
      model: "test-only",
      workspace: root,
      prompt: "OK",
      resultSchema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
      timeoutMs: 5000,
      allowedTools: [] as [],
    };
    const done = async (id: string) => {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        const job = adapter.poll(id);
        if (!["STARTING", "RUNNING"].includes(job.status)) return job;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("Fixture worker did not finish");
    };
    const job = adapter.start(request);
    assert.equal((await done(job.id)).status, "SUCCEEDED");
    const restored = new CodexAdapter(resolve(root, "jobs"), options);
    assert.deepEqual(restored.collectResult(job.id).result, { ok: true });
    assert.equal(restored.collectResult(job.id).job.usage?.output_tokens, 2);
    const cancelled = adapter.start({ ...request, prompt: "WAIT" });
    adapter.cancel(cancelled.id);
    assert.equal((await done(cancelled.id)).status, "CANCELLED");
    const timed = adapter.start({ ...request, prompt: "WAIT", timeoutMs: 300 });
    assert.equal((await done(timed.id)).status, "TIMED_OUT");
    const durableCancel = adapter.start({ ...request, prompt: "WAIT" });
    const cancelledOnDisk = cancelPersistedJobs(resolve(root, "jobs"));
    assert(cancelledOnDisk.requested.includes(durableCancel.id));
    assert.deepEqual(cancelledOnDisk.errors, []);
    assert.equal((await done(durableCancel.id)).status, "CANCELLED");
    const store = new Store(resolve(root, "project"));
    try {
      store.createProject("cancel-test", "https://fixture.invalid/");
      store.planRun(5, 60);
      store.createTask({
        task_id: "cancel-task",
        role: "researcher",
        stage: "TEST",
        goal: "Exercise persisted cancellation",
        budget: { max_seconds: 10, reserved_units: 1 },
      });
      const execution = new CodexDispatcher(
        store,
        adapter,
        "fixture-dispatcher",
      ).execute([
        {
          taskId: "cancel-task",
          model: "test-only",
          workspace: root,
          prompt: "WAIT",
          resultSchema: request.resultSchema,
        },
      ]);
      const timer = setTimeout(() => store.setRunStatus("CANCELLED"), 300);
      try {
        await assert.rejects(execution, /terminated: CANCELLED/);
      } finally {
        clearTimeout(timer);
      }
      const cancelledJob = readdirSync(resolve(root, "jobs"))
        .map((id) => adapter.poll(id))
        .find((item) => item.taskId === "cancel-task")!;
      assert.equal((await done(cancelledJob.id)).status, "CANCELLED");
      assert.equal(store.list("artifact").length, 0);
    } finally {
      store.close();
    }
    assert(
      !readFileSync(
        resolve(root, "jobs", job.id, "events.jsonl"),
        "utf8",
      ).includes("private"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
