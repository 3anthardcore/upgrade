import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { Store, hash, inside } from "../core/index.ts";
import { defaultTokens } from "../core/design.ts";
import type { Artifact } from "../contracts/index.ts";
import type { CaptureReceipt } from "../core/operator-capture.ts";
import { Ajv } from "ajv";
import { identifyUrl, inspectHtml } from "../crawler/index.ts";
import {
  operatorCaptureSchema,
  selectedDomObservationSchema,
} from "../crawler/operator.ts";
import type {
  OperatorCaptureManifest,
  SelectedDomObservation,
} from "../crawler/operator.ts";

const reportAjv = new Ajv({ allErrors: false });
const captureSchema = reportAjv.compile<OperatorCaptureManifest>(
  operatorCaptureSchema,
);
const selectedSchema = reportAjv.compile<SelectedDomObservation>(
  selectedDomObservationSchema,
);
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function requireEvidence(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
// Re-read the exact validated bytes; rendering never reads the mutable capture directory.
function evidenceBytes(store: Store, id: string, expectedType?: string) {
  const meta = store.get<Artifact>("artifact", id);
  const stat = lstatSync(inside(store.root, meta.relative_path));
  requireEvidence(
    Number.isSafeInteger(meta.size_bytes) &&
      meta.size_bytes >= 0 &&
      meta.size_bytes <= 256_000_000 &&
      stat.isFile() &&
      stat.nlink === 1 &&
      stat.size === meta.size_bytes,
    "Artifact is not a bounded independent regular file",
  );
  const artifact = store.validateArtifact(id);
  requireEvidence(
    artifact.validation_status === "VALID",
    "Artifact is not VALID",
  );
  requireEvidence(
    !expectedType || artifact.type === expectedType,
    "Artifact type binding mismatch",
  );
  const bytes = readFileSync(inside(store.root, artifact.relative_path));
  requireEvidence(
    bytes.length === artifact.size_bytes && hash(bytes) === artifact.sha256,
    "Artifact changed after validation",
  );
  return { artifact, bytes };
}
function operatorDerivedEvidence(
  store: Store,
  operator: ReturnType<typeof operatorEvidence>,
  project: any,
) {
  const models: any[] = [],
    builds: any[] = [];
  const modelRecords = store.list<any>("operator_model");
  const selectionFor = (binding: any): string[] => {
    if (
      binding?.schema_version === 1 &&
      typeof binding.selected_source_url === "string" &&
      !Object.hasOwn(binding, "selected_source_urls") &&
      !Object.hasOwn(binding, "selection_mode")
    )
      return [binding.selected_source_url];
    requireEvidence(
      binding?.schema_version === 2 &&
        binding.selection_mode === "ALL_OBSERVED" &&
        !Object.hasOwn(binding, "selected_source_url") &&
        Array.isArray(binding.selected_source_urls) &&
        binding.selected_source_urls.length > 0 &&
        binding.selected_source_urls.length <= 1000 &&
        binding.selected_source_urls.every(
          (url: unknown) =>
            typeof url === "string" && identifyUrl(url).crawl_key === url,
        ) &&
        same(
          binding.selected_source_urls,
          [...new Set(binding.selected_source_urls)].sort(),
        ),
      "Derived selection binding is invalid",
    );
    return binding.selected_source_urls;
  };
  const validateBinding = (record: any) => {
    const binding = record.operator_binding;
    const capture = operator.captures.find(
      (item) =>
        item.capture_id === record.capture_id &&
        item.manifest_sha256 === record.manifest_sha256,
    );
    requireEvidence(
      capture?.state === "PARTIAL",
      "Derived output requires a fully verified COMMITTED capture",
    );
    requireEvidence(
      [1, 2].includes(binding?.schema_version) &&
        binding.project_id === project.project_id &&
        binding.capture_id === capture.capture_id &&
        binding.manifest_sha256 === capture.manifest_sha256 &&
        binding.capture_result_artifact_id === capture.result_artifact_id &&
        record.capture_result_artifact_id === capture.result_artifact_id &&
        binding.source_artifact_id === capture.source_artifact_id &&
        binding.server_access_block_id === capture.server_access_block_id,
      "Derived capture/source binding mismatch",
    );
    requireEvidence(
      evidenceBytes(store, binding.capture_result_artifact_id).artifact
        .sha256 === binding.capture_result_sha256,
      "Derived capture result SHA mismatch",
    );
    const sourceHash = binding.source_artifact_id
      ? evidenceBytes(store, binding.source_artifact_id, "crawl-result.json")
          .artifact.sha256
      : null;
    requireEvidence(
      sourceHash === binding.source_artifact_sha256,
      "Derived original source SHA mismatch",
    );
    requireEvidence(
      selectionFor(binding).every((url) =>
        operator.registry.urls.some(
          (row) =>
            row.crawl_key === url &&
            row.observations.some(
              (observation) => observation.capture_id === capture.capture_id,
            ),
        ),
      ),
      "Derived selected URL has no verified operator observation",
    );
    if (binding.schema_version === 2) {
      const captureResult = JSON.parse(
        evidenceBytes(store, capture.result_artifact_id).bytes.toString("utf8"),
      );
      requireEvidence(
        same(
          binding.selected_source_urls,
          [
            ...new Set(
              captureResult.observations.map(
                (observation: any) =>
                  identifyUrl(observation.source_url).crawl_key,
              ),
            ),
          ].sort(),
        ),
        "ALL_OBSERVED must select every captured source page",
      );
    }
    requireEvidence(
      record.id === record.input_hash &&
        /^[a-f0-9]{64}$/.test(record.input_hash) &&
        /^[a-f0-9]{64}$/.test(record.code_sha256),
      "Derived input identity is malformed",
    );
    return capture;
  };
  const boundJson = (
    record: any,
    id: string,
    type: string,
    expectedSha?: string,
  ) => {
    const file = evidenceBytes(store, id, type);
    requireEvidence(
      !expectedSha || file.artifact.sha256 === expectedSha,
      "Derived output SHA mismatch",
    );
    const body = JSON.parse(file.bytes.toString("utf8"));
    requireEvidence(
      same(body.operator_binding, record.operator_binding) &&
        body.input_hash === record.input_hash &&
        body.state === "PARTIAL" &&
        body.full_source_denominator === "UNKNOWN",
      "Derived artifact binding/state mismatch",
    );
    return body;
  };
  for (const record of modelRecords) {
    const item: any = {
      id: record.id,
      capture_id: record.capture_id,
      recorded_state: record.state,
      state: record.state === "PENDING" ? "PENDING" : "INVALID",
      issues: [],
    };
    models.push(item);
    if (record.state === "PENDING") {
      item.issues.push("Model publication is incomplete.");
      continue;
    }
    try {
      requireEvidence(
        record.state === "COMMITTED",
        "Unsupported operator model state",
      );
      const capture = validateBinding(record);
      requireEvidence(
        record.input_hash ===
          hash(
            JSON.stringify([
              record.operator_binding.schema_version === 1
                ? "operator-model-v1"
                : "operator-model-v2",
              record.operator_binding,
              record.code_sha256,
            ]),
          ),
        "Operator model input hash mismatch",
      );
      const ids = record.output_artifact_ids,
        pins = record.output_sha256;
      requireEvidence(
        ids &&
          pins &&
          ["model", "routes", "scope"].every(
            (name) =>
              typeof ids[name] === "string" &&
              /^[a-f0-9]{64}$/.test(pins[name]),
          ),
        "Operator model output pins are incomplete",
      );
      const model = boundJson(
        record,
        ids.model,
        "operator-content-model.json",
        pins.model,
      );
      const routes = boundJson(
        record,
        ids.routes,
        "operator-route-manifest.json",
        pins.routes,
      );
      const scope = boundJson(
        record,
        ids.scope,
        "operator-scope-manifest.json",
        pins.scope,
      );
      requireEvidence(
        model.project_id === project.project_id &&
          routes.project_id === project.project_id &&
          Array.isArray(model.entities) &&
          Array.isArray(routes.routes) &&
          Array.isArray(scope.inventory),
        "Operator model/routes/scope contract mismatch",
      );
      const captureResult = JSON.parse(
        evidenceBytes(store, capture.result_artifact_id).bytes.toString("utf8"),
      );
      const selection = selectionFor(record.operator_binding);
      requireEvidence(
        same(scope.inventory, captureResult.inventory) &&
          same(scope.coverage, captureResult.coverage) &&
          scope.known_url_count === captureResult.inventory.length &&
          scope.planned_route_count === routes.routes.length &&
          scope.selected_url_count === selection.length &&
          scope.unresolved_url_count ===
            scope.known_url_count - routes.routes.length &&
          same(scope.selected_source_urls, selection),
        "Operator model scope denominator mismatch",
      );
      requireEvidence(
        model.entities.length === selection.length &&
          same(
            model.entities
              .map((entity: any) => identifyUrl(entity.source_url).crawl_key)
              .sort(),
            selection.slice().sort(),
          ) &&
          routes.routes.length <= selection.length &&
          new Set(routes.routes.map((route: any) => route.request_target))
            .size === routes.routes.length &&
          routes.routes.every(
            (route: any) =>
              selection.includes(route.source_origin + route.request_target) &&
              route.target_route === route.request_target &&
              route.query_policy === "preserve-exact" &&
              model.entities.some(
                (entity: any) =>
                  entity.source_id === route.entity_source_id &&
                  identifyUrl(entity.source_url).crawl_key ===
                    route.source_origin + route.request_target,
              ),
          ),
        "Operator model route selection mismatch",
      );
      Object.assign(item, {
        state: "PARTIAL",
        integrity: "VERIFIED",
        stale_binding: capture.stale_binding,
        selected_source_url: record.operator_binding.selected_source_url,
        selected_source_urls: selection,
        selection_mode:
          record.operator_binding.schema_version === 1
            ? "SINGLE_PAGE"
            : "ALL_OBSERVED",
        entities: model.entities.length,
        known_urls: scope.known_url_count,
        planned_routes: routes.routes.length,
        unresolved_urls: scope.unresolved_url_count,
        output_artifact_ids: ids,
        runtime_verification: "NOT_RUN",
      });
    } catch (error) {
      item.issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const record of store.list<any>("operator_build")) {
    const item: any = {
      id: record.id,
      capture_id: record.capture_id,
      recorded_state: record.state,
      state: record.state === "PENDING" ? "PENDING" : "INVALID",
      issues: [],
    };
    builds.push(item);
    if (record.state === "PENDING") {
      item.issues.push("Package publication is incomplete.");
      continue;
    }
    try {
      requireEvidence(
        record.state === "COMMITTED",
        "Unsupported operator build state",
      );
      const capture = validateBinding(record);
      const modelInfo = models.find(
        (model) =>
          model.id === record.model_record_id && model.state === "PARTIAL",
      );
      const modelRecord = modelRecords.find(
        (model) => model.id === record.model_record_id,
      );
      requireEvidence(
        modelInfo &&
          modelRecord &&
          same(record.operator_binding, modelRecord.operator_binding) &&
          same(record.input_artifact_ids, [
            modelRecord.output_artifact_ids.model,
            modelRecord.output_artifact_ids.routes,
            modelRecord.output_artifact_ids.scope,
          ]),
        "Operator package model/input binding mismatch",
      );
      requireEvidence(
        record.input_hash ===
          hash(
            JSON.stringify([
              record.operator_binding.schema_version === 1
                ? "operator-build-v1"
                : "operator-build-v2",
              modelRecord.id,
              modelRecord.output_sha256,
              record.code_sha256,
              defaultTokens,
            ]),
          ),
        "Operator build input hash mismatch",
      );
      const release = boundJson(
        record,
        record.result_artifact_id,
        "operator-release-manifest.json",
      );
      requireEvidence(
        release.project_id === project.project_id &&
          release.release_id === record.release_id &&
          release.package_relative_path === record.package_relative_path &&
          release.manifest_sha256 === record.manifest_sha256_package &&
          release.code_sha256 === record.code_sha256 &&
          release.model_record_id === modelRecord.id &&
          release.model_artifact_id === modelRecord.output_artifact_ids.model &&
          release.route_manifest_artifact_id ===
            modelRecord.output_artifact_ids.routes &&
          release.scope_artifact_id === modelRecord.output_artifact_ids.scope,
        "Operator release artifact binding mismatch",
      );
      const packageDir = inside(store.root, record.package_relative_path);
      requireEvidence(
        lstatSync(packageDir).isDirectory() &&
          !lstatSync(packageDir).isSymbolicLink(),
        "Package root must be an independent directory",
      );
      const packageFiles = new Map<string, string>();
      let manifestBytes: Buffer | undefined;
      const walk = (relative = "") => {
        for (const name of readdirSync(
          relative ? inside(packageDir, relative) : packageDir,
        )) {
          const rel = relative ? `${relative}/${name}` : name;
          const stat = lstatSync(inside(packageDir, rel));
          requireEvidence(!stat.isSymbolicLink(), "Package contains symlink");
          if (stat.isDirectory()) walk(rel);
          else {
            requireEvidence(
              stat.isFile() &&
                stat.nlink === 1 &&
                stat.size <= 256_000_000 &&
                packageFiles.size < 10000,
              "Package contains unsupported or oversized file",
            );
            const bytes = readFileSync(inside(packageDir, rel));
            packageFiles.set(rel, hash(bytes));
            if (rel === "manifest.json") manifestBytes = bytes;
          }
        }
      };
      walk();
      requireEvidence(
        packageFiles.get("manifest.json") === record.manifest_sha256_package,
        "Operator package accepted manifest SHA mismatch",
      );
      requireEvidence(manifestBytes, "Operator package manifest is missing");
      const manifest = JSON.parse(manifestBytes.toString("utf8"));
      requireEvidence(
        manifest.project_id === project.project_id &&
          manifest.source_version === modelRecord.output_sha256.model &&
          same(manifest.files, release.files) &&
          packageFiles.size === Object.keys(manifest.files).length + 1 &&
          Object.entries(manifest.files).every(
            ([path, sha]) => packageFiles.get(path) === sha,
          ),
        "Operator package bytes/tree differ from the accepted release",
      );
      requireEvidence(
        Array.isArray(manifest.blockers) &&
          manifest.blockers.every(
            (value: unknown) => typeof value === "string",
          ) &&
          Array.isArray(manifest.warnings) &&
          manifest.warnings.every(
            (value: unknown) => typeof value === "string",
          ) &&
          same(manifest.blockers, release.blockers) &&
          same(manifest.warnings, release.warnings),
        "Operator package blockers/warnings binding mismatch",
      );
      Object.assign(item, {
        state: "PARTIAL",
        integrity: "VERIFIED",
        package_integrity: "VERIFIED",
        package_blockers: manifest.blockers,
        package_warnings: manifest.warnings,
        import_gate: manifest.blockers.length
          ? "BLOCKED_PACKAGE"
          : "NOT_EVALUATED",
        stale_binding: capture.stale_binding,
        release_id: record.release_id,
        package_relative_path: record.package_relative_path,
        model_record_id: record.model_record_id,
        planned_routes: modelInfo.planned_routes,
        known_urls: modelInfo.known_urls,
        unresolved_urls: modelInfo.unresolved_urls,
        selected_source_urls: modelInfo.selected_source_urls,
        selection_mode: modelInfo.selection_mode,
        runtime_verification: "NOT_RUN",
        result_artifact_id: record.result_artifact_id,
      });
    } catch (error) {
      item.issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    models,
    builds,
    runtime_verification: "NOT_RUN",
    latest_verified_model_id:
      models.filter((model) => model.state === "PARTIAL").at(-1)?.id ?? null,
    latest_verified_build_id:
      builds.filter((build) => build.state === "PARTIAL").at(-1)?.id ?? null,
    incomplete_outputs: [...models, ...builds].filter(
      (record) => record.state !== "PARTIAL",
    ).length,
    note: "Модель, запланированные маршруты и локальный пакет частичного наблюдения проверяются отдельно от настоящего импорта и HTTP Битрикс.",
  };
}
function captureArtifactType(capture: CaptureReceipt, path: string) {
  return `operator-capture-${hash(JSON.stringify([capture.capture_id, capture.manifest_sha256, path]))}.bin`;
}
function sourceUrls(source: any): string[] {
  return [
    ...new Set<string>(
      (source?.entries ?? []).flatMap((entry: any) =>
        [entry.raw_url, ...(entry.raw_urls ?? []), entry.crawl_key].filter(
          (url) => typeof url === "string",
        ),
      ),
    ),
  ];
}
interface OperatorUrl {
  crawl_key: string;
  request_target: string;
  raw_urls: string[];
  current_crawl_statuses: string[];
  capture_inventory_sources: {
    capture_id: string;
    integrity: "UNVERIFIED_CAPTURE" | "VERIFIED_CAPTURE";
  }[];
  observations: {
    capture_id: string;
    state: "SELECTED_FIELDS" | "DOM_OBSERVED";
    stale_binding: boolean;
  }[];
}
function operatorEvidence(
  store: Store,
  source: any,
  currentId: string | null,
  project: any,
) {
  const receipts = store.list<CaptureReceipt>("operator_capture");
  const origin = identifyUrl(project.source.entry_url).origin;
  const combined = new Map<string, OperatorUrl>();
  const add = (raw: string) => {
    const id = identifyUrl(raw);
    let row = combined.get(id.crawl_key);
    if (!row) {
      row = {
        crawl_key: id.crawl_key,
        request_target: id.request_target,
        raw_urls: [],
        current_crawl_statuses: [],
        capture_inventory_sources: [],
        observations: [],
      };
      combined.set(id.crawl_key, row);
    }
    if (!row.raw_urls.includes(raw)) row.raw_urls.push(raw);
    return row;
  };
  const sourceIssues: string[] = [];
  for (const entry of source?.entries ?? []) {
    for (const raw of sourceUrls({ entries: [entry] })) {
      try {
        const row = add(raw);
        if (!row.current_crawl_statuses.includes(String(entry.status)))
          row.current_crawl_statuses.push(String(entry.status));
      } catch {
        sourceIssues.push(
          "An existing source URL could not be identified; its source row remains in the original registry.",
        );
      }
    }
  }
  if (receipts.length) add(project.source.entry_url);
  const captures: any[] = [];
  for (const receipt of receipts) {
    const info: any = {
      capture_id: receipt.capture_id,
      manifest_sha256: receipt.manifest_sha256,
      recorded_state: receipt.state,
      source_artifact_id: receipt.source_artifact_id,
      server_access_block_id: receipt.server_access_block_id,
      result_artifact_id: receipt.result_artifact_id ?? null,
      stale_binding: receipt.source_artifact_id !== currentId,
      state: receipt.state === "PENDING" ? "PENDING" : "INVALID",
      issues: [],
    };
    captures.push(info);
    if (receipt.state === "PENDING") {
      info.issues.push(
        "Publication is incomplete; pending evidence is not included as verified observations.",
      );
      continue;
    }
    try {
      requireEvidence(
        receipt.state === "COMMITTED" && receipt.schema_version === 1,
        "Unsupported capture receipt state/schema",
      );
      requireEvidence(
        /^[a-f0-9]{64}$/.test(receipt.manifest_sha256),
        "Invalid capture manifest pin",
      );
      const result = JSON.parse(
        evidenceBytes(
          store,
          receipt.result_artifact_id!,
          captureArtifactType(receipt, "@validated-result"),
        ).bytes.toString("utf8"),
      );
      requireEvidence(
        result.schema_version === 1 &&
          result.kind === "validated-operator-capture" &&
          result.project_id === project.project_id &&
          result.source_origin === origin &&
          result.capture_id === receipt.capture_id &&
          result.manifest_sha256 === receipt.manifest_sha256 &&
          result.source_artifact_id === receipt.source_artifact_id &&
          result.server_access_block_id === receipt.server_access_block_id &&
          result.state === "PARTIAL" &&
          result.source_access === "NOT_VERIFIED" &&
          result.readiness === "NOT_EVALUATED" &&
          result.trust === "untrusted-source-data",
        "Capture result binding or partial-state mismatch",
      );
      const boundSource = receipt.source_artifact_id
        ? JSON.parse(
            evidenceBytes(
              store,
              receipt.source_artifact_id,
              "crawl-result.json",
            ).bytes.toString("utf8"),
          )
        : null;
      requireEvidence(
        (boundSource?.access?.active_block_id ?? null) ===
          receipt.server_access_block_id,
        "Original source access block binding mismatch",
      );
      requireEvidence(
        same(result.original_source_registry, sourceUrls(boundSource)),
        "Original source registry mismatch",
      );
      // URL existence and successful observation are separate. Keep a hash-verified
      // stored registry in the denominator even if a later payload check fails.
      requireEvidence(
        Array.isArray(result.inventory),
        "Missing capture URL registry",
      );
      const retained = new Map<string, string[]>();
      for (const row of result.inventory) {
        requireEvidence(
          typeof row.crawl_key === "string" &&
            !retained.has(row.crawl_key) &&
            Array.isArray(row.raw_urls) &&
            row.raw_urls.length > 0,
          "Invalid retained capture URL registry",
        );
        for (const raw of row.raw_urls) {
          const identity = identifyUrl(raw);
          requireEvidence(
            /^https?:\/\//i.test(raw) &&
              identity.origin === origin &&
              identity.crawl_key === row.crawl_key &&
              identity.request_target === row.request_target,
            "Retained capture URL binding mismatch",
          );
        }
        retained.set(row.crawl_key, row.raw_urls);
      }
      for (const raw of sourceUrls(boundSource)) add(raw);
      for (const [key, raws] of retained) {
        for (const raw of raws) add(raw);
        combined.get(key)!.capture_inventory_sources.push({
          capture_id: receipt.capture_id,
          integrity: "UNVERIFIED_CAPTURE",
        });
      }
      info.known_registry_urls = retained.size;
      requireEvidence(
        Array.isArray(receipt.files) &&
          same(result.artifact_files, receipt.files),
        "Published file mapping mismatch",
      );
      requireEvidence(
        Array.isArray(result.files),
        "Missing validated file references",
      );
      const fileMap = new Map<string, { bytes: Buffer; artifact: Artifact }>();
      for (const ref of receipt.files) {
        requireEvidence(
          typeof ref.relative_path === "string" &&
            !fileMap.has(ref.relative_path),
          "Duplicate capture file mapping",
        );
        const file = evidenceBytes(
          store,
          ref.artifact_id,
          captureArtifactType(receipt, ref.relative_path),
        );
        requireEvidence(
          file.artifact.sha256 === ref.sha256,
          "Capture file pin mismatch",
        );
        fileMap.set(ref.relative_path, file);
      }
      const payloadPaths = new Set(
        result.files.map((ref: any) => ref.relative_path),
      );
      const manifestRefs = receipt.files.filter(
        (ref) => !payloadPaths.has(ref.relative_path),
      );
      requireEvidence(
        manifestRefs.length === 1 &&
          manifestRefs[0].sha256 === receipt.manifest_sha256,
        "Exactly one pinned capture manifest is required",
      );
      const manifest = JSON.parse(
        fileMap.get(manifestRefs[0].relative_path)!.bytes.toString("utf8"),
      );
      requireEvidence(
        captureSchema(manifest) &&
          manifest.project_id === project.project_id &&
          manifest.capture_id === receipt.capture_id &&
          manifest.source_origin === origin,
        "Capture manifest schema/project binding mismatch",
      );
      const expectedFiles = [
        ...manifest.observations.map((o: any) => o.file),
        ...manifest.assets.map((a: any) => a.file),
      ];
      requireEvidence(
        same(result.files, expectedFiles) &&
          fileMap.size === expectedFiles.length + 1,
        "Capture result does not contain the exact manifest file set",
      );
      for (const ref of expectedFiles) {
        const file = fileMap.get(ref.relative_path);
        requireEvidence(
          file &&
            file.artifact.sha256 === ref.sha256 &&
            file.bytes.length === ref.size_bytes,
          "Capture payload hash/size mismatch",
        );
      }
      const inventory = new Map<
        string,
        { raw_urls: Set<string>; observation: string }
      >();
      const register = (raw: string) => {
        requireEvidence(
          /^https?:\/\//i.test(raw),
          "Capture URL is not absolute HTTP(S)",
        );
        const id = identifyUrl(raw);
        requireEvidence(
          id.origin === origin,
          "Foreign origin in capture inventory",
        );
        let row = inventory.get(id.crawl_key);
        if (!row) {
          row = { raw_urls: new Set(), observation: "UNOBSERVED" };
          inventory.set(id.crawl_key, row);
        }
        row.raw_urls.add(raw);
        return row;
      };
      register(project.source.entry_url);
      for (const raw of [
        ...sourceUrls(boundSource),
        ...manifest.inventory.urls,
      ])
        register(raw);
      const expectedObservations = [];
      for (const observation of manifest.observations) {
        const row = register(observation.source_url);
        register(observation.document_url);
        let selected: any;
        let links: string[];
        const bytes = fileMap.get(observation.file.relative_path)!.bytes;
        if (observation.format === "selected-fields-json") {
          selected = JSON.parse(bytes.toString("utf8"));
          requireEvidence(
            selectedSchema(selected) &&
              identifyUrl(selected.source_url).crawl_key ===
                identifyUrl(observation.source_url).crawl_key,
            "Selected fields schema/source binding mismatch",
          );
          links = selected.links;
          row.observation = "SELECTED_FIELDS";
        } else {
          links = inspectHtml(
            bytes.toString("utf8"),
            identifyUrl(observation.document_url).crawl_key,
          ).links;
          row.observation = "DOM_OBSERVED";
        }
        for (const link of links) {
          try {
            const identity = identifyUrl(link, observation.document_url);
            if (identity.origin === origin) register(identity.raw_url);
          } catch {
            /* Invalid/external links are not source HTTP URLs. */
          }
        }
        expectedObservations.push({
          ...observation,
          trust: "untrusted-source-data",
          ...(selected ? { selected_fields: selected } : {}),
        });
      }
      requireEvidence(
        same(result.observations, expectedObservations) &&
          same(result.assets, manifest.assets),
        "Observation data differs from the pinned files/manifest",
      );
      requireEvidence(
        Array.isArray(result.inventory) &&
          result.inventory.length === inventory.size,
        "Capture inventory is incomplete or duplicated",
      );
      const seen = new Set<string>();
      for (const row of result.inventory) {
        const expected = inventory.get(row.crawl_key);
        requireEvidence(
          expected &&
            !seen.has(row.crawl_key) &&
            identifyUrl(row.crawl_key).request_target === row.request_target &&
            same([...expected.raw_urls].sort(), [...row.raw_urls].sort()) &&
            expected.observation === row.observation,
          "Capture URL inventory binding mismatch",
        );
        seen.add(row.crawl_key);
      }
      const coverage = {
        known_urls: inventory.size,
        unobserved: [...inventory.values()].filter(
          (r) => r.observation === "UNOBSERVED",
        ).length,
        selected_fields: [...inventory.values()].filter(
          (r) => r.observation === "SELECTED_FIELDS",
        ).length,
        dom_observed: [...inventory.values()].filter(
          (r) => r.observation === "DOM_OBSERVED",
        ).length,
        full_source_denominator: "UNKNOWN",
      };
      requireEvidence(
        result.coverage?.basis === "union-of-existing-and-observed-urls" &&
          Object.entries(coverage).every(
            ([key, value]) => result.coverage[key] === value,
          ),
        "Capture coverage claim mismatch",
      );
      // Only successful observation/asset counts wait for complete payload verification.
      for (const [key, row] of inventory) {
        for (const raw of row.raw_urls) add(raw);
        const provenance = combined
          .get(key)!
          .capture_inventory_sources.find(
            (entry) => entry.capture_id === receipt.capture_id,
          );
        if (provenance) provenance.integrity = "VERIFIED_CAPTURE";
        if (row.observation !== "UNOBSERVED")
          combined.get(key)!.observations.push({
            capture_id: receipt.capture_id,
            state: row.observation as "SELECTED_FIELDS" | "DOM_OBSERVED",
            stale_binding: info.stale_binding,
          });
      }
      Object.assign(info, {
        state: "PARTIAL",
        integrity: "VERIFIED",
        coverage,
        verified_files: fileMap.size,
        verified_assets: manifest.assets.length,
        captured_at: manifest.captured_at,
      });
    } catch (error) {
      info.state = "INVALID";
      info.issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  const valid = captures.filter((capture) => capture.state === "PARTIAL");
  const issues = captures.filter((capture) => capture.state !== "PARTIAL");
  const urls = [...combined.values()];
  const registry = {
    basis: "current-crawl-and-verified-operator-captures",
    known_urls: urls.length,
    selected_fields: urls.filter((row) =>
      row.observations.some((o) => o.state === "SELECTED_FIELDS"),
    ).length,
    dom_observed: urls.filter((row) =>
      row.observations.some((o) => o.state === "DOM_OBSERVED"),
    ).length,
    unobserved: urls.filter((row) => !row.observations.length).length,
    unverified_capture_urls: urls.filter((row) =>
      row.capture_inventory_sources.some(
        (entry) => entry.integrity === "UNVERIFIED_CAPTURE",
      ),
    ).length,
    evidence_complete: issues.length === 0 && sourceIssues.length === 0,
    full_source_denominator: "UNKNOWN",
    urls,
    issues: sourceIssues,
  };
  return {
    state: issues.length
      ? valid.length
        ? "PARTIAL_WITH_ERRORS"
        : captures.some((c) => c.state === "INVALID")
          ? "INVALID"
          : "PENDING"
      : valid.length
        ? "PARTIAL"
        : "NOT_CAPTURED",
    captures,
    registry,
    valid_captures: valid.length,
    pending_captures: captures.filter((c) => c.state === "PENDING").length,
    invalid_captures: captures.filter((c) => c.state === "INVALID").length,
    source_access: "NOT_VERIFIED",
    readiness: "NOT_EVALUATED",
    summary: `Операторские наблюдения: ${valid.length} проверенных частичных capture; незавершённых: ${captures.filter((c) => c.state === "PENDING").length}; повреждённых или несогласованных: ${captures.filter((c) => c.state === "INVALID").length}. Объединённый известный реестр: ${registry.known_urls} URL; выбранные поля: ${registry.selected_fields}; DOM-наблюдения: ${registry.dom_observed}; без операторского наблюдения: ${registry.unobserved}; URL из capture с непроверенными данными: ${registry.unverified_capture_urls}. Полный размер сайта неизвестен. Выбранные поля и DOM не подтверждают полную страницу, HTTP 200, сценарии или снятие блокировки автоматического обхода.`,
  };
}
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const markdown = (s: unknown) =>
  esc(s)
    .replace(/([\\`*_\[\]#|])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
export function writeReport(store: Store) {
  const artifacts = store.list<Artifact>("artifact");
  const latest = (type: string) => {
    const a = artifacts.filter((a) => a.type === type).at(-1);
    if (!a) return null;
    return JSON.parse(
      evidenceBytes(store, a.artifact_id, type).bytes.toString("utf8"),
    );
  };
  const status = store.getStatus();
  const qa = latest("qa-report.json");
  const source = latest("crawl-result.json");
  const sourceArtifact = artifacts
    .filter((a) => a.type === "crawl-result.json")
    .at(-1);
  const operator = operatorEvidence(
    store,
    source,
    sourceArtifact?.artifact_id ?? null,
    status.project,
  );
  const operatorDerived = operatorDerivedEvidence(
    store,
    operator,
    status.project,
  );
  const accessError = latest("source-access-error.json");
  const persistedGuardError =
    sourceArtifact &&
    accessError?.source_artifact_id === sourceArtifact.artifact_id &&
    [
      "STORED_ACCESS_CHALLENGE",
      "ACCESS_REVALIDATION_REQUIRED",
      "ACCESS_REQUIRED",
    ].includes(accessError.code)
      ? accessError
      : null;
  const guardError =
    persistedGuardError ??
    (source?.state === "COMPLETE" && source?.access?.version !== 1
      ? {
          source_artifact_id: sourceArtifact!.artifact_id,
          code: "ACCESS_REVALIDATION_REQUIRED",
          reason:
            "Сохранённый COMPLETE не содержит access.version=1; требуется повторная проверка robots.txt перед использованием исходного контента.",
          origin: "report-compatibility-check",
        }
      : null);
  const content = latest("content-model.json");
  const release = latest("release-manifest.json");
  const entries: Array<{ status: string }> = source?.entries ?? [];
  const count = (...states: string[]) =>
    entries.filter((entry) => states.includes(entry.status)).length;
  const recordedSourceState =
    source?.state ??
    (status.run?.execution_status === "PAUSED" ? "PAUSED" : "NOT_STARTED");
  const sourceState = guardError ? "PAUSED" : recordedSourceState;
  const registry = {
    basis: "discovered-source-registry",
    available: Boolean(source),
    denominator: entries.length,
    in_scope: entries.length - count("EXCLUDED"),
    excluded: count("EXCLUDED"),
    queued: count("DISCOVERED", "RATE_LIMITED"),
    requires_access: count("REQUIRES_ACCESS"),
    rate_limited: count("RATE_LIMITED"),
    fetched: guardError ? 0 : count("FETCHED", "RENDERED"),
    recorded_fetched: count("FETCHED", "RENDERED"),
    requires_revalidation: guardError ? count("FETCHED", "RENDERED") : 0,
    failed: count("FAILED", "UNREACHABLE", "REQUIRES_ACCESS", "RATE_LIMITED"),
  };
  const access = source?.access ?? { blocks: [] };
  const accessBlocked =
    Boolean(access.active_block_id) ||
    registry.requires_access > 0 ||
    ["STORED_ACCESS_CHALLENGE", "ACCESS_REQUIRED"].includes(guardError?.code);
  const needsRevalidation = guardError?.code === "ACCESS_REVALIDATION_REQUIRED";
  const incomplete = sourceState !== "COMPLETE" || accessBlocked;
  const entryUrl = status.project.source.entry_url;
  const extentNote =
    "Полный размер исходного сайта неизвестен; реестр содержит только обнаруженные URL и не доказывает полноту всего сайта.";
  const sourceSummary =
    `Исходный URL: ${entryUrl}. Исследование: ${sourceState}. ` +
    `Известный реестр: ${registry.denominator} URL; в scope: ${registry.in_scope}; ` +
    `в очереди: ${registry.queued}; требуют доступа: ${registry.requires_access}; ` +
    `ограничены по частоте: ${registry.rate_limited}; исключены: ${registry.excluded}; ` +
    `получены: ${registry.fetched}; с ошибкой или недоступны: ${registry.failed}. ` +
    `Требуют повторной проверки: ${registry.requires_revalidation}. ` +
    `Sitemap в очереди: ${source?.discovery?.sitemap_queue?.length ?? 0}. ` +
    `Зафиксировано ограничений доступа: ${access.blocks?.length ?? 0}. ` +
    `Активное ограничение доступа: ${accessBlocked ? "да" : "не зарегистрировано"}. ` +
    (needsRevalidation && !accessBlocked
      ? "Требуется повторная проверка robots.txt; блокировка провайдером не подтверждена. "
      : "") +
    "Сведения относятся к сохранённому автоматическому обходу, а не ко всем способам доступа к сайту. " +
    extentNote;
  const entities = content?.entities?.length ?? 0;
  const normalContentNote = content
    ? `Извлечено сущностей: ${entities}. Это число относится к сохранённой модели; размер каталога источника не установлен.`
    : "Контент ещё не извлечён. 0 сохранённых сущностей не означает пустой каталог источника.";
  const partialModel = operatorDerived.models
    .filter((model) => model.state === "PARTIAL")
    .at(-1);
  const partialBuild = operatorDerived.builds
    .filter((build) => build.state === "PARTIAL")
    .at(-1);
  const contentNote = partialModel
    ? `Модель автоматического обхода: ${entities} сущностей. Отдельная проверенная операторская модель: сущностей — ${partialModel.entities}, запланированных маршрутов — ${partialModel.planned_routes} из ${partialModel.known_urls} известных URL. Остальные URL не считаются перенесёнными; размер всего каталога неизвестен.`
    : normalContentNote;
  const headline = accessBlocked
    ? "NOT_READY — автоматический доступ к источнику ограничен"
    : needsRevalidation
      ? "NOT_READY — требуется повторная проверка доступа к источнику"
      : incomplete
        ? sourceState === "NOT_STARTED"
          ? "NOT_READY — исследование источника не начато"
          : "NOT_READY — исследование источника не завершено"
        : "NOT_READY — интеграция Битрикс не подтверждена";
  const sourceNextStep = accessBlocked
    ? "Получить разрешённый доступ к источнику или согласованный экспорт. После снятия ограничения продолжить исследование и проверить исходный реестр URL."
    : needsRevalidation
      ? "Повторно проверить robots.txt командой crawl с прежними лимитами и сохранёнными правилами доступа; после проверки продолжить исследование источника."
      : incomplete
        ? sourceState === "NOT_STARTED"
          ? "Начать исследование источника и сформировать исходный реестр URL, соблюдая разрешённый доступ и лимиты."
          : "Продолжить исследование источника с сохранённого состояния: проверить доступ, ограничения и оставшуюся очередь URL."
        : partialBuild?.package_blockers.length
          ? "Уточнить неохваченные URL и проверить полноту исходного реестра."
          : "Настроить изолированный Битрикс и выполнить импорт, URL/контент/сценарии/админку и backup restore.";
  const operatorNextStep =
    operator.invalid_captures || operatorDerived.incomplete_outputs
      ? "Проверить ошибки и незавершённые записи операторских артефактов, восстановить их по принятым хешам до использования модели или пакета."
      : operator.pending_captures
        ? "Продолжить незавершённое принятие операторского capture по прежнему manifest SHA."
        : operatorDerived.latest_verified_build_id
          ? partialBuild?.package_blockers.length
            ? "Устранить блокеры частичного операторского пакета и собрать новую принятую версию. Импорт заблокирован; отсутствующие файлы и неохваченные URL не считаются перенесёнными."
            : `Проверить изолированный импорт частичного операторского пакета и выбранные маршруты (${partialBuild?.planned_routes ?? 0}); остальные известные URL остаются неохваченными.`
          : partialModel
            ? "Собрать отдельный частичный пакет из проверенной операторской модели, сохранив неохваченные URL в scope."
            : operator.valid_captures
              ? "Извлечь отдельную частичную модель явно выбранной страницы или всех наблюдавшихся страниц из принятого операторского capture и продолжать пополнение наблюдений."
              : "";
  const nextStep = operatorNextStep
    ? `${operatorNextStep} ${sourceNextStep}`
    : sourceNextStep;
  const report = {
    schema_version: 1,
    project_id: status.project.project_id,
    phase: status.run?.phase ?? "NOT_STARTED",
    execution_status: status.run?.execution_status ?? "NOT_STARTED",
    readiness: "NOT_READY",
    headline,
    source: {
      url: entryUrl,
      origin: source?.source_origin ?? new URL(entryUrl).origin,
      state: sourceState,
      recorded_state: recordedSourceState,
      artifact_id: sourceArtifact?.artifact_id ?? null,
      guard_error: guardError,
      gate: accessBlocked
        ? "ACCESS_REQUIRED"
        : needsRevalidation
          ? "ACCESS_REVALIDATION_REQUIRED"
          : incomplete
            ? "DISCOVERY_INCOMPLETE"
            : "COMPLETE",
      counts: source?.counters ?? null,
      registry,
      access_blocked: accessBlocked,
      access,
      frontier: {
        robots_done: source?.discovery?.robots_done ?? false,
        sitemap_queued: source?.discovery?.sitemap_queue?.length ?? 0,
      },
      total_site_urls: null,
      total_site_urls_status: "UNKNOWN",
      extent_note: extentNote,
      summary: sourceSummary,
    },
    qa,
    operator,
    operator_derived: operatorDerived,
    target: {
      state: qa ? "RECORDED_QA" : "NOT_RUN",
      counts: qa?.counts ?? null,
      coverage: qa?.coverage ?? null,
      operator_capture_import: "NOT_RUN",
      note: "Целевые проверки относятся только к сохранённому QA-артефакту. Операторские наблюдения не являются импортом или проверкой страниц Битрикс.",
    },
    entities,
    content: {
      state: content ? "EXTRACTED" : "NOT_EXTRACTED",
      observed_entities: entities,
      source_catalog_size: null,
      note: contentNote,
    },
    limitations: [
      ...new Set([
        ...(source?.limitations ?? []),
        ...(content?.limitations ?? []),
        ...(release?.warnings ?? []),
        ...(release?.blockers ?? []),
        ...(guardError ? [String(guardError.reason)] : []),
        ...operator.captures.flatMap((capture: any) =>
          capture.issues.map(
            (issue: string) =>
              `Operator capture ${capture.capture_id}: ${issue}`,
          ),
        ),
        ...[...operatorDerived.models, ...operatorDerived.builds].flatMap(
          (record: any) =>
            record.issues.map(
              (issue: string) => `Operator derived ${record.id}: ${issue}`,
            ),
        ),
        ...operatorDerived.builds.flatMap((build: any) => [
          ...(build.package_blockers ?? []).map(
            (value: string) => `Operator package ${build.id} blocker: ${value}`,
          ),
          ...(build.package_warnings ?? []).map(
            (value: string) => `Operator package ${build.id} warning: ${value}`,
          ),
        ]),
        ...(operator.captures.some((capture: any) => capture.stale_binding)
          ? [
              "Часть операторских capture привязана к прежнему снимку обхода; текущий crawl и его ограничения сохранены отдельно.",
            ]
          : []),
        ...(operator.captures.length
          ? [
              "Операторский ввод частичен; полный размер источника неизвестен, HTTP-статусы и функции по выбранным полям не установлены.",
            ]
          : []),
        ...(incomplete
          ? [
              "Исследование источника не завершено; полнота контента и исходного реестра не подтверждена.",
            ]
          : []),
        "Настоящий Битрикс, административная часть, production-интеграции и восстановление Битрикс: NOT_RUN.",
      ]),
    ],
    cost: {
      budget: status.run?.budget,
      monetary_status: "UNAVAILABLE",
      tokens_status: "See individual agent results; unavailable is not zero",
    },
    next_step: nextStep,
    resume: `npm run upgrade -- ${status.run ? "resume" : "plan"} --project ${status.project.project_id}`,
    generated_at: new Date().toISOString(),
  };
  const dir = inside(store.root, "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "report.json"), JSON.stringify(report, null, 2));
  const rows = (qa?.checks ?? [])
    .map(
      (c: any) =>
        `<tr><td>${esc(c.id)}</td><td>${esc(c.status)}</td><td>${esc(c.details)}</td></tr>`,
    )
    .join("");
  const operatorRows = report.operator.registry.urls
    .map(
      (row) =>
        `<tr><td>${esc(row.crawl_key)}</td><td>${esc(row.current_crawl_statuses.join(", ") || "Нет в текущем crawl")}</td><td>${esc(row.observations.map((observation) => observation.state + (observation.stale_binding ? " (прежний snapshot)" : "")).join(", ") || "UNOBSERVED")}</td></tr>`,
    )
    .join("");
  const operatorHtml = report.operator.captures.length
    ? `<h2>Операторские наблюдения и общий URL-реестр</h2><p>${esc(report.operator.summary)}</p><p>Состояние evidence: ${esc(report.operator.state)}. Источник остаётся ${esc(report.source.state)} / ${esc(report.source.gate)}.</p><pre>${esc(JSON.stringify(report.operator.captures, null, 2))}</pre><table><thead><tr><th>Исходный URL</th><th>Текущий автоматический обход</th><th>Операторское наблюдение</th></tr></thead><tbody>${operatorRows}</tbody></table>`
    : "";
  const operatorMarkdown = report.operator.captures.length
    ? `\n\n## Операторские наблюдения\n\n${markdown(report.operator.summary)}\n\nСостояние evidence: ${markdown(report.operator.state)}.\n\n${report.operator.captures.map((capture: any) => "- " + markdown(JSON.stringify(capture))).join("\n")}\n\n| Исходный URL | Автоматический обход | Наблюдение |\n| --- | --- | --- |\n${report.operator.registry.urls.map((row) => "| " + markdown(row.crawl_key) + " | " + markdown(row.current_crawl_statuses.join(", ") || "Нет в текущем crawl") + " | " + markdown(row.observations.map((observation) => observation.state + (observation.stale_binding ? " (прежний snapshot)" : "")).join(", ") || "UNOBSERVED") + " |").join("\n")}`
    : "";
  const derivedPresent =
    report.operator_derived.models.length +
      report.operator_derived.builds.length >
    0;
  const derivedHtml = derivedPresent
    ? `<h2>Частичная модель и пакет</h2><p>${esc(report.operator_derived.note)}</p><pre>${esc(JSON.stringify(report.operator_derived, null, 2))}</pre>`
    : "";
  const derivedMarkdown = derivedPresent
    ? `\n\n## Частичная модель и пакет\n\n${markdown(report.operator_derived.note)}\n\n${[...report.operator_derived.models, ...report.operator_derived.builds].map((record: any) => "- " + markdown(JSON.stringify(record))).join("\n")}`
    : "";
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Upgrade — ${esc(report.project_id)}</title><style>body{font:16px/1.6 system-ui;background:#f4f5f3;color:#172429;max-width:1100px;margin:auto;padding:32px}h1{font-size:40px}.status{background:#fff0d5;padding:20px;border-radius:12px}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;border-bottom:1px solid #ddd;padding:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin-bottom:8px}@media(max-width:600px){body{padding:16px}table{display:block;overflow:auto}}</style><header><p>UPGRADE · ПРОВЕРЯЕМЫЙ ПЕРЕНОС</p><h1>${esc(report.project_id)}</h1></header><main><div class="status"><strong>${esc(report.headline)}</strong><p>Этап: ${esc(report.phase)}. Состояние: ${esc(report.execution_status)}.</p></div><h2>Реестр исходных адресов</h2><p>${esc(report.source.summary)}</p><pre>${esc(JSON.stringify(report.source, null, 2))}</pre>${operatorHtml}${derivedHtml}<h2>Контент</h2><p>${esc(report.content.note)}</p><h2>Целевой сайт</h2><p>${esc(report.target.note)}</p><pre>${esc(JSON.stringify(report.target, null, 2))}</pre><h2>Независимые проверки</h2><table><thead><tr><th>Проверка</th><th>Результат</th><th>Подтверждение / ограничение</th></tr></thead><tbody>${rows}</tbody></table><h2>Границы переноса</h2><ul>${report.limitations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><h2>Продолжение</h2><p>${esc(report.next_step)}</p><code>${esc(report.resume)}</code><h2>Расходы</h2><pre>${esc(JSON.stringify(report.cost, null, 2))}</pre></main></html>`;
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(
    resolve(dir, "summary.md"),
    `# ${markdown(report.project_id)}\n\n${markdown(report.headline)}. ${markdown(report.phase)} / ${markdown(report.execution_status)}.\n\n${markdown(report.source.summary)}\n\n${markdown(report.content.note)}${operatorMarkdown}${derivedMarkdown}\n\nЦелевой сайт: ${markdown(report.target.note)}\n\nДоступ к источнику:\n${(report.source.access.blocks ?? []).map((block: unknown) => "- " + markdown(JSON.stringify(block))).join("\n") || "- Ограничения не зарегистрированы."}\n\n${markdown(report.next_step)}\n\nОграничения:\n${report.limitations.map((x) => "- " + markdown(x)).join("\n")}\n\nПродолжение: ${markdown(report.resume)}\n`,
  );
  return {
    json: resolve(dir, "report.json"),
    html: resolve(dir, "index.html"),
    summary: resolve(dir, "summary.md"),
    readiness: "NOT_READY",
  };
}
