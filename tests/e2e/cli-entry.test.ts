import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const version = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
function subprocess(argv: string[], input?: string) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", ...argv],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      input,
    },
  );
}
function cleanup(directory: string) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^upgrade-cli-entry-[a-zA-Z0-9_-]+$/);
  rmSync(target, { recursive: true, force: true });
}
test("CLI runs through a current symlink/junction and stays inert when imported", () => {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-cli-entry-"));
  const current = join(directory, "current");
  let linked = false;
  try {
    symlinkSync(
      root,
      current,
      process.platform === "win32" ? "junction" : "dir",
    );
    linked = true;
    const entry = join(current, "packages/cli/index.ts");
    const help = subprocess([entry, "help"]);
    assert.equal(help.status, 0, help.stderr || String(help.error));
    const result = JSON.parse(help.stdout);
    assert.equal(result.tool, "Upgrade");
    assert.equal(result.version, version);
    assert.ok(result.commands.includes("doctor"));
    assert.ok(
      result.commands.some((command: string) => command.startsWith("status ")),
    );

    const data = join(directory, "data");
    const initialized = subprocess([
      entry,
      "init",
      "--id",
      "entry-test",
      "--source",
      "https://example.test/",
      "--data-dir",
      data,
    ]);
    assert.equal(
      initialized.status,
      0,
      initialized.stderr || String(initialized.error),
    );
    assert.equal(JSON.parse(initialized.stdout).project_id, "entry-test");
    const status = subprocess([
      entry,
      "status",
      "--project",
      "entry-test",
      "--data-dir",
      data,
    ]);
    assert.equal(status.status, 0, status.stderr || String(status.error));
    assert.equal(JSON.parse(status.stdout).project.project_id, "entry-test");

    const imported = join(directory, "import-only.mjs");
    writeFileSync(
      imported,
      `const cli = await import(${JSON.stringify(pathToFileURL(entry).href)});\nif(typeof cli.main !== 'function') throw Error('Missing callable main');\nprocess.stdout.write('IMPORT_ONLY\\n');\n`,
    );
    const probe = subprocess([imported, "help"]);
    assert.equal(probe.status, 0, probe.stderr || String(probe.error));
    assert.equal(probe.stdout, "IMPORT_ONLY\n");
  } finally {
    if (linked) unlinkSync(current);
    cleanup(directory);
  }
});

test("deployment help validator rejects empty output and wrong CLI contracts", () => {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-cli-entry-"));
  try {
    const installer = readFileSync(join(root, "scripts/deploy-app.sh"), "utf8");
    const validator = installer.match(
      /<<'HELP_CHECK'\r?\n([\s\S]*?)\r?\nHELP_CHECK/,
    );
    assert.ok(validator, "actual deployment validator must be present");
    const help = join(directory, "help.json");
    const valid = {
      tool: "Upgrade",
      version,
      commands: [
        "doctor",
        "init --source URL",
        "run --project ID",
        "status --project ID",
      ],
    };
    const cases = [
      { name: "valid", text: JSON.stringify(valid), ok: true },
      { name: "empty success", text: "", ok: false },
      { name: "invalid JSON", text: "not JSON", ok: false },
      {
        name: "wrong tool",
        text: JSON.stringify({ ...valid, tool: "Other" }),
        ok: false,
      },
      {
        name: "wrong version",
        text: JSON.stringify({ ...valid, version: "0.0.0" }),
        ok: false,
      },
      {
        name: "missing command",
        text: JSON.stringify({ ...valid, commands: ["doctor"] }),
        ok: false,
      },
      {
        name: "invalid commands",
        text: JSON.stringify({ ...valid, commands: [1] }),
        ok: false,
      },
    ];
    for (const item of cases) {
      writeFileSync(help, item.text);
      const check = subprocess(
        ["--input-type=commonjs", "-", help, join(root, "package.json")],
        validator[1],
      );
      assert.equal(
        check.status === 0,
        item.ok,
        `${item.name}: ${check.stderr || check.error || "unexpected success"}`,
      );
    }
  } finally {
    cleanup(directory);
  }
});
