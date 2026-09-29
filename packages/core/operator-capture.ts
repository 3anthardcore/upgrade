import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Store, UpgradeError, hash, inside } from "./index.ts";
import { Pipeline } from "./pipeline.ts";
import type { Artifact, Project } from "../contracts/index.ts";
import {
  validateOperatorCapture,
  OperatorCaptureError,
  OPERATOR_CAPTURE_LIMITS,
} from "../crawler/operator.ts";
import type { ValidatedOperatorCapture } from "../crawler/operator.ts";

export interface CaptureReceipt {
  schema_version: 1;
  capture_id: string;
  manifest_sha256: string;
  state: "PENDING" | "COMMITTED";
  source_artifact_id: string | null;
  server_access_block_id: string | null;
  files: { relative_path: string; artifact_id: string; sha256: string }[];
  result_artifact_id?: string;
}

// The same bounded Buffer is hashed and published; never copy a live path after checking it.
function pinnedBytes(
  root: string,
  relative: string,
  expected: string,
  limit: number,
  size?: number,
) {
  const file = inside(root, relative);
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1 || info.size > limit)
    throw new UpgradeError(
      "Capture file is not a bounded independent regular file",
      5,
    );
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== info.dev ||
      before.ino !== info.ino
    )
      throw new UpgradeError("Capture file identity changed", 5);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, limit - total + 1));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      if (total > limit)
        throw new UpgradeError("Capture grew beyond pinned size", 5);
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(fd),
      bytes = Buffer.concat(chunks, total);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      realpathSync(file) !== file ||
      (size !== undefined && bytes.length !== size) ||
      hash(bytes) !== expected
    )
      throw new UpgradeError(
        "Capture changed after validation or differs from pinned bytes",
        5,
      );
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export async function ingestOperatorCapture(
  store: Store,
  options: {
    directory: string;
    expectedManifestSha256: string;
    manifestPath?: string;
  },
) {
  const pipeline = new Pipeline(store);
  return pipeline.locked(
    async () => {
      const project = store.list<Project>("project")[0];
      if (!project) throw new UpgradeError("Initialize project first");
      const priorBinding = store
        .list<CaptureReceipt>("operator_capture")
        .find((r) => r.manifest_sha256 === options.expectedManifestSha256);
      // Retrying an interrupted capture keeps its original source snapshot.
      const latest = priorBinding
        ? priorBinding.source_artifact_id
          ? store.get<Artifact>("artifact", priorBinding.source_artifact_id)
          : undefined
        : store
            .list<Artifact>("artifact")
            .filter((a) => a.type === "crawl-result.json")
            .at(-1);
      let crawl: any = null;
      if (latest) {
        store.validateArtifact(latest.artifact_id);
        const bytes = readFileSync(inside(store.root, latest.relative_path));
        if (hash(bytes) !== latest.sha256)
          throw new UpgradeError("Source artifact changed", 5);
        crawl = JSON.parse(bytes.toString("utf8"));
      }
      const registry: string[] = [];
      for (const entry of crawl?.entries ?? []) {
        if (typeof entry.raw_url === "string") registry.push(entry.raw_url);
        for (const raw of entry.raw_urls ?? [])
          if (typeof raw === "string") registry.push(raw);
        if (typeof entry.crawl_key === "string") registry.push(entry.crawl_key);
      }
      const directory = realpathSync(resolve(options.directory));
      if (lstatSync(resolve(options.directory)).isSymbolicLink())
        throw new UpgradeError("Capture root symlink forbidden", 5);
      let validated: ValidatedOperatorCapture;
      try {
        validated = await validateOperatorCapture({
          ...options,
          directory,
          expectedProjectId: project.project_id,
          expectedSourceUrl: project.source.entry_url,
          existingSourceRegistry: [...new Set(registry)],
          serverAccessBlockId: crawl?.access?.active_block_id,
        });
      } catch (error) {
        if (error instanceof OperatorCaptureError)
          throw new UpgradeError(`${error.code}: ${error.message}`, 5);
        throw error;
      }
      pipeline.assertOwnership(true);
      const id = validated.capture_id;
      let receipt = store
        .list<CaptureReceipt>("operator_capture")
        .find((r) => r.capture_id === id);
      if (receipt && receipt.manifest_sha256 !== validated.manifest_sha256)
        throw new UpgradeError(
          "Capture identity conflicts with its previously bound manifest SHA-256",
          5,
        );
      if (receipt?.state === "COMMITTED") {
        for (const file of receipt.files)
          store.validateArtifact(file.artifact_id);
        store.validateArtifact(receipt.result_artifact_id!);
        return {
          ...receipt,
          replayed: true,
          source_access: "NOT_VERIFIED",
          readiness: "NOT_EVALUATED",
        };
      }
      if (!receipt) {
        receipt = {
          schema_version: 1,
          capture_id: id,
          manifest_sha256: validated.manifest_sha256,
          state: "PENDING",
          source_artifact_id: latest?.artifact_id ?? null,
          server_access_block_id: validated.server_access_block_id,
          files: [],
        };
        store.transaction(() => {
          store.put("operator_capture", id, receipt);
          store.event(
            "operator_capture.started",
            "operator",
            { capture_id: id, manifest_sha256: validated.manifest_sha256 },
            store.currentRun().run_id,
          );
        });
      }
      // Reconcile deterministic artifact identities before retrying an unknown publication.
      const publish = (relativePath: string, bytes: Buffer) => {
        pipeline.assertOwnership(true);
        const type = `operator-capture-${hash(JSON.stringify([id, validated.manifest_sha256, relativePath]))}.bin`;
        const matches = store
          .list<Artifact>("artifact")
          .filter((a) => a.type === type);
        if (matches.length > 1)
          throw new UpgradeError("Ambiguous capture artifact identity", 5);
        if (matches[0]) {
          const found = store.validateArtifact(matches[0].artifact_id);
          if (found.sha256 !== hash(bytes) || found.size_bytes !== bytes.length)
            throw new UpgradeError("Conflicting stored capture bytes", 5);
          return found;
        }
        return store.publishArtifact(type, bytes);
      };
      const refs = [
        {
          relative_path: options.manifestPath ?? "operator-capture.json",
          sha256: validated.manifest_sha256,
          size_bytes: undefined,
        },
        ...validated.files,
      ];
      const accepted: CaptureReceipt["files"] = [];
      for (const ref of refs) {
        const bytes = pinnedBytes(
          directory,
          ref.relative_path,
          ref.sha256,
          ref.size_bytes ?? OPERATOR_CAPTURE_LIMITS.manifestBytes,
          ref.size_bytes,
        );
        const artifact = publish(ref.relative_path, bytes);
        accepted.push({
          relative_path: ref.relative_path,
          artifact_id: artifact.artifact_id,
          sha256: artifact.sha256,
        });
      }
      const result = {
        ...validated,
        source_artifact_id: latest?.artifact_id ?? null,
        original_source_registry: [...new Set(registry)],
        artifact_files: accepted,
        limitations: validated.limitations.filter(
          (v) => !v.startsWith("Core ingestion,"),
        ),
      };
      const resultArtifact = publish(
        "@validated-result",
        Buffer.from(JSON.stringify(result, null, 2) + "\n"),
      );
      const committed: CaptureReceipt = {
        ...receipt,
        state: "COMMITTED",
        files: accepted,
        source_artifact_id: latest?.artifact_id ?? null,
        server_access_block_id: validated.server_access_block_id,
        result_artifact_id: resultArtifact.artifact_id,
      };
      store.transaction(() => {
        store.put("operator_capture", id, committed);
        store.event(
          "operator_capture.committed",
          "operator",
          {
            capture_id: id,
            manifest_sha256: validated.manifest_sha256,
            result_artifact_id: resultArtifact.artifact_id,
            source_access: "NOT_VERIFIED",
            readiness: "NOT_EVALUATED",
          },
          store.currentRun().run_id,
        );
      });
      return {
        ...committed,
        replayed: false,
        source_access: "NOT_VERIFIED",
        readiness: "NOT_EVALUATED",
      };
    },
    { maintenance: true },
  );
}
