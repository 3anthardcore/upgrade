/** Root operator boundary. This module never opens the content Store. */
import { constants } from "node:fs";
import {
  open,
  lstat,
  realpath,
  readFile,
  mkdir,
  readdir,
  rename,
  chmod,
} from "node:fs/promises";
import { resolve, relative, dirname, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { executeNativeTarget, loadNativeProfile } from "./native.ts";
import type { NativeRunner } from "./native.ts";
import { validateBitrixPackage } from "./index.ts";
import {
  HANDOFF_LIMITS,
  handoffHash,
  handoffJson,
  handoffAssert as need,
  handoffEqual,
  parseHandoff,
  validateHandoffProfile,
  validateHandoffRequest,
  validateHandoffReceipt,
} from "../contracts/native-handoff.ts";
import type {
  NativeHandoffReceipt,
  NativeHandoffProfile,
  NativeHandoffRequest,
} from "../contracts/native-handoff.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
export async function nativeExecutorFingerprint() {
  const files = [
    "packages/contracts/native-handoff.ts",
    "packages/bitrix-adapter/handoff.ts",
    "packages/bitrix-adapter/native.ts",
    "packages/bitrix-adapter/index.ts",
    "scripts/execute-native-handoff.ts",
    "packages/bitrix-adapter/package.schema.json",
    "packages/bitrix-adapter/demo.ts",
    "package-lock.json",
  ];
  const rows: unknown[] = [];
  for (const name of files)
    rows.push([name, handoffHash(await readFile(resolve(repo, name)))]);
  return handoffHash(JSON.stringify(rows));
}
export async function readHandoffFile(path: string, cap: number, pin?: string) {
  const info = await lstat(path);
  need(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.nlink === 1 &&
      info.size <= cap,
    "BOUNDED_FILE_REQUIRED",
  );
  const f = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await f.stat();
    need(
      before.isFile() &&
        before.ino === info.ino &&
        before.dev === info.dev &&
        before.size <= cap,
      "FILE_CHANGED",
    );
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const r = await f.read(bytes, offset, bytes.length - offset, offset);
      need(r.bytesRead > 0, "SHORT_READ");
      offset += r.bytesRead;
    }
    const after = await f.stat();
    need(
      before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "FILE_CHANGED",
    );
    if (pin) need(handoffHash(bytes) === pin, "FILE_PIN_MISMATCH");
    return bytes;
  } finally {
    await f.close();
  }
}
async function securePath(
  path: string,
  directory: boolean,
  test: boolean,
  cmsLeaf = false,
) {
  need(
    isAbsolute(path) &&
      resolve(path) === path &&
      (await realpath(path)) === path,
    "CANONICAL_PATH_REQUIRED",
  );
  let current = path;
  for (;;) {
    const info = await lstat(current);
    need(
      !info.isSymbolicLink() &&
        (current !== path ||
          (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)),
      "PATH_TYPE_INVALID",
    );
    if (!test) {
      if (current === path && cmsLeaf && info.uid === 33)
        need(
          info.isDirectory() && (info.mode & 0o077) === 0,
          "CMS_STATE_MODE_INVALID",
        );
      else
        need(
          info.uid === 0 && (info.mode & 0o022) === 0,
          "ROOT_OWNED_PATH_REQUIRED",
        );
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
// Fixed builtin-only program, never populated from a request or source file.
// An inherited directory FD grants read access only to the approved snapshot;
// the child cannot traverse the private outbox's other requests or receipts.
const CMS_COPY_PROGRAM = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(process.getuid()!==33 || process.getgid()!==33)throw Error('CMS_UID_REQUIRED');
const dest=process.argv[1];if(!path.isAbsolute(dest))throw Error('ABSOLUTE_DEST_REQUIRED');
if(fs.existsSync(dest)){if(!fs.lstatSync(dest).isDirectory()||fs.lstatSync(dest).isSymbolicLink())throw Error('DEST_TYPE');process.exit(0);}
const pending=dest+'.pending-'+crypto.randomUUID();
fs.cpSync('/proc/self/fd/3',pending,{recursive:true,dereference:true,errorOnExist:true,force:false});
fs.chmodSync(pending,0o755);fs.renameSync(pending,dest);
`;
async function materializeCmsPackage(
  snapshot: string,
  destination: string,
  seconds: number,
) {
  const fd = await open(
    snapshot,
    constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await new Promise<void>((done, reject) => {
      const child = spawn(
        process.execPath,
        ["-e", CMS_COPY_PROGRAM, destination],
        {
          shell: false,
          uid: 33,
          gid: 33,
          env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
          stdio: ["ignore", "ignore", "ignore", fd.fd],
        },
      );
      const timer = setTimeout(
        () => {
          child.kill("SIGKILL");
          reject(Error("HANDOFF_CMS_COPY_TIMEOUT"));
        },
        Math.min(seconds, 600) * 1000,
      );
      child.on("error", () => {
        clearTimeout(timer);
        reject(Error("HANDOFF_CMS_COPY_START_FAILED"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? done() : reject(Error("HANDOFF_CMS_COPY_FAILED"));
      });
    });
  } finally {
    await fd.close();
  }
}
async function exclusiveBytes(path: string, bytes: Buffer, mode = 0o600) {
  try {
    const f = await open(path, "wx", mode);
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    need(
      (await readHandoffFile(path, Math.max(bytes.length, 1))).equals(bytes),
      "EXISTING_BYTES_CONFLICT",
    );
  }
}
/** Validation and copying use the same bounded buffers. Interrupted staging is
 * never adopted; only an atomically published, independently validated package is reused. */
export async function copyHandoffPackage(
  source: string,
  destination: string,
  project: string,
  manifestPin: string,
  guard: () => void = () => {},
) {
  guard();
  const manifestBytes = await readHandoffFile(
    resolve(source, "manifest.json"),
    4000000,
    manifestPin,
  );
  const manifest = parseHandoff(manifestBytes);
  need(
    manifest.project_id === project &&
      manifest.files &&
      typeof manifest.files === "object" &&
      !Array.isArray(manifest.files),
    "PACKAGE_MANIFEST_INVALID",
  );
  const entries = Object.entries(manifest.files) as Array<[string, string]>;
  need(
    entries.length > 0 && entries.length <= HANDOFF_LIMITS.files,
    "PACKAGE_FILE_COUNT",
  );
  for (const [name, pin] of entries)
    need(
      /^[a-zA-Z0-9_.\/-]+$/.test(name) &&
        !name.startsWith("/") &&
        name.split("/").every((p) => p && p !== "." && p !== "..") &&
        /^[a-f0-9]{64}$/.test(pin),
      "PACKAGE_PATH_INVALID",
    );
  try {
    await lstat(destination);
    await validateBitrixPackage(destination, project, manifestPin);
    guard();
    return;
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const staging = destination + ".pending-" + randomUUID();
  await mkdir(staging, { mode: 0o700 });
  let total = manifestBytes.length;
  await exclusiveBytes(resolve(staging, "manifest.json"), manifestBytes, 0o644);
  for (const [name, pin] of entries) {
    await nextTurn();
    guard();
    const sourceFile = resolve(source, name),
      physical = await realpath(sourceFile);
    need(
      physical.startsWith((await realpath(source)) + sep),
      "PACKAGE_SOURCE_ESCAPE",
    );
    const bytes = await readHandoffFile(sourceFile, HANDOFF_LIMITS.file, pin);
    total += bytes.length;
    need(total <= HANDOFF_LIMITS.package, "PACKAGE_BYTES_EXCEEDED");
    const target = resolve(staging, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    await exclusiveBytes(target, bytes, 0o644);
    guard();
  }
  await validateBitrixPackage(staging, project, manifestPin);
  guard();
  await chmod(staging, 0o755);
  await rename(staging, destination);
  guard();
}

export interface ExecuteHandoffOptions {
  profilePath: string;
  profileSha256: string;
  requestId: string;
  requestSha256: string;
}
/** Injecting a runner is reserved for a declared local driver double. It never
 * generates NATIVE receipts. Production CLI exposes no runner override. */
export async function executeNativeHandoff(
  options: ExecuteHandoffOptions,
  runner?: NativeRunner,
) {
  const test = runner !== undefined;
  if (!test)
    need(
      process.platform === "linux" && process.getuid?.() === 0,
      "ROOT_LINUX_OPERATOR_REQUIRED",
    );
  need(Number(process.versions.node.split(".")[0]) === 24, "NODE_24_REQUIRED");
  need(
    /^[a-f0-9]{64}$/.test(options.requestId) &&
      /^[a-f0-9]{64}$/.test(options.requestSha256) &&
      /^[a-f0-9]{64}$/.test(options.profileSha256),
    "PINS_REQUIRED",
  );
  await securePath(options.profilePath, false, test);
  const profile: NativeHandoffProfile = parseHandoff(
    await readHandoffFile(options.profilePath, 65536, options.profileSha256),
  );
  validateHandoffProfile(profile);
  need(
    profile.executor_sha256 === (await nativeExecutorFingerprint()),
    "EXECUTOR_CODE_CHANGED",
  );
  for (const path of [
    profile.inbox_root,
    profile.outbox_root,
    profile.journal_dir,
  ])
    await securePath(path, true, test);
  await securePath(profile.native_profile_path, false, test);
  const native = await loadNativeProfile(
    profile.native_profile_path,
    profile.native_profile_sha256,
  );
  need(
    native.project_id === profile.project_id &&
      native.target_id === profile.target_id,
    "PRIVATE_NATIVE_BINDING_MISMATCH",
  );
  await securePath(native.host_package_root, true, test, true);
  const journalBinding = resolve(
    profile.journal_dir,
    profile.target_id,
    "binding.json",
  );
  await securePath(journalBinding, false, test);
  await readHandoffFile(journalBinding, 65536, profile.journal_binding_sha256);
  const inbox = resolve(profile.inbox_root, options.requestId);
  await securePath(inbox, true, test);
  const requestBytes = await readHandoffFile(
    resolve(inbox, "request.json"),
    HANDOFF_LIMITS.request,
    options.requestSha256,
  );
  const request: NativeHandoffRequest = parseHandoff(requestBytes);
  validateHandoffRequest(request);
  need(
    request.request_id === options.requestId &&
      handoffEqual(request.binding, {
        schema_version: 1,
        project_id: profile.project_id,
        target_id: profile.target_id,
        profile_id: profile.profile_id,
        profile_sha256: options.profileSha256,
        executor_sha256: profile.executor_sha256,
        native_profile_sha256: profile.native_profile_sha256,
        journal_identity_sha256: handoffHash(
          JSON.stringify([
            profile.journal_dir,
            profile.target_id,
            profile.journal_binding_sha256,
          ]),
        ),
      }),
    "REQUEST_PROFILE_MISMATCH",
  );
  const out = resolve(profile.outbox_root, request.request_id);
  await mkdir(out, { recursive: true, mode: 0o700 });
  await securePath(out, true, test);
  const lockPath = resolve(out, "lock.sqlite");
  try {
    const f = await open(lockPath, "wx", 0o600);
    await f.close();
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
  }
  await securePath(lockPath, false, test);
  const lock = new DatabaseSync(lockPath);
  try {
    lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw Error("HANDOFF_OPERATOR_BUSY");
  }
  try {
    await exclusiveBytes(resolve(out, "request.json"), requestBytes);
    const receipts = (await readdir(out))
      .filter((n) => /^receipt-\d{4}\.json$/.test(n))
      .sort();
    for (const name of receipts) {
      const bytes = await readHandoffFile(
          resolve(out, name),
          HANDOFF_LIMITS.receipt,
        ),
        r = parseHandoff(bytes);
      validateHandoffReceipt(r, request, options.requestSha256);
      // Repeated dispatch re-enters the same journal: apply reconciles first.
      // A stored receipt is historical and cannot substitute for a fresh verify.
    }
    const attempt = receipts.length + 1;
    need(attempt <= 1000, "ATTEMPTS_EXHAUSTED");
    const packageDir = resolve(
      native.host_package_root,
      "handoff-" + request.build.package_manifest_sha256,
    );
    const snapshot = resolve(out, "package");
    await copyHandoffPackage(
      resolve(inbox, "package"),
      snapshot,
      profile.project_id,
      request.build.package_manifest_sha256,
    );
    if (test || (await lstat(native.host_package_root)).uid === 0)
      await copyHandoffPackage(
        snapshot,
        packageDir,
        profile.project_id,
        request.build.package_manifest_sha256,
      );
    else
      await materializeCmsPackage(snapshot, packageDir, native.timeout_seconds);
    await readHandoffFile(
      resolve(packageDir, "manifest.json"),
      4000000,
      request.build.package_manifest_sha256,
    );
    await validateBitrixPackage(
      packageDir,
      profile.project_id,
      request.build.package_manifest_sha256,
    );
    // Persist intent before the existing native journal can issue any command.
    await exclusiveBytes(
      resolve(out, `intent-${String(attempt).padStart(4, "0")}.json`),
      Buffer.from(
        handoffJson({ request_sha256: options.requestSha256, attempt }),
      ),
    );
    let value: any = null,
      status: NativeHandoffReceipt["status"] = "UNKNOWN";
    try {
      value = await executeNativeTarget(
        {
          profilePath: profile.native_profile_path,
          profileSha256: profile.native_profile_sha256,
          packageDir,
          manifestSha256: request.build.package_manifest_sha256,
          journalDir: profile.journal_dir,
          action: request.action,
        },
        runner,
      );
      status =
        value.status === "PACKAGE_VALID"
          ? "VALIDATED"
          : value.status === "TARGET_DRY_RUN"
            ? "DRY_RUN"
            : ["TARGET_CONFIRMED", "CONFIRMED"].includes(value.status)
              ? "CONFIRMED"
              : "INCOMPLETE";
    } catch {
      /* Any transport failure is UNKNOWN. The existing journal decides retry safety. */
    }
    let head: any = null;
    try {
      head = parseHandoff(
        await readHandoffFile(
          resolve(
            profile.journal_dir,
            profile.target_id,
            request.build.package_manifest_sha256 + ".state.json",
          ),
          65536,
        ),
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    // Do not expose private absolute receipt locations through the public copy.
    if (head?.last_result)
      head.last_result = {
        command: head.last_result.command,
        sha256: head.last_result.sha256,
      };
    const receipt: NativeHandoffReceipt = {
      schema_version: 1,
      kind: "native-handoff-receipt",
      request_id: request.request_id,
      request_sha256: options.requestSha256,
      binding: request.binding,
      build: request.build,
      action: request.action,
      attempt,
      execution: test ? "TEST_DOUBLE" : "NATIVE",
      status,
      recorded_at: new Date().toISOString(),
      native_profile_sha256: profile.native_profile_sha256,
      journal_binding_sha256: profile.journal_binding_sha256,
      journal_head: head,
      native_result: value?.result ?? null,
      activation: "NOT_RUN",
      full_qa: "NOT_RUN",
    };
    validateHandoffReceipt(receipt, request, options.requestSha256);
    const bytes = Buffer.from(handoffJson(receipt));
    need(bytes.length <= HANDOFF_LIMITS.receipt, "RECEIPT_SIZE");
    const path = resolve(
      out,
      `receipt-${String(attempt).padStart(4, "0")}.json`,
    );
    await exclusiveBytes(path, bytes);
    return {
      receipt_path: path,
      receipt_sha256: handoffHash(bytes),
      receipt,
      reused: false,
    };
  } finally {
    try {
      lock.exec("ROLLBACK");
    } finally {
      lock.close();
    }
  }
}
