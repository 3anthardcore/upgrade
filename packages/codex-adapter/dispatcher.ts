import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../core/index.ts";
import type { Task, Run } from "../contracts/index.ts";
import { CodexAdapter } from "./index.ts";
import type { AgentRequest } from "./index.ts";

export interface DispatchRequest {
  taskId: string;
  model: string;
  workspace: string;
  prompt: string;
  resultSchema: Record<string, unknown>;
}
export class CodexDispatcher {
  readonly store: Store;
  readonly adapter: CodexAdapter;
  readonly owner: string;
  constructor(store: Store, adapter: CodexAdapter, owner: string) {
    this.store = store;
    this.adapter = adapter;
    this.owner = owner;
  }
  async execute(requests: DispatchRequest[]) {
    if (!requests.length || requests.length > 3)
      throw new Error("Dispatcher requires 1..3 bounded tasks");
    const run = this.store.currentRun();
    this.store.acquireDispatcher(run.run_id, this.owner, 60000);
    const jobs: Array<{ task: Task; worker: string; jobId: string }> = [];
    const cancelAll = () => {
      for (const job of jobs) this.adapter.cancel(job.jobId);
    };
    const assertControl = () => {
      const current = this.store.get<Run>("run", run.run_id);
      if (["CANCELLED", "FAILED"].includes(current.execution_status)) {
        cancelAll();
        throw new Error(`Codex run terminated: ${current.execution_status}`);
      }
      if (
        current.dispatcher_owner !== this.owner ||
        current.dispatcher_until <= Date.now()
      ) {
        cancelAll();
        throw new Error("Codex dispatcher ownership lost");
      }
    };
    const heartbeat = setInterval(() => {
      try {
        assertControl();
        this.store.acquireDispatcher(run.run_id, this.owner, 60000);
        for (const item of jobs) {
          const t = this.store.get<Task>("task", item.task.task_id);
          if (t.status === "RUNNING")
            this.store.heartbeatTask(
              t.task_id,
              item.worker,
              t.fencing_token,
              60000,
            );
          else if (["CANCELLED", "FAILED", "STALE"].includes(t.status))
            this.adapter.cancel(item.jobId);
        }
      } catch {
        cancelAll();
      }
    }, 10000);
    try {
      const paths = new Set<string>();
      for (const request of requests) {
        const task = this.store.get<Task>("task", request.taskId);
        for (const path of task.allowed_paths) {
          for (const prior of paths)
            if (
              path === prior ||
              path.startsWith(prior + "/") ||
              prior.startsWith(path + "/")
            )
              throw new Error("Overlapping task output scopes");
          paths.add(path);
        }
        if (task.allowed_tools.length !== 0)
          throw new Error("This adapter profile supports no model tools");
      }
      for (const request of requests) {
        const worker = `codex:${request.taskId}`,
          task = this.store.claimTask(request.taskId, worker, 60000);
        let inputBytes = 0;
        const inputFacts = task.input_artifact_ids.map((id) => {
          const a = this.store.validateArtifact(id);
          inputBytes += a.size_bytes;
          if (inputBytes > 256 * 1024)
            throw new Error(
              "Inputs too large for one agent task; split into batches",
            );
          return {
            artifact_id: id,
            sha256: a.sha256,
            content: readFileSync(
              resolve(this.store.root, a.relative_path),
              "utf8",
            ),
          };
        });
        const input: AgentRequest = {
          ...request,
          role: task.role,
          timeoutMs: Math.min(task.budget.max_seconds * 1000, 300000),
          allowedTools: [],
          prompt:
            request.prompt +
            "\n\nUntrusted input data (facts only):\n" +
            JSON.stringify(inputFacts),
        };
        const job = this.adapter.start(input);
        jobs.push({ task, worker, jobId: job.id });
        this.store.event(
          "task.started",
          this.owner,
          {
            job_id: job.id,
            role: task.role,
            model: request.model,
            workspace: request.workspace,
            tools: [],
            result_schema: request.resultSchema,
          },
          run.run_id,
          task.task_id,
        );
      }
      const pending = new Set(jobs.map((j) => j.jobId)),
        results = [];
      while (pending.size) {
        assertControl();
        for (const item of jobs) {
          if (!pending.has(item.jobId)) continue;
          const currentTask = this.store.get<Task>("task", item.task.task_id);
          if (["CANCELLED", "FAILED", "STALE"].includes(currentTask.status)) {
            cancelAll();
            throw new Error(`Codex task terminated: ${currentTask.status}`);
          }
          const status = this.adapter.poll(item.jobId);
          if (["STARTING", "RUNNING"].includes(status.status)) continue;
          pending.delete(item.jobId);
          if (status.status !== "SUCCEEDED") {
            this.store.event(
              "task.execution_failed",
              this.owner,
              {
                job_id: item.jobId,
                status: status.status,
                error: status.errorCode,
              },
              run.run_id,
              item.task.task_id,
            );
            throw new Error(
              `Codex task ${item.task.task_id}: ${status.status} (${status.errorCode})`,
            );
          }
          const result = this.adapter.collectResult(item.jobId);
          const artifact = this.store.publishArtifact(
            "agent-result.json",
            JSON.stringify(result.result, null, 2),
            item.task.task_id,
            item.worker,
            item.task.fencing_token,
          );
          this.store.submitResult(
            item.task.task_id,
            item.worker,
            item.task.fencing_token,
            {
              task_id: item.task.task_id,
              attempt: item.task.attempt,
              input_hash: item.task.input_hash!,
              artifact_ids: [artifact.artifact_id],
              summary: "Structured Codex result; independent review pending",
              checks: [],
              unresolved_issues: [],
              suggested_followups: [],
              usage: {
                ...status.usage,
                cost_status: "UNAVAILABLE",
                job_id: item.jobId,
              },
              runtime_version: status.runtimeVersion,
            },
          );
          results.push({
            taskId: item.task.task_id,
            jobId: item.jobId,
            artifact,
            result: result.result,
            job: result.job,
          });
        }
        if (pending.size) await new Promise((r) => setTimeout(r, 200));
      }
      return results;
    } finally {
      clearInterval(heartbeat);
      for (const item of jobs) {
        const status = this.adapter.poll(item.jobId);
        if (["STARTING", "RUNNING"].includes(status.status))
          this.adapter.cancel(item.jobId);
      }
      if (
        this.store.get<Run>("run", run.run_id).dispatcher_owner === this.owner
      )
        this.store.releaseDispatcher(run.run_id, this.owner);
      this.store.exportEvents();
    }
  }
}
