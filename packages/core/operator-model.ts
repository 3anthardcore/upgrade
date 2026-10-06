import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  lstatSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Ajv } from "ajv";
import { Store, UpgradeError, hash, inside, uid } from "./index.ts";
import { Pipeline } from "./pipeline.ts";
import { sourceFingerprint, defaultTokens } from "./design.ts";
import type { Artifact, Project } from "../contracts/index.ts";
import type { CaptureReceipt } from "./operator-capture.ts";
import {
  operatorCaptureSchema,
  OPERATOR_CAPTURE_LIMITS,
} from "../crawler/operator.ts";
import type {
  OperatorCaptureManifest,
  ValidatedOperatorCapture,
} from "../crawler/operator.ts";
import { identifyUrl } from "../crawler/index.ts";
import { extractOperatorContent } from "../extractor/operator.ts";
import type { OperatorContentModel } from "../extractor/operator.ts";
import type { RouteManifest, PlannedRoute } from "../route-planner/index.ts";
import {
  buildBitrixPackage,
  validateBitrixPackage,
  validateRequestTarget,
} from "../bitrix-adapter/index.ts";
import type { PackageManifest } from "../bitrix-adapter/index.ts";

interface OperatorBindingBase {
  project_id: string;
  capture_id: string;
  manifest_sha256: string;
  capture_result_artifact_id: string;
  capture_result_sha256: string;
  source_artifact_id: string | null;
  source_artifact_sha256: string | null;
  server_access_block_id: string | null;
}
export type OperatorBinding = OperatorBindingBase &
  (
    | { schema_version: 1; selected_source_url: string }
    | {
        schema_version: 2;
        selection_mode: "ALL_OBSERVED";
        selected_source_urls: string[];
      }
  );
export interface OperatorModelRecord {
  id: string;
  state: "PENDING" | "COMMITTED";
  input_hash: string;
  operator_binding: OperatorBinding;
  capture_id: string;
  manifest_sha256: string;
  capture_result_artifact_id: string;
  code_sha256: string;
  output_artifact_ids: { model: string; routes: string; scope: string };
  output_sha256: { model: string; routes: string; scope: string };
}
export interface OperatorBuildRecord {
  id: string;
  state: "PENDING" | "COMMITTED";
  input_hash: string;
  operator_binding: OperatorBinding;
  capture_id: string;
  manifest_sha256: string;
  capture_result_artifact_id: string;
  model_record_id: string;
  input_artifact_ids: string[];
  result_artifact_id?: string;
  package_relative_path: string;
  manifest_sha256_package?: string;
  release_id: string;
  code_sha256: string;
  attempt_relative_path?: string;
}
export interface OperatorOptions {
  captureId: string;
  manifestSha256: string;
  page?: string;
  allObserved?: boolean;
}
type AcceptedCapture = ValidatedOperatorCapture & {
  source_artifact_id: string | null;
  artifact_files: CaptureReceipt["files"];
};
type ModelArtifact = OperatorContentModel & {
  operator_binding: OperatorBinding;
  input_hash: string;
  state: "PARTIAL";
  full_source_denominator: "UNKNOWN";
};
type RoutesArtifact = RouteManifest & {
  operator_binding: OperatorBinding;
  input_hash: string;
  state: "PARTIAL";
  full_source_denominator: "UNKNOWN";
};
const json = (value: unknown) =>
  Buffer.from(JSON.stringify(value, null, 2) + "\n");
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.keys(child)
            .sort()
            .map((key) => [key, child[key]]),
        )
      : child,
  );
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const fail = (message: string): never => {
  throw new UpgradeError(message, 5);
};
const validateManifest = new Ajv({
  allErrors: true,
}).compile<OperatorCaptureManifest>(operatorCaptureSchema);
const MAX_ARTIFACT_BYTES = 256_000_000;
const MODEL_CODE = [
  "packages/core/operator-model.ts",
  "packages/contracts/commerce.ts",
  "packages/extractor",
  "packages/crawler",
  "package-lock.json",
];
const BUILD_CODE = [
  "packages/core/operator-model.ts",
  "packages/bitrix-adapter",
  "bitrix",
  "package-lock.json",
];
function selectedUrls(binding: OperatorBinding): string[] {
  if (
    binding.schema_version === 1 &&
    typeof binding.selected_source_url === "string" &&
    !Object.hasOwn(binding, "selected_source_urls") &&
    !Object.hasOwn(binding, "selection_mode")
  )
    return [binding.selected_source_url];
  if (
    binding.schema_version === 2 &&
    binding.selection_mode === "ALL_OBSERVED" &&
    !Object.hasOwn(binding, "selected_source_url") &&
    Array.isArray(binding.selected_source_urls) &&
    binding.selected_source_urls.length > 0 &&
    binding.selected_source_urls.length <=
      OPERATOR_CAPTURE_LIMITS.observations &&
    binding.selected_source_urls.every(
      (url) => typeof url === "string" && identifyUrl(url).crawl_key === url,
    ) &&
    equal(
      binding.selected_source_urls,
      [...new Set(binding.selected_source_urls)].sort(),
    )
  )
    return binding.selected_source_urls;
  return fail("Invalid operator selection binding");
}
const modelDomain = (binding: OperatorBinding) =>
  binding.schema_version === 1 ? "operator-model-v1" : "operator-model-v2";
const buildDomain = (binding: OperatorBinding) =>
  binding.schema_version === 1 ? "operator-build-v1" : "operator-build-v2";
async function verification<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof UpgradeError) throw error;
    throw new UpgradeError(
      `Operator evidence verification failed: ${error instanceof Error ? error.message : String(error)}`,
      5,
    );
  }
}

/** Read the exact bytes subsequently consumed, after Store's integrity check. */
function artifactBytes(store: Store, id: string, expectedHash?: string) {
  const meta = store.get<Artifact>("artifact", id);
  if (
    !Number.isSafeInteger(meta.size_bytes) ||
    meta.size_bytes < 0 ||
    meta.size_bytes > MAX_ARTIFACT_BYTES
  )
    return fail("Operator artifact exceeds bounded input size");
  const file = inside(store.root, meta.relative_path);
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1 || info.size !== meta.size_bytes)
    return fail(
      "Operator artifact must remain an independent regular file of the pinned size",
    );
  store.validateArtifact(id);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.ino !== info.ino ||
      before.dev !== info.dev
    )
      return fail("Operator artifact identity changed while opening");
    const buffer = Buffer.alloc(meta.size_bytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd),
      bytes = buffer.subarray(0, size);
    if (
      size !== meta.size_bytes ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      hash(bytes) !== meta.sha256 ||
      (expectedHash && meta.sha256 !== expectedHash)
    )
      return fail(
        "Operator artifact bytes no longer match their immutable pin",
      );
    return { artifact: meta, bytes };
  } finally {
    closeSync(fd);
  }
}
function artifactJson<T>(
  store: Store,
  id: string,
  expectedHash?: string,
): { artifact: Artifact; value: T } {
  const read = artifactBytes(store, id, expectedHash);
  try {
    return {
      artifact: read.artifact,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(read.bytes),
      ) as T,
    };
  } catch {
    return fail("Operator artifact is not valid UTF-8 JSON");
  }
}

async function loadCapture(store: Store, options: OperatorOptions, pipeline: Pipeline) {
  if (
    (options.allObserved !== undefined &&
      typeof options.allObserved !== "boolean") ||
    (options.allObserved && options.page)
  )
    throw new UpgradeError("Choose either --all-observed or --page, not both");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.captureId) ||
    !/^[a-f0-9]{64}$/.test(options.manifestSha256)
  )
    throw new UpgradeError(
      "Explicit capture ID and manifest SHA-256 are required",
    );
  const project = store.list<Project>("project")[0];
  if (!project) throw new UpgradeError("Initialize project first");
  const receipt = store.get<CaptureReceipt>(
    "operator_capture",
    options.captureId,
  );
  if (receipt.state !== "COMMITTED" || !receipt.result_artifact_id)
    throw new UpgradeError("Operator capture is not COMMITTED", 3);
  if (
    receipt.capture_id !== options.captureId ||
    receipt.manifest_sha256 !== options.manifestSha256
  )
    return fail("Operator capture identity/pin mismatch");
  const accepted = artifactJson<AcceptedCapture>(
    store,
    receipt.result_artifact_id,
  );
  const capture = accepted.value;
  if (
    capture.kind !== "validated-operator-capture" ||
    capture.schema_version !== 1 ||
    capture.project_id !== project.project_id ||
    capture.capture_id !== receipt.capture_id ||
    capture.manifest_sha256 !== receipt.manifest_sha256 ||
    capture.source_origin !== identifyUrl(project.source.entry_url).origin ||
    capture.state !== "PARTIAL" ||
    capture.source_access !== "NOT_VERIFIED" ||
    capture.readiness !== "NOT_EVALUATED" ||
    capture.server_access_block_id !== receipt.server_access_block_id ||
    capture.source_artifact_id !== receipt.source_artifact_id ||
    !equal(capture.artifact_files, receipt.files)
  )
    return fail("Accepted operator capture binding is inconsistent");
  if (
    !Array.isArray(receipt.files) ||
    receipt.files.length < 2 ||
    receipt.files.length >
      OPERATOR_CAPTURE_LIMITS.assets + OPERATOR_CAPTURE_LIMITS.observations + 1
  )
    return fail("Invalid accepted operator file registry");
  const files = new Map(receipt.files.map((ref) => [ref.relative_path, ref]));
  if (files.size !== receipt.files.length)
    return fail("Duplicate accepted operator file path");
  const manifestRef = receipt.files.find(
    (ref) => ref.sha256 === receipt.manifest_sha256,
  );
  if (!manifestRef) return fail("Pinned operator manifest artifact missing");
  const original = artifactJson<OperatorCaptureManifest>(
    store,
    manifestRef.artifact_id,
    receipt.manifest_sha256,
  );
  if (
    !validateManifest(original.value) ||
    original.value.capture_id !== receipt.capture_id ||
    original.value.project_id !== project.project_id ||
    original.value.source_origin !== capture.source_origin
  )
    return fail("Pinned original capture manifest failed its contract");
  const observationInputs = capture.observations.map(
    ({ source_url, document_url, observed_at, format, file }) => ({
      source_url,
      document_url,
      observed_at,
      format,
      file,
    }),
  );
  if (
    !equal(observationInputs, original.value.observations) ||
    !equal(capture.assets, original.value.assets) ||
    !equal(capture.files, [
      ...original.value.observations.map((o) => o.file),
      ...original.value.assets.map((a) => a.file),
    ])
  )
    return fail("Operator result differs from its pinned original manifest");
  const declared = new Map(
    capture.files.map((ref) => [ref.relative_path, ref]),
  );
  if (declared.size + 1 !== files.size)
    return fail("Operator artifact registry has extra or missing files");
  const readFile = (relativePath: string) => {
    const expected = declared.get(relativePath),
      ref = files.get(relativePath);
    if (!expected || !ref || expected.sha256 !== ref.sha256)
      return fail("Unbound operator file requested");
    const read = artifactBytes(store, ref.artifact_id, expected.sha256);
    if (read.bytes.length !== expected.size_bytes)
      return fail("Operator file size disagrees with its manifest");
    return read.bytes;
  };
  for (const relativePath of declared.keys()) {
    await nextTurn();
    pipeline.assertOwnership(true);
    readFile(relativePath);
  }
  let sourceHash: string | null = null;
  if (receipt.source_artifact_id) {
    const source = artifactJson<any>(store, receipt.source_artifact_id);
    if (
      source.artifact.type !== "crawl-result.json" ||
      (source.value.access?.active_block_id ?? null) !==
        receipt.server_access_block_id
    )
      return fail("Inherited source access binding changed");
    sourceHash = source.artifact.sha256;
  }
  const observed = [
    ...new Set(
      capture.observations.map((o) => identifyUrl(o.source_url).crawl_key),
    ),
  ];
  const chosen = options.page
    ? identifyUrl(options.page).crawl_key
    : observed.length === 1
      ? observed[0]
      : undefined;
  if (
    (!options.allObserved && (!chosen || !observed.includes(chosen))) ||
    !observed.length
  )
    throw new UpgradeError(
      "Choose one captured page with --page ABSOLUTE_URL or explicitly select --all-observed",
    );
  const bindingBase: OperatorBindingBase = {
    project_id: project.project_id,
    capture_id: receipt.capture_id,
    manifest_sha256: receipt.manifest_sha256,
    capture_result_artifact_id: receipt.result_artifact_id,
    capture_result_sha256: accepted.artifact.sha256,
    source_artifact_id: receipt.source_artifact_id,
    source_artifact_sha256: sourceHash,
    server_access_block_id: receipt.server_access_block_id,
  };
  const binding: OperatorBinding = options.allObserved
    ? {
        schema_version: 2,
        ...bindingBase,
        selection_mode: "ALL_OBSERVED",
        selected_source_urls: observed.sort(),
      }
    : { schema_version: 1, ...bindingBase, selected_source_url: chosen! };
  return { project, receipt, capture, binding, readFile };
}

function planOperatorRoutes(
  capture: AcceptedCapture,
  model: OperatorContentModel,
  binding: OperatorBinding,
  inputHash: string,
): RoutesArtifact {
  const selected = new Set(selectedUrls(binding));
  const manifest: RoutesArtifact = {
    schema_version: 1,
    project_id: model.project_id,
    source_scope_count: capture.inventory.length,
    mapped_count: 0,
    routes: [],
    exclusions: [],
    unresolved: [],
    conflicts: [],
    origin_map: { [capture.source_origin]: "https://demo.invalid" },
    limitations: [
      binding.schema_version === 1
        ? "Only an explicitly selected operator observation is mapped. Source HTTP status, redirects and server access remain unverified."
        : "All captured source-page observations are explicitly selected. Unobserved inventory URLs remain unresolved; source HTTP status and server access remain unverified.",
      "Target HTTP 200 is a planned partial-page response, not an observed source status. Query order and repeated/empty parameters are preserved exactly.",
    ],
    operator_binding: binding,
    input_hash: inputHash,
    state: "PARTIAL",
    full_source_denominator: "UNKNOWN",
  };
  for (const entry of capture.inventory) {
    if (!selected.has(entry.crawl_key)) {
      manifest.unresolved.push({
        source_url: entry.crawl_key,
        reason:
          entry.observation === "UNOBSERVED"
            ? "No operator page observation"
            : "Observed but outside the explicitly selected partial page",
      });
      continue;
    }
    const entity = model.entities.find(
      (item) => identifyUrl(item.source_url).crawl_key === entry.crawl_key,
    );
    if (!entity) {
      manifest.unresolved.push({
        source_url: entry.crawl_key,
        reason: "Selected observation has no supported content entity",
      });
      continue;
    }
    try {
      validateRequestTarget(entry.request_target);
      if (
        /^\/(?:api|upgrade)(?:\/|$)/i.test(
          decodeURIComponent(entry.request_target.split("?")[0]),
        )
      )
        throw new Error("Reserved own target path");
    } catch {
      manifest.conflicts.push({
        source_url: entry.crawl_key,
        reason: "Reserved, unsafe or unsupported exact target path",
      });
      continue;
    }
    const query = entry.request_target.includes("?")
      ? entry.request_target.slice(entry.request_target.indexOf("?") + 1)
      : "";
    const route: PlannedRoute = {
      source_url: entry.crawl_key,
      source_origin: capture.source_origin,
      request_target: entry.request_target,
      target_route: entry.request_target,
      page_type: entity.page_type,
      entity_source_id: entity.source_id,
      expected_status: 200,
      redirect_to: null,
      query_policy: "preserve-exact",
      query_parameters: query
        ? query.split("&").map((raw) => ({
            raw,
            name: raw.split("=")[0],
            classification: "unknown-preserved",
          }))
        : [],
      canonical_url: null,
      reason:
        "Explicit target route for one partial operator observation; source HTTP status is unknown",
      rule_version: 1,
      tests: [
        "exact-request-target",
        "partial-operator-content",
        "target-http-200-NOT_RUN",
      ],
      source_status:
        entry.observation === "SELECTED_FIELDS"
          ? "OPERATOR_SELECTED_FIELDS"
          : "OPERATOR_DOM_OBSERVED",
    };
    manifest.routes.push(route);
  }
  manifest.mapped_count = manifest.routes.length;
  return manifest;
}

function reuseJson(
  store: Store,
  pipeline: Pipeline,
  type: string,
  bytes: Buffer,
  expected: string,
) {
  pipeline.assertOwnership(true);
  if (hash(bytes) !== expected)
    return fail("Output differs from its durable publication intent");
  const found = store
    .list<Artifact>("artifact")
    .filter((a) => a.type === type && a.sha256 === expected);
  if (found.length > 1) return fail("Ambiguous duplicate operator output");
  if (found[0])
    return artifactBytes(store, found[0].artifact_id, expected).artifact;
  return store.publishArtifact(type, bytes);
}

function existingRecord<T>(
  store: Store,
  kind: string,
  id: string,
): T | undefined {
  try {
    return store.get<T>(kind, id);
  } catch (error) {
    if (
      error instanceof UpgradeError &&
      error.code === 2 &&
      error.message === `${kind} not found: ${id}`
    )
      return undefined;
    throw error;
  }
}
function assertModelIntent(
  record: OperatorModelRecord,
  binding: OperatorBinding,
  id: string,
  currentCodeHash?: string,
) {
  selectedUrls(binding);
  if (
    !record ||
    !["PENDING", "COMMITTED"].includes(record.state) ||
    record.id !== id ||
    record.input_hash !== id ||
    !/^[a-f0-9]{64}$/.test(record.code_sha256) ||
    (currentCodeHash !== undefined && record.code_sha256 !== currentCodeHash) ||
    id !==
      hash(
        JSON.stringify([modelDomain(binding), binding, record.code_sha256]),
      ) ||
    !equal(record.operator_binding, binding) ||
    record.capture_id !== binding.capture_id ||
    record.manifest_sha256 !== binding.manifest_sha256 ||
    record.capture_result_artifact_id !== binding.capture_result_artifact_id ||
    !record.output_artifact_ids ||
    !record.output_sha256 ||
    !["model", "routes", "scope"].every(
      (name) =>
        typeof record.output_artifact_ids[name as "model"] === "string" &&
        /^[a-f0-9]{64}$/.test(record.output_sha256[name as "model"]),
    )
  )
    return fail("Stored operator model intent mismatch");
}
const outputTypes = {
  model: "operator-content-model.json",
  routes: "operator-route-manifest.json",
  scope: "operator-scope-manifest.json",
};
function assertModelOutput(
  output: { artifact: Artifact; value: any },
  name: keyof typeof outputTypes,
  record: OperatorModelRecord,
) {
  if (
    output.artifact.type !== outputTypes[name] ||
    !equal(output.value.operator_binding, record.operator_binding) ||
    output.value.input_hash !== record.input_hash ||
    output.value.state !== "PARTIAL" ||
    output.value.full_source_denominator !== "UNKNOWN"
  )
    return fail("Operator model output binding mismatch");
}
function operatorRelease(
  manifest: PackageManifest,
  build: OperatorBuildRecord,
  model: OperatorModelRecord,
) {
  return {
    ...manifest,
    operator_binding: build.operator_binding,
    input_hash: build.input_hash,
    state: "PARTIAL",
    full_source_denominator: "UNKNOWN",
    source_access: "NOT_VERIFIED",
    readiness: "NOT_EVALUATED",
    release_id: build.release_id,
    package_relative_path: build.package_relative_path,
    manifest_sha256: build.manifest_sha256_package,
    model_record_id: model.id,
    scope_artifact_id: model.output_artifact_ids.scope,
    route_manifest_artifact_id: model.output_artifact_ids.routes,
    model_artifact_id: model.output_artifact_ids.model,
    code_sha256: build.code_sha256,
  };
}

export async function createOperatorModel(
  store: Store,
  options: OperatorOptions,
) {
  const pipeline = new Pipeline(store);
  return verification(() =>
    pipeline.locked(
      async () => {
        const input = await loadCapture(store, options, pipeline);
        const codeHash = sourceFingerprint(MODEL_CODE);
        const inputHash = hash(
          JSON.stringify([modelDomain(input.binding), input.binding, codeHash]),
        );
        const prior = existingRecord<OperatorModelRecord>(
          store,
          "operator_model",
          inputHash,
        );
        if (prior) assertModelIntent(prior, input.binding, inputHash, codeHash);
        if (prior?.state === "COMMITTED") {
          for (const name of ["model", "routes", "scope"] as const)
            assertModelOutput(
              artifactJson(
                store,
                prior.output_artifact_ids[name],
                prior.output_sha256[name],
              ),
              name,
              prior,
            );
          return { ...prior, replayed: true };
        }
        const extracted = await extractOperatorContent(input.capture, {
          projectId: input.project.project_id,
          sourceVersion: input.binding.capture_result_sha256,
          readFile: (relativePath) => {
            pipeline.assertOwnership(true);
            return input.readFile(relativePath);
          },
        });
        if (sourceFingerprint(MODEL_CODE) !== codeHash)
          return fail(
            "Extractor implementation changed during operator model execution",
          );
        const selection = selectedUrls(input.binding);
        const selected = new Set(selection);
        const selectedEntities = extracted.entities.filter((entity) =>
          selected.has(identifyUrl(entity.source_url).crawl_key),
        );
        if (
          selectedEntities.length !== selection.length ||
          new Set(
            selectedEntities.map(
              (entity) => identifyUrl(entity.source_url).crawl_key,
            ),
          ).size !== selection.length
        )
          throw new UpgradeError(
            "Exactly one supported observed entity is required for every explicitly selected page",
            5,
          );
        const model: ModelArtifact = {
          ...extracted,
          entities: selectedEntities,
          ...(extracted.commerce ? {commerce: {
            schema_version: 1 as const,
            entries: extracted.commerce.entries.filter((entry) => selectedEntities.some((entity) => entity.source_id === entry.entity_source_id)),
          }} : {}),
          raw_selected_fields: extracted.raw_selected_fields.filter((field) =>
            selectedEntities.some(
              (entity) => entity.source_id === field.entity_source_id,
            ),
          ),
          offers: extracted.offers.filter((offer) =>
            selectedEntities.some(
              (entity) => entity.source_id === offer.product_source_id,
            ),
          ),
          prices: extracted.prices.filter((price) =>
            selectedEntities.some(
              (entity) => entity.source_id === price.product_source_id,
            ),
          ),
          features: extracted.features.filter((feature) =>
            selected.has(identifyUrl(feature.source_url).crawl_key),
          ),
          operator_binding: input.binding,
          input_hash: inputHash,
          state: "PARTIAL",
          full_source_denominator: "UNKNOWN",
        };
        const routes = planOperatorRoutes(
          input.capture,
          model,
          input.binding,
          inputHash,
        );
        const scope = {
          schema_version: 1,
          kind: "operator-partial-scope",
          operator_binding: input.binding,
          input_hash: inputHash,
          state: "PARTIAL",
          full_source_denominator: "UNKNOWN",
          source_access: "NOT_VERIFIED",
          readiness: "NOT_EVALUATED",
          inventory: input.capture.inventory,
          urls: input.capture.inventory.map((entry) => entry.crawl_key),
          coverage: input.capture.coverage,
          selected_source_urls: selection,
          known_url_count: input.capture.inventory.length,
          selected_url_count: selection.length,
          planned_route_count: routes.mapped_count,
          unresolved_url_count:
            input.capture.inventory.length - routes.mapped_count,
          unresolved: [...routes.unresolved, ...routes.conflicts],
          limitations: routes.limitations,
        };
        const data = {
          model: json(model),
          routes: json(routes),
          scope: json(scope),
        };
        const hashes = {
          model: hash(data.model),
          routes: hash(data.routes),
          scope: hash(data.scope),
        };
        if (
          prior &&
          (!equal(prior.operator_binding, input.binding) ||
            !equal(prior.output_sha256, hashes))
        )
          return fail(
            "Pending operator model no longer matches its pinned output intent",
          );
        const record: OperatorModelRecord = prior ?? {
          id: inputHash,
          state: "PENDING",
          input_hash: inputHash,
          operator_binding: input.binding,
          capture_id: input.binding.capture_id,
          manifest_sha256: input.binding.manifest_sha256,
          capture_result_artifact_id: input.binding.capture_result_artifact_id,
          code_sha256: codeHash,
          output_artifact_ids: { model: "", routes: "", scope: "" },
          output_sha256: hashes,
        };
        if (!prior)
          store.transaction(() => {
            store.put("operator_model", inputHash, record);
            store.event(
              "operator_model.started",
              "operator",
              { input_hash: inputHash, operator_binding: input.binding },
              store.currentRun().run_id,
            );
          });
        for (const name of ["model", "routes", "scope"] as const)
          record.output_artifact_ids[name] = reuseJson(
            store,
            pipeline,
            outputTypes[name],
            data[name],
            hashes[name],
          ).artifact_id;
        record.state = "COMMITTED";
        store.transaction(() => {
          store.put("operator_model", inputHash, record);
          store.event(
            "operator_model.committed",
            "operator",
            {
              input_hash: inputHash,
              output_artifact_ids: record.output_artifact_ids,
              state: "PARTIAL",
            },
            store.currentRun().run_id,
          );
        });
        return { ...record, replayed: false };
      },
      { maintenance: true },
    ),
  );
}

function exactPrivateFile(store: Store, relative: string, bytes: Buffer) {
  const file = inside(store.root, relative);
  if (existsSync(file)) {
    const info = lstatSync(file);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size !== bytes.length ||
      hash(readFileSync(file)) !== hash(bytes)
    )
      return fail(
        "Materialized operator bytes conflict with an existing private file",
      );
    return file;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // The project dispatcher is the sole writer. Interrupted copies remain separate
  // diagnostic files; a partial write is never mistaken for reusable asset bytes.
  const temporary = inside(store.root, `${relative}.${uid("copy")}.tmp`);
  writeFileSync(temporary, bytes, { flag: "wx", mode: 0o400 });
  renameSync(temporary, file);
  return file;
}

/** Add explicit partial scope only to an unpublished builder output, then seal its manifest. */
function addPartialBoundary(
  directory: string,
  manifest: PackageManifest,
  scope: unknown,
  binding: OperatorBinding,
  known: number,
) {
  const scopeBytes = json(scope);
  writeFileSync(join(directory, "data/operator-scope.json"), scopeBytes, {
    flag: "wx",
  });
  manifest.files["data/operator-scope.json"] = hash(scopeBytes);
  const headerPath = "code/local/templates/upgrade/header.php";
  const header = readFileSync(join(directory, headerPath), "utf8");
  // Keep the reviewed template's safety notice intact while replacing only its
  // visible scope label. Older source packages retain their historical marker.
  const marker = header.includes("Закрытая демонстрация")
    ? "Закрытая демонстрация"
    : "Концепция обновления · Демонстрация";
  if (!header.includes(marker))
    return fail(
      "Own template no longer exposes the expected partial-banner insertion point",
    );
  const partialHeader = header.replace(
    marker,
    `Частичный снимок по наблюдению оператора · ${selectedUrls(binding).length} из ${known} известных URL · Полнота источника не установлена`,
  );
  writeFileSync(join(directory, headerPath), partialHeader);
  manifest.files[headerPath] = hash(partialHeader);
  manifest.warnings = [
    ...new Set([
      ...manifest.warnings,
      binding.schema_version === 1
        ? `PARTIAL_OPERATOR_CAPTURE:${binding.capture_id}:one-page-of-${known}-known-urls`
        : `PARTIAL_OPERATOR_CAPTURE:${binding.capture_id}:${selectedUrls(binding).length}-observed-pages-of-${known}-known-urls`,
      "FULL_SOURCE_DENOMINATOR_UNKNOWN: unresolved URLs are not excluded or fabricated",
      "SOURCE_ACCESS_NOT_VERIFIED: source crawl access gate remains unchanged",
      "OPERATOR_TARGET_HTTP_200_PLANNED: source HTTP status, redirects and runtime behavior remain unverified",
    ]),
  ].sort();
  writeFileSync(join(directory, "manifest.json"), json(manifest));
}

export async function buildOperatorPackage(
  store: Store,
  options: OperatorOptions & { modelId: string },
) {
  const pipeline = new Pipeline(store);
  return verification(() =>
    pipeline.locked(
      async () => {
        if (!/^[a-f0-9]{64}$/.test(options.modelId))
          throw new UpgradeError("Explicit --model MODEL_ID is required");
        const record = store.get<OperatorModelRecord>(
          "operator_model",
          options.modelId,
        );
        if (record.state !== "COMMITTED")
          throw new UpgradeError("Operator model is not COMMITTED", 3);
        if (
          (record.operator_binding.schema_version === 2) !==
          Boolean(options.allObserved)
        )
          throw new UpgradeError(
            "Build selection must match the model: use --all-observed only for an ALL_OBSERVED model",
          );
        const input = await loadCapture(store, {
          ...options,
          page:
            options.page ??
            (record.operator_binding.schema_version === 1
              ? record.operator_binding.selected_source_url
              : undefined),
        }, pipeline);
        assertModelIntent(record, input.binding, options.modelId);
        const model = artifactJson<ModelArtifact>(
          store,
          record.output_artifact_ids.model,
          record.output_sha256.model,
        );
        const routes = artifactJson<RoutesArtifact>(
          store,
          record.output_artifact_ids.routes,
          record.output_sha256.routes,
        );
        const scope = artifactJson<any>(
          store,
          record.output_artifact_ids.scope,
          record.output_sha256.scope,
        );
        assertModelOutput(model, "model", record);
        assertModelOutput(routes, "routes", record);
        assertModelOutput(scope, "scope", record);
        const selection = selectedUrls(input.binding);
        if (
          model.value.entities.length !== selection.length ||
          !equal(
            model.value.entities
              .map((entity) => identifyUrl(entity.source_url).crawl_key)
              .sort(),
            selection.slice().sort(),
          ) ||
          routes.value.routes.length !== selection.length ||
          !equal(
            routes.value.routes
              .map((route) => route.source_origin + route.request_target)
              .sort(),
            selection.slice().sort(),
          ) ||
          !routes.value.routes.every((route) =>
            model.value.entities.some(
              (entity) =>
                entity.source_id === route.entity_source_id &&
                identifyUrl(entity.source_url).crawl_key ===
                  route.source_origin + route.request_target,
            ),
          ) ||
          routes.value.conflicts.length ||
          !equal(scope.value.selected_source_urls, selection) ||
          scope.value.selected_url_count !== selection.length ||
          !equal(scope.value.inventory, input.capture.inventory) ||
          scope.value.known_url_count !== input.capture.inventory.length ||
          scope.value.planned_route_count !== selection.length ||
          scope.value.unresolved_url_count !==
            input.capture.inventory.length - selection.length
        )
          throw new UpgradeError(
            "Partial package requires one safe exact mapped page per selected observation and no route conflicts",
            5,
          );
        const codeHash = sourceFingerprint(BUILD_CODE);
        const inputHash = hash(
          JSON.stringify([
            buildDomain(input.binding),
            record.id,
            record.output_sha256,
            codeHash,
            defaultTokens,
          ]),
        );
        const prior = existingRecord<OperatorBuildRecord>(
          store,
          "operator_build",
          inputHash,
        );
        const releaseId = `operator-${inputHash.slice(0, 24)}`;
        const intended = {
          id: inputHash,
          input_hash: inputHash,
          operator_binding: input.binding,
          capture_id: input.binding.capture_id,
          manifest_sha256: input.binding.manifest_sha256,
          capture_result_artifact_id: input.binding.capture_result_artifact_id,
          model_record_id: record.id,
          input_artifact_ids: [
            model.artifact.artifact_id,
            routes.artifact.artifact_id,
            scope.artifact.artifact_id,
          ],
          package_relative_path: `operator-releases/${releaseId}`,
          release_id: releaseId,
          code_sha256: codeHash,
        };
        const build: OperatorBuildRecord = prior ?? {
          ...intended,
          state: "PENDING",
        };
        if (
          !["PENDING", "COMMITTED"].includes(build.state) ||
          !Object.entries(intended).every(([key, value]) =>
            equal(build[key as keyof OperatorBuildRecord], value),
          ) ||
          (build.manifest_sha256_package !== undefined &&
            !/^[a-f0-9]{64}$/.test(build.manifest_sha256_package))
        )
          return fail("Stored operator build intent mismatch");
        const finalDir = inside(store.root, build.package_relative_path);
        if (build.state === "COMMITTED") {
          if (!build.result_artifact_id || !build.manifest_sha256_package)
            return fail("Committed operator build receipt incomplete");
          const release = artifactJson<any>(store, build.result_artifact_id);
          const manifest = await validateBitrixPackage(
            finalDir,
            input.project.project_id,
            build.manifest_sha256_package,
          );
          if (
            release.artifact.type !== "operator-release-manifest.json" ||
            !equal(release.value, operatorRelease(manifest, build, record))
          )
            return fail("Operator release artifact binding mismatch");
          return {
            ...build,
            package_dir: finalDir,
            replayed: true,
            runtime_verification: "NOT_RUN",
          };
        }
        if (!prior)
          store.transaction(() => {
            store.put("operator_build", inputHash, build);
            store.event(
              "operator_build.started",
              "operator",
              { input_hash: inputHash, operator_binding: input.binding },
              store.currentRun().run_id,
            );
          });
        if (!build.manifest_sha256_package) {
          // An incomplete previous attempt is retained for diagnosis, never reused by self-hash.
          const mediaRootRelative = `operator-media/${input.binding.capture_result_sha256}`;
          const mediaRoot = inside(store.root, mediaRootRelative);
          mkdirSync(mediaRoot, { recursive: true, mode: 0o700 });
          const assets = input.capture.assets.map((asset) => ({
            source_url: asset.source_url,
            status: "FETCHED", // Builder compatibility: local verified bytes; no source HTTP claim.
            mime: asset.mime,
            sha256: asset.file.sha256,
            body_path: exactPrivateFile(
              store,
              `${mediaRootRelative}/${asset.file.sha256}.bin`,
              input.readFile(asset.file.relative_path),
            ),
          }));
          build.attempt_relative_path = `operator-builds/${inputHash}/${uid("attempt")}`;
          store.transaction(() => {
            store.put("operator_build", inputHash, build);
            store.event(
              "operator_build.attempt",
              "operator",
              {
                input_hash: inputHash,
                attempt_relative_path: build.attempt_relative_path,
              },
              store.currentRun().run_id,
            );
          });
          pipeline.assertOwnership(true);
          const attempt = inside(store.root, build.attempt_relative_path);
          const built = await buildBitrixPackage({
            projectId: input.project.project_id,
            sourceVersion: model.artifact.sha256,
            outputDir: attempt,
            sourceOrigin: input.capture.source_origin,
            designTokens: defaultTokens,
            entities: model.value.entities.map((entity) => ({
              ...entity,
              metadata: {
                operator_binding: input.binding,
                source_state: "PARTIAL",
                full_source_denominator: "UNKNOWN",
              },
            })),
            routes: routes.value.routes.map((route) => ({ ...route })),
            assets,
            assetRoot: mediaRoot,
            commerce: model.value.commerce,
          });
          addPartialBoundary(
            attempt,
            built.manifest,
            scope.value,
            input.binding,
            input.capture.inventory.length,
          );
          const manifestHash = hash(
            readFileSync(join(attempt, "manifest.json")),
          );
          await validateBitrixPackage(
            attempt,
            input.project.project_id,
            manifestHash,
          );
          if (sourceFingerprint(BUILD_CODE) !== codeHash)
            return fail(
              "Builder implementation changed during operator package execution",
            );
          pipeline.assertOwnership(true);
          build.manifest_sha256_package = manifestHash;
          store.transaction(() => {
            store.put("operator_build", inputHash, build);
            store.event(
              "operator_build.prepared",
              "operator",
              { input_hash: inputHash, manifest_sha256: manifestHash },
              store.currentRun().run_id,
            );
          });
        }
        if (!existsSync(finalDir)) {
          if (!build.attempt_relative_path)
            return fail(
              "Prepared operator build lacks its bounded staging path",
            );
          if (
            !new RegExp(
              `^operator-builds/${inputHash}/attempt-[a-f0-9-]+$`,
            ).test(build.attempt_relative_path)
          )
            return fail(
              "Prepared operator build staging path binding mismatch",
            );
          const attempt = inside(store.root, build.attempt_relative_path);
          await validateBitrixPackage(
            attempt,
            input.project.project_id,
            build.manifest_sha256_package,
          );
          mkdirSync(dirname(finalDir), { recursive: true, mode: 0o700 });
          renameSync(attempt, finalDir);
        }
        const manifest = await validateBitrixPackage(
          finalDir,
          input.project.project_id,
          build.manifest_sha256_package,
        );
        for (const file of [...Object.keys(manifest.files), "manifest.json"]) {
          await nextTurn();
          pipeline.assertOwnership(true);
          chmodSync(inside(finalDir, file), 0o400);
        }
        const release = operatorRelease(manifest, build, record);
        const bytes = json(release);
        build.result_artifact_id = reuseJson(
          store,
          pipeline,
          "operator-release-manifest.json",
          bytes,
          hash(bytes),
        ).artifact_id;
        build.state = "COMMITTED";
        store.transaction(() => {
          store.put("operator_build", inputHash, build);
          store.event(
            "operator_build.committed",
            "operator",
            {
              input_hash: inputHash,
              result_artifact_id: build.result_artifact_id,
              manifest_sha256: build.manifest_sha256_package,
              state: "PARTIAL",
              runtime_verification: "NOT_RUN",
            },
            store.currentRun().run_id,
          );
        });
        return {
          ...build,
          package_dir: finalDir,
          replayed: false,
          runtime_verification: "NOT_RUN",
        };
      },
      { maintenance: true },
    ),
  );
}
