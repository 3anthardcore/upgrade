#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, projectRoot, UpgradeError, uid } from "../core/index.ts";
import { Pipeline } from "../core/pipeline.ts";
import { doctor } from "../core/doctor.ts";
import { loadProfile } from "../core/config.ts";
import { backupProject, restoreProject } from "../core/backup.ts";
import { ingestOperatorCapture } from "../core/operator-capture.ts";
import type { Task, AgentResult, Check } from "../contracts/index.ts";
export const EXIT = {
  OK: 0,
  CONFIG: 2,
  INCOMPLETE: 3,
  ACCESS: 4,
  VERIFY: 5,
  INTERNAL: 70,
};
function args(argv: string[]) {
  const positional: string[] = [],
    flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      positional.push(argv[i]);
      continue;
    }
    const name = argv[i].slice(2);
    if (!name) throw new UpgradeError("Invalid flag");
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { positional, flags };
}
export async function main(argv = process.argv.slice(2)) {
  const {
    positional: [command, sub],
    flags: f,
  } = args(argv);
  const text = (key: string, required = false) => {
    const v = f[key];
    if (required && typeof v !== "string")
      throw new UpgradeError(`--${key} required`);
    return typeof v === "string" ? v : undefined;
  };
  const number = (key: string, fallback: number) => {
    const v = text(key);
    const n = v === undefined ? fallback : Number(v);
    if (!Number.isFinite(n) || n < 1)
      throw new UpgradeError(`--${key} must be positive`);
    return n;
  };
  const data = resolve(
    text("data-dir") ?? process.env.UPGRADE_DATA_DIR ?? "var/projects",
  );
  const print = (value: unknown) =>
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  if (!command || command === "help" || f.help) {
    print({
      tool: "Upgrade",
      version: "0.1.0",
      commands: [
        "doctor",
        "init --source URL --id ID",
        "plan --project ID",
        "run --project ID --until demo-ready",
        "status --project ID --json",
        "inspect --project ID --task TASK",
        "task create|claim|heartbeat|submit|review",
        "artifact add --project ID --file FILE --type TYPE",
        "operator-capture ingest --project ID --directory PATH --manifest-sha256 SHA256",
        "operator model --project ID --capture ID --manifest-sha256 SHA256 [--page URL | --all-observed]",
        "operator build --project ID --capture ID --manifest-sha256 SHA256 --model MODEL_ID [--all-observed]",
        "crawl|extract|build|verify|report|package --project ID",
        "crawl|run --project ID --ack-access-block BLOCK_ID --access-resolution-reason TEXT",
        "import --project ID --dry-run",
        "pause|resume|retry|cancel --project ID",
        "backup --project ID --to PATH",
        "restore --from PATH --to PATH",
        "agents --project ID --file dispatch.json",
        "deploy --project ID --environment production --release ID",
      ],
      note: "Bitrix integration gates remain NOT_RUN until a licensed isolated target is configured. No command implies production authorization.",
    });
    return 0;
  }
  if (command === "doctor") {
    loadProfile(text("profile") ?? "public");
    const result = await doctor(data);
    print(result);
    return result.checks.node.ok ? 0 : 2;
  }
  if (command === "restore") {
    print(await restoreProject(text("from", true)!, text("to", true)!));
    return 0;
  }
  const accessBlock = text("ack-access-block");
  const accessReason = text("access-resolution-reason");
  const accessRequested =
    f["ack-access-block"] !== undefined ||
    f["access-resolution-reason"] !== undefined;
  if (
    accessRequested &&
    (!["crawl", "run"].includes(command) ||
      !accessBlock ||
      !/^access-[A-Za-z0-9-]+$/.test(accessBlock) ||
      !accessReason ||
      accessReason.trim().length < 10 ||
      accessReason.trim().length > 2000)
  )
    throw new UpgradeError(
      "Use crawl/run with --ack-access-block BLOCK_ID and --access-resolution-reason TEXT (10..2000 characters); confirm legitimate source access first",
    );
  const id = text(command === "init" ? "id" : "project", true)!;
  const root = projectRoot(data, id);
  if (command !== "init" && !existsSync(resolve(root, "state/upgrade.db")))
    throw new UpgradeError("Project does not exist");
  const store = new Store(root);
  const pipeline = new Pipeline(store, {
    fixtureOrigin: text("fixture-origin"),
    browser: Boolean(f.browser),
    maxPages: text("max-pages") ? number("max-pages", 10000) : undefined,
    maxRequests: text("max-requests")
      ? number("max-requests", 65000)
      : undefined,
    maxBytes: text("max-bytes")
      ? number("max-bytes", 10_737_418_240)
      : undefined,
    targetUrl: text("target-url"),
    accessResume: accessRequested
      ? {
          blockId: accessBlock!,
          acknowledgementId: uid("access-ack"),
          reason: accessReason!.trim(),
        }
      : undefined,
  });
  try {
    let value: unknown,
      exit = 0;
    switch (command) {
      case "init":
        value = store.createProject(
          id,
          text("source", true)!,
          text("profile") ?? "public",
          loadProfile(text("profile") ?? "public"),
        );
        break;
      case "plan":
        const profile =
          store.list<ReturnType<typeof loadProfile>>("profile")[0] ??
          loadProfile();
        value = store.planRun(
          number("max-tasks", profile.agents.max_tasks),
          number("max-seconds", profile.agents.max_wall_time_seconds),
        );
        break;
      case "status":
        value = store.getStatus();
        break;
      case "inspect":
        value = store.get("task", text("task", true)!);
        break;
      case "pause":
        value = store.setRunStatus("PAUSED");
        break;
      case "cancel":
        const { cancelPersistedJobs } =
          await import("../codex-adapter/index.ts");
        value = {
          run: store.setRunStatus("CANCELLED"),
          agents: cancelPersistedJobs(resolve(root, "agent-jobs")),
        };
        break;
      case "resume":
        value = store.resumeRun();
        break;
      case "retry": {
        const task = store.get<Task>("task", text("task", true)!);
        if (
          !["FAILED", "RETRY_WAIT", "STALE"].includes(task.status) ||
          task.attempt >= task.max_attempts
        )
          throw new UpgradeError("Task cannot retry");
        task.status = "RETRY_WAIT";
        store.transaction(() => {
          store.put("task", task.task_id, task);
          store.event(
            "task.retry_scheduled",
            "operator",
            {},
            task.run_id,
            task.task_id,
          );
        });
        value = task;
        break;
      }
      case "task": {
        const taskId = text("task");
        switch (sub) {
          case "create":
            value = store.createTask(
              JSON.parse(readFileSync(text("file", true)!, "utf8")),
            );
            break;
          case "claim":
            value = store.claimTask(
              taskId!,
              text("worker", true)!,
              number("ttl-ms", 60000),
            );
            break;
          case "heartbeat":
            value = store.heartbeatTask(
              taskId!,
              text("worker", true)!,
              number("lease", 0),
            );
            break;
          case "submit":
            value = store.submitResult(
              taskId!,
              text("worker", true)!,
              number("lease", 0),
              JSON.parse(
                readFileSync(text("file", true)!, "utf8"),
              ) as AgentResult,
            );
            break;
          case "review": {
            const reviewer = text("reviewer", true)!;
            if (text("decision") === "accept")
              value = store.acceptTask(
                taskId!,
                reviewer,
                JSON.parse(
                  readFileSync(text("report", true)!, "utf8"),
                ) as Check[],
              );
            else if (text("decision") === "reject")
              value = store.rejectTask(
                taskId!,
                reviewer,
                text("reason", true)!,
              );
            else
              throw new UpgradeError(
                "Review decision must be accept or reject",
              );
            break;
          }
          default:
            throw new UpgradeError("Unknown task command");
        }
        break;
      }
      case "artifact":
        if (sub !== "add") throw new UpgradeError("Use artifact add");
        value = store.publishArtifact(
          text("type", true)!,
          readFileSync(text("file", true)!),
          text("task") ?? null,
          text("worker"),
          text("lease") ? number("lease", 0) : undefined,
        );
        break;
      case "operator-capture":
        if (sub !== "ingest")
          throw new UpgradeError("Use operator-capture ingest");
        value = await ingestOperatorCapture(store, {
          directory: text("directory", true)!,
          expectedManifestSha256: text("manifest-sha256", true)!,
          manifestPath: text("manifest"),
        });
        break;
      case "operator": {
        if (f["all-observed"] !== undefined && f["all-observed"] !== true)
          throw new UpgradeError(
            "--all-observed is an explicit flag without a value",
          );
        const { createOperatorModel, buildOperatorPackage } =
          await import("../core/operator-model.ts");
        const options = {
          captureId: text("capture", true)!,
          manifestSha256: text("manifest-sha256", true)!,
          page: text("page"),
          allObserved: f["all-observed"] === true,
        };
        if (sub === "model") value = await createOperatorModel(store, options);
        else if (sub === "build")
          value = await buildOperatorPackage(store, {
            ...options,
            modelId: text("model", true)!,
          });
        else throw new UpgradeError("Use operator model or operator build");
        break;
      }
      case "run":
        if (text("until") && text("until") !== "demo-ready")
          throw new UpgradeError("Only --until demo-ready is supported");
        value = await pipeline.run();
        exit = 3;
        break;
      case "crawl":
        value = await pipeline.locked(() => pipeline.crawl());
        if (store.currentRun().execution_status === "PAUSED") exit = 3;
        break;
      case "extract":
        value = await pipeline.locked(() => pipeline.extract());
        break;
      case "build":
      case "package":
        value = await pipeline.locked(() => pipeline.build());
        break;
      case "import":
        if (!f["dry-run"] && !f.apply)
          throw new UpgradeError("Choose --dry-run or --apply");
        if (f.apply && text("environment") !== "demo")
          throw new UpgradeError(
            "Import apply requires explicit demo environment",
          );
        value = await pipeline.locked(() =>
          pipeline.import(Boolean(f["dry-run"])),
        );
        if (f.apply) exit = 4;
        break;
      case "verify":
        value = await pipeline.locked(() => pipeline.verify());
        pipeline.report();
        exit = 3;
        break;
      case "report":
        value = pipeline.report();
        break;
      case "backup":
        value = await pipeline.locked(
          () => backupProject(store, text("to", true)!),
          { maintenance: true },
        );
        break;
      case "agents": {
        const { CodexAdapter } = await import("../codex-adapter/index.ts");
        const { CodexDispatcher } =
          await import("../codex-adapter/dispatcher.ts");
        const dispatch = JSON.parse(readFileSync(text("file", true)!, "utf8"));
        const adapter = new CodexAdapter(resolve(root, "agent-jobs"));
        value = await new CodexDispatcher(
          store,
          adapter,
          `cli-agents:${process.pid}`,
        ).execute(dispatch);
        break;
      }
      case "deploy": {
        const release = text("release", true)!;
        const known = store
          .list<any>("stage")
          .find((s) => s.id === "build" && s.release_id === release);
        if (!known) throw new UpgradeError("Unknown release id");
        value = {
          status: "BLOCKED",
          release_id: release,
          environment: text("environment", true),
          reasons: [
            "Deployment executor is not enabled until target profile, Bitrix QA, backup/restore, data delta and authorized scope are configured.",
          ],
          production_changed: false,
        };
        store.event("deploy.blocked", "operator", value);
        exit = 4;
        break;
      }
      default:
        throw new UpgradeError(`Unknown command: ${command}`);
    }
    store.exportEvents();
    print(value);
    return exit;
  } finally {
    store.close();
  }
}
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    // Node resolves module URLs through symlinks; argv preserves the invoked path.
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main()
    .then((code) => (process.exitCode = code))
    .catch((error) => {
      process.stderr.write(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof UpgradeError ? error.code : 70,
        }) + "\n",
      );
      process.exitCode = error instanceof UpgradeError ? error.code : 70;
    });
}
