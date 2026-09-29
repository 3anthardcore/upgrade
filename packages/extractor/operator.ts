import { createHash } from "node:crypto";
import path from "node:path";
import { Ajv } from "ajv";
import { load } from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { detectAccessChallenge, isHtmlResponse } from "../crawler/access.ts";
import { identifyUrl } from "../crawler/network.ts";
import {
  OPERATOR_CAPTURE_LIMITS,
  selectedDomObservationSchema,
} from "../crawler/operator.ts";
import type {
  OperatorFileReference,
  OperatorInventoryEntry,
  SelectedDomObservation,
  ValidatedOperatorCapture,
} from "../crawler/operator.ts";
import type { CrawlAsset } from "../crawler/index.ts";
import { sanitizeHtml } from "./index.ts";
import type {
  ContentBlock,
  ContentEntity,
  ContentModel,
  Evidence,
  Fact,
} from "./index.ts";

export class OperatorExtractionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export interface OperatorExtractionOptions {
  projectId?: string;
  sourceVersion?: string;
  /** Resolver owned by the caller; returns immutable accepted artifact bytes, not fetched URLs. */
  readFile: (relativePath: string) => Uint8Array | Promise<Uint8Array>;
  /** Optional trusted path of these same bytes after caller-controlled local materialization. */
  mediaPath?: (relativePath: string) => string | undefined;
}
export interface RawSelectedField {
  entity_source_id: string;
  source_url: string;
  index: number;
  name: string;
  locator: string;
  text: string;
  evidence: Evidence;
}
export interface OperatorAsset extends CrawlAsset {
  operator_file?: OperatorFileReference;
  operator_bytes?: "VERIFIED";
}
export interface OperatorContentModel extends ContentModel {
  source_capture: {
    kind: "operator-capture";
    capture_id: string;
    manifest_sha256: string;
    source_version: string | null;
    state: "PARTIAL";
    source_access: "NOT_VERIFIED";
    full_source_denominator: "UNKNOWN";
    server_access_block_id: string | null;
    known_urls: number;
    observed_urls: number;
    selected_fields_urls: number;
    dom_observed_urls: number;
    missing_asset_urls: string[];
  };
  source_inventory: OperatorInventoryEntry[];
  raw_selected_fields: RawSelectedField[];
  assets: OperatorAsset[];
}

const ajv = new Ajv({ strict: true, allErrors: true });
const validateSelected = ajv.compile<SelectedDomObservation>(
  selectedDomObservationSchema,
);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const stableId = (kind: string, url: string) =>
  `${kind}_${hash(url).slice(0, 24)}`;
const fail = (code: string, message: string): never => {
  throw new OperatorExtractionError(code, message);
};
const textValue = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mediaExtension = /\.(?:png|jpe?g|gif|webp|avif|svg|pdf)(?:[?#]|$)/i;
const selectedFieldLabels = new Map([
  ["title", "Название"],
  ["availability", "Наличие на странице источника"],
  ["promotion", "Акция на странице источника"],
  ["description_excerpt", "Фрагмент описания"],
]);
function selectedFieldLabel(name: string): string {
  const known = selectedFieldLabels.get(name);
  if (known) return known;
  // Presentation only: canonical zero-based index, bounded by the 5000-field
  // observation contract. No price role (old/current/discount) is inferred.
  const price = /^displayed_price_(0|[1-9][0-9]{0,3})$/.exec(name);
  if (price && Number(price[1]) < 5000)
    return `Цена на странице источника (${Number(price[1]) + 1})`;
  return name;
}

const inactiveDom =
  'script,style,button,input,textarea,select,iframe,frame,object,embed,svg,math,template,noscript,[hidden],[aria-hidden="true"]';
const structuralTags = new Set([
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "address",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "details",
  "summary",
]);
const atomicTags = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "table",
  "blockquote",
]);
const isElement = (node: AnyNode): node is Element => "tagName" in node;
const explicitlyHiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;

function cleanPrimaryDom($: CheerioAPI, root: Element, bodyFallback = false) {
  const main = $(root);
  main.find(inactiveDom).remove();
  main.find("nav,aside").remove();
  if (bodyFallback) main.find("header,footer").remove();
  main.find("[style]").each((_i, node) => {
    if (explicitlyHiddenStyle.test($(node).attr("style") ?? ""))
      $(node).remove();
  });
  // Product/review copy may live inside a form. Preserve inert text, not fields or actions.
  main.find("form").each((_i, node) => {
    $(node).replaceWith($(node).contents());
  });
  return main;
}

/** The selector is an auditable heuristic, not proof that a page is complete. */
function primaryDom($: CheerioAPI) {
  const usable = (node: Element) => {
    if (
      $(node).is('[hidden],[aria-hidden="true"]') ||
      $(node).parents('[hidden],[aria-hidden="true"],nav,header,footer,aside')
        .length ||
      $(node)
        .parents("[style]")
        .add(node)
        .toArray()
        .some((parent) =>
          explicitlyHiddenStyle.test($(parent).attr("style") ?? ""),
        )
    )
      return false;
    // Inspect the same inert content that extraction will retain, without
    // changing original nodes used for source locators and metadata evidence.
    const retained = cleanPrimaryDom($, $(node).clone().get(0)!);
    return Boolean(retained.text().trim() || retained.find("img").length);
  };
  for (const selector of [
    "main",
    '[role="main"]',
    "#content",
    "#main",
    "#main-content",
  ]) {
    const candidates = $(selector)
      .toArray()
      .filter((node): node is Element => isElement(node) && usable(node));
    if (candidates.length === 1) return { node: $(candidates[0]), selector };
  }
  const articles = $("article")
    .toArray()
    .filter((node): node is Element => isElement(node) && usable(node));
  const pageHeading = $("body h1").first().get(0);
  if (
    articles.length === 1 &&
    (!pageHeading ||
      $(articles[0])
        .find("h1")
        .toArray()
        .includes(pageHeading as Element))
  )
    return { node: $(articles[0]), selector: "article" };
  return { node: $("body"), selector: "body" };
}

function originalLocators(root: Element): WeakMap<AnyNode, string> {
  const locators = new WeakMap<AnyNode, string>();
  const stack: Array<{ node: AnyNode; locator: string; depth: number }> = [
    { node: root, locator: root.tagName, depth: 0 },
  ];
  while (stack.length) {
    const { node, locator, depth } = stack.pop()!;
    if (depth > 200) fail("OPERATOR_LIMIT", "DOM nesting exceeds 200 levels");
    locators.set(node, locator);
    if (!("children" in node)) continue;
    const tags = new Map<string, number>();
    for (const [index, child] of node.children.entries()) {
      const tag = isElement(child) ? child.tagName : "text()";
      const order = (tags.get(tag) ?? 0) + 1;
      tags.set(tag, order);
      stack.push({
        node: child,
        locator: `${locator} > ${tag}${tag === "text()" ? `[${index}]` : `:nth-of-type(${order})`}`,
        depth: depth + 1,
      });
    }
  }
  return locators;
}

/** Restrict observations used as target navigation; exact accepted source identities are never rewritten. */
function navigationTarget(
  raw: string,
  documentUrl: string,
  origin: string,
): string | undefined {
  if (!raw.trim() || raw.startsWith("#") || /[\u0000-\u0020\\]/.test(raw))
    return;
  try {
    const identity = identifyUrl(raw, documentUrl);
    if (identity.origin !== origin || mediaExtension.test(identity.raw_url))
      return;
    const url = new URL(identity.raw_url);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      /(?:^|\/)(?:cart|checkout|payment|payments|order|orders|login|logout|register|account|wishlist|compare|admin|bitrix|local|api|add|remove|delete)(?:[/.]|$)/i.test(
        decodedPath,
      )
    )
      return;
    for (const [key, value] of url.searchParams) {
      if (
        /^(?:action|do|act|add|remove|delete|submit|checkout|logout|login|payment|order|quantity|cart|token|sessid|csrf|csrf_token)$/i.test(
          key,
        )
      )
        return;
      if (
        key.toLowerCase() === "route" &&
        /(?:^|\/)(?:account|checkout|payment|api|tool|cart|compare|wishlist)(?:\/|$)/i.test(
          value,
        )
      )
        return;
    }
    return identity.request_target;
  } catch {
    return;
  }
}

function safeRelativePath(value: string) {
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
    fail("OPERATOR_FILE", "Expected a portable relative artifact path");
}
function signatureMatches(bytes: Uint8Array, mime: string) {
  const body = Buffer.from(bytes);
  if (mime === "image/png")
    return body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return body[0] === 255 && body[1] === 216 && body[2] === 255;
  if (mime === "image/gif")
    return ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"));
  if (mime === "image/webp")
    return (
      body.subarray(0, 4).toString("ascii") === "RIFF" &&
      body.subarray(8, 12).toString("ascii") === "WEBP"
    );
  return (
    mime === "application/pdf" &&
    body.subarray(0, 5).toString("ascii") === "%PDF-"
  );
}
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("OPERATOR_FORMAT", "Expected valid UTF-8 observation bytes");
  }
}

interface StructuredCandidate {
  value: Record<string, unknown>;
  type: ContentEntity["type"];
  locator: string;
}
function structuredCandidates(
  raw: string,
  locator: string,
  documentUrl: string,
  baseUrl = documentUrl,
): StructuredCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const candidates: StructuredCandidate[] = [];
  let count = 0;
  const visit = (
    value: unknown,
    context: boolean,
    depth: number,
    location: string,
  ) => {
    if (++count > 1000 || depth > 8)
      fail("OPERATOR_LIMIT", "Structured data nesting or node budget exceeded");
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, context, depth + 1, `${location}[${index}]`),
      );
      return;
    }
    const object = record(value);
    const schemaContext =
      object["@context"] === undefined
        ? context
        : /^https?:\/\/schema\.org\/?$/i.test(
            textValue(object["@context"]) ?? "",
          );
    const types = Array.isArray(object["@type"])
      ? object["@type"]
      : [object["@type"]];
    const classified = new Set<ContentEntity["type"]>();
    if (types.includes("Product")) classified.add("Product");
    if (
      types.some((type) =>
        ["Article", "BlogPosting", "NewsArticle"].includes(String(type)),
      )
    )
      classified.add("Article");
    if (types.includes("Service")) classified.add("Service");
    const binding = textValue(object.url) ?? textValue(object["@id"]);
    let bound = false;
    if (binding) {
      try {
        bound =
          identifyUrl(binding, baseUrl).crawl_key ===
          identifyUrl(documentUrl).crawl_key;
      } catch {
        /* Invalid source data never changes scope. */
      }
    }
    if (schemaContext && bound && classified.size === 1)
      candidates.push({
        value: object,
        type: [...classified][0],
        locator: location,
      });
    if (object["@graph"] !== undefined)
      visit(object["@graph"], schemaContext, depth + 1, `${location}.@graph`);
  };
  visit(parsed, false, 0, locator);
  return candidates;
}

/** Pure transformation: all I/O is supplied by a trusted byte resolver; no CrawlResult or access override is created. */
export async function extractOperatorContent(
  capture: ValidatedOperatorCapture,
  options: OperatorExtractionOptions,
): Promise<OperatorContentModel> {
  if (
    capture.schema_version !== 1 ||
    capture.kind !== "validated-operator-capture" ||
    capture.state !== "PARTIAL" ||
    capture.source_access !== "NOT_VERIFIED" ||
    capture.trust !== "untrusted-source-data" ||
    capture.readiness !== "NOT_EVALUATED" ||
    capture.coverage.full_source_denominator !== "UNKNOWN"
  )
    fail(
      "OPERATOR_CAPTURE",
      "A validated partial operator capture is required",
    );
  if (
    options.projectId !== undefined &&
    options.projectId !== capture.project_id
  )
    fail("OPERATOR_PROJECT", "Capture cannot be relabeled as another project");
  if (!/^[a-f0-9]{64}$/.test(capture.manifest_sha256))
    fail("OPERATOR_CAPTURE", "Accepted manifest SHA-256 is missing");
  if (
    capture.observations.length > OPERATOR_CAPTURE_LIMITS.observations ||
    capture.assets.length > OPERATOR_CAPTURE_LIMITS.assets ||
    capture.inventory.length > OPERATOR_CAPTURE_LIMITS.inventoryUrls ||
    capture.files.length !==
      capture.observations.length + capture.assets.length ||
    capture.unverified_asset_urls.length >
      OPERATOR_CAPTURE_LIMITS.inventoryUrls + OPERATOR_CAPTURE_LIMITS.assets
  )
    fail("OPERATOR_LIMIT", "Capture metadata exceeds the operator limits");
  const sourceOrigin = identifyUrl(capture.source_origin).origin;
  if (sourceOrigin !== capture.source_origin)
    fail("OPERATOR_CAPTURE", "Expected the exact source origin");
  const sameOrigin = (raw: string) => {
    const value = identifyUrl(raw);
    if (value.origin !== sourceOrigin)
      fail(
        "OPERATOR_ORIGIN",
        "Observation or declared asset origin differs from the capture",
      );
    return value;
  };
  const inventory = new Set<string>();
  for (const item of capture.inventory) {
    const identity = sameOrigin(item.crawl_key);
    if (
      inventory.has(identity.crawl_key) ||
      item.request_target !== identity.request_target ||
      item.raw_urls.some(
        (raw) => sameOrigin(raw).crawl_key !== identity.crawl_key,
      )
    )
      fail("OPERATOR_CAPTURE", "Source inventory identity is inconsistent");
    inventory.add(identity.crawl_key);
  }
  const fileReferences = new Map<string, OperatorFileReference>();
  let declaredBytes = 0;
  for (const file of capture.files) {
    safeRelativePath(file.relative_path);
    if (
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 1 ||
      file.size_bytes > OPERATOR_CAPTURE_LIMITS.fileBytes ||
      fileReferences.has(file.relative_path)
    )
      fail("OPERATOR_FILE", "Invalid or duplicate accepted file reference");
    declaredBytes += file.size_bytes;
    if (declaredBytes > OPERATOR_CAPTURE_LIMITS.totalBytes)
      fail("OPERATOR_LIMIT", "Accepted file byte budget exceeded");
    fileReferences.set(file.relative_path, file);
  }
  const readVerified = async (
    file: OperatorFileReference,
  ): Promise<Uint8Array> => {
    safeRelativePath(file.relative_path);
    const accepted = fileReferences.get(file.relative_path);
    if (
      !accepted ||
      accepted.sha256 !== file.sha256 ||
      accepted.size_bytes !== file.size_bytes
    )
      fail(
        "OPERATOR_FILE",
        "Observation file is not bound to the validated capture file registry",
      );
    let raw: Uint8Array;
    try {
      raw = await options.readFile(file.relative_path);
    } catch {
      return fail(
        "OPERATOR_FILE_MISSING",
        `Accepted artifact bytes unavailable: ${file.relative_path}`,
      );
    }
    if (!(raw instanceof Uint8Array))
      fail("OPERATOR_FILE", "Byte resolver must return Uint8Array or Buffer");
    if (raw.byteLength !== file.size_bytes || hash(raw) !== file.sha256)
      fail(
        "OPERATOR_HASH",
        `Accepted artifact size or SHA-256 mismatch: ${file.relative_path}`,
      );
    return Buffer.from(raw);
  };
  const limitations = new Set<string>([
    "PARTIAL operator observations only; the full source URL denominator remains UNKNOWN and server HTTP access is NOT_VERIFIED.",
    "Verbatim prices and availability are observations, not executable commerce data; no normalized prices, stock, orders or payments are inferred.",
    "Source facts, HTML and operator labels remain untrusted data; byte integrity is not independent confirmation of their truth.",
  ]);
  const model: OperatorContentModel = {
    schema_version: 1,
    project_id: capture.project_id,
    source_origin: sourceOrigin,
    entities: [],
    offers: [],
    prices: [],
    assets: [],
    features: [],
    limitations: [],
    content_requirements: {
      schema_version: 1,
      types: {
        Page: {
          required: ["source_id", "source_url", "title", "blocks", "evidence"],
          conditional: ["observed-fields", "verified-local-media"],
        },
        Product: {
          required: ["source_id", "source_url", "title", "evidence"],
          conditional: [
            "unambiguous-schema-org-type",
            "commerce-requires-separate-reviewed-mapping",
          ],
        },
        Article: {
          required: ["source_id", "source_url", "title", "blocks", "evidence"],
          conditional: ["observed-metadata"],
        },
        Service: {
          required: ["source_id", "source_url", "title", "blocks", "evidence"],
          conditional: ["observed-metadata"],
        },
      },
      comparison:
        "Compare typed output and raw selected fields with accepted immutable bytes; incomplete observations never prove absent source facts or full site coverage.",
    },
    source_capture: {
      kind: "operator-capture",
      capture_id: capture.capture_id,
      manifest_sha256: capture.manifest_sha256,
      source_version: options.sourceVersion ?? null,
      state: "PARTIAL",
      source_access: "NOT_VERIFIED",
      full_source_denominator: "UNKNOWN",
      server_access_block_id: capture.server_access_block_id,
      known_urls: capture.inventory.length,
      observed_urls: capture.observations.length,
      selected_fields_urls: capture.observations.filter(
        (item) => item.format === "selected-fields-json",
      ).length,
      dom_observed_urls: capture.observations.filter(
        (item) => item.format === "dom-html",
      ).length,
      missing_asset_urls: [],
    },
    source_inventory: structuredClone(capture.inventory),
    raw_selected_fields: [],
  };
  const assets = new Map<string, OperatorAsset>();
  for (const item of capture.assets) {
    const url = sameOrigin(item.source_url).crawl_key;
    if (
      assets.has(url) ||
      item.observed_on_urls.some(
        (page) => !inventory.has(sameOrigin(page).crawl_key),
      )
    )
      fail(
        "OPERATOR_CAPTURE",
        "Asset URL or its observation provenance is inconsistent",
      );
    const bytes = await readVerified(item.file);
    if (detectAccessChallenge(Buffer.from(bytes)))
      fail(
        "OPERATOR_CHALLENGE",
        "Known access challenge supplied as asset bytes",
      );
    if (!signatureMatches(bytes, item.mime))
      fail(
        "OPERATOR_MIME",
        "Accepted asset bytes do not match the allowlisted MIME signature",
      );
    const local = options.mediaPath?.(item.file.relative_path);
    if (
      local !== undefined &&
      (!path.isAbsolute(local) || /^https?:/i.test(local))
    )
      fail(
        "OPERATOR_FILE",
        "Materialized media path must be an absolute local path supplied by the caller",
      );
    const asset: OperatorAsset = {
      source_url: url,
      discovered_from: [...item.observed_on_urls],
      status: local ? "FETCHED" : "DISCOVERED",
      mime: item.mime,
      sha256: item.file.sha256,
      size_bytes: item.file.size_bytes,
      operator_file: { ...item.file },
      operator_bytes: "VERIFIED",
      ...(local
        ? { body_path: local }
        : {
            reason:
              "Accepted artifact bytes verified; local materialization path not supplied",
          }),
    };
    assets.set(url, asset);
    model.assets.push(asset);
  }
  const missing = new Set<string>();
  const mediaFor = (raw: string, sourceUrl: string, baseUrl: string) => {
    if (!raw.trim()) {
      limitations.add(
        `Missing source media address at ${sourceUrl}; no image URL is inferred from the document or base URL.`,
      );
      return undefined;
    }
    let identity;
    try {
      identity = identifyUrl(raw, baseUrl);
    } catch {
      limitations.add(
        `Unsupported embedded or invalid media reference at ${sourceUrl}`,
      );
      return undefined;
    }
    if (identity.origin !== sourceOrigin) {
      limitations.add(`External media was not copied: ${identity.crawl_key}`);
      return undefined;
    }
    let asset = assets.get(identity.crawl_key);
    if (!asset) {
      asset = {
        source_url: identity.crawl_key,
        discovered_from: [sourceUrl],
        status: "DISCOVERED",
        reason: "Observed media lacks accepted immutable file bytes",
      };
      assets.set(identity.crawl_key, asset);
      model.assets.push(asset);
      missing.add(identity.crawl_key);
    } else if (!asset.discovered_from.includes(sourceUrl))
      asset.discovered_from.push(sourceUrl);
    return asset;
  };
  const observedPages = new Set<string>();
  for (const observation of capture.observations) {
    const identity = sameOrigin(observation.source_url);
    const document = sameOrigin(observation.document_url);
    if (
      !inventory.has(identity.crawl_key) ||
      !inventory.has(document.crawl_key) ||
      observedPages.has(identity.crawl_key)
    )
      fail(
        "OPERATOR_CAPTURE",
        "Observation is missing from source denominator or duplicated",
      );
    observedPages.add(identity.crawl_key);
    const bytes = await readVerified(observation.file);
    const evidence = (locator: string): Evidence => ({
      source_url: observation.document_url,
      observed_at: observation.observed_at,
      locator,
      snapshot_sha256: observation.file.sha256,
      trust: "untrusted-source-data",
    });
    const fact = <T>(
      value: T | null,
      locator: string,
      confidence: Fact["confidence"] = "medium",
    ): Fact<T> => ({
      value,
      status: value === null ? "UNKNOWN" : "OBSERVED",
      confidence: value === null ? "low" : confidence,
      evidence: evidence(locator),
    });
    const entity: ContentEntity = {
      source_id: stableId("operator_entity", identity.crawl_key),
      type: "Page",
      page_type: "operator-partial",
      source_url: identity.crawl_key,
      title: "",
      description: "",
      blocks: [],
      sanitized_html: "",
      seo: {
        title: "",
        description: "",
        h1: null,
        canonical_url: null,
        language: null,
      },
      facts: {
        name: fact(null, "partial observation; name not established"),
        description: fact(
          null,
          "partial observation; full description not established",
        ),
        sku: fact(null, "partial observation; SKU not established"),
        price: fact(null, "commerce interpretation is not performed"),
        availability: fact(
          null,
          "stock/availability interpretation is not performed",
        ),
      },
      evidence: [evidence(`operator:${observation.format}`)],
      assets: [],
    };
    let documentBaseUrl = document.crawl_key;
    const observeMedia = (raw: string) => {
      const asset = mediaFor(raw, identity.crawl_key, documentBaseUrl);
      if (!asset) return;
      if (!entity.assets.includes(asset.source_url))
        entity.assets.push(asset.source_url);
      return asset;
    };
    const attachMedia = (raw: string, alt = "", locator?: string) => {
      const asset = observeMedia(raw);
      if (!asset) return;
      if (asset.operator_bytes === "VERIFIED" && asset.sha256)
        entity.blocks.push({
          type: asset.mime === "application/pdf" ? "document" : "image",
          source_url: asset.source_url,
          asset_sha256: asset.sha256,
          alt,
          ...(asset.mime === "application/pdf" ? { text: alt } : {}),
        });
      if (locator) entity.evidence.push(evidence(locator));
    };
    if (observation.format === "selected-fields-json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(decode(bytes));
      } catch {
        return fail(
          "OPERATOR_FORMAT",
          "Selected fields must be valid UTF-8 JSON",
        );
      }
      if (!validateSelected(parsed))
        fail("OPERATOR_FORMAT", ajv.errorsText(validateSelected.errors));
      const selected = parsed as SelectedDomObservation;
      if (sameOrigin(selected.source_url).crawl_key !== identity.crawl_key)
        fail(
          "OPERATOR_CAPTURE",
          "Selected fields URL differs from its accepted observation",
        );
      if (
        detectAccessChallenge(
          `<title>${escapeText(selected.document_title)}</title>`,
        )
      )
        fail(
          "OPERATOR_CHALLENGE",
          "Known access challenge in selected observation",
        );
      entity.title = selected.document_title;
      entity.seo.title = selected.document_title;
      const headings = selected.fields.filter(
        (field) => field.locator.trim().toLowerCase() === "h1",
      );
      if (headings.length === 1) {
        entity.seo.h1 = headings[0].text;
        entity.facts.name = fact(
          headings[0].text,
          `selected.fields[${selected.fields.indexOf(headings[0])}] (${headings[0].locator})`,
        );
        if (!entity.title) entity.title = headings[0].text;
      }
      if (selected.fields.length)
        entity.blocks.push({
          type: "table",
          rows: selected.fields.map((field) => [
            selectedFieldLabel(field.name),
            field.text,
          ]),
        });
      selected.fields.forEach((field, index) => {
        const locator = `selected.fields[${index}] (${field.locator})`;
        entity.facts[`operator_field:${index}`] = fact(field.text, locator);
        model.raw_selected_fields.push({
          entity_source_id: entity.source_id,
          source_url: observation.document_url,
          index,
          ...field,
          evidence: evidence(locator),
        });
      });
      for (const media of selected.asset_urls) attachMedia(media);
      limitations.add(
        `Selected fields at ${identity.crawl_key} are not a full DOM, product schema or complete page; no HTML snapshot is synthesized.`,
      );
    } else if (observation.format === "dom-html") {
      const html = decode(bytes);
      if (!isHtmlResponse(html))
        fail(
          "OPERATOR_FORMAT",
          "DOM evidence must be HTML, not selected JSON or text",
        );
      if (detectAccessChallenge(html))
        fail("OPERATOR_CHALLENGE", "Known access challenge in DOM evidence");
      const $ = load(html);
      const baseHref = $("base[href]").first().attr("href");
      if (baseHref) {
        entity.facts["dom:base_href"] = fact(baseHref, "base[href]:first@href");
        try {
          documentBaseUrl = identifyUrl(baseHref, document.crawl_key).raw_url;
        } catch {
          fail(
            "OPERATOR_FORMAT",
            "Unsupported or invalid DOM base URL requires review",
          );
        }
        if (identifyUrl(documentBaseUrl).origin !== sourceOrigin)
          limitations.add(
            `External DOM base at ${identity.crawl_key}; relative navigation/media cannot become local content.`,
          );
      }
      const primaryCandidates: StructuredCandidate[] = [];
      $('script[type="application/ld+json"]').each((index, node) => {
        const raw = $(node).text();
        const locator = `script[type="application/ld+json"][${index}]`;
        entity.facts[`operator_jsonld:${index}`] = fact(raw, locator);
        primaryCandidates.push(
          ...structuredCandidates(
            raw,
            locator,
            document.crawl_key,
            documentBaseUrl,
          ),
        );
      });
      const primary =
        primaryCandidates.length === 1 ? primaryCandidates[0] : undefined;
      if (primary) {
        entity.type = primary.type;
        entity.page_type = `operator-partial-${primary.type.toLowerCase()}`;
        entity.facts["source_declared_type"] = fact(
          primary.type,
          `${primary.locator}.@type`,
        );
        if (typeof primary.value.sku === "string")
          entity.facts.sku = fact(primary.value.sku, `${primary.locator}.sku`);
        if (typeof primary.value.name === "string")
          entity.facts.name = fact(
            primary.value.name,
            `${primary.locator}.name`,
          );
      } else if (primaryCandidates.length > 1)
        limitations.add(
          `Ambiguous page-bound structured types at ${identity.crawl_key}; entity remains Page.`,
        );
      const title = $("title").first().text();
      const description =
        $('meta[name="description"]').first().attr("content") ?? "";
      const siteNames = $('meta[property="og:site_name"]')
        .toArray()
        .map((node) => $(node).attr("content"))
        .filter((value): value is string => Boolean(value?.trim()));
      if (new Set(siteNames).size === 1)
        entity.facts["dom:site_name"] = fact(
          siteNames[0],
          'meta[property="og:site_name"]@content',
        );
      if (document.request_target === "/") {
        const navigation: Array<{ label: string; request_target: string }> = [];
        const navigationPairs = new Set<string>();
        $('header nav a[href],[role="banner"] nav a[href]').each(
          (_i, anchor) => {
            const node = $(anchor);
            if (
              Object.keys(anchor.attribs).some((name) => /^on/i.test(name)) ||
              node.is(
                '[role="button"],[data-cart],[data-action],[hidden],[aria-hidden="true"]',
              ) ||
              node.parents('[hidden],[aria-hidden="true"],template,noscript')
                .length ||
              node
                .parents("[style]")
                .add(anchor)
                .toArray()
                .some((parent) =>
                  explicitlyHiddenStyle.test($(parent).attr("style") ?? ""),
                )
            )
              return;
            const target = navigationTarget(
              node.attr("href")!,
              documentBaseUrl,
              sourceOrigin,
            );
            if (!target) return;
            const label = cleanPrimaryDom($, node.clone().get(0)!).text();
            if (!label.trim()) return;
            const key = JSON.stringify([label, target]);
            if (navigationPairs.has(key)) return;
            navigationPairs.add(key);
            navigation.push({ label, request_target: target });
          },
        );
        if (navigation.length)
          entity.facts["dom:primary_navigation"] = fact(
            navigation,
            "homepage header nav/[role=banner] nav a[href] inert textContent and same-origin safe request target",
          );
        const images = $('meta[property="og:image"]')
          .toArray()
          .map((node) => $(node).attr("content"))
          .filter((value): value is string => Boolean(value));
        const expected = new Set<string>();
        for (const raw of images) {
          try {
            const image = identifyUrl(raw, documentBaseUrl);
            if (image.origin === sourceOrigin) expected.add(image.crawl_key);
          } catch {
            /* Untrusted metadata cannot authorize external content. */
          }
        }
        const alts: string[] = [];
        if (expected.size === 1)
          $('header a[href] img,[role="banner"] a[href] img').each(
            (_i, image) => {
              const anchor = $(image).closest("a"),
                href = anchor.attr("href") ?? "",
                alt = $(image).attr("alt") ?? "";
              if (!alt.trim() || href.startsWith("#")) return;
              try {
                const home = identifyUrl(href, documentBaseUrl),
                  src = identifyUrl(
                    $(image).attr("src") ?? "",
                    documentBaseUrl,
                  );
                if (
                  home.origin === sourceOrigin &&
                  home.request_target === "/" &&
                  !home.fragment &&
                  expected.has(src.crawl_key)
                )
                  alts.push(alt);
              } catch {
                /* Invalid source URL remains untrusted text. */
              }
            },
          );
        if (new Set(alts).size === 1)
          entity.facts["dom:home_logo_alt"] = fact(
            alts[0],
            'header/[role=banner] root link img@alt with src matching the unique same-origin meta[property="og:image"]',
          );
      }
      const canonical = $('link[rel="canonical"]').first().attr("href");
      if (canonical) {
        entity.facts["dom:canonical"] = fact(
          canonical,
          "link[rel=canonical]@href",
        );
        try {
          const target = identifyUrl(canonical, documentBaseUrl);
          if (target.origin === sourceOrigin)
            entity.seo.canonical_url = target.raw_url;
          else
            limitations.add(
              `External canonical requires review: ${identity.crawl_key}`,
            );
        } catch {
          limitations.add(
            `Invalid canonical requires review: ${identity.crawl_key}`,
          );
        }
      }
      const detected: [string, string][] = [];
      if ($("form").length)
        detected.push([
          "form",
          `${$("form").length} source form(s) observed; no submission or target implementation`,
        ]);
      if ($('input[type="search"],form[role="search"]').length)
        detected.push([
          "search",
          "Source search controls observed; behavior unverified",
        ]);
      if ($('[data-cart],button[name="add_to_cart"],a[href*="cart"]').length)
        detected.push([
          "cart",
          "Source cart controls observed; behavior unverified",
        ]);
      for (const [type, observationText] of detected)
        model.features.push({
          source_id: stableId(
            "operator_feature",
            `${identity.crawl_key}:${type}`,
          ),
          source_url: identity.crawl_key,
          type,
          observation: observationText,
          status: "UNVERIFIED",
          source_evidence: evidence(`DOM:${type}`),
          target_implementation: null,
          test: null,
        });
      const chosen = primaryDom($),
        main = chosen.node;
      const mainElement = main.get(0);
      if (!mainElement || !isElement(mainElement))
        throw new OperatorExtractionError(
          "OPERATOR_FORMAT",
          "HTML has no primary content root",
        );
      const sourceLocators = originalLocators(mainElement);
      const locator = (node: AnyNode) =>
        `${chosen.selector}: ${sourceLocators.get(node) ?? "source descendant"}`;
      entity.facts["dom:primary_content"] = fact(
        chosen.selector,
        `${chosen.selector} selected by landmark heuristic`,
      );
      limitations.add(
        `Primary content at ${identity.crawl_key} uses ${chosen.selector}; this is a DOM heuristic, not computed visibility or complete-page coverage.`,
      );
      cleanPrimaryDom($, mainElement, chosen.selector === "body");
      const missingImageSources = main
        .find("img")
        .toArray()
        .filter((image) => !($(image).attr("src") ?? "").trim())
        .map((image) => ({
          raw_src: $(image).attr("src") ?? null,
          alt: $(image).attr("alt") ?? "",
          locator: locator(image) + "@src",
        }));
      if (missingImageSources.length) {
        entity.facts["dom:missing_image_sources"] = fact(
          missingImageSources,
          `${chosen.selector} img with absent or blank src; image URL and content not established`,
        );
        limitations.add(
          `Missing source image address at ${identity.crawl_key}; ${missingImageSources.length} image(s) have absent or blank src, with no replacement inferred.`,
        );
      }
      entity.facts["dom:visible_text"] = fact(
        main.text(),
        `${chosen.selector} textContent after inactive/explicitly hidden content removal; computed CSS visibility unknown`,
      );
      const h1 = main.find("h1").first().text() || null;
      entity.title = title || h1 || textValue(primary?.value.name) || "";
      entity.description = description;
      entity.seo = {
        ...entity.seo,
        title,
        description,
        h1,
        language: $("html").attr("lang") ?? null,
      };
      if (h1) {
        entity.facts["dom:h1"] = fact(
          h1,
          locator(main.find("h1").first().get(0)!),
        );
        if (entity.facts.name.value === null)
          entity.facts.name = fact(
            h1,
            locator(main.find("h1").first().get(0)!),
          );
      }
      if (description)
        entity.facts.description = fact(
          description,
          "meta[name=description]@content",
        );
      type ObservedLink = {
        label: string;
        raw_href: string;
        request_target: string;
        locator: string;
        image_source_url?: string;
        image_asset_sha256?: string;
      };
      const observedLinks: ObservedLink[] = [],
        linkByNode = new WeakMap<Element, ObservedLink>();
      main.find("a[href]").each((_i, node) => {
        if (
          Object.keys(node.attribs).some((name) => /^on/i.test(name)) ||
          $(node).is('[role="button"],[data-cart],[data-action]')
        )
          return;
        const target = navigationTarget(
          $(node).attr("href")!,
          documentBaseUrl,
          sourceOrigin,
        );
        if (
          !target ||
          assets.has(
            identifyUrl($(node).attr("href")!, documentBaseUrl).crawl_key,
          )
        )
          return;
        const images = $(node).find("img").toArray(),
          rawLabel = $(node).text();
        const label = rawLabel.trim()
          ? rawLabel
          : images.length === 1
            ? ($(images[0]).attr("alt") ?? "")
            : "";
        const link: ObservedLink = {
          label,
          raw_href: $(node).attr("href")!,
          request_target: target,
          locator:
            locator(node) + (rawLabel.trim() ? " textContent" : " img@alt"),
        };
        if (images.length === 1) {
          const asset = observeMedia($(images[0]).attr("src") ?? "");
          if (asset) {
            link.image_source_url = asset.source_url;
            if (
              asset.operator_bytes === "VERIFIED" &&
              asset.mime?.startsWith("image/")
            )
              link.image_asset_sha256 = asset.sha256;
          }
        }
        observedLinks.push(link);
        linkByNode.set(node, link);
      });
      entity.facts["dom:links"] = fact(
        observedLinks,
        `${chosen.selector} a[href]; observed labels/targets, never implementation of source actions`,
      );
      type ObservedCard = ObservedLink & { items: string[] };
      const cardsByNode = new WeakMap<Element, ObservedCard>(),
        observedCards: ObservedCard[] = [];
      const cardCandidate = (element: Element): ObservedCard | undefined => {
        const headings = $(element)
          .find(
            "h1 a[href],h2 a[href],h3 a[href],h4 a[href],h5 a[href],h6 a[href]",
          )
          .toArray();
        const links = headings
          .map((node) => linkByNode.get(node))
          .filter((link): link is ObservedLink => Boolean(link));
        if (headings.length !== 1 || links.length !== 1) return;
        const link = links[0];
        if (!link.label.trim()) return;
        const images = $(element)
          .find("a[href] img")
          .toArray()
          .filter((image) => {
            const anchor = $(image).closest("a").get(0);
            return (
              anchor &&
              isElement(anchor) &&
              linkByNode.get(anchor)?.request_target === link.request_target
            );
          });
        const imageUrls = new Set(
          images.map((image) => $(image).attr("src")).filter(Boolean),
        );
        if (!images.length || imageUrls.size !== 1) return;
        const card: ObservedCard = {
          ...link,
          locator: locator(element),
          items: [],
        };
        const asset = observeMedia($(images[0]).attr("src") ?? "");
        if (asset) {
          card.image_source_url = asset.source_url;
          if (
            asset.operator_bytes === "VERIFIED" &&
            asset.mime?.startsWith("image/")
          )
            card.image_asset_sha256 = asset.sha256;
        }
        const copy = $(element).clone();
        copy.find("h1,h2,h3,h4,h5,h6,img").remove();
        copy.find("a").each((_i, anchor) => {
          if (
            /^(?:купить|в\s+корзину|добавить\s+в\s+корзину|заказать|buy|add\s+to\s+cart|order)$/i.test(
              $(anchor).text().trim(),
            )
          )
            $(anchor).remove();
        });
        const chunks = (node: Element, depth = 0) => {
          if (depth > 200)
            fail("OPERATOR_LIMIT", "DOM nesting exceeds 200 levels");
          if (atomicTags.has(node.tagName) || node.tagName === "li") {
            const value = $(node).text().trim();
            if (value) card.items.push(value);
            return;
          }
          let inline = "";
          const flush = () => {
            if (inline.trim()) card.items.push(inline.trim());
            inline = "";
          };
          for (const child of node.children) {
            if (child.type === "text") inline += child.data;
            else if (isElement(child)) {
              if (child.tagName === "br") inline += "\n";
              else if (
                structuralTags.has(child.tagName) ||
                atomicTags.has(child.tagName) ||
                $(child).find([...structuralTags, ...atomicTags].join(","))
                  .length
              ) {
                flush();
                chunks(child, depth + 1);
              } else inline += $(child).text();
            }
          }
          flush();
        };
        const copyRoot = copy.get(0);
        if (copyRoot && isElement(copyRoot)) chunks(copyRoot);
        return card;
      };
      // Repeated sibling structure, not a CMS class or hostname, establishes grouping.
      main
        .find("*")
        .add(main)
        .each((_i, parent) => {
          const candidates = $(parent)
            .children()
            .toArray()
            .filter(isElement)
            .map((node) => ({ node, card: cardCandidate(node) }))
            .filter((entry): entry is { node: Element; card: ObservedCard } =>
              Boolean(entry.card),
            );
          const groups = new Map<string, typeof candidates>();
          for (const item of candidates) {
            const signature =
              item.node.tagName +
              ":" +
              $(item.node)
                .children()
                .toArray()
                .filter(isElement)
                .map((node) => node.tagName)
                .join(",");
            const group = groups.get(signature) ?? [];
            group.push(item);
            groups.set(signature, group);
          }
          for (const group of groups.values())
            if (group.length >= 2)
              for (const { node, card } of group) {
                cardsByNode.set(node, card);
                observedCards.push(card);
              }
        });
      if (observedCards.length)
        entity.facts["dom:cards"] = fact(
          observedCards,
          `${chosen.selector} repeated sibling containers with one heading link and a matching linked image; observed presentation only`,
        );
      const emittedLinks = new Set<string>();
      const emittedCards = new Set<string>();
      const emit = (block: ContentBlock, source: AnyNode) => {
        if (entity.blocks.length >= 10000)
          fail("OPERATOR_LIMIT", "DOM content exceeds 10000 blocks");
        entity.blocks.push(block);
        entity.evidence.push(evidence(locator(source)));
      };
      const emitLink = (node: Element) => {
        const link = linkByNode.get(node);
        if (!link || !link.label.trim()) return false;
        const key = JSON.stringify([link.request_target, link.label.trim()]);
        if (!emittedLinks.has(key)) {
          emit(
            {
              type: "link",
              text: link.label.trim(),
              request_target: link.request_target,
              ...(link.image_asset_sha256
                ? {
                    asset_sha256: link.image_asset_sha256,
                    alt: link.label.trim(),
                  }
                : {}),
            },
            node,
          );
          emittedLinks.add(key);
        }
        return true;
      };
      const nestedMedia = (node: Element) => {
        $(node)
          .find("a[href],img")
          .each((_i, child) => {
            if (child.tagName === "a") {
              if (
                !emitLink(child) &&
                /\.pdf(?:[?#]|$)/i.test($(child).attr("href") ?? "")
              )
                attachMedia(
                  $(child).attr("href")!,
                  $(child).text().trim(),
                  locator(child),
                );
            } else if (
              !$(child)
                .parents("a")
                .toArray()
                .some((parent) => Boolean(linkByNode.get(parent)?.label.trim()))
            )
              attachMedia(
                $(child).attr("src") ?? "",
                $(child).attr("alt") ?? "",
                locator(child),
              );
          });
      };
      const descendants = [
        ...structuralTags,
        ...atomicTags,
        "img",
        "a[href]",
      ].join(",");
      const walk = (element: Element, depth = 0) => {
        if (depth > 200)
          fail("OPERATOR_LIMIT", "DOM nesting exceeds 200 levels");
        const node = $(element),
          tag = element.tagName,
          text = node.text().trim();
        const card = cardsByNode.get(element);
        if (card) {
          const block: ContentBlock = {
            type: "card",
            text: card.label.trim(),
            request_target: card.request_target,
            items: card.items,
            ...(card.image_asset_sha256
              ? {
                  asset_sha256: card.image_asset_sha256,
                  alt: card.label.trim(),
                }
              : {}),
          };
          const key = JSON.stringify(block);
          if (!emittedCards.has(key)) {
            emit(block, element);
            emittedCards.add(key);
          }
          return;
        }
        if (tag === "a" && emitLink(element)) return;
        if (tag === "a" && /\.pdf(?:[?#]|$)/i.test(node.attr("href") ?? "")) {
          attachMedia(node.attr("href")!, text, locator(element));
          return;
        }
        if (tag === "img") {
          attachMedia(
            node.attr("src") ?? "",
            node.attr("alt") ?? "",
            locator(element),
          );
          return;
        }
        if (atomicTags.has(tag)) {
          const links = node.find("a[href]").toArray();
          if (
            (/^h[1-6]$/.test(tag) || tag === "p") &&
            links.length === 1 &&
            linkByNode.has(links[0]) &&
            text === node.find("a[href]").text().trim()
          ) {
            emitLink(links[0]);
            return;
          }
          if (/^h[1-6]$/.test(tag) && text)
            emit({ type: "heading", level: Number(tag[1]), text }, element);
          else if (tag === "p" && text)
            emit({ type: "paragraph", text }, element);
          else if (tag === "blockquote" && text)
            emit({ type: "quote", text }, element);
          else if (tag === "ul" || tag === "ol")
            emit(
              {
                type: "list",
                items: node
                  .children("li")
                  .map((_i, item) => $(item).text().trim())
                  .get(),
              },
              element,
            );
          else if (tag === "table")
            emit(
              {
                type: "table",
                rows: node
                  .find("tr")
                  .toArray()
                  .filter((row) => $(row).closest("table").get(0) === element)
                  .map((row) =>
                    $(row)
                      .children("th,td")
                      .toArray()
                      .map((cell) => $(cell).text().trim()),
                  ),
              },
              element,
            );
          nestedMedia(element);
          return;
        }
        let inline = "";
        const flush = () => {
          if (inline.trim())
            emit({ type: "paragraph", text: inline.trim() }, element);
          inline = "";
        };
        for (const child of element.children) {
          if (child.type === "text") inline += child.data;
          else if (isElement(child)) {
            if (child.tagName === "br") inline += "\n";
            else if (
              !atomicTags.has(child.tagName) &&
              !structuralTags.has(child.tagName) &&
              child.tagName !== "img" &&
              !(child.tagName === "a" && child.attribs.href) &&
              !$(child).find(descendants).length
            )
              inline += $(child).text();
            else {
              flush();
              walk(child, depth + 1);
            }
          }
        }
        flush();
      };
      walk(mainElement);
      main.find("a[href]").each((_index, node) => {
        const href = $(node).attr("href")!;
        try {
          const target = identifyUrl(href, documentBaseUrl);
          if (
            mediaExtension.test(target.raw_url) ||
            assets.has(target.crawl_key)
          )
            $(node).removeAttr("href");
          else if (linkByNode.has(node))
            $(node).attr("href", linkByNode.get(node)!.request_target);
          else if (!href.startsWith("#")) $(node).removeAttr("href");
        } catch {
          $(node).removeAttr("href");
        }
      });
      entity.sanitized_html = sanitizeHtml(main.html() ?? "");
    } else fail("OPERATOR_FORMAT", "Unsupported operator observation format");
    if (!entity.title)
      limitations.add(`Required title remains unknown: ${identity.crawl_key}`);
    if (!entity.blocks.length)
      limitations.add(
        `No supported content blocks extracted: ${identity.crawl_key}`,
      );
    model.entities.push(entity);
  }
  for (const url of capture.unverified_asset_urls)
    mediaFor(url, "operator-capture", sourceOrigin + "/");
  model.source_capture.missing_asset_urls = [...missing];
  if (missing.size)
    limitations.add(
      `${missing.size} observed asset URL(s) lack verified capture bytes; no remote fallback or invented media is generated.`,
    );
  if (capture.assets.length && !options.mediaPath)
    limitations.add(
      "Media bytes are verified artifacts; local paths are intentionally absent until caller-controlled materialization.",
    );
  limitations.add(
    "Operator extraction does not implement target scenarios, route reconciliation, complete capture, publication or access challenge resolution.",
  );
  model.limitations = [...limitations];
  return model;
}
