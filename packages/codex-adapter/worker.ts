import { spawn, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import { atomicJson, normalizeEvent } from "./index.ts";
import type { AgentJob, AgentEvent } from "./index.ts";

// The worker owns its child tree and durable terminal status even if the CLI exits.
const directory = resolve(process.argv[2]),
  jobPath = resolve(directory, "job.json");
const job: AgentJob = JSON.parse(readFileSync(jobPath, "utf8"));
const eventPath = resolve(directory, "events.jsonl");
writeFileSync(eventPath, "", { mode: 0o600 });
const persist = () => atomicJson(jobPath, job);
const log = (event: AgentEvent) =>
  appendFileSync(eventPath, JSON.stringify(event) + "\n");
job.workerPid = process.pid;
job.status = "RUNNING";
job.startedAt = new Date().toISOString();
persist();
const child = spawn(
  job.command.executable,
  [...job.command.prefixArgs, ...job.args],
  {
    cwd: job.workspace,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  },
);
job.childPid = child.pid;
persist();
let buffer = "",
  bytes = 0,
  closed = false,
  toolViolation = false;
const killTree = () => {
  if (!child.pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      timeout: 10000,
    });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};
const stop = (status: "CANCELLED" | "TIMED_OUT" | "FAILED", code: string) => {
  if (closed) return;
  job.status = status;
  job.errorCode = code;
  killTree();
};
const consume = (line: string) => {
  try {
    const event = normalizeEvent(JSON.parse(line));
    if (!event) return;
    log(event);
    if (event.usage) job.usage = event.usage;
    if (event.type === "agent.tool_policy_violation") {
      toolViolation = true;
      stop("FAILED", "TOOL_POLICY_VIOLATION");
    }
  } catch {
    /* Non-JSON diagnostics and unknown vendor events are not persisted. */
  }
};
child.stdout.on("data", (chunk: Buffer) => {
  bytes += chunk.length;
  if (bytes > 2 * 1024 * 1024) {
    stop("FAILED", "EVENT_LIMIT_EXCEEDED");
    return;
  }
  buffer += chunk.toString("utf8");
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    consume(buffer.slice(0, at));
    buffer = buffer.slice(at + 1);
  }
  if (buffer.length > 1024 * 1024) stop("FAILED", "EVENT_LINE_LIMIT_EXCEEDED");
});
// Diagnostics may contain credentials or private paths. Record only a bounded count.
child.stderr.on("data", (chunk: Buffer) => {
  bytes += chunk.length;
  if (bytes > 2 * 1024 * 1024) stop("FAILED", "EVENT_LIMIT_EXCEEDED");
});
child.stdin.on("error", () => {});
child.stdin.end(readFileSync(resolve(directory, "prompt.txt")));
const timer = setInterval(() => {
  if (existsSync(resolve(directory, "cancel.requested")))
    stop("CANCELLED", "CANCEL_REQUESTED");
  else if (Date.now() - Date.parse(job.startedAt!) >= job.timeoutMs)
    stop("TIMED_OUT", "WALL_TIME_LIMIT");
}, 200);
const finish = (exitCode: number | null) => {
  if (closed) return;
  closed = true;
  clearInterval(timer);
  if (buffer.trim()) consume(buffer);
  job.exitCode = exitCode;
  job.finishedAt = new Date().toISOString();
  if (job.status === "RUNNING") {
    if (exitCode !== 0 || toolViolation) {
      job.status = "FAILED";
      job.errorCode = "CODEX_EXEC_FAILED";
    } else
      try {
        const result = JSON.parse(
          readFileSync(resolve(directory, "result.json"), "utf8"),
        );
        const validate = new Ajv().compile(
          JSON.parse(
            readFileSync(resolve(directory, "result.schema.json"), "utf8"),
          ),
        );
        if (!validate(result)) throw new Error("schema");
        job.status = "SUCCEEDED";
      } catch {
        job.status = "FAILED";
        job.errorCode = "INVALID_RESULT";
      }
  }
  log({ type: "agent.process_finished", timestamp: job.finishedAt, exitCode });
  persist();
};
child.on("error", () => {
  job.status = "FAILED";
  job.errorCode = "CODEX_SPAWN_FAILED";
  finish(null);
});
child.on("close", finish);
process.on("SIGTERM", () => stop("CANCELLED", "WORKER_TERMINATED"));
process.on("SIGINT", () => stop("CANCELLED", "WORKER_INTERRUPTED"));
