import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { Store, UpgradeError, hash, inside, uid } from "./index.ts";
import type { Artifact, Project } from "../contracts/index.ts";
import { crawlSite, verifyCrawlSnapshots, assertNoStoredAccessChallenge } from "../crawler/index.ts";
import { CrawlError } from "../crawler/network.ts";
import type { CrawlOptions, CrawlResult } from "../crawler/index.ts";
import { extractContent } from "../extractor/index.ts";
import { planRoutes } from "../route-planner/index.ts";
import {
  buildBitrixPackage,
  validateBitrixPackage,
} from "../bitrix-adapter/index.ts";
import { verifyRoutes } from "../verifier/index.ts";
import { writeReport } from "../reporter/index.ts";
import { loadProfile } from "./config.ts";
import { sourceFingerprint, defaultTokens, designBrief } from "./design.ts";

export interface PipelineOptions {
  fixtureOrigin?: string;
  browser?: boolean;
  maxPages?: number;
  maxRequests?: number;
  maxBytes?: number;
  targetUrl?: string;
  signal?: AbortSignal;
  accessResume?: { blockId: string; acknowledgementId: string; reason: string };
}
export class Pipeline {
  store: Store;
  options: PipelineOptions;
  owner: string | null = null;
  constructor(store: Store, options: PipelineOptions = {}) {
    this.store = store;
    this.options = options;
  }
  latest<T = any>(type: string): { artifact: Artifact; value: T } {
    const a = this.store
      .list<Artifact>("artifact")
      .filter((a) => a.type === type)
      .at(-1);
    if (!a) throw new UpgradeError(`Required artifact missing: ${type}`, 3);
    this.store.validateArtifact(a.artifact_id);
    const value = JSON.parse(
      readFileSync(inside(this.store.root, a.relative_path), "utf8"),
    );
    // Filesystem locations are runtime bindings, not source facts. Rebind after restore.
    if (type === "crawl-result.json") {
      const current = inside(this.store.root, "source");
      for (const row of [...value.entries, ...value.assets]) {
        for (const field of ["body_path", "dom_path"]) {
          if (row[field]) {
            const digest =
              field === "dom_path"
                ? row.dom_sha256
                : (row.body_sha256 ?? row.sha256);
            if (!/^[a-f0-9]{64}$/.test(digest ?? ""))
              throw new UpgradeError("Snapshot hash missing", 5);
            row[field] = inside(current, `snapshots/${digest}.bin`);
          }
        }
      }
      value.output_dir = current;
    }
    if (type === "content-model.json") {
      for (const asset of value.assets ?? []) {
        if (asset.body_path && asset.sha256)
          asset.body_path = inside(
            this.store.root,
            `source/snapshots/${asset.sha256}.bin`,
          );
      }
    }
    if (type === "release-manifest.json" && value.release_id)
      value.package_dir = inside(
        this.store.root,
        `releases/${value.release_id}`,
      );
    return {
      artifact: a,
      value,
    };
  }
  assertOwnership(maintenance = false) {
    if (!this.owner)
      throw new UpgradeError("Stage requires dispatcher lock", 3);
    const r = this.store.currentRun();
    if (r.dispatcher_owner !== this.owner || r.dispatcher_until <= Date.now())
      throw new UpgradeError("Dispatcher ownership lost", 3);
    if (maintenance) return;
    if (r.execution_status !== "ACTIVE")
      throw new UpgradeError("Run paused or blocked", 3);
    if (Date.now() >= r.budget.started_at + r.budget.max_seconds * 1000) {
      this.store.setRunStatus("PAUSED");
      throw new UpgradeError("Run wall-time budget exhausted", 3);
    }
  }
  save(type: string, value: unknown) {
    this.assertOwnership();
    return this.store.publishArtifact(
      type,
      JSON.stringify(value, null, 2) + "\n",
    );
  }
  project() {
    return this.store.list<Project>("project")[0];
  }
  async locked<T>(
    fn: () => Promise<T>,
    options: { maintenance?: boolean } = {},
  ) {
    const r = this.store.currentRun(),
      owner = `cli:${process.pid}:${uid("op")}`;
    this.store.acquireDispatcher(r.run_id, owner);
    this.owner = owner;
    let lost = false;
    const timer = setInterval(() => {
      try {
        this.store.acquireDispatcher(r.run_id, owner);
      } catch {
        lost = true;
      }
    }, 10000);
    try {
      this.assertOwnership(options.maintenance ?? false);
      const value = await fn();
      if (lost) throw new UpgradeError("Dispatcher ownership lost", 3);
      return value;
    } finally {
      clearInterval(timer);
      if (this.store.currentRun().dispatcher_owner === owner)
        this.store.releaseDispatcher(r.run_id, owner);
      this.owner = null;
      this.store.exportEvents();
    }
  }
  phase(phase: string) {
    this.assertOwnership();
    const r = this.store.currentRun();
    r.phase = phase;
    this.store.transaction(() => {
      this.store.put("run", r.run_id, r);
      this.store.event("stage.started", "pipeline", { phase }, r.run_id);
    });
  }
  async crawl() {
    this.phase("DISCOVERING");
    const p = this.project();
    const profile =
      this.store.list<ReturnType<typeof loadProfile>>("profile")[0] ??
      loadProfile(p.target.environment_profile);
    const savedOptions = this.store.list<any>("crawl-options")[0];
    const priorSnapshot = existsSync(inside(this.store.root, "source/crawl.json"));
    const limitKeys = ["maxPages", "maxAssets", "maxRequests", "maxBytes", "maxWallTimeMs"] as const;
    if (priorSnapshot && (!savedOptions || limitKeys.some(key => !Number.isFinite(savedOptions[key])))) {
      this.store.event("crawl.legacy_limits_unknown", "pipeline", {action: "new_explicit_snapshot_required"}, this.store.currentRun().run_id);
      this.store.setRunStatus("PAUSED");
      throw new UpgradeError("Legacy crawl limits were not recorded; cannot safely reconstruct them. Preserve this evidence and plan a new project/snapshot with explicit limits", 3);
    }
    for (const key of ["maxPages", "maxRequests", "maxBytes"] as const) {
      if (savedOptions?.[key] !== undefined && this.options[key] !== undefined && this.options[key]! > savedOptions[key])
        throw new UpgradeError(`Increasing ${key} requires a separately recorded budget decision; automatic resume cannot expand it`, 2);
    }
    const options: CrawlOptions = {
      sourceUrl: p.source.entry_url,
      projectId: p.project_id,
      outputDir: inside(this.store.root, "source"),
      mode: this.options.browser ? "browser" : (savedOptions?.mode ?? "http"),
      fixtureOrigins: this.options.fixtureOrigin
        ? [this.options.fixtureOrigin]
        : (savedOptions?.fixtureOrigins ?? []),
      maxPages: this.options.maxPages ?? savedOptions?.maxPages ?? profile.crawl.max_html_pages,
      maxAssets: savedOptions?.maxAssets ?? profile.crawl.max_assets,
      maxRequests: this.options.maxRequests ?? savedOptions?.maxRequests ?? 65000,
      maxBytes: this.options.maxBytes ?? savedOptions?.maxBytes ?? profile.crawl.max_download_bytes,
      maxWallTimeMs: savedOptions?.maxWallTimeMs ?? profile.crawl.max_wall_time_minutes * 60_000,
      maxRedirects: savedOptions?.maxRedirects ?? profile.crawl.max_redirects,
      respectRobots: savedOptions?.respectRobots ?? profile.crawl.respect_robots,
      requestsPerSecond: savedOptions?.requestsPerSecond ?? (this.options.fixtureOrigin
        ? 100
        : profile.crawl.requests_per_second_per_host),
      signal: this.options.signal,
      accessResume: this.options.accessResume,
    };
    // Omission retains the recorded limit; an explicit flag can only lower it during this snapshot.
    // The one-use access acknowledgement and process signal must never become reusable configuration.
    const {signal: _signal, accessResume: _accessResume, ...persistentOptions} = options;
    this.store.put("crawl-options", "current", persistentOptions);
    this.store.event("crawl.effective_limits", "pipeline", Object.fromEntries(limitKeys.map(key => [key, options[key]])), this.store.currentRun().run_id);
    const result = await crawlSite(options);
    const artifact = this.save("crawl-result.json", result);
    this.save("url-inventory.json", result.entries);
    this.save("asset-manifest.json", result.assets);
    this.store.event(
      "stage.completed",
      "pipeline",
      {
        phase: "DISCOVERING",
        artifact_id: artifact.artifact_id,
        state: result.state,
        counters: result.counters,
      },
      this.store.currentRun().run_id,
    );
    if (result.state !== "COMPLETE") {
      this.store.setRunStatus("PAUSED");
      return { status: "PAUSED", artifact };
    }
    const priorScope = this.store
      .list<Artifact>("artifact")
      .find((a) => a.type === "scope-manifest.json");
    if (!priorScope) {
      const scope = {
        schema_version: 1,
        project_id: p.project_id,
        basis: "discovered-source-registry",
        source_artifact_id: artifact.artifact_id,
        created_at: new Date().toISOString(),
        urls: result.entries
          .filter((e) => e.status !== "EXCLUDED")
          .map((e) => ({
            raw_url: e.raw_url,
            request_target: e.request_target,
            crawl_key: e.crawl_key,
          })),
        exclusions: result.entries
          .filter((e) => e.status === "EXCLUDED")
          .map((e) => ({ raw_url: e.raw_url, reason: e.reason, rule: e.rule })),
        confidence: result.completeness.confidence,
        limitations: result.limitations,
      };
      this.save("scope-manifest.json", scope);
    }
    return { status: "COMPLETE", artifact };
  }
  async validateSourceAccess(crawl = this.latest<CrawlResult>("crawl-result.json")) {
    this.assertOwnership();
    if (crawl.value.state !== "COMPLETE") {
      this.store.setRunStatus("PAUSED");
      this.report();
      throw new UpgradeError("Crawl incomplete; resume discovery before extraction or build", 3);
    }
    await verifyCrawlSnapshots(crawl.value);
    try {
      await assertNoStoredAccessChallenge(crawl.value);
    } catch (error) {
      if (!(error instanceof CrawlError) || !["ACCESS_REQUIRED", "STORED_ACCESS_CHALLENGE", "ACCESS_REVALIDATION_REQUIRED"].includes(error.code)) throw error;
      this.save("source-access-error.json", {
        source_artifact_id: crawl.artifact.artifact_id,
        code: error.code, reason: error.message, recorded_at: new Date().toISOString(),
      });
      this.store.setRunStatus("PAUSED");
      this.report();
      throw new UpgradeError(`${error.message}; resume and crawl to record/revalidate source access before extraction`, 3);
    }
  }
  async extract() {
    this.phase("PLANNING");
    const crawl = this.latest<CrawlResult>("crawl-result.json");
    if (crawl.value.state !== "COMPLETE")
      throw new UpgradeError("Crawl incomplete; resume discovery", 3);
    await this.validateSourceAccess(crawl);
    const input = hash(
      crawl.artifact.sha256 +
        sourceFingerprint(["packages/extractor", "packages/route-planner"]),
    );
    const prior = this.store.list<any>("stage").find((x) => x.id === "extract");
    if (prior?.input_hash === input) {
      for (const id of prior.outputs) this.store.validateArtifact(id);
      return { reused: true, outputs: prior.outputs };
    }
    const model = await extractContent(crawl.value);
    const routes = planRoutes(crawl.value, model);
    const outputs = [
      this.save("content-model.json", model),
      this.save("route-manifest.json", routes),
      this.save("content-requirements.json", model.content_requirements),
      this.save("feature-matrix.json", model.features),
    ];
    this.store.put("stage", "extract", {
      id: "extract",
      input_hash: input,
      outputs: outputs.map((a) => a.artifact_id),
    });
    this.store.event("stage.completed", "pipeline", {
      phase: "PLANNING",
      entities: model.entities.length,
      routes: routes.routes.length,
    });
    return {
      entities: model.entities.length,
      routes: routes.routes.length,
      conflicts: routes.conflicts,
    };
  }
  async build() {
    await this.validateSourceAccess();
    this.phase("BUILDING");
    const model = this.latest("content-model.json"),
      routes = this.latest("route-manifest.json");
    if (routes.value.conflicts?.length)
      throw new UpgradeError("Unresolved route collisions", 5);
    let tokens;
    try {
      tokens = this.latest("design-tokens.json");
    } catch (error) {
      if (
        !(error instanceof UpgradeError) ||
        !error.message.startsWith("Required artifact missing")
      )
        throw error;
      this.save("design-tokens.json", defaultTokens);
      this.save(
        "design-brief.json",
        designBrief(
          model.value.entities.map((e: any) => e.page_type ?? e.type),
        ),
      );
      tokens = this.latest("design-tokens.json");
    }
    const codeHash = sourceFingerprint([
      "bitrix",
      "packages/bitrix-adapter",
      "package-lock.json",
    ]);
    const inputHash = hash(
      model.artifact.sha256 +
        routes.artifact.sha256 +
        tokens.artifact.sha256 +
        codeHash,
    );
    const prior = this.store.list<any>("stage").find((x) => x.id === "build");
    if (prior?.input_hash === inputHash) {
      const manifest = await validateBitrixPackage(
        inside(this.store.root, `releases/${prior.release_id}`),
        this.project().project_id,
        prior.manifest_sha256,
      );
      return {
        reused: true,
        packageDir: inside(this.store.root, `releases/${prior.release_id}`),
        manifest,
      };
    }
    const release = uid("release");
    const built = await buildBitrixPackage({
      projectId: this.project().project_id,
      sourceVersion: model.artifact.sha256,
      outputDir: inside(this.store.root, `releases/${release}`),
      sourceOrigin: model.value.source_origin,
      entities: model.value.entities,
      routes: routes.value.routes,
      assets: model.value.assets,
      assetRoot: inside(this.store.root, "source"),
      designTokens: tokens.value,
    });
    await validateBitrixPackage(built.packageDir, this.project().project_id);
    const manifestHash = hash(readFileSync(built.manifestPath));
    this.save("release-manifest.json", {
      ...built.manifest,
      release_id: release,
      package_dir: built.packageDir,
      manifest_sha256: manifestHash,
      code_sha256: codeHash,
    });
    this.save("bitrix-mapping.json", {
      schema_version: 1,
      profile: "editable-content-snapshot",
      content: "CIBlockElement",
      external_url: "upgrade.core exact route registry",
      catalog: "REQUIRES_INTEGRATION",
      runtime_verification: "NOT_RUN",
    });
    this.store.put("stage", "build", {
      id: "build",
      input_hash: inputHash,
      package_dir: built.packageDir,
      release_id: release,
      manifest_sha256: manifestHash,
    });
    this.store.event("stage.completed", "pipeline", {
      phase: "BUILDING",
      release_id: release,
      blockers: built.manifest.blockers,
    });
    return built;
  }
  async import(dryRun: boolean) {
    const release = this.latest("release-manifest.json").value;
    const manifest = await validateBitrixPackage(
      release.package_dir,
      this.project().project_id,
      release.manifest_sha256,
    );
    const report = {
      schema_version: 1,
      project_id: this.project().project_id,
      target: "bitrix",
      dry_run: dryRun,
      status: dryRun ? "PACKAGE_VALIDATED" : "BLOCKED",
      manifest,
      bitrix_execution: "NOT_RUN",
      commands: {
        validate: {
          executable: "php",
          args: [
            "bitrix/importer/cli.php",
            "--command=validate",
            `--package=${release.package_dir}`,
            `--project=${this.project().project_id}`,
            `--manifest-sha256=${hash(readFileSync(resolve(release.package_dir, "manifest.json")))}`,
          ],
        },
      },
      blockers: [
        "Bitrix installation, dedicated database and target gateway fencing profile are not configured.",
        ...manifest.blockers,
      ],
    };
    this.save("import-report.json", report);
    this.store.event("import.preflight", "pipeline", {
      dry_run: dryRun,
      status: report.status,
    });
    return report;
  }
  async verify() {
    this.phase("VERIFYING");
    const scope = this.latest("scope-manifest.json"),
      routes = this.latest("route-manifest.json"),
      model = this.latest("content-model.json");
    const report = await verifyRoutes({
      scope: scope.value,
      scopeHash: scope.artifact.sha256,
      routes: routes.value,
      model: model.value,
      targetUrl: this.options.targetUrl,
      fixtureOrigins: this.options.fixtureOrigin
        ? [this.options.fixtureOrigin]
        : [],
    });
    this.save("qa-report.json", report);
    const r = this.store.currentRun();
    r.execution_status = "BLOCKED";
    this.store.put("run", r.run_id, r);
    this.store.event("check.completed", "deterministic-qa", report, r.run_id);
    return report;
  }
  report() {
    const report = writeReport(this.store);
    this.store.exportEvents();
    return report;
  }
  async run() {
    return this.locked(async () => {
      let crawl;
      try {
        crawl = this.latest<CrawlResult>("crawl-result.json").value;
      } catch {}
      if (!crawl || crawl.state !== "COMPLETE") {
        const result = await this.crawl();
        if (result.status === "PAUSED") {
          this.report();
          return result;
        }
      }
      await this.extract();
      await this.build();
      await this.import(true);
      const qa = await this.verify();
      this.report();
      return {
        status: "BLOCKED",
        reason: "Bitrix integration is required for DEMO_READY",
        qa,
      };
    });
  }
}
