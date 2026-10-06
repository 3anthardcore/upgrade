import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import type {
  CommerceEvidence,
  CommerceModel,
  CommercePrice,
  CommercePurchase,
  CommerceFact,
} from "../contracts/commerce.ts";
import type {
  CatalogPageReference,
  CatalogProjection,
  CatalogExactPrice,
  CatalogOffer,
} from "../contracts/catalog.ts";

const hash = (v: unknown): string =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const need = (ok: unknown, code: string): void => {
  if (!ok) throw new Error(code);
};
const sha = (v: string): boolean => /^[a-f0-9]{64}$/.test(v);
function evidence(v: CommerceEvidence | null): v is CommerceEvidence {
  return (
    !!v &&
    v.trust === "untrusted-source-data" &&
    sha(v.snapshot_sha256) &&
    !!v.locator &&
    Number.isFinite(Date.parse(v.observed_at)) &&
    /^https?:\/\//.test(v.source_url)
  );
}
function decimal(v: string | null, positive = true): boolean {
  if (v === null || !/^(0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(v)) return false;
  const n = scaled(v);
  return n <= 1_000_000_000_000n && (!positive || n > 0n);
}
function scaled(v: string): bigint {
  const [a, b = ""] = v.split(".");
  return BigInt(a!) * 1_000_000n + BigInt(b.padEnd(6, "0"));
}
function observed(v: CommerceFact<string>): string | null {
  return v.status === "OBSERVED" &&
    evidence(v.evidence) &&
    typeof v.value === "string" &&
    v.value.length > 0
    ? v.value
    : null;
}
function attributes(
  v: Record<string, CommerceFact<string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(v).flatMap(([key, value]) => {
      const text = observed(value);
      return text === null ? [] : [[key, text]];
    }),
  );
}
function exactPrice(
  prices: CommercePrice[],
  purchase: CommercePurchase,
  sourceUrl: string,
): { price: CatalogExactPrice | null; blockers: string[] } {
  const blockers: string[] = [];
  const p = prices.filter((p) => p.id === purchase.price_id);
  if (p.length !== 1)
    return { price: null, blockers: ["EXACT_CURRENT_PRICE_UNAVAILABLE"] };
  const x = p[0]!;
  if (
    x.evidence?.source_url !== sourceUrl ||
    purchase.quantity_evidence?.source_url !== sourceUrl
  )
    blockers.push("PRICE_SOURCE_PAGE_MISMATCH");
  if (
    x.role !== "CURRENT" ||
    x.status !== "OBSERVED" ||
    !x.totals_eligible ||
    !x.money ||
    x.maximum !== null ||
    x.conditions.length ||
    !evidence(x.evidence)
  )
    blockers.push("PRICE_NOT_UNCONDITIONAL_CURRENT");
  const money = x.money;
  if (
    !money ||
    !/^(0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(money.decimal) ||
    !["RUB", "USD", "EUR"].includes(money.currency) ||
    !Number.isSafeInteger(money.minor) ||
    money.minor! < 0
  )
    blockers.push("PRICE_MONEY_UNREPRESENTABLE");
  else {
    const [a, b = ""] = money.decimal.split(".");
    if (BigInt(a!) * 100n + BigInt(b.padEnd(2, "0")) !== BigInt(money.minor!))
      blockers.push("PRICE_MINOR_MISMATCH");
  }
  if (!x.unit || !/^[a-zA-Z0-9_-]{1,32}$/.test(x.unit))
    blockers.push("PRICE_UNIT_UNKNOWN");
  if (
    !decimal(purchase.min_quantity) ||
    !decimal(purchase.quantity_step) ||
    (purchase.max_quantity !== null && !decimal(purchase.max_quantity)) ||
    !evidence(purchase.quantity_evidence) ||
    purchase.blockers.length
  )
    blockers.push("QUANTITY_EVIDENCE_INCOMPLETE");
  if (
    decimal(purchase.min_quantity) &&
    decimal(purchase.quantity_step) &&
    (scaled(purchase.min_quantity!) % scaled(purchase.quantity_step!) !== 0n ||
      (purchase.max_quantity !== null &&
        decimal(purchase.max_quantity) &&
        scaled(purchase.max_quantity) < scaled(purchase.min_quantity!)))
  )
    blockers.push("QUANTITY_CONSTRAINTS_INCONSISTENT");
  if (blockers.length) return { price: null, blockers };
  return {
    price: {
      source_price_id: x.id,
      decimal: money!.decimal,
      currency: money!.currency as CatalogExactPrice["currency"],
      minor: money!.minor!,
      unit: x.unit!,
      min_quantity: purchase.min_quantity!,
      quantity_step: purchase.quantity_step!,
      max_quantity: purchase.max_quantity,
      evidence: x.evidence,
      quantity_evidence: purchase.quantity_evidence!,
    },
    blockers: [],
  };
}
export interface ProjectNativeCatalogOptions {
  projectId: string;
  targetId: string;
  contentManifestSha256: string;
  modelSha256: string;
  entities: CatalogPageReference[];
  commerce: CommerceModel;
  /** Explicit category membership; never inferred from global navigation. */
  categoryMappings?: {
    category_source_id: string;
    product_source_ids: string[];
    evidence: CommerceEvidence;
  }[];
}
export function projectNativeCatalog(
  options: ProjectNativeCatalogOptions,
): CatalogProjection {
  const { projectId, targetId, commerce } = options;
  need(
    /^[a-zA-Z0-9_-]{1,63}$/.test(projectId) &&
      /^[a-zA-Z0-9_.-]{1,128}$/.test(targetId),
    "CATALOG_IDENTITY_INVALID",
  );
  need(
    sha(options.contentManifestSha256) && sha(options.modelSha256),
    "CATALOG_INPUT_PINS_REQUIRED",
  );
  need(
    commerce.schema_version === 1 && commerce.entries.length <= 100_000,
    "CATALOG_COMMERCE_INVALID",
  );
  const pages = new Map<string, CatalogPageReference>();
  const stable = new Set<string>();
  for (const page of options.entities) {
    need(
      !pages.has(page.source_id) &&
        !stable.has(page.stable_key) &&
        sha(page.stable_key) &&
        sha(page.payload_sha256) &&
        !!page.title,
      "CATALOG_PAGE_REFERENCE_INVALID",
    );
    const url = new URL(page.source_url);
    need(
      ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash,
      "CATALOG_SOURCE_URL_INVALID",
    );
    pages.set(page.source_id, { ...page });
    stable.add(page.stable_key);
  }
  const entries = new Map(commerce.entries.map((e) => [e.entity_source_id, e]));
  need(
    entries.size === commerce.entries.length,
    "CATALOG_DUPLICATE_OBSERVATION",
  );
  for (const e of entries.values()) {
    const p = pages.get(e.entity_source_id);
    need(p && p.source_url === e.source_url, "CATALOG_PAGE_BINDING_MISMATCH");
    need(e.schema_version === 1, "CATALOG_OBSERVATION_SCHEMA");
  }
  const categories: CatalogProjection["categories"] = [];
  const memberships = new Map<string, string[]>();
  for (const map of options.categoryMappings ?? []) {
    const e = entries.get(map.category_source_id);
    need(
      e &&
        e.page_kind.status === "OBSERVED" &&
        e.page_kind.value === "CATEGORY" &&
        evidence(e.page_kind.evidence) &&
        evidence(map.evidence),
      "CATALOG_CATEGORY_NOT_OBSERVED",
    );
    const category_key = hash([projectId, "category", map.category_source_id]);
    need(
      !categories.some((c) => c.category_key === category_key),
      "CATALOG_CATEGORY_DUPLICATE",
    );
    need(
      Buffer.byteLength(pages.get(map.category_source_id)!.title) <= 255,
      "CATALOG_CATEGORY_NAME_TOO_LONG",
    );
    categories.push({
      category_key,
      page: pages.get(map.category_source_id)!,
      name: pages.get(map.category_source_id)!.title,
      evidence: map.evidence,
      observation: structuredClone(e!),
    });
    for (const id of map.product_source_ids) {
      need(
        entries.get(id)?.page_kind.value === "PRODUCT",
        "CATALOG_CATEGORY_MEMBER_INVALID",
      );
      const keys = memberships.get(id) ?? [];
      need(!keys.includes(category_key), "CATALOG_CATEGORY_MEMBER_DUPLICATE");
      memberships.set(id, [...keys, category_key]);
    }
  }
  const products: CatalogProjection["products"] = [];
  for (const e of entries.values()) {
    if (e.page_kind.status !== "OBSERVED" || e.page_kind.value !== "PRODUCT")
      continue;
    need(
      evidence(e.page_kind.evidence) &&
        e.page_kind.evidence?.source_url === e.source_url,
      "CATALOG_KIND_EVIDENCE_PAGE_MISMATCH",
    );
    for (const f of [
      e.product.sku,
      ...Object.values(e.product.attributes),
      ...e.variants.flatMap((v) => [v.sku, ...Object.values(v.attributes)]),
    ])
      if (f.status === "OBSERVED")
        need(
          evidence(f.evidence) && f.evidence.source_url === e.source_url,
          "CATALOG_FACT_EVIDENCE_PAGE_MISMATCH",
        );
    need(e.variants.length <= 200, "CATALOG_VARIANT_LIMIT");
    const ids = new Set<string>();
    const offers: CatalogOffer[] = [];
    for (const v of e.variants) {
      need(
        typeof v.id === "string" &&
          v.id.length > 0 &&
          v.id.length <= 1024 &&
          !ids.has(v.id) &&
          evidence(v.evidence) &&
          v.evidence.source_url === e.source_url,
        "CATALOG_VARIANT_IDENTITY_INVALID",
      );
      ids.add(v.id);
      const attrs = attributes(v.attributes);
      need(
        Object.keys(attrs).length > 0 &&
          Object.keys(attrs).length === Object.keys(v.attributes).length,
        "CATALOG_VARIANT_ATTRIBUTES_INCOMPLETE",
      );
      need(
        Buffer.byteLength(
          Object.entries(attrs)
            .map(([k, v]) => k + ": " + v)
            .join(" / "),
        ) <= 255,
        "CATALOG_VARIANT_NAME_TOO_LONG",
      );
      offers.push({
        offer_key: hash([projectId, "offer", e.entity_source_id, v.id]),
        observed_variant_id: v.id,
        source_url: v.source_url,
        sku: observed(v.sku),
        attributes: attrs,
        evidence: v.evidence,
        ...exactPrice(v.prices, v.purchase, e.source_url),
      });
    }
    const pricing = offers.length
      ? { price: null, blockers: [] }
      : exactPrice(e.prices, e.purchase, e.source_url);
    products.push({
      page: pages.get(e.entity_source_id)!,
      category_keys: memberships.get(e.entity_source_id) ?? [],
      sku: observed(e.product.sku),
      attributes: attributes(e.product.attributes),
      ...pricing,
      offers,
      observation: structuredClone(e),
    });
  }
  need(
    products.length <= 20000 && categories.length <= 20000,
    "CATALOG_SCOPE_LIMIT",
  );
  return {
    schema_version: 1,
    kind: "native-catalog-overlay",
    project_id: projectId,
    target_id: targetId,
    content_manifest_sha256: options.contentManifestSha256,
    model_sha256: options.modelSha256,
    state: "PARTIAL",
    runtime_verification: "NOT_RUN",
    categories,
    products,
    blockers: [],
    limitations: [
      "EXISTING_PAGE_IDENTITY_ONLY",
      "STOCK_AND_AVAILABILITY_NOT_IMPORTED",
      "NO_REAL_ORDERS_PAYMENTS_OR_MAIL",
      "MIN_MAX_QUANTITY_REMAIN_OBSERVATIONS_NOT_NATIVE_CHECKOUT_RULES",
      "FULL_SOURCE_DENOMINATOR_UNKNOWN",
      ...(categories.length ? [] : ["CATEGORY_MAPPING_NOT_SUPPLIED"]),
    ],
  };
}
/** Exclusive immutable file. Caller publishes its returned SHA via the durable core. */
export function writeCatalogProjection(
  path: string,
  projection: CatalogProjection,
): { sha256: string; bytes: number } {
  const body = Buffer.from(JSON.stringify(projection, null, 2) + "\n");
  need(body.length <= 67_108_864, "CATALOG_PROJECTION_TOO_LARGE");
  writeFileSync(path, body, { flag: "wx", mode: 0o600 });
  return {
    sha256: createHash("sha256").update(body).digest("hex"),
    bytes: body.length,
  };
}
