import {
  mkdirSync,
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
let output: string | undefined, releaseId: string | undefined;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--output") output = args[++index];
  else if (args[index] === "--release") releaseId = args[++index];
  else
    throw new Error(
      "Usage: node scripts/package-app.ts --output /path/app.tar.gz [--release release-id]",
    );
}
if (!output) throw new Error("--output is required");
output = resolve(output);
if (
  existsSync(output) ||
  existsSync(output + ".sha256") ||
  existsSync(output + ".manifest.json")
)
  throw new Error("Refusing to overwrite an existing package or receipt");
const topFiles = [
  "AGENTS.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".gitignore",
  ".gitattributes",
  ".env.example",
  ".nvmrc",
  "runtime-manifest.json",
];
const topDirectories = [
  ".agents",
  "agents",
  "configs",
  "docs",
  "packages",
  "bitrix",
  "infra",
  "scripts",
  "tests",
];
const denied = new Set([
  ".git",
  "node_modules",
  "var",
  ".cache",
  "test-results",
  "playwright-report",
  "secrets",
  "distribution",
]);
const extensions =
  /\.(?:md|json|ya?ml|ts|js|mjs|cjs|sh|py|php|css|html|svg|conf|ini)$/;
const files: Array<{ path: string; sha256: string; bytes: number }> = [];
let total = 0;
const staged = mkdtempSync(resolve(tmpdir(), "upgrade-app-package-"));
try {
  const include = (source: string) => {
    const info = lstatSync(source),
      name = relative(root, source).split(sep).join("/");
    if (info.isSymbolicLink())
      throw new Error(`Symlink not allowed in application package: ${name}`);
    if (!info.isFile()) throw new Error(`Non-regular package file: ${name}`);
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.split("/").includes(".."))
      throw new Error(`Unsafe package filename: ${name}`);
    if (info.size > 20 * 1024 * 1024)
      throw new Error("Application source package exceeds finite size limit");
    const bytes = readFileSync(source);
    if (
      bytes.length > 20 * 1024 * 1024 ||
      (total += bytes.length) > 200 * 1024 * 1024
    )
      throw new Error("Application source package exceeds finite size limit");
    const target = resolve(staged, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
    files.push({ path: name, sha256: hash(bytes), bytes: bytes.length });
  };
  const walk = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        denied.has(item.name) ||
        (item.name.startsWith(".env") && item.name !== ".env.example") ||
        /\.(?:db|sqlite|pem|key|pfx|log|zip|gz|xz)$/i.test(item.name)
      )
        continue;
      const path = resolve(directory, item.name);
      if (item.isSymbolicLink()) throw new Error("Symlink in source tree");
      if (item.isDirectory()) walk(path);
      else if (
        extensions.test(item.name) ||
        item.name === "Dockerfile" ||
        item.name === ".env.example"
      )
        include(path);
    }
  };
  for (const name of topFiles) {
    const path = resolve(root, name);
    if (existsSync(path)) include(path);
  }
  for (const name of topDirectories) {
    const path = resolve(root, name);
    if (existsSync(path)) walk(path);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (
    !files.some((f) => f.path === "packages/cli/index.ts") ||
    !files.some((f) => f.path === "package-lock.json")
  )
    throw new Error("Required application inputs are missing");
  const contentHash = hash(JSON.stringify(files));
  releaseId ??= `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z-${contentHash.slice(0, 12)}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(releaseId))
    throw new Error("Invalid release ID");
  const manifest = {
    schema_version: 1,
    kind: "upgrade-application-source",
    release_id: releaseId,
    created_at: new Date().toISOString(),
    source_sha256: contentHash,
    runtime: { node: "24.20.0", platform: "linux-x64" },
    file_count: files.length,
    source_bytes: total,
    excludes: [
      "client state",
      "credentials",
      "node_modules",
      ".git",
      "licensed Bitrix distribution",
    ],
    files,
  };
  writeFileSync(
    resolve(staged, "upgrade-app-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  mkdirSync(dirname(output), { recursive: true });
  const temp = output + ".partial";
  if (existsSync(temp))
    throw new Error("Partial archive already exists; inspect it before retry");
  const archive = spawnSync("tar", ["-czf", temp, "-C", staged, "."], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  if (archive.status !== 0)
    throw new Error(`tar failed: ${archive.error?.message ?? archive.stderr}`);
  const digest = hash(readFileSync(temp));
  renameSync(temp, output);
  writeFileSync(output + ".sha256", digest + "\n", { flag: "wx" });
  writeFileSync(
    output + ".manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify(
      {
        archive: output,
        sha256: digest,
        release_id: releaseId,
        source_sha256: contentHash,
        file_count: files.length,
        source_bytes: total,
        archive_bytes: lstatSync(output).size,
        manifest: output + ".manifest.json",
      },
      null,
      2,
    ),
  );
} finally {
  const temporaryBase = resolve(tmpdir()),
    cleanupTarget = resolve(staged),
    child = relative(temporaryBase, cleanupTarget);
  if (
    dirname(cleanupTarget) !== temporaryBase ||
    !/^upgrade-app-package-[a-zA-Z0-9_-]+$/.test(child) ||
    lstatSync(cleanupTarget).isSymbolicLink()
  )
    throw new Error(
      "Refusing cleanup outside the verified package staging directory",
    );
  rmSync(cleanupTarget, { recursive: true, force: true });
}
