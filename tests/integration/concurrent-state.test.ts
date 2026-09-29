import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { Store } from "../../packages/core/index.ts";
function processCall(root: string, action: string) {
  const script = `import {Store} from ${JSON.stringify(pathToFileURL(resolve("packages/core/index.ts")).href)}; const s=new Store(process.argv[1]);try{${action}}catch(e){console.log(JSON.stringify({refused:true,error:e.message}));}finally{s.close();}`;
  return new Promise<any>((res, rej) => {
    const p = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        script,
        root,
      ],
      { windowsHide: true, shell: false },
    );
    let out = "",
      err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("error", rej);
    p.on("exit", (code) => {
      if (code !== 0) rej(new Error(err));
      else
        try {
          res(JSON.parse(out));
        } catch {
          rej(new Error(out + err));
        }
    });
  });
}
test("two actual processes share one run and cannot both own the same task", async () => {
  const root = mkdtempSync(join(tmpdir(), "upgrade-processes-"));
  const s = new Store(root);
  try {
    s.createProject("concurrency", "https://example.com/");
    const planned = await Promise.all([
      processCall(root, "console.log(JSON.stringify(s.planRun()));"),
      processCall(root, "console.log(JSON.stringify(s.planRun()));"),
    ]);
    assert.equal(planned[0].run_id, planned[1].run_id);
    assert.equal(s.list("run").length, 1);
    s.createTask({
      task_id: "shared",
      role: "qa",
      stage: "TEST",
      goal: "one owner",
    });
    const claims = await Promise.all([
      processCall(
        root,
        'console.log(JSON.stringify(s.claimTask("shared","worker-a")));',
      ),
      processCall(
        root,
        'console.log(JSON.stringify(s.claimTask("shared","worker-b")));',
      ),
    ]);
    assert.equal(claims.filter((c) => c.status === "RUNNING").length, 1);
    assert.equal(claims.filter((c) => c.refused).length, 1);
    assert.equal(s.currentRun().budget.reserved, 1);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
