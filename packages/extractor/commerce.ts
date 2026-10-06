import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { identifyUrl } from "../crawler/network.ts";
import { COMMERCE_LIMITS } from "../contracts/commerce.ts";
import type {
  CommerceEvidence,
  CommerceFact,
  CommerceMoney,
  CommerceObservation,
  CommercePageKind,
  CommercePrice,
  CommercePurchase,
  CommerceVariant,
} from "../contracts/commerce.ts";

export interface CommerceExtractionOptions {
  entitySourceId: string;
  sourceUrl: string;
  documentUrl: string;
  observedAt: string;
  snapshotSha256: string;
  primarySelector?: string;
  primaryIndex?: number;
  verifiedAsset?: (sourceUrl: string) => string | undefined;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim()
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : null;
const array = (value: unknown): any[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];
const supportedCurrency: Record<string, number> = {
  RUB: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
};
const hiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;
function retained($: CheerioAPI, node: Element) {
  return !$(node)
    .parents()
    .add(node)
    .toArray()
    .some(
      (item) =>
        $(item).is(
          '[hidden],[aria-hidden="true"],template,noscript,script,style',
        ) || hiddenStyle.test($(item).attr("style") ?? ""),
    );
}
/** No floats, exponent notation, negative quantity or ambiguous grouping. */
export function commerceDecimal(raw: string, places = 6): string | null {
  const value = raw.trim();
  if (value.length > 128) return null;
  if (
    !new RegExp(
      `^(?:\\d+|\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+)(?:[.,]\\d{1,${places}})?$`,
    ).test(value)
  )
    return null;
  const [integer, fraction = ""] = value
    .replace(/[ \u00a0\u202f]/g, "")
    .replace(",", ".")
    .split(".");
  return (
    (integer.replace(/^0+(?=\d)/, "") || "0") +
    (fraction.replace(/0+$/, "") ? "." + fraction.replace(/0+$/, "") : "")
  );
}
function quantity(value: unknown): string | null {
  const raw = string(value),
    normalized = raw ? commerceDecimal(raw) : null;
  if (normalized === null) return null;
  const scaled =
    BigInt(normalized.split(".")[0]) * 1_000_000n +
    BigInt((normalized.split(".")[1] ?? "").padEnd(6, "0"));
  return scaled > 0n && scaled <= 1_000_000_000_000n ? normalized : null;
}
function money(amount: unknown, currency: string | null): CommerceMoney | null {
  const raw = string(amount);
  if (!raw || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const scale = supportedCurrency[currency];
  const decimal = commerceDecimal(raw, scale === 0 ? 1 : (scale ?? 6));
  if (decimal === null || (scale === 0 && decimal.includes("."))) return null;
  let minor: number | null = null;
  if (scale !== undefined) {
    const [whole, fraction = ""] = decimal.split(".");
    if (fraction.length <= scale) {
      const value =
        BigInt(whole) * 10n ** BigInt(scale) +
        BigInt(fraction.padEnd(scale, "0") || "0");
      if (value <= BigInt(Number.MAX_SAFE_INTEGER)) minor = Number(value);
    }
  }
  return { decimal, currency, minor };
}
function currencyIn(raw: string): string | null {
  const currencies = new Set<string>();
  for (const match of raw.matchAll(
    /\b(RUB|USD|EUR|GBP|JPY)\b|₽|€|(?:руб(?:\.|лей|ля)?|р\.)(?=\s|$|\/)/gi,
  )) {
    currencies.add(
      match[1]?.toUpperCase() ?? (match[0] === "€" ? "EUR" : "RUB"),
    );
  }
  return currencies.size === 1 ? [...currencies][0] : null;
}
function observedUnit(raw: string): string | null {
  const match =
    /(?:\/\s*|(?:^|\s)за\s+)(м²|м2|m2|м\.?(?:\s*кв\.)?|шт\.?|упак(?:овк[ауи])?\.?|комплект|пог\.?\s*м\.?)(?=\s|$|[.,;])/iu.exec(
      raw,
    );
  if (!match) return null;
  const unit = match[1].toLowerCase();
  return /^(м²|м2|m2|м\.?\s*кв\.)$/.test(unit)
    ? "m2"
    : /^шт/.test(unit)
      ? "piece"
      : /^упак/.test(unit)
        ? "pack"
        : /^комплект/.test(unit)
          ? "set"
          : "m";
}
function target(raw: string, base: string, origin: string): string | null {
  if (!raw.trim() || raw.startsWith("#") || /[\u0000-\u0020\\]/.test(raw))
    return null;
  try {
    const id = identifyUrl(raw, base);
    if (id.origin !== origin) return null;
    const url = new URL(id.raw_url);
    if (
      /(?:^|\/)(?:cart|checkout|payment|payments|order|orders|login|logout|register|account|wishlist|compare|admin|bitrix|local|api|add|remove|delete)(?:[/.]|$)/i.test(
        decodeURIComponent(url.pathname),
      )
    )
      return null;
    for (const [key, value] of url.searchParams) {
      if (
        /^(?:action|do|act|add|remove|delete|submit|checkout|logout|login|payment|order|quantity|cart|token|sessid|csrf|csrf_token)$/i.test(
          key,
        )
      )
        return null;
      if (
        key.toLowerCase() === "route" &&
        /(?:^|\/)(?:account|checkout|payment|api|tool|cart|compare|wishlist)(?:\/|$)/i.test(
          value,
        )
      )
        return null;
    }
    return id.request_target;
  } catch {
    return null;
  }
}
export function extractCommerceObservation(
  html: string,
  options: CommerceExtractionOptions,
): CommerceObservation {
  const $ = load(html),
    identity = identifyUrl(options.sourceUrl),
    document = identifyUrl(options.documentUrl);
  if (
    identity.origin !== document.origin ||
    !/^[a-f0-9]{64}$/.test(options.snapshotSha256)
  )
    throw new Error("Commerce evidence identity invalid");
  let base = document.crawl_key;
  try {
    if ($("base[href]").first().attr("href"))
      base = identifyUrl($("base[href]").first().attr("href")!, base).raw_url;
  } catch {
    throw new Error("Invalid commerce HTML base requires review");
  }
  let root: Cheerio<AnyNode> = $(options.primarySelector ?? "main").eq(
    options.primaryIndex ?? 0,
  );
  if (!root.length) root = $("#content").first();
  if (!root.length) root = $("body");
  const ev = (locator: string): CommerceEvidence => ({
    source_url: options.documentUrl,
    observed_at: options.observedAt,
    locator,
    snapshot_sha256: options.snapshotSha256,
    trust: "untrusted-source-data",
  });
  const fact = <T>(
    value: T | null,
    locator: string,
    reason: string | null = null,
  ): CommerceFact<T> => ({
    value,
    status: value === null ? "UNKNOWN" : "OBSERVED",
    evidence: ev(locator),
    reason,
  });
  const locator = (node: Element) => {
    const parts: string[] = [];
    let current: Element | undefined = node;
    while (current && parts.length < 200) {
      const parent: Element["parent"] = current.parent;
      const siblings =
        parent && "children" in parent
          ? parent.children.filter(
              (item): item is Element =>
                "tagName" in item && item.tagName === current!.tagName,
            )
          : [];
      parts.unshift(
        `${current.tagName}:nth-of-type(${siblings.indexOf(current) + 1})`,
      );
      current = parent && "tagName" in parent ? parent : undefined;
    }
    return parts.join(" > ");
  };
  const unknown = <T>() =>
    fact<T>(null, "commerce interpretation; no unambiguous observation");
  const result: CommerceObservation = {
    schema_version: 1,
    entity_source_id: options.entitySourceId,
    source_url: identity.crawl_key,
    request_target: identity.request_target,
    page_kind: unknown<CommercePageKind>(),
    product: {
      name: unknown<string>(),
      brand: unknown<string>(),
      sku: unknown<string>(),
      availability: unknown<string>(),
      attributes: Object.create(null),
    },
    prices: [],
    purchase: {
      price_id: null,
      min_quantity: null,
      quantity_step: null,
      max_quantity: null,
      default_quantity: null,
      quantity_evidence: null,
      blockers: [],
    },
    variants: [],
    selections: [],
    breadcrumbs: [],
    links: [],
    images: [],
    limitations: [
      "Commerce is an observation sidecar: it does not retype imported entities, grant access, prove stock, or implement source actions.",
      "Missing units and quantity constraints remain unknown; no default stock, price, VAT, minimum or variant combination is invented.",
    ],
  };
  const uniqueFact = (
    values: { value: string; locator: string }[],
  ): CommerceFact<string> => {
    const unique = [...new Set(values.map((item) => item.value.trim()))];
    if (unique.length === 1) return fact(values[0].value, values[0].locator);
    return {
      ...unknown<string>(),
      status: unique.length ? "REQUIRES_REVIEW" : "UNKNOWN",
      reason: unique.length
        ? "Conflicting observed values"
        : "No explicit source value",
    };
  };
  const structured: Record<string, any>[] = [];
  $('script[type="application/ld+json"]').each((i, node) => {
    try {
      const raw = $(node).text();
      if (raw.length > 2_000_000) {
        result.limitations.push(
          "Oversized structured commerce data requires review",
        );
        return;
      }
      const parsed = JSON.parse(raw);
      for (const entry of array(parsed).flatMap((item) =>
        array(object(item)["@graph"] ?? item),
      )) {
        const value = object(entry),
          types = array(value["@type"]);
        const context = value["@context"] ?? object(parsed)["@context"];
        if (
          !array(context).some(
            (item) =>
              typeof item === "string" &&
              /^https?:\/\/schema\.org\/?$/.test(item),
          )
        )
          continue;
        if (
          !types.some((type) =>
            ["Product", "Article", "Service", "CollectionPage"].includes(type),
          )
        )
          continue;
        const binding = string(value.url) ?? string(value["@id"]);
        if (
          binding &&
          identifyUrl(binding, base).crawl_key === document.crawl_key
        )
          structured.push({
            ...value,
            __locator: `script[type=application/ld+json][${i}]`,
          });
      }
    } catch {
      result.limitations.push(
        "Invalid or unbound structured commerce data was not promoted",
      );
    }
  });
  const products = structured.filter((item) =>
    array(item["@type"]).includes("Product"),
  );
  let product = products.length === 1 ? products[0] : undefined;
  const structuredIdentity = (
    value: Record<string, any>,
  ): string | null | false => {
    const bindings = [value.url, value["@id"]].filter(
      (item) => item !== undefined,
    );
    const urls: string[] = [];
    for (const binding of bindings) {
      if (typeof binding !== "string" || !binding.trim()) return false;
      try {
        const id = identifyUrl(binding, base);
        if (
          id.origin !== identity.origin ||
          !target(id.raw_url, base, identity.origin)
        )
          return false;
        urls.push(id.crawl_key);
      } catch {
        return false;
      }
    }
    return new Set(urls).size > 1 ? false : (urls[0] ?? null);
  };
  const boundOffers = (
    value: unknown,
    owner: Record<string, any>,
    where: string,
  ): Record<string, any>[] => {
    const ownerIdentity = structuredIdentity(owner);
    const expected = ownerIdentity || document.crawl_key;
    return array(value)
      .map((entry, index): Record<string, any> => ({
        ...object(entry),
        __commerce_index: index,
      }))
      .filter((offer) => {
        const offerIdentity = structuredIdentity(offer),
          offered = object(offer.itemOffered);
        const offeredIdentity = structuredIdentity(offered);
        const hasOffered = offer.itemOffered !== undefined;
        const ownerSku = string(owner.sku),
          offeredSku = string(offered.sku);
        const valid =
          ownerIdentity !== false &&
          offerIdentity !== false &&
          offeredIdentity !== false &&
          (!offerIdentity || offerIdentity === expected) &&
          (!offeredIdentity || offeredIdentity === expected) &&
          (!hasOffered ||
            offeredIdentity === expected ||
            Boolean(ownerSku && offeredSku === ownerSku)) &&
          !(ownerSku && offeredSku && ownerSku !== offeredSku);
        if (!valid)
          result.limitations.push(
            `Unbound or conflicting nested offer identity was not promoted: ${where}`,
          );
        return valid;
      });
  };
  if (product && structuredIdentity(product) !== document.crawl_key) {
    result.limitations.push(
      "Conflicting structured product identity was not promoted",
    );
    product = undefined;
  }
  const parentOffers = product
    ? boundOffers(product.offers, product, product.__locator + ".offers")
    : [];
  let purchaseRoot: Cheerio<AnyNode> = root
    .find("#product")
    .filter((_i, node) => retained($, node))
    .first();
  if (!purchaseRoot.length && root.is("#product")) purchaseRoot = root;
  const quantities = root
    .find(
      'input[name="quantity"],input[itemprop="eligibleQuantity"],input[data-quantity]',
    )
    .filter((_i, node) => retained($, node));
  const productSignal = Boolean(
    product ||
    (quantities.length === 1 &&
      root
        .find(
          '.price-new,.price_new,.price-old,.price_old,.price,[itemprop="price"],[data-price-role]',
        )
        .filter((_i, node) => retained($, node)).length),
  );
  if (!purchaseRoot.length) purchaseRoot = root;
  const heading = root
    .find("h1")
    .filter((_i, node) => retained($, node))
    .first();
  let kind: CommercePageKind =
    identity.request_target === "/"
      ? "HOME"
      : productSignal
        ? "PRODUCT"
        : structured.some((item) => array(item["@type"]).includes("Article"))
          ? "ARTICLE"
          : structured.some((item) => array(item["@type"]).includes("Service"))
            ? "SERVICE"
            : root.find("h2 a[href],h3 a[href],h4 a[href]").length >= 2 &&
                root.find("a[href] img").length >= 2
              ? "CATEGORY"
              : "CONTENT";
  result.page_kind = fact(
    kind,
    product?.__locator ??
      "primary DOM landmarks / explicit quantity and price / repeated linked headings",
    "Presentation classification only; legacy entity type and identity are unchanged",
  );
  result.product.name =
    product && string(product.name)
      ? fact(string(product.name), product.__locator + ".name")
      : heading.length
        ? fact(heading.text(), locator(heading.get(0)!))
        : unknown();
  const fields: Record<string, { value: string; locator: string }[]> = {
    brand: [],
    sku: [],
    availability: [],
  };
  if (product) {
    for (const key of ["brand", "sku"] as const) {
      const value = string(product[key]) ?? string(object(product[key]).name);
      if (value)
        fields[key].push({ value, locator: product.__locator + "." + key });
    }
    for (const [index, item] of parentOffers.entries()) {
      const value = string(object(item).availability);
      if (value)
        fields.availability.push({
          value,
          locator:
            product.__locator +
            `.offers[${item.__commerce_index ?? index}].availability`,
        });
    }
    for (const [index, item] of array(product.additionalProperty).entries()) {
      const property = object(item),
        name = string(property.name),
        value = string(property.value);
      if (name && value)
        result.product.attributes[name] = fact(
          value,
          product.__locator + `.additionalProperty[${index}]`,
        );
    }
  }
  if (kind === "PRODUCT") {
    root.find("tr").each((_i, row) => {
      if (!retained($, row)) return;
      const cells = $(row).children("td,th");
      if (cells.length !== 2) return;
      const label = cells.eq(0).text().trim(),
        value = cells.eq(1).text().trim();
      if (!label || !value) return;
      result.product.attributes[label] = fact(value, locator(row));
      if (/^(?:бренд|производитель|brand|manufacturer)$/i.test(label))
        fields.brand.push({ value, locator: locator(row) });
      if (/^(?:артикул|sku|код товара|product code)$/i.test(label))
        fields.sku.push({ value, locator: locator(row) });
    });
    for (const [key, selector] of [
      ["brand", '[itemprop="brand"]'],
      ["sku", '[itemprop="sku"]'],
      ["availability", '[itemprop="availability"],.stock,[data-availability]'],
    ] as const)
      root.find(selector).each((_i, node) => {
        if (!retained($, node)) return;
        const value =
          $(node).attr("content") ??
          $(node).attr("href") ??
          $(node).text().trim();
        if (value) fields[key].push({ value, locator: locator(node) });
      });
  }
  for (const key of ["brand", "sku", "availability"] as const)
    result.product[key] = uniqueFact(fields[key]);
  function makePrice(
    raw: string,
    role: CommercePrice["role"],
    where: string,
    currencyHint: string | null = null,
    amountHint: unknown = null,
    unitHint: string | null = null,
    conditions: string[] = [],
  ): CommercePrice {
    const observedCurrency = currencyIn(raw),
      hintedCurrency = currencyHint?.trim().toUpperCase() ?? null;
    const matches = [
      ...raw.matchAll(
        /(?<![\d.,A-Za-z])(\d[\d \u00a0\u202f]*(?:[.,]\d{1,6})?)\s*(?:RUB|USD|EUR|GBP|JPY|₽|€|руб(?:\.|лей|ля)?|р\.)(?=\s|$|\/)/gi,
      ),
    ];
    const currency = matches.length
      ? observedCurrency
      : (hintedCurrency ?? observedCurrency);
    const conflicts: string[] = [];
    // Visible evidence and metadata are parsed independently. Metadata may
    // supply a missing currency, never replace or repair a visible amount.
    const visibleAmount =
      matches.length === 1
        ? commerceDecimal(matches[0][1].trim())
        : matches.length === 0
          ? commerceDecimal(raw)
          : null;
    if (matches.length && hintedCurrency && hintedCurrency !== observedCurrency)
      conflicts.push("Visible currency conflicts with metadata");
    if (
      amountHint !== null &&
      (visibleAmount === null ||
        commerceDecimal(String(amountHint)) !== visibleAmount)
    )
      conflicts.push("Visible amount conflicts with metadata");
    let amount: unknown = visibleAmount;
    const from = /(?:^|\s)(?:от|from)(?=\s|\d|$)/iu.test(raw);
    const range = matches.length === 2 && /[–—-]/.test(raw);
    if (!range && /(?:^|\s)[−-]\s*\d/u.test(raw)) amount = null;
    if (from && role !== "OLD") role = "FROM";
    if (range) {
      role = "RANGE";
      amount = matches[0][1].trim();
    }
    const value = money(amount, currency),
      maximum = range ? money(matches[1][1].trim(), currency) : null;
    const observedUnitValue = observedUnit(raw);
    const units = new Set(
      [
        ...raw.matchAll(
          /(?:\/\s*|(?:^|\s)за\s+)(м²|м2|m2|м\.?(?:\s*кв\.)?|шт\.?|упак(?:овк[ауи])?\.?|комплект|пог\.?\s*м\.?)(?=\s|$|[.,;])/giu,
        ),
      ].map((match) => observedUnit(match[0])),
    );
    if (units.size > 1) conflicts.push("Conflicting visible price units");
    if (
      unitHint?.trim() &&
      observedUnitValue &&
      unitHint.trim() !== observedUnitValue
    )
      conflicts.push("Visible unit conflicts with metadata");
    const unit = observedUnitValue ?? unitHint?.trim() ?? null;
    const residue = raw
      .replace(
        /\d[\d \u00a0\u202f]*(?:[.,]\d{1,6})?\s*(?:RUB|USD|EUR|GBP|JPY|₽|€|руб(?:\.|лей|ля)?|р\.)(?=\s|$|\/)/gi,
        "",
      )
      .replace(
        /(?:\/\s*|(?:^|\s)за\s+)(?:м²|м2|m2|м\.?(?:\s*кв\.)?|шт\.?|упак(?:овк[ауи])?\.?|комплект|пог\.?\s*м\.?)(?=\s|$|[.,;])/giu,
        "",
      )
      .replace(/(?:^|\s)(?:от|from|цена|price)(?=\s|$|:)/giu, "")
      .replace(/[\s:;,.()–—-]/g, "");
    if (!(currencyHint && commerceDecimal(raw, 2) !== null) && residue)
      conditions = [...conditions, `Unparsed price condition/text: ${raw}`];
    conditions = [...conditions, ...conflicts];
    const status =
      value === null || conflicts.length > 0 || (matches.length > 1 && !range)
        ? "REQUIRES_REVIEW"
        : role === "UNKNOWN"
          ? "REQUIRES_REVIEW"
          : "OBSERVED";
    return {
      id: `price_${digest(options.entitySourceId + ":" + where + ":" + raw)}`,
      role,
      status,
      raw_text: raw,
      money: value,
      maximum,
      unit,
      conditions,
      totals_eligible:
        status === "OBSERVED" &&
        role === "CURRENT" &&
        value?.minor !== null &&
        value !== null &&
        unit !== null &&
        !conditions.length,
      evidence: ev(where),
    };
  }
  const offerPrices = (offerValue: unknown, where: string): CommercePrice[] => {
    const prices: CommercePrice[] = [];
    if (array(offerValue).length > COMMERCE_LIMITS.prices)
      throw new Error("Commerce offer limit exceeded");
    for (const [index, item] of array(offerValue).entries()) {
      const offer = object(item),
        type = array(offer["@type"]),
        specification = object(offer.priceSpecification);
      if (!type.includes("Offer") && !type.includes("AggregateOffer")) continue;
      const exactAmount = offer.price ?? specification.price,
        amount = exactAmount ?? offer.lowPrice,
        currency = string(offer.priceCurrency ?? specification.priceCurrency);
      const unit =
        string(specification.unitText) ??
        string(object(specification.referenceQuantity).unitText);
      const conditions: string[] = [];
      for (const key of [
        "priceValidUntil",
        "eligibleCustomerType",
        "eligibleRegion",
      ] as const)
        if (offer[key] !== undefined)
          conditions.push(key + ": " + JSON.stringify(offer[key]));
      if (specification.valueAddedTaxIncluded !== undefined)
        conditions.push(
          "valueAddedTaxIncluded: " +
            JSON.stringify(specification.valueAddedTaxIncluded),
        );
      const raw = string(amount) ?? JSON.stringify(amount ?? null);
      const parsedPrice = makePrice(
        raw,
        type.includes("AggregateOffer") ||
          (exactAmount === undefined && offer.lowPrice !== undefined)
          ? "FROM"
          : "CURRENT",
        `${where}[${offer.__commerce_index ?? index}].price`,
        currency,
        amount,
        unit,
        conditions,
      );
      if (type.includes("AggregateOffer") && offer.highPrice !== undefined) {
        parsedPrice.maximum = money(offer.highPrice, currency);
        parsedPrice.role = "RANGE";
        if (!parsedPrice.maximum) parsedPrice.status = "REQUIRES_REVIEW";
      }
      prices.push(parsedPrice);
    }
    return prices;
  };
  if (kind === "PRODUCT") {
    if (product)
      result.prices.push(
        ...offerPrices(parentOffers, product.__locator + ".offers"),
      );
    purchaseRoot
      .find(
        '.price-new,.price_new,.price-old,.price_old,[data-price-role],[itemprop="price"],.price,del,s',
      )
      .each((_i, node) => {
        if (!retained($, node)) return;
        const item = $(node);
        if (
          item.find(
            '.price-new,.price_new,.price-old,.price_old,[data-price-role],[itemprop="price"]',
          ).length
        )
          return;
        const visibleCopy = item.clone();
        visibleCopy.find("*").each((_index, child) => {
          if (
            $(child).is(
              '[hidden],[aria-hidden="true"],template,noscript,script,style',
            ) ||
            hiddenStyle.test($(child).attr("style") ?? "")
          )
            $(child).remove();
        });
        const raw = visibleCopy.text().trim() || item.attr("content") || "";
        if (!raw) return;
        const contradictoryClass = (item.attr("class") ?? "")
          .split(/\s+/)
          .some(
            (value) =>
              /(?:^|[_-])old(?:[_-]|$)/.test(value) &&
              /(?:^|[_-])new(?:[_-]|$)/.test(value),
          );
        const oldSignal =
          item.is('.price-old,.price_old,del,s,[data-price-role="old"]') ||
          item.parents("del,s").length > 0;
        const currentSignal = item.is(
          '.price-new,.price_new,[data-price-role="current"]',
        );
        const role: CommercePrice["role"] =
          contradictoryClass ||
          (oldSignal && currentSignal) ||
          (item.attr("data-price-role") !== undefined &&
            !["old", "current"].includes(item.attr("data-price-role")!))
            ? "UNKNOWN"
            : oldSignal
              ? "OLD"
              : item.is(
                    '.price-new,.price_new,[itemprop="price"],[data-price-role="current"]',
                  )
                ? "CURRENT"
                : "UNKNOWN";
        const adjacent = (direction: "prev" | "next") => {
          let sibling = node[direction];
          while (sibling?.type === "text" && !sibling.data.trim())
            sibling = sibling[direction];
          if (sibling?.type === "text") return sibling.data.trim();
          if (!sibling || !("tagName" in sibling) || !retained($, sibling))
            return "";
          if (
            $(sibling).is(
              'input,select,button,.price-new,.price_new,.price-old,.price_old,[data-price-role],[itemprop="price"],.price,del,s',
            )
          )
            return "";
          return $(sibling).text().trim();
        };
        const neighbors = [adjacent("prev"), adjacent("next")].filter(Boolean);
        const context = neighbors.filter(
          (value) =>
            value.length <= 160 &&
            (/^(?:от|from|RUB|USD|EUR|GBP|JPY|₽|€|руб\.?|р\.)$/iu.test(value) ||
              /^\//u.test(value)),
        );
        const parent = item.parent(),
          unitHint = item.attr("data-unit") ?? parent.attr("data-unit") ?? null;
        const conditions = [
          item.attr("data-condition"),
          parent.attr("data-condition"),
        ].filter((value): value is string => Boolean(value));
        for (const value of neighbors)
          if (!context.includes(value) && !/^(?:цена|price)\s*:$/iu.test(value))
            conditions.push(
              `Adjacent price text requires review: ${value.slice(0, 500)}`,
            );
        const currency =
          item.attr("data-currency") ??
          purchaseRoot
            .find('[itemprop="priceCurrency"]')
            .first()
            .attr("content") ??
          null;
        result.prices.push(
          makePrice(
            [...context, raw].join(" "),
            role,
            locator(node),
            currency,
            item.attr("content") ?? null,
            unitHint,
            conditions,
          ),
        );
      });
  }
  if (result.prices.length > COMMERCE_LIMITS.prices)
    throw new Error("Commerce price observation limit exceeded");
  function purchase(
    prices: CommercePrice[],
    min: unknown,
    step: unknown,
    max: unknown,
    initial: unknown,
    evidence: CommerceEvidence | null,
    requiresSelection = false,
  ): CommercePurchase {
    const current = prices.filter(
      (item) =>
        item.role === "CURRENT" &&
        item.status === "OBSERVED" &&
        item.money !== null,
    );
    const groups = new Set(
      current.map((item) =>
        JSON.stringify([item.money, item.unit, item.conditions]),
      ),
    );
    const chosen = groups.size === 1 ? current[0] : undefined;
    const output: CommercePurchase = {
      price_id: chosen?.id ?? null,
      min_quantity: quantity(min),
      quantity_step: quantity(step),
      max_quantity: quantity(max),
      default_quantity: quantity(initial),
      quantity_evidence: evidence,
      blockers: [],
    };
    if (!chosen)
      output.blockers.push(
        groups.size > 1
          ? "AMBIGUOUS_CURRENT_PRICE"
          : "CURRENT_EXACT_PRICE_UNKNOWN",
      );
    if (chosen && !chosen.totals_eligible)
      output.blockers.push("PRICE_UNIT_CURRENCY_OR_CONDITIONS_UNRESOLVED");
    if (!output.min_quantity) output.blockers.push("MIN_QUANTITY_UNKNOWN");
    if (!output.quantity_step) output.blockers.push("QUANTITY_STEP_UNKNOWN");
    if (requiresSelection) output.blockers.push("VARIANT_SELECTION_REQUIRED");
    if (max !== undefined && max !== null && max !== "" && !output.max_quantity)
      output.blockers.push("INVALID_MAX_QUANTITY");
    if (
      output.min_quantity &&
      output.max_quantity &&
      Number(output.min_quantity) > Number(output.max_quantity)
    )
      output.blockers.push("INCONSISTENT_QUANTITY_RANGE");
    return output;
  }
  const quantityNode = quantities.length === 1 ? quantities.first() : null;
  const onlyOffer = product && parentOffers.length === 1 ? parentOffers[0] : {};
  const eligibleQuantity = object(onlyOffer.eligibleQuantity);
  result.purchase = purchase(
    result.prices,
    quantityNode?.attr("min") ?? eligibleQuantity.minValue,
    quantityNode?.attr("step") ?? eligibleQuantity.stepValue,
    quantityNode?.attr("max") ?? eligibleQuantity.maxValue,
    quantityNode?.attr("value"),
    quantityNode
      ? ev(locator(quantityNode.get(0)!))
      : product && onlyOffer.eligibleQuantity
        ? ev(product.__locator + ".offers.eligibleQuantity")
        : null,
  );
  if (kind === "PRODUCT")
    purchaseRoot.find("select").each((_i, node) => {
      if (!retained($, node) || !$(node).attr("name")) return;
      const item = $(node),
        id = item.attr("id"),
        labels = id
          ? root
              .find("label")
              .filter((_i, label) => $(label).attr("for") === id)
          : null;
      const options = item
        .find("option")
        .toArray()
        .map((option) => ({
          value: $(option).attr("value") ?? $(option).text(),
          label: $(option).text(),
          selected: $(option).attr("selected") !== undefined,
          disabled: $(option).attr("disabled") !== undefined,
        }));
      if (options.length > COMMERCE_LIMITS.options)
        throw new Error("Commerce option observation limit exceeded");
      result.selections.push({
        name: item.attr("name")!,
        label: labels?.first().text() ?? item.attr("aria-label") ?? "",
        required: item.attr("required") !== undefined,
        options,
        evidence: ev(locator(node)),
      });
    });
  if (result.selections.length > COMMERCE_LIMITS.selections)
    throw new Error("Commerce selection limit exceeded");
  if (product) {
    if (array(product.hasVariant).length > COMMERCE_LIMITS.variants)
      throw new Error("Commerce variant observation limit exceeded");
    const variants = array(product.hasVariant).map((value, index) => ({
      value: object(value),
      where: product.__locator + `.hasVariant[${index}]`,
    }));
    for (const [index, offer] of array(product.offers).entries()) {
      const row = object(offer),
        item = object(row.itemOffered);
      if (
        array(row["@type"]).includes("Offer") &&
        array(item["@type"]).includes("Product") &&
        boundOffers(row, item, product.__locator + `.offers[${index}]`)
          .length === 1
      )
        variants.push({
          value: { ...item, offers: row },
          where: product.__locator + `.offers[${index}].itemOffered`,
        });
    }
    if (variants.length > COMMERCE_LIMITS.variants)
      throw new Error("Commerce variant observation limit exceeded");
    for (const { value, where } of variants) {
      if (!array(value["@type"]).includes("Product")) continue;
      if (structuredIdentity(value) === false) {
        result.limitations.push(
          `Unbound variant identity was not promoted: ${where}`,
        );
        continue;
      }
      const attributes: Record<string, CommerceFact<string>> = Object.create(
        null,
      );
      for (const key of ["color", "size", "material", "pattern"] as const)
        if (string(value[key]))
          attributes[key] = fact(string(value[key]), where + "." + key);
      for (const [index, property] of array(
        value.additionalProperty,
      ).entries()) {
        const p = object(property),
          name = string(p.name),
          observed = string(p.value);
        if (name && observed)
          attributes[name] = fact(
            observed,
            where + `.additionalProperty[${index}]`,
          );
      }
      const sku = string(value.sku),
        url = string(value.url),
        safe = url ? target(url, base, identity.origin) : null;
      if (!Object.keys(attributes).length && !sku && !safe) {
        result.limitations.push(
          "Variant without an explicit identity/attribute observation was not materialized",
        );
        continue;
      }
      const acceptedOffers = boundOffers(
        value.offers,
        value,
        where + ".offers",
      );
      const prices = offerPrices(acceptedOffers, where + ".offers");
      const offer = acceptedOffers.length === 1 ? acceptedOffers[0] : {};
      const eligible = object(offer.eligibleQuantity);
      const id = `variant_${digest(
        identity.crawl_key +
          ":" +
          JSON.stringify([
            sku,
            safe,
            Object.entries(attributes)
              .map(([key, field]) => [key, field.value])
              .sort(([a], [b]) => String(a).localeCompare(String(b))),
          ]),
      )}`;
      if (result.variants.some((variant) => variant.id === id))
        throw new Error("Duplicate observed variant identity requires review");
      result.variants.push({
        id,
        source_url: safe ? identity.origin + safe : null,
        sku: fact(sku, where + ".sku"),
        attributes,
        prices,
        purchase: purchase(
          prices,
          eligible.minValue,
          eligible.stepValue,
          eligible.maxValue,
          null,
          ev(where + ".offers.eligibleQuantity"),
        ),
        evidence: ev(where),
      });
    }
  }
  if (result.variants.length > COMMERCE_LIMITS.variants)
    throw new Error("Commerce variant observation limit exceeded");
  if (
    result.variants.length ||
    result.selections.some((selection) => selection.required)
  )
    result.purchase.blockers.push("VARIANT_SELECTION_REQUIRED");
  const link = (node: Element) => {
    if (
      !retained($, node) ||
      Object.keys(node.attribs).some((key) => /^on/i.test(key)) ||
      $(node).is('[role="button"],[data-cart],[data-action]')
    )
      return null;
    const raw = $(node).attr("href") ?? "",
      route = target(raw, base, identity.origin);
    if (!route) return null;
    return {
      label: $(node).text(),
      request_target: route,
      evidence: ev(locator(node)),
    };
  };
  root.find("a[href]").each((_i, node) => {
    const value = link(node);
    if (value) result.links.push(value);
  });
  root
    .find(
      '.breadcrumb a[href],[aria-label="breadcrumb"] a[href],[aria-label="Хлебные крошки"] a[href]',
    )
    .each((_i, node) => {
      const value = link(node);
      if (value) result.breadcrumbs.push(value);
    });
  root.find("img[src]").each((_i, node) => {
    if (!retained($, node) || !$(node).attr("src")?.trim()) return;
    try {
      const image = identifyUrl($(node).attr("src")!, base);
      if (image.origin === identity.origin)
        result.images.push({
          source_url: image.crawl_key,
          alt: $(node).attr("alt") ?? "",
          asset_sha256: options.verifiedAsset?.(image.crawl_key) ?? null,
          evidence: ev(locator(node)),
        });
    } catch {
      /* No image fallback is inferred. */
    }
  });
  if (
    result.links.length > COMMERCE_LIMITS.links ||
    result.images.length > COMMERCE_LIMITS.images
  )
    throw new Error("Commerce presentation observation limit exceeded");
  return result;
}
