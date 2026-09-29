import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { Ajv } from "ajv";
import { detectAccessChallenge, isHtmlResponse } from "./access.ts";
import { identifyUrl, inspectHtml } from "./index.ts";

export class OperatorCaptureError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface OperatorFileReference {
  relative_path: string;
  sha256: string;
  size_bytes: number;
}
export interface OperatorCaptureManifest {
  schema_version: 1;
  kind: "operator-capture";
  capture_id: string;
  project_id: string;
  source_origin: string;
  captured_at: string;
  inventory: { basis: "operator-observed-urls"; urls: string[] };
  observations: {
    source_url: string;
    document_url: string;
    observed_at: string;
    format: "dom-html" | "selected-fields-json";
    file: OperatorFileReference;
  }[];
  assets: {
    source_url: string;
    observed_on_urls: string[];
    mime:
      | "image/png"
      | "image/jpeg"
      | "image/gif"
      | "image/webp"
      | "application/pdf";
    file: OperatorFileReference;
  }[];
}
export interface SelectedDomObservation {
  schema_version: 1;
  kind: "selected-dom-observation";
  source_url: string;
  document_title: string;
  fields: { name: string; locator: string; text: string }[];
  links: string[];
  asset_urls: string[];
}

export const OPERATOR_CAPTURE_LIMITS = Object.freeze({
  manifestBytes: 2_000_000,
  fileBytes: 20_000_000,
  totalBytes: 200_000_000,
  inventoryUrls: 10_000,
  observations: 1_000,
  assets: 5_000,
});
export interface OperatorCaptureOptions {
  directory: string;
  manifestPath?: string;
  /** Pin provided by the trusted artifact registry/caller, not by the untrusted manifest itself. */
  expectedManifestSha256: string;
  expectedProjectId: string;
  expectedSourceUrl: string;
  existingSourceRegistry?: readonly string[];
  serverAccessBlockId?: string;
  limits?: Partial<Record<keyof typeof OPERATOR_CAPTURE_LIMITS, number>>;
}

const text = { type: "string", maxLength: 8192 };
const timestamp = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$",
};
const fileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["relative_path", "sha256", "size_bytes"],
  properties: {
    relative_path: { type: "string", minLength: 1, maxLength: 240 },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    size_bytes: {
      type: "integer",
      minimum: 1,
      maximum: OPERATOR_CAPTURE_LIMITS.fileBytes,
    },
  },
};
const urlArray = {
  type: "array",
  maxItems: OPERATOR_CAPTURE_LIMITS.inventoryUrls,
  items: text,
};
export const operatorCaptureSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "kind",
    "capture_id",
    "project_id",
    "source_origin",
    "captured_at",
    "inventory",
    "observations",
    "assets",
  ],
  properties: {
    schema_version: { const: 1 },
    kind: { const: "operator-capture" },
    capture_id: {
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
    },
    project_id: { type: "string", minLength: 1, maxLength: 128 },
    source_origin: text,
    captured_at: timestamp,
    inventory: {
      type: "object",
      additionalProperties: false,
      required: ["basis", "urls"],
      properties: {
        basis: { const: "operator-observed-urls" },
        urls: urlArray,
      },
    },
    observations: {
      type: "array",
      minItems: 1,
      maxItems: OPERATOR_CAPTURE_LIMITS.observations,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_url",
          "document_url",
          "observed_at",
          "format",
          "file",
        ],
        properties: {
          source_url: text,
          document_url: text,
          observed_at: timestamp,
          format: { enum: ["dom-html", "selected-fields-json"] },
          file: fileSchema,
        },
      },
    },
    assets: {
      type: "array",
      maxItems: OPERATOR_CAPTURE_LIMITS.assets,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_url", "observed_on_urls", "mime", "file"],
        properties: {
          source_url: text,
          observed_on_urls: { ...urlArray, minItems: 1 },
          mime: {
            enum: [
              "image/png",
              "image/jpeg",
              "image/gif",
              "image/webp",
              "application/pdf",
            ],
          },
          file: fileSchema,
        },
      },
    },
  },
};
export const selectedDomObservationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "kind",
    "source_url",
    "document_title",
    "fields",
    "links",
    "asset_urls",
  ],
  properties: {
    schema_version: { const: 1 },
    kind: { const: "selected-dom-observation" },
    source_url: text,
    document_title: { type: "string", maxLength: 4096 },
    fields: {
      type: "array",
      maxItems: 5000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "locator", "text"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 256 },
          locator: { type: "string", minLength: 1, maxLength: 2048 },
          text: { type: "string", maxLength: 65536 },
        },
      },
    },
    links: urlArray,
    asset_urls: urlArray,
  },
};
const ajv = new Ajv({ allErrors: true, strict: true });
const validateManifest = ajv.compile<OperatorCaptureManifest>(
  operatorCaptureSchema,
);
const validateSelected = ajv.compile<SelectedDomObservation>(
  selectedDomObservationSchema,
);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const fail = (code: string, message: string): never => {
  throw new OperatorCaptureError(code, message);
};

function portablePath(value: string): string {
  if (
    value.length > 240 ||
    value
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) ||
          part.endsWith(".") ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    fail(
      "CAPTURE_PATH",
      "File names must be portable relative slash-separated paths without traversal or reserved names",
    );
  return value;
}

function validTimestamp(value: string) {
  const date = new Date(value);
  if (
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")
  )
    fail("CAPTURE_SCHEMA", "Capture timestamp must be a valid UTC timestamp");
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("CAPTURE_SCHEMA", "Capture JSON must be valid UTF-8 JSON");
  }
}

async function safeRead(
  root: string,
  relative: string,
  limit: number,
): Promise<Buffer> {
  portablePath(relative);
  const parts = relative.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const info = await lstat(current);
    if (
      info.isSymbolicLink() ||
      (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())
    )
      fail(
        "CAPTURE_PATH",
        "Symlinks and non-regular capture files are forbidden",
      );
  }
  const expected = await lstat(current);
  if (expected.nlink !== 1)
    fail("CAPTURE_PATH", "Hard-linked capture files are forbidden");
  if (expected.size > limit)
    fail("CAPTURE_LIMIT", "Capture file exceeds byte limit");
  const canonical = await realpath(current);
  const relativeCanonical = path.relative(root, canonical);
  if (relativeCanonical.startsWith("..") || path.isAbsolute(relativeCanonical))
    fail(
      "CAPTURE_PATH",
      "Capture file resolves outside the selected directory",
    );
  const handle = await open(
    current,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.ino !== expected.ino ||
      before.dev !== expected.dev
    )
      fail("CAPTURE_CHANGED", "Capture file identity changed while opening");
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, limit - size + 1));
      const read = await handle.read(chunk, 0, chunk.length, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
      if (size > limit)
        fail("CAPTURE_LIMIT", "Capture file grew beyond byte limit");
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      (await realpath(current)) !== canonical
    )
      fail("CAPTURE_CHANGED", "Capture changed during validation");
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

async function validateTree(root: string, allowed: Set<string>) {
  const directories = new Set<string>();
  for (const file of allowed) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++)
      directories.add(parts.slice(0, index).join("/"));
  }
  const seen = new Set<string>();
  async function visit(relative: string) {
    const directory = await opendir(path.join(root, relative));
    for await (const item of directory) {
      const child = relative ? `${relative}/${item.name}` : item.name;
      portablePath(child);
      const info = await lstat(path.join(root, child));
      if (info.isSymbolicLink())
        fail("CAPTURE_PATH", "Symlinks in capture tree are forbidden");
      if (info.isDirectory()) {
        if (!directories.has(child))
          fail("CAPTURE_UNLISTED_FILE", "Unlisted directory in capture tree");
        await visit(child);
      } else {
        if (!info.isFile() || info.nlink !== 1)
          fail("CAPTURE_PATH", "Only ordinary independent files are accepted");
        if (!allowed.has(child))
          fail("CAPTURE_UNLISTED_FILE", "Unlisted file in capture tree");
        seen.add(child);
      }
    }
  }
  await visit("");
  if (seen.size !== allowed.size)
    fail("CAPTURE_MISSING_FILE", "Capture manifest references missing files");
}

function verifyMediaSignature(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/gif")
    return ["GIF87a", "GIF89a"].includes(
      bytes.subarray(0, 6).toString("ascii"),
    );
  if (mime === "image/webp")
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  if (mime === "application/pdf")
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
}

export interface OperatorInventoryEntry {
  crawl_key: string;
  request_target: string;
  raw_urls: string[];
  discovered_from: string[];
  observation: "UNOBSERVED" | "SELECTED_FIELDS" | "DOM_OBSERVED";
}
export interface ValidatedOperatorCapture {
  schema_version: 1;
  kind: "validated-operator-capture";
  capture_id: string;
  project_id: string;
  source_origin: string;
  manifest_sha256: string;
  state: "PARTIAL";
  trust: "untrusted-source-data";
  source_access: "NOT_VERIFIED";
  server_access_block_id: string | null;
  readiness: "NOT_EVALUATED";
  inventory: OperatorInventoryEntry[];
  coverage: {
    basis: "union-of-existing-and-observed-urls";
    known_urls: number;
    unobserved: number;
    selected_fields: number;
    dom_observed: number;
    full_source_denominator: "UNKNOWN";
  };
  observations: (OperatorCaptureManifest["observations"][number] & {
    trust: "untrusted-source-data";
    selected_fields?: SelectedDomObservation;
  })[];
  assets: OperatorCaptureManifest["assets"];
  external_references: string[];
  unverified_asset_urls: string[];
  files: OperatorFileReference[];
  limitations: string[];
}

/** Offline validation only. This never modifies Store, crawl state, source permissions, or target files. */
export async function validateOperatorCapture(
  options: OperatorCaptureOptions,
): Promise<ValidatedOperatorCapture> {
  const limits = { ...OPERATOR_CAPTURE_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value >
        OPERATOR_CAPTURE_LIMITS[name as keyof typeof OPERATOR_CAPTURE_LIMITS]
    )
      fail(
        "CAPTURE_LIMIT",
        "Capture limits must be positive integers within the documented hard caps",
      );
  }
  if (!/^[a-f0-9]{64}$/.test(options.expectedManifestSha256))
    fail("CAPTURE_HASH", "A trusted expected manifest SHA-256 is required");
  const chosenDirectory = path.resolve(options.directory);
  if ((await lstat(chosenDirectory)).isSymbolicLink())
    fail("CAPTURE_PATH", "Capture directory must not be a symlink");
  const root = await realpath(chosenDirectory);
  const manifestPath = portablePath(
    options.manifestPath ?? "operator-capture.json",
  );
  const manifestBytes = await safeRead(
    root,
    manifestPath,
    limits.manifestBytes,
  );
  if (digest(manifestBytes) !== options.expectedManifestSha256)
    fail("CAPTURE_HASH", "Manifest does not match the trusted caller pin");
  const parsed = parseJson(manifestBytes);
  if (!validateManifest(parsed))
    fail(
      "CAPTURE_SCHEMA",
      ajv.errorsText(validateManifest.errors, { dataVar: "manifest" }),
    );
  const manifest = parsed as OperatorCaptureManifest;
  if (manifest.project_id !== options.expectedProjectId)
    fail("CAPTURE_PROJECT", "Capture belongs to a different project");
  const seed = identifyUrl(options.expectedSourceUrl);
  if (manifest.source_origin !== seed.origin)
    fail("CAPTURE_ORIGIN", "Capture source origin does not match the project");
  validTimestamp(manifest.captured_at);
  if (
    manifest.observations.length > limits.observations ||
    manifest.assets.length > limits.assets ||
    manifest.inventory.urls.length > limits.inventoryUrls
  )
    fail("CAPTURE_LIMIT", "Capture object count exceeds the chosen limit");
  if ((options.existingSourceRegistry?.length ?? 0) > limits.inventoryUrls)
    fail(
      "CAPTURE_LIMIT",
      "Existing source registry exceeds the chosen URL limit",
    );

  const registry = new Map<string, OperatorInventoryEntry>();
  const rawUrls = new Set<string>();
  const external = new Set<string>();
  const observedAssets = new Set<string>();
  const sameOrigin = (raw: string) => {
    if (!/^https?:\/\//i.test(raw))
      fail("CAPTURE_URL", "Capture URLs must be absolute HTTP(S) URLs");
    const identity = identifyUrl(raw);
    if (identity.origin !== seed.origin)
      fail(
        "CAPTURE_ORIGIN",
        "Observation or declared asset lies outside the project origin",
      );
    return identity;
  };
  const addUrl = (raw: string, from: string) => {
    const identity = sameOrigin(raw);
    if (!rawUrls.has(raw) && rawUrls.size >= limits.inventoryUrls)
      fail(
        "CAPTURE_LIMIT",
        "Combined raw URL variants exceed the chosen limit",
      );
    rawUrls.add(raw);
    let item = registry.get(identity.crawl_key);
    if (!item) {
      if (registry.size >= limits.inventoryUrls)
        fail(
          "CAPTURE_LIMIT",
          "Combined source URL denominator exceeds the chosen limit",
        );
      item = {
        crawl_key: identity.crawl_key,
        request_target: identity.request_target,
        raw_urls: [],
        discovered_from: [],
        observation: "UNOBSERVED",
      };
      registry.set(identity.crawl_key, item);
    }
    if (!item.raw_urls.includes(raw)) item.raw_urls.push(raw);
    if (!item.discovered_from.includes(from)) item.discovered_from.push(from);
    return item;
  };
  addUrl(options.expectedSourceUrl, "project-source");
  for (const url of options.existingSourceRegistry ?? [])
    addUrl(url, "existing-source-registry");
  for (const url of manifest.inventory.urls) addUrl(url, "operator-inventory");
  const files = [
    ...manifest.observations.map((item) => item.file),
    ...manifest.assets.map((item) => item.file),
  ];
  const allowed = new Set([manifestPath]);
  const caseInsensitive = new Set([manifestPath.toLowerCase()]);
  const portableNames = new Map<string, string>();
  const manifestParts = manifestPath.split("/");
  for (let index = 1; index <= manifestParts.length; index++) {
    const prefix = manifestParts.slice(0, index).join("/");
    portableNames.set(prefix.toLowerCase(), prefix);
  }
  let totalBytes = manifestBytes.length;
  for (const file of files) {
    portablePath(file.relative_path);
    const parts = file.relative_path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join("/");
      const existing = portableNames.get(prefix.toLowerCase());
      if (existing && existing !== prefix)
        fail(
          "CAPTURE_PATH",
          "Case-colliding directory or file names are not portable",
        );
      portableNames.set(prefix.toLowerCase(), prefix);
    }
    if (caseInsensitive.has(file.relative_path.toLowerCase()))
      fail("CAPTURE_PATH", "Duplicate or case-colliding capture file path");
    allowed.add(file.relative_path);
    caseInsensitive.add(file.relative_path.toLowerCase());
    totalBytes += file.size_bytes;
    if (file.size_bytes > limits.fileBytes || totalBytes > limits.totalBytes)
      fail("CAPTURE_LIMIT", "Capture declared bytes exceed the chosen limit");
  }
  await validateTree(root, allowed);
  const readVerified = async (file: OperatorFileReference) => {
    const bytes = await safeRead(
      root,
      file.relative_path,
      Math.min(file.size_bytes, limits.fileBytes),
    );
    if (bytes.length !== file.size_bytes || digest(bytes) !== file.sha256)
      fail(
        "CAPTURE_HASH",
        "Capture file size or SHA-256 does not match the pinned manifest",
      );
    return bytes;
  };
  const observedPages = new Set<string>();
  const observations: ValidatedOperatorCapture["observations"] = [];
  const addReference = (raw: string, base: string, asset: boolean) => {
    const identity = identifyUrl(raw, base);
    if (identity.origin !== seed.origin) external.add(identity.raw_url);
    else if (asset) observedAssets.add(identity.crawl_key);
    else addUrl(identity.raw_url, `observation:${base}`);
    if (
      observedAssets.size + external.size >
      limits.inventoryUrls + limits.assets
    )
      fail(
        "CAPTURE_LIMIT",
        "Observed reference count exceeds the chosen limit",
      );
  };
  for (const observation of manifest.observations) {
    const identity = sameOrigin(observation.source_url);
    const documentIdentity = sameOrigin(observation.document_url);
    validTimestamp(observation.observed_at);
    if (observedPages.has(identity.crawl_key))
      fail(
        "CAPTURE_DUPLICATE",
        "Repeated observations for one request target require a separate capture version",
      );
    observedPages.add(identity.crawl_key);
    const bytes = await readVerified(observation.file);
    let selected: SelectedDomObservation | undefined;
    let links: string[], media: string[];
    if (observation.format === "selected-fields-json") {
      const payload = parseJson(bytes);
      if (!validateSelected(payload))
        fail(
          "CAPTURE_SCHEMA",
          ajv.errorsText(validateSelected.errors, {
            dataVar: "selected observation",
          }),
        );
      selected = payload as SelectedDomObservation;
      if (sameOrigin(selected.source_url).crawl_key !== identity.crawl_key)
        fail(
          "CAPTURE_URL",
          "Selected observation URL differs from its manifest binding",
        );
      const escapedTitle = selected.document_title
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (detectAccessChallenge(`<title>${escapedTitle}</title>`))
        fail(
          "CAPTURE_CHALLENGE",
          "Selected observation is a recognized access challenge",
        );
      links = selected.links;
      media = selected.asset_urls;
    } else {
      let html: string;
      try {
        html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return fail("CAPTURE_SCHEMA", "DOM snapshot must be valid UTF-8");
      }
      if (!isHtmlResponse(html))
        fail(
          "CAPTURE_FORMAT",
          "DOM evidence must contain HTML markup; selected JSON or plain text is not a DOM snapshot",
        );
      if (detectAccessChallenge(html))
        fail(
          "CAPTURE_CHALLENGE",
          "DOM snapshot is a recognized access challenge",
        );
      const inspected = inspectHtml(html, documentIdentity.crawl_key);
      links = inspected.links;
      media = inspected.media;
    }
    const page = addUrl(observation.source_url, "operator-observation");
    addUrl(observation.document_url, `document-url:${observation.source_url}`);
    page.observation = selected ? "SELECTED_FIELDS" : "DOM_OBSERVED";
    for (const link of links)
      addReference(link, observation.document_url, false);
    for (const asset of media)
      addReference(asset, observation.document_url, true);
    observations.push({
      ...observation,
      trust: "untrusted-source-data",
      ...(selected ? { selected_fields: selected } : {}),
    });
  }
  const verifiedAssets = new Set<string>();
  for (const asset of manifest.assets) {
    const identity = sameOrigin(asset.source_url);
    if (verifiedAssets.has(identity.crawl_key))
      fail("CAPTURE_DUPLICATE", "Repeated asset source URL");
    for (const page of asset.observed_on_urls) {
      if (!registry.has(sameOrigin(page).crawl_key))
        fail(
          "CAPTURE_URL",
          "Asset observation page is absent from the combined source registry",
        );
    }
    const bytes = await readVerified(asset.file);
    if (detectAccessChallenge(bytes))
      fail("CAPTURE_CHALLENGE", "Asset file contains a recognized challenge");
    if (!verifyMediaSignature(bytes, asset.mime))
      fail(
        "CAPTURE_MIME",
        "Asset signature does not match its allowlisted MIME",
      );
    verifiedAssets.add(identity.crawl_key);
  }
  const inventory = [...registry.values()];
  return {
    schema_version: 1,
    kind: "validated-operator-capture",
    capture_id: manifest.capture_id,
    project_id: manifest.project_id,
    source_origin: seed.origin,
    manifest_sha256: options.expectedManifestSha256,
    state: "PARTIAL",
    trust: "untrusted-source-data",
    source_access: "NOT_VERIFIED",
    server_access_block_id: options.serverAccessBlockId ?? null,
    readiness: "NOT_EVALUATED",
    inventory,
    coverage: {
      basis: "union-of-existing-and-observed-urls",
      known_urls: inventory.length,
      unobserved: inventory.filter((item) => item.observation === "UNOBSERVED")
        .length,
      selected_fields: inventory.filter(
        (item) => item.observation === "SELECTED_FIELDS",
      ).length,
      dom_observed: inventory.filter(
        (item) => item.observation === "DOM_OBSERVED",
      ).length,
      full_source_denominator: "UNKNOWN",
    },
    observations,
    assets: manifest.assets,
    external_references: [...external],
    unverified_asset_urls: [...observedAssets].filter(
      (url) => !verifiedAssets.has(url),
    ),
    files,
    limitations: [
      "Validation proves schema, local byte integrity and URL binding, not the truth of source facts or capture authenticity.",
      "Selected fields remain partial observations; DOM snapshots do not prove a complete page or a complete source URL registry.",
      "No HTTP status, redirects, robots policy, server access resolution, target implementation or functional scenario is established.",
      "Known challenge detection is narrow; an unrecognized defense or incomplete DOM may require operator review.",
      "Media signatures are checked, not decoded or rendered; PDF attachments require separate safe serving and validation.",
      "Core ingestion, immutable artifact registration, content extraction and readiness evaluation are not integrated by this adapter.",
    ],
  };
}
