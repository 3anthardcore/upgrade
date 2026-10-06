import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { load } from "cheerio";
import { identifyUrl, verifyCrawlSnapshots } from "../crawler/index.ts";
import type { CrawlResult, CrawlEntry, CrawlAsset } from "../crawler/index.ts";
import type { CommerceModel } from "../contracts/commerce.ts";
import { extractCommerceObservation } from "./commerce.ts";
import { primaryDom, cleanPrimaryDom } from "./primary-dom.ts";

export interface Evidence {
  source_url: string;
  observed_at: string;
  locator: string;
  snapshot_sha256: string;
  trust: "untrusted-source-data";
}
export interface Fact<T = unknown> {
  value: T | null;
  status: "OBSERVED" | "ABSENT_IN_SOURCE" | "UNKNOWN" | "REQUIRES_REVIEW";
  confidence: "high" | "medium" | "low";
  evidence: Evidence;
  unit?: string | null;
}
export interface ContentBlock {
  type:
    | "heading"
    | "paragraph"
    | "list"
    | "table"
    | "image"
    | "document"
    | "quote"
    | "link"
    | "card";
  text?: string;
  level?: number;
  items?: string[];
  rows?: string[][];
  source_url?: string;
  asset_sha256?: string;
  alt?: string;
  /** Same-origin source path and exact query for inert target navigation, never an action or external URL. */
  request_target?: string;
}
export interface ContentEntity {
  source_id: string;
  type: "Page" | "Product" | "Article" | "Service";
  page_type: string;
  source_url: string;
  title: string;
  description: string;
  blocks: ContentBlock[];
  sanitized_html: string;
  seo: {
    title: string;
    description: string;
    h1: string | null;
    canonical_url: string | null;
    language: string | null;
  };
  facts: Record<string, Fact>;
  evidence: Evidence[];
  assets: string[];
}
export interface PriceObservation {
  source_id: string;
  product_source_id: string;
  offer_source_id: string | null;
  amount: string | null;
  currency: string | null;
  kind: "exact" | "from" | "range" | "unknown";
  maximum: string | null;
  unit: string | null;
  conditions: string | null;
  observed_at: string;
  region: null;
  evidence: Evidence;
  status: "OBSERVED" | "REQUIRES_REVIEW" | "UNKNOWN";
}
export interface Offer {
  source_id: string;
  product_source_id: string;
  source_url: string;
  sku: string | null;
  attributes: Record<string, string>;
  availability: Fact<string>;
  evidence: Evidence;
}
export interface Feature {
  source_id: string;
  source_url: string;
  type: string;
  observation: string;
  status: "UNVERIFIED" | "REQUIRES_INTEGRATION";
  source_evidence: Evidence;
  target_implementation: null;
  test: null;
}
export interface ContentModel {
  schema_version: 1;
  project_id: string;
  source_origin: string;
  commerce?: CommerceModel;
  entities: ContentEntity[];
  offers: Offer[];
  prices: PriceObservation[];
  assets: CrawlAsset[];
  features: Feature[];
  limitations: string[];
  content_requirements: {
    schema_version: 1;
    types: Record<string, { required: string[]; conditional: string[] }>;
    comparison: string;
  };
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const stableId = (type: string, key: string) =>
  `${type.toLowerCase()}_${hash(key).slice(0, 24)}`;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringValue = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;
const array = (value: unknown): unknown[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
const typeIs = (value: Record<string, unknown>, type: string) =>
  array(value["@type"]).includes(type);

export function sanitizeHtml(html: string): string {
  const $ = load(html, {}, false);
  $(
    "script,style,iframe,frame,object,embed,svg,math,form,input,button,textarea,select,link,meta,base,noscript,template",
  ).remove();
  const allowedTags = new Set([
    "p",
    "div",
    "span",
    "section",
    "article",
    "main",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "blockquote",
    "strong",
    "b",
    "em",
    "i",
    "a",
    "br",
    "hr",
    "figure",
    "figcaption",
    "img",
  ]);
  $("*").each((_i, element) => {
    if (!("tagName" in element)) return;
    if (!allowedTags.has(element.tagName)) {
      $(element).replaceWith($(element).contents());
      return;
    }
    for (const attribute of Object.keys(element.attribs)) {
      if (
        !["href", "alt", "title", "colspan", "rowspan", "id"].includes(
          attribute,
        )
      )
        $(element).removeAttr(attribute);
    }
    // All source media is rendered from typed, downloaded asset blocks, never via hotlink HTML.
    if (element.tagName === "img") {
      $(element).replaceWith(
        $("<span></span>").text($(element).attr("alt") ?? ""),
      );
      return;
    }
    const href = $(element).attr("href");
    if (
      href &&
      (!/^(?:https?:\/\/|\/|#|\?)/i.test(href) ||
        href.startsWith("//") ||
        /[\u0000-\u0020\\]/.test(href))
    )
      $(element).removeAttr("href");
    if (href && /^https?:/i.test(href))
      $(element).attr("rel", "noopener noreferrer");
  });
  return $.html();
}

function structuredItems(value: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const item of array(value)) {
    const object = record(item);
    if (!Object.keys(object).length) continue;
    result.push(object);
    if (object["@graph"]) result.push(...structuredItems(object["@graph"]));
  }
  return result;
}

function decimal(value: unknown): string | null {
  const text = stringValue(value)?.trim();
  // Never make locale-dependent guesses (1,234 might be 1.234 or 1234).
  return text && /^\d+(?:\.\d+)?$/.test(text) ? text : null;
}

export async function extractContent(
  crawl: CrawlResult,
): Promise<ContentModel> {
  await verifyCrawlSnapshots(crawl);
  const verifiedAssets = new Map<string, { sha256: string; mime: string }>();
  for (const asset of crawl.assets) {
    if (
      asset.status !== "FETCHED" ||
      !asset.body_path ||
      !asset.sha256 ||
      !asset.mime
    )
      continue;
    const info = await lstat(asset.body_path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 200_000_000)
      throw new Error("Source asset is not a bounded regular snapshot");
    const bytes = await readFile(asset.body_path);
    if (
      bytes.length !== info.size ||
      (asset.size_bytes !== undefined && bytes.length !== asset.size_bytes) ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    )
      throw new Error(
        "Source asset SHA-256 or byte count changed during extraction",
      );
    const previous = verifiedAssets.get(asset.source_url);
    if (
      previous &&
      (previous.sha256 !== asset.sha256 || previous.mime !== asset.mime)
    )
      throw new Error("Source asset has conflicting verified snapshots");
    verifiedAssets.set(asset.source_url, {
      sha256: asset.sha256,
      mime: asset.mime,
    });
  }
  const model: ContentModel = {
    schema_version: 1,
    project_id: crawl.project_id,
    source_origin: crawl.source_origin,
    commerce: { schema_version: 1, entries: [] },
    entities: [],
    offers: [],
    prices: [],
    assets: structuredClone(crawl.assets),
    features: [],
    limitations: [],
    content_requirements: {
      schema_version: 1,
      types: {
        Page: {
          required: [
            "source_id",
            "source_url",
            "title",
            "blocks",
            "seo",
            "evidence",
          ],
          conditional: ["images-if-observed"],
        },
        Product: {
          required: ["source_id", "source_url", "title", "evidence"],
          conditional: [
            "observed-prices",
            "observed-offers",
            "observed-specifications",
            "observed-media",
          ],
        },
        Article: {
          required: ["source_id", "source_url", "title", "blocks", "evidence"],
          conditional: ["observed-author", "observed-publication-date"],
        },
        Service: {
          required: ["source_id", "source_url", "title", "blocks", "evidence"],
          conditional: ["observed-prices"],
        },
      },
      comparison:
        "Compare required and conditionally observed fields against immutable source snapshots; unknown values stay null.",
    },
  };
  for (const entry of crawl.entries) {
    if (
      !["FETCHED", "RENDERED"].includes(entry.status) ||
      entry.http_status !== 200 ||
      !entry.body_path ||
      !["text/html", "application/xhtml+xml"].includes(entry.mime ?? "")
    )
      continue;
    // Validate the exact buffer used by both extractors, not just an earlier
    // filesystem pass. Source controls remain inert input to the normalizer.
    const bytes = await readFile(entry.dom_path ?? entry.body_path);
    const snapshotSha = entry.dom_sha256 ?? entry.body_sha256!;
    if (createHash("sha256").update(bytes).digest("hex") !== snapshotSha)
      throw new Error("Source SHA-256 changed during extraction");
    const html = bytes.toString("utf8"),
      $ = load(html);
    const evidence = (locator: string): Evidence => ({
      source_url: entry.crawl_key,
      observed_at: entry.fetched_at ?? crawl.started_at,
      locator,
      snapshot_sha256: entry.dom_sha256 ?? entry.body_sha256!,
      trust: "untrusted-source-data",
    });
    const fact = <T>(
      value: T | null,
      locator: string,
      confidence: Fact["confidence"] = "high",
    ): Fact<T> => ({
      value,
      status: value === null ? "ABSENT_IN_SOURCE" : "OBSERVED",
      confidence,
      evidence: evidence(locator),
    });
    const structured = entry.structured_data.flatMap(structuredItems);
    const product = structured.find((item) => typeIs(item, "Product"));
    const article = structured.find((item) =>
      ["Article", "BlogPosting", "NewsArticle"].some((type) =>
        typeIs(item, type),
      ),
    );
    const service = structured.find((item) => typeIs(item, "Service"));
    const type = product
      ? "Product"
      : article
        ? "Article"
        : service
          ? "Service"
          : "Page";
    const primary = product ?? article ?? service ?? {};
    const sourceId = stableId(type, entry.crawl_key);
    const chosen = primaryDom($),
      main = chosen.node;
    model.commerce!.entries.push(
      extractCommerceObservation(html, {
        entitySourceId: sourceId,
        sourceUrl: entry.crawl_key,
        documentUrl: entry.final_url ?? entry.crawl_key,
        observedAt: entry.fetched_at ?? crawl.started_at,
        snapshotSha256: snapshotSha,
        primarySelector: chosen.selector,
        primaryIndex: $(chosen.selector).toArray().indexOf(main.get(0)!),
        verifiedAsset: (url) => {
          const asset = verifiedAssets.get(url);
          return asset?.mime.startsWith("image/") ? asset.sha256 : undefined;
        },
      }),
    );
    cleanPrimaryDom($, main.get(0)!, chosen.selector === "body");
    const blocks: ContentBlock[] = [];
    main
      .find('h1,h2,h3,h4,h5,h6,p,ul,ol,table,blockquote,img,a[href$=".pdf"]')
      .each((_index, element) => {
        const node = $(element);
        if (node.parents("ul,ol,table,blockquote").length) return;
        const tag = element.tagName,
          text = node.text().replace(/\s+/g, " ").trim();
        if (/^h[1-6]$/.test(tag) && text)
          blocks.push({ type: "heading", level: Number(tag[1]), text });
        else if (tag === "p" && text) blocks.push({ type: "paragraph", text });
        else if (tag === "ul" || tag === "ol")
          blocks.push({
            type: "list",
            items: node
              .children("li")
              .map((_i, li) => $(li).text().replace(/\s+/g, " ").trim())
              .get(),
          });
        else if (tag === "table")
          blocks.push({
            type: "table",
            rows: node
              .find("tr")
              .map((_i, tr) => [
                $(tr)
                  .find("th,td")
                  .map((_j, td) => $(td).text().trim())
                  .get(),
              ])
              .get() as unknown as string[][],
          });
        else if (tag === "blockquote" && text)
          blocks.push({ type: "quote", text });
        else if (tag === "img" || tag === "a") {
          try {
            const url = identifyUrl(
              node.attr(tag === "img" ? "src" : "href") ?? "",
              entry.final_url ?? entry.crawl_key,
            ).crawl_key;
            const asset = verifiedAssets.get(url);
            blocks.push({
              type: tag === "img" ? "image" : "document",
              source_url: url,
              asset_sha256: asset?.sha256,
              alt: node.attr("alt") ?? text,
            });
          } catch {
            /* Invalid source URL is reported by crawl; no executable fallback. */
          }
        }
      });
    const h1 = main.find("h1").first().text().trim() || null;
    const entity: ContentEntity = {
      source_id: sourceId,
      type,
      page_type:
        type === "Page"
          ? entry.request_target === "/"
            ? "home"
            : /contact/i.test(entry.request_target)
              ? "contacts"
              : "text"
          : type.toLowerCase(),
      source_url: entry.crawl_key,
      title: entry.title || h1 || stringValue(primary.name) || "",
      description: entry.description ?? "",
      blocks,
      sanitized_html: sanitizeHtml(main.html() ?? ""),
      seo: {
        title: entry.title ?? "",
        description: entry.description ?? "",
        h1,
        canonical_url: entry.canonical_url ?? null,
        language: entry.language ?? null,
      },
      facts: {
        name: fact(stringValue(primary.name) ?? h1, "h1 / JSON-LD.name"),
        sku: fact(stringValue(primary.sku), "JSON-LD.sku"),
        manufacturer: fact(
          stringValue(record(primary.manufacturer).name) ??
            stringValue(record(primary.brand).name),
          "JSON-LD.manufacturer/brand",
        ),
        description: fact(
          stringValue(primary.description) ?? (entry.description || null),
          "meta.description / JSON-LD.description",
        ),
      },
      evidence: [evidence("main / article / body")],
      assets: entry.media,
    };
    for (const item of array(primary.additionalProperty)) {
      const property = record(item),
        name = stringValue(property.name),
        value = stringValue(property.value);
      if (name)
        entity.facts[`property:${name}`] = {
          ...fact(value, `JSON-LD.additionalProperty:${name}`),
          unit:
            stringValue(property.unitText) ?? stringValue(property.unitCode),
        };
    }
    if (!entity.title)
      model.limitations.push(
        `Required title not extracted: ${entry.crawl_key}`,
      );
    if (!blocks.length)
      model.limitations.push(
        `No supported visible blocks extracted: ${entry.crawl_key}`,
      );
    model.entities.push(entity);

    if (product) {
      const offers = array(product.offers).map(record);
      for (const offer of offers) {
        const offered = record(offer.itemOffered);
        const attributes: Record<string, string> = {};
        for (const key of ["color", "size", "material"]) {
          const value = stringValue(offered[key]) ?? stringValue(offer[key]);
          if (value !== null) attributes[key] = value;
        }
        const sku = stringValue(offered.sku) ?? stringValue(offer.sku);
        const identity =
          stringValue(offer["@id"]) ??
          stringValue(offer.url) ??
          JSON.stringify({ sku, attributes });
        const offerId = stableId("Offer", sourceId + ":" + identity);
        if (model.offers.some((item) => item.source_id === offerId)) {
          model.limitations.push(
            `Ambiguous duplicate offer identity at ${entry.crawl_key}; manual review required`,
          );
          continue;
        }
        model.offers.push({
          source_id: offerId,
          product_source_id: sourceId,
          source_url: entry.crawl_key,
          sku,
          attributes,
          availability: fact(
            stringValue(offer.availability),
            "JSON-LD.offers.availability",
          ),
          evidence: evidence("JSON-LD.offers"),
        });
        const specification = record(offer.priceSpecification);
        const minimum = decimal(
            offer.price ?? specification.price ?? offer.lowPrice,
          ),
          maximum = decimal(offer.highPrice);
        const visiblePrice = main
          .find("[data-price]")
          .first()
          .attr("data-price");
        const mismatch =
          !!visiblePrice &&
          minimum !== null &&
          decimal(visiblePrice) !== minimum;
        model.prices.push({
          source_id: stableId(
            "PriceObservation",
            offerId + ":" + (entry.body_sha256 ?? ""),
          ),
          product_source_id: sourceId,
          offer_source_id: offerId,
          amount: minimum,
          currency: stringValue(
            offer.priceCurrency ?? specification.priceCurrency,
          ),
          kind:
            offer.lowPrice !== undefined
              ? maximum && maximum !== minimum
                ? "range"
                : "from"
              : minimum !== null
                ? "exact"
                : "unknown",
          maximum,
          unit:
            stringValue(specification.unitText) ??
            stringValue(record(specification.referenceQuantity).unitText) ??
            null,
          conditions:
            stringValue(specification.description) ??
            stringValue(offer.description),
          observed_at: entry.fetched_at!,
          region: null,
          evidence: evidence("JSON-LD.offers.price"),
          status: mismatch
            ? "REQUIRES_REVIEW"
            : minimum === null
              ? "UNKNOWN"
              : "OBSERVED",
        });
        if (mismatch)
          model.limitations.push(
            `Visible and structured price differ: ${entry.crawl_key}`,
          );
      }
      if (!offers.length)
        entity.facts.price = {
          value: null,
          status: "UNKNOWN",
          confidence: "low",
          evidence: evidence("JSON-LD.offers missing"),
        };
    }
    // Feature detection is observation only. A source button never becomes evidence of a working target feature.
    const raw = load(html);
    const detected: [string, string][] = [];
    if (raw("form").length)
      detected.push([
        "form",
        `${raw("form").length} source form(s); submission not attempted`,
      ]);
    if (raw('input[type="search"],form[role="search"]').length)
      detected.push(["search", "Source search controls observed"]);
    if (raw('[data-cart],button[name="add_to_cart"],a[href*="cart"]').length)
      detected.push(["cart", "Source cart controls observed"]);
    if (raw('select[name*="variant"],[data-variant]').length)
      detected.push(["variant", "Source variant controls observed"]);
    for (const [feature, observation] of detected)
      model.features.push({
        source_id: stableId("Feature", entry.crawl_key + ":" + feature),
        source_url: entry.crawl_key,
        type: feature,
        observation,
        status: "UNVERIFIED",
        source_evidence: evidence(`DOM:${feature}`),
        target_implementation: null,
        test: null,
      });
  }
  model.limitations.push(
    "Generic extractor does not infer undocumented variants, arbitrary business logic or owner-only data.",
  );
  model.limitations.push(
    "Site menus, category relationships, breadcrumbs and arbitrary CMS-specific fields require an explicit reviewed adapter.",
  );
  return model;
}
