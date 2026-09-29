import { spawn } from "node:child_process";
import { statfsSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { CodexAdapter, resolveCodexCommand } from "../codex-adapter/index.ts";
async function command(
  bin: string,
  args: string[],
  timeout = 8000,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((res) => {
    let out = "";
    let settled = false;
    const p = spawn(bin, args, { windowsHide: true, shell: false });
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res({ ok, output: out.trim().slice(0, 1500) });
    };
    const timer = setTimeout(() => {
      p.kill();
      out += " timeout";
      done(false);
    }, timeout);
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    p.on("error", (e) => {
      out = e.message;
      done(false);
    });
    p.on("exit", (code) => done(code === 0));
  });
}
export async function doctor(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const disk = statfsSync(dataDir);
  let codex: unknown;
  try {
    const cmd = resolveCodexCommand();
    const adapter = new CodexAdapter(resolve(dataDir, ".doctor-jobs"), {
      command: cmd,
    });
    const probe = adapter.probe();
    const auth = await command(cmd.executable, [
      ...cmd.prefixArgs,
      "login",
      "status",
    ]);
    codex = {
      ok: probe.available,
      ...probe,
      authentication: auth.ok ? "AUTHENTICATED" : "NOT_AUTHENTICATED",
    };
  } catch (e) {
    codex = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const [php, docker, wsl] = await Promise.all([
    command(process.env.UPGRADE_PHP_BIN ?? "php", ["--version"]),
    command("docker", ["info", "--format", "{{.ServerVersion}}"]),
    process.platform === "win32"
      ? command("wsl", ["--exec", "sh", "-lc", "uname -r; node --version"])
      : Promise.resolve({ ok: true, output: "native Linux" }),
  ]);
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    checks: {
      node: { ok: Number(process.versions.node.split(".")[0]) === 24 },
      storage: {
        ok: disk.bavail * disk.bsize > 5_000_000_000,
        free_bytes: disk.bavail * disk.bsize,
        path: resolve(dataDir),
      },
      browser: {
        ok: existsSync(chromium.executablePath()),
        path: chromium.executablePath(),
      },
      codex,
      php,
      docker,
      wsl,
      bitrix: {
        ok: false,
        status: "NOT_RUN",
        reason:
          "Operator must configure licensed Bitrix root, isolated database and environment profile.",
      },
    },
    blockers: [
      "No licensed Bitrix environment configured; DEMO_READY is blocked.",
    ],
    notes: [
      "Docker daemon availability is distinct from CLI installation.",
      "Run npm run test:agents for real parallel execution and structured-output verification.",
      "Single-operator filesystem is not an OS multi-tenant security boundary.",
    ],
  };
}
