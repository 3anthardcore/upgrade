import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  realpath,
  open,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import packageSchema from "./package.schema.json" with { type: "json" };

export interface BitrixEntityInput {
  source_id: string;
  type: string;
  title: string;
  body_text?: string;
  description?: string;
  blocks?: unknown[];
  seo?: unknown;
  facts?: unknown;
  evidence?: unknown[];
  metadata?: Record<string, unknown>;
  assets?: unknown[];
  [key: string]: unknown;
}
export interface BitrixRouteInput {
  request_target: string;
  source_id?: string | null;
  entity_source_id?: string | null;
  entity_type?: string;
  expected_status?: number;
  redirect_target?: string | null;
  redirect_to?: string | null;
  source_origin?: string;
  [key: string]: unknown;
}
export interface BitrixPackageInput {
  projectId: string;
  sourceVersion: string;
  outputDir: string;
  entities: BitrixEntityInput[];
  routes: BitrixRouteInput[];
  sourceOrigin?: string;
  designTokens?: Record<string, unknown>;
  assets?: Array<{
    source_url: string;
    status: string;
    mime?: string;
    sha256?: string;
    body_path?: string;
  }>;
  assetRoot?: string;
}
export interface PackageManifest {
  schema_version: "1.0";
  project_id: string;
  source_version: string;
  mode: "public-demo";
  target_profile: "editable-content-snapshot";
  files: Record<string, string>;
  entity_count: number;
  route_count: number;
  blockers: string[];
  warnings: string[];
  runtime_verification: "NOT_RUN";
}
export const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");
async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export const stableEntityKey = (
  project: string,
  type: string,
  source: string,
): string => sha256(JSON.stringify([project, type, source]));
const validProject = /^[a-z0-9][a-z0-9-]{0,62}$/;
const supported = new Set([
  "page",
  "home",
  "service",
  "article",
  "contact",
  "contacts",
  "category",
  "search",
  "not-found",
  "product",
  "section",
]);
const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";
const validateManifest = new Ajv({ allErrors: true }).compile(packageSchema);

export function designTokenCss(tokens: Record<string, unknown>): string {
  const variables: Record<string, string> = {};
  const color = (tokens.color ?? {}) as Record<string, unknown>;
  for (const [key, variable] of Object.entries({
    ink: "ink",
    surface: "surface",
    paper: "paper",
    accent: "accent",
    muted: "muted",
    border: "line",
  })) {
    if (color[key] === undefined) continue;
    if (typeof color[key] !== "string" || !/^#[a-f0-9]{6}$/i.test(color[key]))
      throw new Error("INVALID_COLOR_TOKEN");
    variables[variable] = color[key];
  }
  const typography = (tokens.typography ?? {}) as Record<string, unknown>;
  const family = typography.family ?? tokens.font;
  if (family !== undefined) {
    if (typeof family !== "string" || !/^[a-zA-Z0-9 ,"'-]{1,160}$/.test(family))
      throw new Error("INVALID_FONT_TOKEN");
    variables.font = family;
  }
  if (typography.body !== undefined) {
    if (
      typeof typography.body !== "string" ||
      !/^\d+(?:\.\d+)?(?:rem|px)$/.test(typography.body)
    )
      throw new Error("INVALID_BODY_TOKEN");
    variables["font-size"] = typography.body;
  }
  if (typography.title !== undefined) {
    if (
      typeof typography.title !== "string" ||
      !/^clamp\(\d+(?:\.\d+)?rem, \d+(?:\.\d+)?vw, \d+(?:\.\d+)?rem\)$/.test(
        typography.title,
      )
    )
      throw new Error("INVALID_TITLE_TOKEN");
    variables["title-size"] = typography.title;
  }
  if (typography.lineHeight !== undefined) {
    if (
      typeof typography.lineHeight !== "number" ||
      typography.lineHeight < 1 ||
      typography.lineHeight > 2.5
    )
      throw new Error("INVALID_LINE_HEIGHT_TOKEN");
    variables["line-height"] = String(typography.lineHeight);
  }
  if (tokens.radius !== undefined) {
    const value =
      typeof tokens.radius === "number"
        ? tokens.radius
        : Number(String(tokens.radius).replace(/px$/, ""));
    if (!Number.isFinite(value) || value < 0 || value > 64)
      throw new Error("INVALID_RADIUS_TOKEN");
    variables.radius = value + "px";
  }
  if (tokens.contentMax !== undefined) {
    if (
      typeof tokens.contentMax !== "number" ||
      tokens.contentMax < 640 ||
      tokens.contentMax > 1920
    )
      throw new Error("INVALID_CONTENT_WIDTH_TOKEN");
    variables["content-max"] = tokens.contentMax + "px";
  }
  if (tokens.spacing !== undefined) {
    if (
      !Array.isArray(tokens.spacing) ||
      tokens.spacing.length < 2 ||
      tokens.spacing.some(
        (value) => typeof value !== "number" || value < 0 || value > 256,
      )
    )
      throw new Error("INVALID_SPACING_TOKEN");
    variables["space-max"] =
      String(tokens.spacing[Math.min(6, tokens.spacing.length - 1)]) + "px";
  }
  return (
    "\n/* Generated from accepted design tokens. */\n:root{" +
    Object.entries(variables)
      .map(([key, value]) => "--" + key + ":" + value)
      .join(";") +
    "}\n"
  );
}

export function validateRequestTarget(target: string): void {
  if (
    typeof target !== "string" ||
    target.length > 8192 ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    /[\u0000-\u0020\u007f#\\]/.test(target)
  )
    throw new Error("INVALID_REQUEST_TARGET");
  const path = target.split("?")[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error("INVALID_PERCENT_ENCODING");
  }
  if (
    decoded.split("/").some((x) => x === "." || x === "..") ||
    /[\u0000-\u001f\\]/.test(decoded)
  )
    throw new Error("UNSAFE_ROUTE");
  if (
    /^\/(?:bitrix|local|upload|\.well-known)(?:\/|$)/i.test(decoded) ||
    decoded === "/robots.txt"
  )
    throw new Error("RESERVED_ROUTE_COLLISION");
}

export async function buildBitrixPackage(
  input: BitrixPackageInput,
): Promise<{
  packageDir: string;
  manifestPath: string;
  manifest: PackageManifest;
  warnings: string[];
}> {
  if (!validProject.test(input.projectId))
    throw new Error("INVALID_PROJECT_ID");
  if (!input.sourceVersion) throw new Error("SOURCE_VERSION_REQUIRED");
  const tokens = input.designTokens ?? {
    color: { ink: "#172429", surface: "#f5f6f3", accent: "#145b45" },
    radius: "12px",
    font: "system-ui, sans-serif",
  };
  const tokenCss = designTokenCss(tokens);
  const entityIds = new Set<string>();
  const warnings = new Set<string>();
  const blockers = new Set<string>();
  const assetFiles = new Map<string, { sourcePath: string; hash: string }>();
  const assetRecords: Array<{
    source_url: string;
    sha256: string;
    mime: string;
    path: string;
    public_path: string;
  }> = [];
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "application/pdf": "pdf",
  };
  const assetRoot = input.assetRoot ? await realpath(input.assetRoot) : null;
  for (const asset of input.assets ?? []) {
    if (
      asset.status !== "FETCHED" ||
      !asset.mime ||
      !extensions[asset.mime] ||
      !asset.body_path ||
      !asset.sha256
    ) {
      blockers.add(`ASSET_UNAVAILABLE:${asset.source_url}`);
      continue;
    }
    if (!assetRoot) {
      blockers.add("ASSET_ROOT_REQUIRED");
      continue;
    }
    const path = await realpath(asset.body_path);
    if (
      !path.startsWith(assetRoot + sep) ||
      (await lstat(asset.body_path)).isSymbolicLink()
    )
      throw new Error("ASSET_PATH_ESCAPE");
    if ((await lstat(path)).size > 200_000_000)
      throw new Error("ASSET_SIZE_LIMIT");
    if ((await hashFile(path)) !== asset.sha256)
      throw new Error("ASSET_HASH_MISMATCH");
    const handle = await open(path, "r");
    const data = Buffer.alloc(16);
    try {
      await handle.read(data, 0, data.length, 0);
    } finally {
      await handle.close();
    }
    const magic =
      asset.mime === "image/png"
        ? data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : asset.mime === "image/jpeg"
          ? data[0] === 255 && data[1] === 216
          : asset.mime === "image/gif"
            ? /^GIF8[79]a$/.test(data.subarray(0, 6).toString())
            : asset.mime === "image/webp"
              ? data.subarray(0, 4).toString() === "RIFF" &&
                data.subarray(8, 12).toString() === "WEBP"
              : asset.mime === "image/avif"
                ? data.subarray(4, 8).toString() === "ftyp" &&
                  ["avif", "avis"].includes(data.subarray(8, 12).toString())
                : data.subarray(0, 5).toString() === "%PDF-";
    if (!magic) throw new Error("ASSET_MAGIC_MISMATCH");
    const name = asset.sha256 + "." + extensions[asset.mime];
    assetRecords.push({
      source_url: asset.source_url,
      sha256: asset.sha256,
      mime: asset.mime,
      path: "assets/" + name,
      public_path: "/upload/upgrade/" + input.projectId + "/" + name,
    });
    assetFiles.set("assets/" + name, { sourcePath: path, hash: asset.sha256 });
  }
  const entities = input.entities.map((entity) => {
    if (!entity.source_id || !entity.title || entity.title.length > 255)
      throw new Error("INVALID_ENTITY");
    if (entityIds.has(entity.source_id)) throw new Error("AMBIGUOUS_SOURCE_ID");
    entityIds.add(entity.source_id);
    const type = entity.type.toLowerCase();
    if (!supported.has(type))
      blockers.add(`UNSUPPORTED_ENTITY_TYPE:${entity.type}`);
    if (type === "product")
      warnings.add(
        "PRODUCT_CONTENT_SNAPSHOT_ONLY: offers, prices, stock, filters and commerce require a catalog adapter and real Bitrix verification",
      );
    for (const asset of entity.assets ?? []) {
      if (
        typeof asset === "string" &&
        !assetRecords.some((item) => item.source_url === asset)
      )
        blockers.add(`ENTITY_ASSET_MISSING:${asset}`);
    }
    const blocks =
      entity.blocks ??
      (entity.body_text ? [{ type: "paragraph", text: entity.body_text }] : []);
    if (
      blocks.some(
        (block) =>
          typeof block !== "object" ||
          block === null ||
          ![
            "paragraph",
            "heading",
            "list",
            "table",
            "quote",
            "image",
            "document",
            "link",
            "card",
          ].includes(String((block as { type?: unknown }).type)),
      )
    )
      blockers.add("UNSUPPORTED_CONTENT_BLOCK");
    for (const block of blocks as Array<{
      type: string;
      asset_sha256?: string;
      request_target?: string;
      items?: unknown;
    }>) {
      if (["link", "card"].includes(block.type)) {
        try { validateRequestTarget(block.request_target ?? ""); }
        catch { blockers.add("UNSAFE_CONTENT_LINK"); }
        if (block.asset_sha256 && !assetRecords.some((item) => item.sha256 === block.asset_sha256 && item.mime.startsWith("image/")))
          blockers.add("BLOCK_LINK_IMAGE_MISSING");
        if (block.items !== undefined && block.items !== null && (!Array.isArray(block.items) || block.items.some((item) => typeof item !== "string")))
          blockers.add("CONTENT_CARD_ITEMS_INVALID");
      }
      if (
        ["image", "document"].includes(block.type) &&
        !assetRecords.some((item) => item.sha256 === block.asset_sha256)
      )
        blockers.add("BLOCK_ASSET_MISSING");
    }
    return {
      ...entity,
      type,
      blocks,
      stable_key: stableEntityKey(input.projectId, type, entity.source_id),
    };
  });
  const seenRoutes = new Set<string>();
  const routes = input.routes.map((route) => {
    validateRequestTarget(route.request_target);
    if (
      input.sourceOrigin &&
      route.source_origin &&
      route.source_origin !== input.sourceOrigin
    )
      throw new Error("MULTI_ORIGIN_REQUIRES_SEPARATE_TARGET");
    if (seenRoutes.has(route.request_target))
      throw new Error("ROUTE_COLLISION");
    seenRoutes.add(route.request_target);
    const status = route.expected_status ?? 200;
    if (![200, 301, 302, 307, 308, 404, 410].includes(status))
      throw new Error("UNSUPPORTED_HTTP_STATUS");
    const sourceId = route.entity_source_id ?? route.source_id ?? null;
    const rawRedirect = route.redirect_to ?? route.redirect_target ?? null;
    let redirect = rawRedirect;
    if (rawRedirect?.startsWith("http")) {
      const url = new URL(rawRedirect);
      if (url.origin !== input.sourceOrigin)
        throw new Error("EXTERNAL_REDIRECT_REQUIRES_REVIEW");
      redirect = url.pathname + url.search;
    }
    if (redirect) validateRequestTarget(redirect);
    if (status >= 300 && status < 400 && !redirect)
      throw new Error("REDIRECT_TARGET_REQUIRED");
    if (status === 200 && (!sourceId || !entityIds.has(sourceId)))
      throw new Error("ROUTE_ENTITY_MISSING");
    const entity = entities.find((item) => item.source_id === sourceId);
    return {
      request_target: route.request_target,
      route_key: sha256(route.request_target),
      entity_key: entity?.stable_key ?? null,
      expected_status: status,
      redirect_target: redirect,
      query_policy: "preserve-exact",
    };
  });
  for (const route of routes) {
    if (route.redirect_target && !seenRoutes.has(route.redirect_target))
      blockers.add(`REDIRECT_OUTSIDE_REGISTRY:${route.request_target}`);
    const chain = new Set<string>([route.request_target]);
    let next = route.redirect_target;
    while (next) {
      if (chain.has(next)) throw new Error("REDIRECT_LOOP");
      chain.add(next);
      next =
        routes.find((item) => item.request_target === next)?.redirect_target ??
        null;
    }
  }
  const packageDir = resolve(input.outputDir);
  await mkdir(dirname(packageDir), { recursive: true });
  await mkdir(packageDir); // A release is immutable: never overwrite an existing path.
  const files: Record<string, string> = {};
  const add = async (path: string, data: string | Buffer) => {
    await mkdir(dirname(resolve(packageDir, path)), { recursive: true });
    await writeFile(resolve(packageDir, path), data, { flag: "wx" });
    files[path] = sha256(data);
  };
  await add("data/entities.json", json(entities));
  await add("data/routes.json", json(routes));
  await add("data/assets.json", json(assetRecords));
  for (const [path, asset] of assetFiles) {
    await mkdir(dirname(resolve(packageDir, path)), { recursive: true });
    await pipeline(
      createReadStream(asset.sourcePath),
      createWriteStream(resolve(packageDir, path), { flags: "wx" }),
    );
    if ((await hashFile(resolve(packageDir, path))) !== asset.hash)
      throw new Error("ASSET_CHANGED_DURING_PACKAGING");
    files[path] = asset.hash;
  }
  await add("data/design-tokens.json", json(tokens));
  // A homepage logo's observed alt label may name the site; never guess from an arbitrary image.
  const home = input.entities.find((entity) => entity.source_url === input.sourceOrigin + "/");
  const homeFacts = home?.facts as Record<string, { value?: unknown }> | undefined;
  const observedBrand = homeFacts?.["dom:home_logo_alt"]?.value;
  const brand = typeof observedBrand === "string" && observedBrand.trim().length > 0 && observedBrand.length <= 160
    ? observedBrand : "Обновлённый сайт";
  const escapedBrand = brand.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
  const observedNavigation = homeFacts?.["dom:primary_navigation"]?.value;
  const mappedTargets = new Set(routes.filter(route => route.expected_status === 200).map(route => route.request_target));
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
  const navigation: string[] = [];
  const seenNavigation = new Set<string>();
  if (Array.isArray(observedNavigation)) for (const item of observedNavigation) {
    if (!item || typeof item.label !== "string" || typeof item.request_target !== "string" || !item.label.trim() || item.label.length > 240) continue;
    try { validateRequestTarget(item.request_target); } catch { continue; }
    if (!mappedTargets.has(item.request_target)) continue;
    const key = JSON.stringify([item.label, item.request_target]);
    if (seenNavigation.has(key)) continue;
    seenNavigation.add(key);
    navigation.push(`<a href="${escapeHtml(item.request_target)}">${escapeHtml(item.label.trim())}</a>`);
  }
  const sourceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../bitrix",
  );
  const copyTree = async (dir: string) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isSymbolicLink()) throw new Error("SYMLINK_IN_PACKAGE_SOURCE");
      if (item.isDirectory()) await copyTree(path);
      else {
        const name = "code/" + relative(sourceRoot, path).split(sep).join("/");
        const bytes = await readFile(path);
        await add(
          name,
          name === "code/local/templates/upgrade/styles.css"
            ? bytes.toString("utf8") + tokenCss
            : name === "code/local/templates/upgrade/header.php"
              ? bytes.toString("utf8").replace(/<!-- upgrade:brand-name -->.*?<!-- \/upgrade:brand-name -->/, () => escapedBrand)
                .replace(/<!-- upgrade:primary-navigation -->.*?<!-- \/upgrade:primary-navigation -->/s, match => navigation.length ? navigation.join("") : match)
            : bytes,
        );
      }
    }
  };
  await copyTree(sourceRoot);
  const manifest: PackageManifest = {
    schema_version: "1.0",
    project_id: input.projectId,
    source_version: input.sourceVersion,
    mode: "public-demo",
    target_profile: "editable-content-snapshot",
    files,
    entity_count: entities.length,
    route_count: routes.length,
    blockers: [...blockers].sort(),
    warnings: [...warnings].sort(),
    runtime_verification: "NOT_RUN",
  };
  const manifestPath = resolve(packageDir, "manifest.json");
  await writeFile(manifestPath, json(manifest), { flag: "wx" });
  return { packageDir, manifestPath, manifest, warnings: manifest.warnings };
}

export async function validateBitrixPackage(
  packageDir: string,
  expectedProject: string,
  expectedManifestHash?: string,
): Promise<PackageManifest> {
  const root = await realpath(packageDir);
  const manifestBytes = await readFile(resolve(root, "manifest.json"));
  if (expectedManifestHash && sha256(manifestBytes) !== expectedManifestHash)
    throw new Error("ACCEPTED_MANIFEST_HASH_MISMATCH");
  const manifest = JSON.parse(
    manifestBytes.toString("utf8"),
  ) as PackageManifest;
  if (!validateManifest(manifest))
    throw new Error(
      "PACKAGE_SCHEMA_INVALID:" + JSON.stringify(validateManifest.errors),
    );
  if (
    manifest.schema_version !== "1.0" ||
    manifest.mode !== "public-demo" ||
    manifest.target_profile !== "editable-content-snapshot" ||
    manifest.project_id !== expectedProject ||
    !validProject.test(expectedProject)
  )
    throw new Error("PACKAGE_SCHEMA_OR_PROJECT_MISMATCH");
  if (
    !manifest.files ||
    Array.isArray(manifest.files) ||
    !manifest.files["data/entities.json"] ||
    !manifest.files["data/routes.json"]
  )
    throw new Error("PACKAGE_FILES_REQUIRED");
  const checkTree = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      const name = relative(root, path).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error("PACKAGE_SYMLINK");
      if (entry.isDirectory()) await checkTree(path);
      else if (
        !entry.isFile() ||
        (name !== "manifest.json" && !Object.hasOwn(manifest.files, name))
      )
        throw new Error("UNLISTED_PACKAGE_FILE:" + name);
    }
  };
  await checkTree(root);
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (
      !/^[a-zA-Z0-9_.\/-]+$/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((x) => x === ".." || x === "." || !x) ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new Error("UNSAFE_PACKAGE_PATH_OR_HASH");
    const candidate = resolve(root, name);
    const physical = await realpath(candidate);
    if (
      !physical.startsWith(root + sep) ||
      (await lstat(candidate)).isSymbolicLink()
    )
      throw new Error("PACKAGE_PATH_ESCAPE");
    if ((await hashFile(candidate)) !== hash)
      throw new Error("PACKAGE_HASH_MISMATCH");
  }
  const entities = JSON.parse(
    await readFile(resolve(root, "data/entities.json"), "utf8"),
  ) as Array<{
    stable_key: string;
    source_id: string;
    type: string;
    title: string;
  }>;
  const routes = JSON.parse(
    await readFile(resolve(root, "data/routes.json"), "utf8"),
  ) as Array<{
    request_target: string;
    route_key: string;
    entity_key: string | null;
    expected_status: number;
  }>;
  if (
    !Array.isArray(entities) ||
    !Array.isArray(routes) ||
    entities.length !== manifest.entity_count ||
    routes.length !== manifest.route_count
  )
    throw new Error("PACKAGE_COUNT_MISMATCH");
  const keys = new Set<string>();
  for (const entity of entities) {
    if (
      !entity.source_id ||
      !entity.title ||
      entity.stable_key !==
        stableEntityKey(expectedProject, entity.type, entity.source_id) ||
      keys.has(entity.stable_key)
    )
      throw new Error("ENTITY_KEY_MISMATCH");
    keys.add(entity.stable_key);
  }
  const targets = new Set<string>();
  for (const route of routes) {
    validateRequestTarget(route.request_target);
    if (
      route.route_key !== sha256(route.request_target) ||
      targets.has(route.request_target) ||
      (route.expected_status === 200 && !keys.has(route.entity_key ?? ""))
    )
      throw new Error("ROUTE_INTEGRITY_FAILURE");
    targets.add(route.request_target);
  }
  return manifest;
}
