import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { CrawlError, identifyUrl, safeFetch } from "./network.ts";
import type { HttpResponse } from "./network.ts";
import { parseRobots, robotsAllows } from "./robots.ts";
import type { RobotsPolicy } from "./robots.ts";
import { detectAccessChallenge, isHtmlResponse } from "./access.ts";
import type {
  AccessBlock,
  AccessChallenge,
  AccessResume,
  AccessStage,
} from "./access.ts";

export { identifyUrl, isPublicAddress, safeFetch } from "./network.ts";
export { detectAccessChallenge } from "./access.ts";
export type CrawlStatus =
  | "DISCOVERED"
  | "FETCHED"
  | "RENDERED"
  | "EXCLUDED"
  | "UNREACHABLE"
  | "REQUIRES_ACCESS"
  | "RATE_LIMITED"
  | "FAILED";
export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}
export interface CrawlEntry {
  raw_url: string;
  request_target: string;
  crawl_key: string;
  discovered_from: string[];
  status: CrawlStatus;
  http_status?: number;
  final_http_status?: number;
  final_url?: string;
  redirect_chain: RedirectHop[];
  body_path?: string;
  body_sha256?: string;
  dom_path?: string;
  dom_sha256?: string;
  mime?: string;
  bytes?: number;
  fetched_at?: string;
  headers?: Record<string, string>;
  attempts: number;
  title?: string;
  description?: string;
  canonical_url?: string;
  language?: string;
  robots?: string;
  links: string[];
  media: string[];
  anchors: string[];
  headings: string[];
  structured_data: unknown[];
  reason?: string;
  rule?: string;
  rendered?: {
    viewport: { width: number; height: number };
    locale: string;
    cookies: "fresh-empty";
    blocked_requests: string[];
  };
}
export interface CrawlAsset {
  source_url: string;
  discovered_from: string[];
  status: "DISCOVERED" | "FETCHED" | "EXCLUDED" | "FAILED";
  mime?: string;
  sha256?: string;
  body_path?: string;
  size_bytes?: number;
  reason?: string;
}
export interface CrawlResult {
  schema_version: 1;
  project_id: string;
  source_origin: string;
  output_dir: string;
  started_at: string;
  finished_at?: string;
  state: "COMPLETE" | "PAUSED";
  access?: { version: 1; active_block_id?: string; blocks: AccessBlock[] };
  entries: CrawlEntry[];
  assets: CrawlAsset[];
  limitations: string[];
  counters: { requests: number; bytes: number; pages: number };
  discovery: {
    robots_done: boolean;
    robots: RobotsPolicy;
    sitemap_queue: string[];
    sitemap_done: string[];
    sitemap_failed: string[];
  };
  policy: {
    mode: "http" | "browser";
    respect_robots: boolean;
    source_url: string;
    fixture_origins: string[];
  };
  completeness: {
    basis: "discovered-source-registry";
    confidence: "bounded";
    queued: number;
    excluded: number;
    failed: number;
    unverified_sources: string[];
  };
}
export interface CrawlOptions {
  sourceUrl: string;
  outputDir: string;
  projectId?: string;
  maxPages?: number;
  maxAssets?: number;
  maxRequests?: number;
  maxBytes?: number;
  maxResponseBytes?: number;
  maxWallTimeMs?: number;
  requestsPerSecond?: number;
  maxRedirects?: number;
  maxRetries?: number;
  respectRobots?: boolean;
  fixtureOrigins?: string[];
  mode?: "http" | "browser";
  browserExecutablePath?: string;
  browserTimeoutMs?: number;
  /** One explicit operator acknowledgement for the currently persisted access block. Never reusable. */
  accessResume?: AccessResume;
  signal?: AbortSignal;
}
const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const sleep = async (milliseconds: number, signal?: AbortSignal) => {
  if (signal?.aborted) throw new CrawlError("ABORTED", "Crawl interrupted");
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new CrawlError("ABORTED", "Crawl interrupted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
};

export function inspectHtml(html: string, base: string) {
  const $ = load(html),
    links = new Set<string>(),
    media = new Set<string>();
  const resolveUrl = (value: string | undefined) => {
    if (!value || /^(?:data|javascript|mailto|tel|blob):/i.test(value))
      return undefined;
    try {
      return identifyUrl(value.trim(), base).raw_url;
    } catch {
      return undefined;
    }
  };
  $('a[href],area[href],link[rel="alternate"][href]').each(
    (_index, element) => {
      const url = resolveUrl($(element).attr("href"));
      if (url) links.add(url);
    },
  );
  $("img[src],source[src],video[poster],a[href]").each((_index, element) => {
    const value =
      $(element).attr("src") ??
      $(element).attr("poster") ??
      $(element).attr("href");
    const url = resolveUrl(value);
    if (
      url &&
      (element.tagName !== "a" ||
        /\.(pdf|png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/i.test(url))
    )
      media.add(url);
  });
  $("[srcset]").each((_index, element) => {
    for (const item of ($(element).attr("srcset") ?? "").split(",")) {
      const url = resolveUrl(item.trim().split(/\s+/)[0]);
      if (url) media.add(url);
    }
  });
  $("[style]").each((_index, element) => {
    for (const match of ($(element).attr("style") ?? "").matchAll(
      /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    )) {
      const url = resolveUrl(match[1]);
      if (url) media.add(url);
    }
  });
  const structured: unknown[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      structured.push(JSON.parse($(element).text()));
    } catch {
      /* Invalid source JSON is data, never code. */
    }
  });
  return {
    title: $("title").first().text().trim(),
    description: $('meta[name="description"]').attr("content") ?? "",
    canonical_url: resolveUrl($('link[rel="canonical"]').attr("href")),
    language: $("html").attr("lang"),
    robots: $('meta[name="robots"]').attr("content"),
    links: [...links],
    media: [...media],
    anchors: $("[id],a[name]")
      .map(
        (_i, element) => $(element).attr("id") ?? $(element).attr("name") ?? "",
      )
      .get(),
    headings: $("h1,h2,h3,h4,h5,h6")
      .map((_i, element) => $(element).text().trim())
      .get(),
    structured_data: structured,
  };
}

async function snapshot(
  directory: string,
  body: Buffer | string,
): Promise<{ path: string; hash: string }> {
  const hash = digest(body),
    filename = path.join(directory, "snapshots", `${hash}.bin`);
  try {
    await writeFile(filename, body, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (digest(await readFile(filename)) !== hash)
      throw new CrawlError(
        "SNAPSHOT_CORRUPT",
        `Immutable snapshot damaged: ${hash}`,
      );
  }
  return { path: filename, hash };
}

export async function verifyCrawlSnapshots(result: CrawlResult): Promise<void> {
  const directory = path.resolve(result.output_dir);
  for (const item of [
    ...result.entries.flatMap((entry) => [
      { file: entry.body_path, hash: entry.body_sha256 },
      { file: entry.dom_path, hash: entry.dom_sha256 },
    ]),
    ...result.assets.map((asset) => ({
      file: asset.body_path,
      hash: asset.sha256,
    })),
    ...(result.access?.blocks ?? []).map((block) => ({
      file: /^[a-f0-9]{64}$/.test(block.body_sha256)
        ? path.join(directory, "snapshots", `${block.body_sha256}.bin`)
        : path.join(directory, "invalid-access-evidence"),
      hash: block.body_sha256,
    })),
  ]) {
    if (!item.file) continue;
    const relative = path.relative(directory, path.resolve(item.file));
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !item.hash ||
      digest(await readFile(item.file)) !== item.hash
    ) {
      throw new CrawlError(
        "SNAPSHOT_CORRUPT",
        "Snapshot path or SHA-256 failed validation",
      );
    }
  }
}

async function findStoredAccessChallenge(result: CrawlResult) {
  for (const entry of result.entries) {
    if (!["FETCHED", "RENDERED"].includes(entry.status)) continue;
    for (const item of [
      { file: entry.body_path, kind: "http" as const, headers: entry.headers },
      { file: entry.dom_path, kind: "dom" as const, headers: undefined },
    ]) {
      if (!item.file) continue;
      const body = await readFile(item.file);
      const match = detectAccessChallenge(body, item.headers);
      if (match) return { entry, body, match, kind: item.kind };
    }
  }
  return undefined;
}

/** Offline acceptance guard for earlier COMPLETE artifacts; does not mutate evidence or access the source. */
export async function assertNoStoredAccessChallenge(
  result: CrawlResult,
): Promise<void> {
  if (result.access?.active_block_id)
    throw new CrawlError(
      "ACCESS_REQUIRED",
      `Access block ${result.access.active_block_id} requires explicit resolution`,
    );
  const found = await findStoredAccessChallenge(result);
  if (found)
    throw new CrawlError(
      "STORED_ACCESS_CHALLENGE",
      `Stored ${found.match.provider} challenge at ${found.entry.crawl_key}; run crawl to persist its access gate`,
    );
  if (result.access?.version !== 1)
    throw new CrawlError(
      "ACCESS_REVALIDATION_REQUIRED",
      "Legacy crawl lacks access checks for robots.txt; run crawl to revalidate under the existing budgets",
    );
}

/** One durable queue writer; no source bytes are interpreted as agent instructions. */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const source = identifyUrl(options.sourceUrl),
    outputDir = path.resolve(options.outputDir);
  await mkdir(path.join(outputDir, "snapshots"), {
    recursive: true,
    mode: 0o700,
  });
  const lockPath = path.join(outputDir, "crawl.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number((await readFile(lockPath, "utf8")).trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive || !Number.isSafeInteger(pid) || pid <= 0)
      throw new CrawlError(
        "CRAWL_LOCKED",
        "Another crawler owns this directory",
      );
    await unlink(lockPath);
    lock = await open(lockPath, "wx", 0o600);
  }
  await lock.writeFile(String(process.pid));
  try {
    return await runCrawl(options, source, outputDir);
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

async function runCrawl(
  options: CrawlOptions,
  source: ReturnType<typeof identifyUrl>,
  outputDir: string,
): Promise<CrawlResult> {
  const statePath = path.join(outputDir, "crawl.json");
  const policy = {
    mode: options.mode ?? ("http" as "http" | "browser"),
    respect_robots: options.respectRobots ?? true,
    source_url: source.crawl_key,
    fixture_origins: [...(options.fixtureOrigins ?? [])].sort(),
  };
  let state: CrawlResult;
  let requiresRobotsRevalidation = false;
  let storedState: string | undefined;
  try {
    storedState = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (storedState !== undefined) {
    state = JSON.parse(storedState);
    if (
      state.schema_version !== 1 ||
      state.project_id !== (options.projectId ?? "fixture") ||
      JSON.stringify(state.policy) !== JSON.stringify(policy)
    )
      throw new CrawlError(
        "CRAWL_POLICY_CHANGED",
        "Source/project/policy changed; use a new snapshot directory",
      );
    // Restore can change both the root path and operating system. Persisted absolute paths are never
    // authority: accepted content hashes identify files inside this caller's new snapshot directory.
    const restoredSnapshot = (hash: string | undefined) => {
      if (!hash || !/^[a-f0-9]{64}$/.test(hash))
        throw new CrawlError(
          "SNAPSHOT_CORRUPT",
          "Snapshot SHA-256 identity is missing or invalid",
        );
      return path.join(outputDir, "snapshots", `${hash}.bin`);
    };
    state.output_dir = outputDir;
    for (const entry of state.entries) {
      if (entry.body_path)
        entry.body_path = restoredSnapshot(entry.body_sha256);
      if (entry.dom_path) entry.dom_path = restoredSnapshot(entry.dom_sha256);
    }
    for (const asset of state.assets)
      if (asset.body_path) asset.body_path = restoredSnapshot(asset.sha256);
    await verifyCrawlSnapshots(state);
    requiresRobotsRevalidation = state.access?.version !== 1;
  } else {
    state = {
      schema_version: 1,
      project_id: options.projectId ?? "fixture",
      source_origin: source.origin,
      output_dir: outputDir,
      started_at: new Date().toISOString(),
      state: "PAUSED",
      access: { version: 1, blocks: [] },
      entries: [],
      assets: [],
      limitations: [],
      counters: { requests: 0, bytes: 0, pages: 0 },
      discovery: {
        robots_done: false,
        robots: { rules: [], sitemaps: [] },
        sitemap_queue: [],
        sitemap_done: [],
        sitemap_failed: [],
      },
      policy,
      completeness: {
        basis: "discovered-source-registry",
        confidence: "bounded",
        queued: 0,
        excluded: 0,
        failed: 0,
        unverified_sources: [],
      },
    };
  }
  const limits = {
    pages: options.maxPages ?? 10_000,
    assets: options.maxAssets ?? 50_000,
    requests: options.maxRequests ?? 65_000,
    bytes: options.maxBytes ?? 1_000_000_000,
    wall: options.maxWallTimeMs ?? 14_400_000,
  };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isFinite(value) || value < 1)
      throw new Error(`Invalid positive crawl limit: ${name}`);
  if (
    !Number.isFinite(options.requestsPerSecond ?? 1) ||
    (options.requestsPerSecond ?? 1) <= 0 ||
    (options.requestsPerSecond ?? 1) > 100
  )
    throw new Error("requestsPerSecond must be between 0 and 100");
  if ((options.maxRetries ?? 2) < 0 || (options.maxRetries ?? 2) > 5)
    throw new Error("maxRetries must be 0..5");
  const addLimitation = (message: string) => {
    if (!state.limitations.includes(message)) state.limitations.push(message);
  };
  const addPage = (raw: string, discoveredFrom: string) => {
    let identity;
    try {
      identity = identifyUrl(raw, source.crawl_key);
    } catch {
      return;
    }
    if (identity.origin !== source.origin) return;
    if (
      identity.fragment.startsWith("#/") ||
      identity.fragment.startsWith("#!")
    )
      addLimitation(
        `Hash route requires an explicit browser route contract: ${identity.raw_url}`,
      );
    const existing = state.entries.find(
      (entry) => entry.crawl_key === identity.crawl_key,
    );
    if (existing) {
      if (!existing.discovered_from.includes(discoveredFrom))
        existing.discovered_from.push(discoveredFrom);
      return;
    }
    state.entries.push({
      ...identity,
      discovered_from: [discoveredFrom],
      status: "DISCOVERED",
      redirect_chain: [],
      links: [],
      media: [],
      anchors: [],
      headings: [],
      structured_data: [],
      attempts: 0,
    });
  };
  addPage(source.raw_url, "seed");
  let saveTail: Promise<unknown> = Promise.resolve();
  const save = (): Promise<void> => {
    const pending = saveTail.then(async () => {
      state.completeness = {
        basis: "discovered-source-registry",
        confidence: "bounded",
        queued: state.entries.filter(
          (e) => e.status === "DISCOVERED" || e.status === "RATE_LIMITED",
        ).length,
        excluded: state.entries.filter((e) => e.status === "EXCLUDED").length,
        failed: state.entries.filter((e) =>
          ["FAILED", "UNREACHABLE", "REQUIRES_ACCESS"].includes(e.status),
        ).length,
        unverified_sources: [
          ...state.discovery.sitemap_failed,
          ...(policy.mode === "http" ? ["JavaScript-rendered DOM"] : []),
          "Authenticated/private content",
          "Unknown unlinked URLs",
        ],
      };
      await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2), {
        mode: 0o600,
      });
      await rename(`${statePath}.tmp`, statePath);
    });
    saveTail = pending.catch(() => undefined);
    return pending;
  };
  state.access ??= { version: 1, blocks: [] };
  const clearExtractedContent = (entry: CrawlEntry) => {
    for (const key of [
      "title",
      "description",
      "canonical_url",
      "language",
      "robots",
    ] as const)
      delete entry[key];
    entry.links = [];
    entry.media = [];
    entry.anchors = [];
    entry.headings = [];
    entry.structured_data = [];
  };
  const blockAccess = async (
    url: string,
    stage: AccessStage,
    body: Buffer | string,
    match: AccessChallenge,
    entry?: CrawlEntry,
    response?: HttpResponse,
    evidenceKind: "http" | "dom" = "http",
  ): Promise<never> => {
    // The active gate is set before asynchronous evidence I/O, stopping queued browser requests as well.
    const id = `access-${randomUUID()}`;
    state.access!.active_block_id = id;
    state.state = "PAUSED";
    delete state.finished_at;
    const stored = await snapshot(outputDir, body);
    state.access!.blocks.push({
      id,
      url,
      stage,
      ...match,
      source_entry_url: entry?.crawl_key,
      body_sha256: stored.hash,
      evidence_kind: evidenceKind,
      http_status: response?.status,
      headers: response?.headers,
      observed_at: new Date().toISOString(),
    });
    if (entry) {
      entry.status = "REQUIRES_ACCESS";
      entry.reason = `${match.reason}: ${match.provider ?? "access policy"}; block ${id}`;
      entry.rule = "ACCESS_REQUIRED";
      clearExtractedContent(entry);
      if (stage === "page") {
        entry.body_path = stored.path;
        entry.body_sha256 = stored.hash;
      } else if (evidenceKind === "dom") {
        entry.dom_path = stored.path;
        entry.dom_sha256 = stored.hash;
      }
    } else {
      // A controlling robots/sitemap request is evidence for its own URL, never a homepage response.
      const seed = state.entries.find(
        (item) => item.crawl_key === source.crawl_key,
      );
      if (seed?.status === "DISCOVERED") {
        seed.reason = `${match.reason} at ${url}; block ${id}`;
        seed.rule = "ACCESS_REQUIRED";
      }
    }
    addLimitation(
      `ACCESS_REQUIRED: ${url}; explicit accessResume acknowledgement is required; source defenses are not bypassed`,
    );
    await save();
    throw new CrawlError(
      "ACCESS_REQUIRED",
      `Access block ${id} at ${url}: ${match.reason}`,
    );
  };
  const guardResponse = async (
    response: HttpResponse,
    stage: AccessStage,
    entry?: CrawlEntry,
  ) => {
    const match =
      detectAccessChallenge(response.body, response.headers) ??
      (stage === "robots" &&
      response.status === 200 &&
      isHtmlResponse(response.body, response.headers)
        ? {
            reason: "ROBOTS_HTML" as const,
            signals: [
              "robots.txt HTTP 200 contains HTML instead of a robots policy",
            ],
          }
        : undefined);
    if (match)
      await blockAccess(
        response.url,
        stage,
        response.body,
        match,
        entry,
        response,
      );
  };
  if (options.accessResume) {
    const acknowledgement = options.accessResume;
    const active = state.access.blocks.find(
      (item) => item.id === state.access!.active_block_id,
    );
    if (
      !active ||
      acknowledgement.blockId !== active.id ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
        acknowledgement.acknowledgementId,
      ) ||
      acknowledgement.reason.trim().length < 10 ||
      acknowledgement.reason.trim().length > 2000 ||
      state.access.blocks.some(
        (item) =>
          item.resume?.acknowledgement_id === acknowledgement.acknowledgementId,
      )
    )
      throw new CrawlError(
        "INVALID_ACCESS_RESUME",
        "A fresh acknowledgement ID, current block ID and resolution reason (10..2000 characters) are required",
      );
    active.resume = {
      acknowledgement_id: acknowledgement.acknowledgementId,
      reason: acknowledgement.reason.trim(),
      acknowledged_at: new Date().toISOString(),
    };
    delete state.access.active_block_id;
    if (active.source_entry_url) {
      const entry = state.entries.find(
        (item) => item.crawl_key === active.source_entry_url,
      );
      if (entry?.status === "REQUIRES_ACCESS") {
        entry.status = "DISCOVERED";
        clearExtractedContent(entry);
        delete entry.reason;
        delete entry.rule;
      }
    } else {
      const seed = state.entries.find(
        (item) => item.crawl_key === source.crawl_key,
      );
      if (seed?.status === "DISCOVERED" && seed.rule === "ACCESS_REQUIRED") {
        delete seed.reason;
        delete seed.rule;
      }
    }
    // Acknowledgement permits one resumed observation. Counters, attempts and started_at remain unchanged.
    await save();
  } else if (state.access.active_block_id) {
    state.state = "PAUSED";
    await save();
    return state;
  }
  let lastRequestAt = 0;
  const checkBudget = () => {
    if (state.access?.active_block_id)
      throw new CrawlError(
        "ACCESS_REQUIRED",
        `Access block ${state.access.active_block_id} is active`,
      );
    if (options.signal?.aborted)
      throw new CrawlError("ABORTED", "Crawl interrupted");
    if (
      state.counters.requests >= limits.requests ||
      state.counters.bytes >= limits.bytes ||
      Date.now() - Date.parse(state.started_at) >= limits.wall
    )
      throw new CrawlError(
        "BUDGET_LIMIT",
        "Persisted request, byte or wall-time budget reached",
      );
  };
  const performRequest = async (url: string): Promise<HttpResponse> => {
    checkBudget();
    await sleep(
      Math.max(
        0,
        1_000 / (options.requestsPerSecond ?? 1) - (Date.now() - lastRequestAt),
      ),
      options.signal,
    );
    checkBudget();
    const reservedBytes = Math.min(
      options.maxResponseBytes ?? 8_000_000,
      limits.bytes - state.counters.bytes,
    );
    state.counters.requests++;
    state.counters.bytes += reservedBytes;
    // Reserve requests and worst-case response bytes durably before external I/O. A crash or unknown outcome
    // keeps the conservative reservation; neither retry nor process loss resets consumption.
    await save();
    lastRequestAt = Date.now();
    const result = await safeFetch(url, {
      allowedOrigins: [source.origin],
      fixtureOrigins: options.fixtureOrigins,
      signal: options.signal,
      maxResponseBytes: reservedBytes,
      timeoutMs: Math.max(
        1,
        Math.min(
          15_000,
          limits.wall - (Date.now() - Date.parse(state.started_at)),
        ),
      ),
    });
    state.counters.bytes -= reservedBytes - result.body.length;
    await save();
    return result;
  };
  let requestTail: Promise<unknown> = Promise.resolve();
  const request = (url: string): Promise<HttpResponse> => {
    const pending = requestTail.then(() => performRequest(url));
    requestTail = pending.catch(() => undefined);
    return pending;
  };
  const fetchFollowing = async (url: string) => {
    const chain: RedirectHop[] = [],
      visited = new Set<string>();
    let current = url;
    try {
      while (true) {
        const identity = identifyUrl(current);
        if (visited.has(identity.crawl_key))
          throw new CrawlError("REDIRECT_LOOP", "Source redirects in a loop");
        visited.add(identity.crawl_key);
        if (
          policy.respect_robots &&
          state.discovery.robots_done &&
          !robotsAllows(state.discovery.robots, identity.request_target)
        )
          throw new CrawlError(
            "ROBOTS_BLOCKED",
            "Redirect destination is excluded by robots",
          );
        const response = await request(current);
        if (
          ![301, 302, 303, 307, 308].includes(response.status) ||
          !response.headers.location
        )
          return { response, chain };
        if (chain.length >= (options.maxRedirects ?? 5))
          throw new CrawlError("REDIRECT_LIMIT", "Maximum redirects reached");
        const next = identifyUrl(response.headers.location, current);
        chain.push({
          url: current,
          status: response.status,
          location: next.crawl_key,
        });
        // DNS/IP is revalidated by request() on each next connection. No cross-origin automatic expansion.
        if (next.origin !== source.origin)
          throw new CrawlError(
            "ORIGIN_BLOCKED",
            `Redirect destination outside scope: ${next.origin}`,
          );
        current = next.crawl_key;
      }
    } catch (error) {
      if (error instanceof CrawlError) error.redirectChain = chain;
      throw error;
    }
  };
  try {
    state.state = "PAUSED";
    delete state.finished_at;
    if (requiresRobotsRevalidation) {
      state.discovery.robots_done = false;
      addLimitation(
        "Legacy robots policy requires one access-detection revalidation; existing budgets are retained.",
      );
      await save();
    }
    const storedChallenge = await findStoredAccessChallenge(state);
    if (storedChallenge) {
      const { entry, body, match, kind } = storedChallenge;
      await blockAccess(
        entry.final_url ?? entry.crawl_key,
        "stored_snapshot",
        body,
        match,
        entry,
        undefined,
        kind,
      );
    }
    if (!state.discovery.robots_done) {
      const { response } = await fetchFollowing(`${source.origin}/robots.txt`);
      await guardResponse(response, "robots");
      if (
        [401, 403, 429, 503].includes(response.status) ||
        response.status >= 500
      )
        throw new CrawlError(
          "ROBOTS_UNAVAILABLE",
          `robots.txt HTTP ${response.status}; crawl is paused conservatively`,
        );
      state.discovery.robots =
        response.status === 200
          ? parseRobots(response.body.toString("utf8"))
          : { rules: [], sitemaps: [] };
      state.discovery.robots_done = true;
      for (const sitemap of [
        ...state.discovery.robots.sitemaps,
        `${source.origin}/sitemap.xml`,
      ]) {
        try {
          const url = identifyUrl(sitemap, source.crawl_key);
          if (
            url.origin === source.origin &&
            !state.discovery.sitemap_queue.includes(url.crawl_key)
          )
            state.discovery.sitemap_queue.push(url.crawl_key);
        } catch {
          addLimitation(`Invalid sitemap reference: ${sitemap}`);
        }
      }
      await save();
    }
    while (state.discovery.sitemap_queue.length) {
      const url = state.discovery.sitemap_queue[0];
      try {
        const { response } = await fetchFollowing(url);
        await guardResponse(response, "sitemap");
        if (response.status !== 200) {
          if (response.status !== 404)
            state.discovery.sitemap_failed.push(
              `${url} HTTP ${response.status}`,
            );
        } else {
          const xml = load(response.body.toString("utf8"), { xmlMode: true });
          if (xml("sitemapindex").length) {
            xml("sitemap > loc").each((_i, element) => {
              try {
                const next = identifyUrl(xml(element).text().trim(), url);
                if (
                  next.origin === source.origin &&
                  !state.discovery.sitemap_done.includes(next.crawl_key) &&
                  !state.discovery.sitemap_queue.includes(next.crawl_key)
                )
                  state.discovery.sitemap_queue.push(next.crawl_key);
              } catch {
                addLimitation("Invalid nested sitemap URL");
              }
            });
          } else if (xml("urlset").length)
            xml("url > loc").each((_i, element) =>
              addPage(xml(element).text().trim(), `sitemap:${url}`),
            );
          else
            state.discovery.sitemap_failed.push(`${url}: invalid XML sitemap`);
        }
      } catch (error) {
        if (
          error instanceof CrawlError &&
          ["BUDGET_LIMIT", "ABORTED", "ACCESS_REQUIRED"].includes(error.code)
        )
          throw error;
        state.discovery.sitemap_failed.push(`${url}: ${errorText(error)}`);
      }
      state.discovery.sitemap_done.push(url);
      state.discovery.sitemap_queue.shift();
      await save();
    }
    for (let index = 0; index < state.entries.length; index++) {
      const entry = state.entries[index];
      if (entry.status !== "DISCOVERED" && entry.status !== "RATE_LIMITED")
        continue;
      checkBudget();
      if (state.counters.pages >= limits.pages)
        throw new CrawlError(
          "PAGE_LIMIT",
          "Persisted page budget reached; discovered scope remains queued",
        );
      if (
        policy.respect_robots &&
        !robotsAllows(state.discovery.robots, entry.request_target)
      ) {
        entry.status = "EXCLUDED";
        entry.reason = "robots.txt disallow";
        entry.rule = "robots";
        await save();
        continue;
      }
      if (entry.attempts > (options.maxRetries ?? 2)) {
        entry.status = "RATE_LIMITED";
        throw new CrawlError(
          "HOST_PAUSED",
          "Persistent source throttling; explicit new snapshot or retry policy review required",
        );
      }
      try {
        entry.attempts++;
        await save();
        const { response, chain } = await fetchFollowing(entry.crawl_key);
        entry.http_status = chain[0]?.status ?? response.status;
        entry.final_http_status = response.status;
        entry.final_url = response.url;
        entry.redirect_chain = chain;
        entry.mime =
          response.headers["content-type"]
            ?.split(";")[0]
            .trim()
            .toLowerCase() ?? "application/octet-stream";
        entry.headers = response.headers;
        entry.bytes = response.body.length;
        entry.fetched_at = new Date().toISOString();
        await guardResponse(response, "page", entry);
        if ([429, 503].includes(response.status)) {
          entry.status = "RATE_LIMITED";
          entry.reason = `HTTP ${response.status}`;
          await save();
          if (entry.attempts > (options.maxRetries ?? 2))
            throw new CrawlError(
              "HOST_PAUSED",
              "Persistent source throttling; no infinite retries",
            );
          const retry = response.headers["retry-after"];
          const delay =
            retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : retry
                ? Math.max(0, Date.parse(retry) - Date.now())
                : 1000 * 2 ** (entry.attempts - 1);
          // A long Retry-After pauses for an operator/scheduler, never ignores the host's requested delay.
          if (!Number.isFinite(delay) || delay > 60_000)
            throw new CrawlError(
              "HOST_PAUSED",
              `Source Retry-After requires later resume: ${retry}`,
            );
          await sleep(delay, options.signal);
          index--;
          continue;
        }
        const stored = await snapshot(outputDir, response.body);
        entry.body_path = stored.path;
        entry.body_sha256 = stored.hash;
        if ([401, 403].includes(response.status)) {
          entry.status = "REQUIRES_ACCESS";
          entry.reason = `HTTP ${response.status}`;
        } else if (response.status >= 500) {
          entry.status = "UNREACHABLE";
          entry.reason = `HTTP ${response.status}`;
        } else {
          entry.status = "FETCHED";
          if (
            entry.mime === "text/html" ||
            entry.mime === "application/xhtml+xml"
          ) {
            Object.assign(
              entry,
              inspectHtml(response.body.toString("utf8"), response.url),
            );
            if (policy.mode === "browser" && response.status === 200) {
              const { renderPage } = await import("./browser.ts");
              const rendered = await renderPage(response.url, {
                request: async (url) => {
                  const response = await request(url);
                  await guardResponse(response, "browser_http", entry);
                  return response;
                },
                checkDom: async (html) => {
                  const match = detectAccessChallenge(html);
                  if (match)
                    await blockAccess(
                      response.url,
                      "browser_dom",
                      html,
                      match,
                      entry,
                      undefined,
                      "dom",
                    );
                },
                executablePath: options.browserExecutablePath,
                timeoutMs: options.browserTimeoutMs,
              });
              const dom = await snapshot(outputDir, rendered.html);
              entry.dom_path = dom.path;
              entry.dom_sha256 = dom.hash;
              entry.rendered = rendered.profile;
              entry.status = "RENDERED";
              Object.assign(entry, inspectHtml(rendered.html, response.url));
            }
            for (const link of entry.links) {
              if (/\.(png|jpe?g|webp|gif|avif|svg|pdf)(?:[?#]|$)/i.test(link))
                continue;
              addPage(link, entry.crawl_key);
            }
            for (const url of entry.media) {
              const id = identifyUrl(url, response.url),
                existing = state.assets.find(
                  (asset) => asset.source_url === id.crawl_key,
                );
              if (existing) {
                if (!existing.discovered_from.includes(entry.crawl_key))
                  existing.discovered_from.push(entry.crawl_key);
              } else
                state.assets.push({
                  source_url: id.crawl_key,
                  discovered_from: [entry.crawl_key],
                  status: "DISCOVERED",
                });
            }
          }
        }
        for (const hop of chain) addPage(hop.location, `redirect:${hop.url}`);
        state.counters.pages++;
      } catch (error) {
        if (error instanceof CrawlError && error.code === "ACCESS_REQUIRED")
          throw error;
        if (error instanceof CrawlError && error.redirectChain?.length) {
          entry.redirect_chain = error.redirectChain;
          entry.http_status = error.redirectChain[0].status;
        }
        if (
          error instanceof CrawlError &&
          ["BUDGET_LIMIT", "PAGE_LIMIT", "HOST_PAUSED", "ABORTED"].includes(
            error.code,
          )
        ) {
          if (entry.status !== "RATE_LIMITED") entry.status = "DISCOVERED";
          throw error;
        }
        // A permitted source URL whose redirect/network destination is forbidden is still unresolved
        // source scope. Only an explicit pre-fetch source policy exclusion removes it from required work.
        entry.status = "FAILED";
        entry.reason = errorText(error);
        entry.rule = error instanceof CrawlError ? error.code : "fetch-error";
      }
      await save();
    }
    let processedAssets = state.assets.filter(
      (item) => item.status !== "DISCOVERED",
    ).length;
    for (const asset of state.assets) {
      if (asset.status !== "DISCOVERED") continue;
      checkBudget();
      if (processedAssets >= limits.assets)
        throw new CrawlError(
          "ASSET_LIMIT",
          "Persisted asset budget reached; discovered resources remain queued",
        );
      processedAssets++;
      const identity = identifyUrl(asset.source_url);
      if (identity.origin !== source.origin) {
        asset.status = "EXCLUDED";
        asset.reason = "External resource origin not approved";
        await save();
        continue;
      }
      if (
        policy.respect_robots &&
        !robotsAllows(state.discovery.robots, identity.request_target)
      ) {
        asset.status = "EXCLUDED";
        asset.reason = "robots.txt disallow";
        await save();
        continue;
      }
      try {
        const { response } = await fetchFollowing(asset.source_url),
          mime = response.headers["content-type"]
            ?.split(";")[0]
            .trim()
            .toLowerCase();
        await guardResponse(response, "asset");
        if (response.status !== 200)
          throw new Error(`Asset HTTP ${response.status}`);
        // SVG/HTML are not copied into a target. Raster-only baseline fails closed for executable formats.
        if (
          !mime ||
          ![
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/avif",
            "application/pdf",
          ].includes(mime)
        ) {
          asset.status = "EXCLUDED";
          asset.reason = `Unsupported or unsafe asset MIME: ${mime}`;
        } else {
          const stored = await snapshot(outputDir, response.body);
          Object.assign(asset, {
            status: "FETCHED",
            mime,
            sha256: stored.hash,
            body_path: stored.path,
            size_bytes: response.body.length,
          });
        }
      } catch (error) {
        if (
          error instanceof CrawlError &&
          ["BUDGET_LIMIT", "ABORTED", "ACCESS_REQUIRED"].includes(error.code)
        )
          throw error;
        asset.status = "FAILED";
        asset.reason = errorText(error);
      }
      await save();
    }
    state.state = "COMPLETE";
    state.finished_at = new Date().toISOString();
    addLimitation(
      "Completeness is relative to discovered links and sitemaps, not an assertion about all URLs of the source.",
    );
    addLimitation(
      "Snapshot consistency rechecks and owner exports are not implemented; one snapshot is not atomic.",
    );
    if (policy.mode === "http")
      addLimitation("JavaScript-only content was not rendered in HTTP mode.");
    if (policy.mode === "browser")
      addLimitation(
        "Browser traffic is mediated and GET-only; OS/container process isolation is a separate deployment prerequisite.",
      );
    if (state.assets.some((asset) => asset.status !== "FETCHED"))
      addLimitation(
        "Some discovered media were excluded or failed; offline media completeness is not established.",
      );
  } catch (error) {
    state.state = "PAUSED";
    addLimitation(
      `${error instanceof CrawlError ? error.code : "CRAWL_ERROR"}: ${errorText(error)}`,
    );
  }
  await save();
  return state;
}
