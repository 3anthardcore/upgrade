import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  extractCommerceObservation,
  commerceDecimal,
} from "../../packages/extractor/commerce.ts";
import { extractOperatorContent } from "../../packages/extractor/operator.ts";
import type { ValidatedOperatorCapture } from "../../packages/crawler/operator.ts";

const origin = "https://commerce.example";
const url = origin + "/catalog/item?option=one&option=two&empty=";
const sha = (input: string) => createHash("sha256").update(input).digest("hex");
const entityId = "operator_entity_" + sha(url).slice(0, 24);
const page = (body: string, head = "") =>
  `<!doctype html><html><head><title>Observed item</title>${head}</head><body><main>${body}</main></body></html>`;
const controls =
  '<input name="quantity" min="0.5" step="0.5" max="100" value="1">';
const product = (prices: string, extra = "", quantity = controls) =>
  page(
    `<h1>Source item</h1><div class="stock">В наличии</div><table><tr><th>Бренд</th><td>Actual brand</td></tr><tr><th>Артикул</th><td>000123</td></tr></table><div id="product">${quantity}${prices}${extra}</div>`,
  );
function extract(html: string, source = url) {
  return extractCommerceObservation(html, {
    entitySourceId: source === url ? entityId : "entity_other",
    sourceUrl: source,
    documentUrl: source,
    observedAt: "2026-09-30T03:00:00.000Z",
    snapshotSha256: sha(html),
    primarySelector: "main",
  });
}

test("nested structured offer identities cannot donate foreign prices, stock, quantities or variants", () => {
  const offer = {
    "@type": "Offer",
    price: "100",
    priceCurrency: "RUB",
    availability: "https://schema.org/InStock",
    priceSpecification: { unitText: "piece" },
    eligibleQuantity: { minValue: "1", stepValue: "1" },
  };
  for (const changed of [
    { ...offer, url: "https://foreign.example/item" },
    { ...offer, url: origin + "/unrelated" },
    {
      ...offer,
      itemOffered: {
        "@type": "Product",
        url: "https://foreign.example/item",
        sku: "FOREIGN-SKU",
      },
    },
    {
      ...offer,
      url: origin + "/unrelated",
      itemOffered: { "@type": "Product", url, sku: "FOREIGN-SKU" },
    },
  ]) {
    const data = {
      "@context": "https://schema.org",
      "@type": "Product",
      url,
      name: "Bound product",
      offers: changed,
    };
    const result = extract(
      page(
        "<h1>Bound product</h1>",
        `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
      ),
    );
    assert.deepEqual(result.prices, []);
    assert.equal(result.product.availability.value, null);
    assert.equal(result.purchase.min_quantity, null);
    assert.equal(result.purchase.quantity_step, null);
    assert.deepEqual(result.variants, []);
    assert.ok(result.limitations.some((value) => /identity/.test(value)));
  }
});

test("a FROM marker in a separate visible sibling remains a non-exact price", () => {
  for (const marker of ["<span>от </span>", "<b>from</b>\n ", "от "]) {
    const result = extract(
      product(`${marker}<span class="price_new">100 р. / шт.</span>`),
    );
    assert.equal(result.prices[0].role, "FROM");
    assert.equal(result.prices[0].totals_eligible, false);
    assert.equal(result.purchase.price_id, null);
  }
});

test("Offer.lowPrice alone never becomes an exact CURRENT price", () => {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    url,
    offers: {
      "@type": "Offer",
      lowPrice: "1",
      priceCurrency: "RUB",
      priceSpecification: { unitText: "piece" },
      eligibleQuantity: { minValue: "1", stepValue: "1" },
    },
  };
  const result = extract(
    page(
      "<h1>Bound product</h1>",
      `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
    ),
  );
  assert.equal(result.prices[0].role, "FROM");
  assert.equal(result.prices[0].money?.decimal, "1");
  assert.equal(result.prices[0].totals_eligible, false);
  assert.equal(result.purchase.price_id, null);
});

test("metadata cannot replace contradictory visible money or erase source price conditions", () => {
  for (const html of [
    '<span class="price_new" content="1">100 р. / шт.</span>',
    '<span class="price_new" content="100">100 р. / шт. для владельцев карты</span>',
    '<span class="price_new" data-currency="EUR">100 USD / шт.</span>',
    '<span class="price_new" data-unit="m2">100 р. / шт.</span>',
    '<span class="price_new" content="100" data-currency="RUB">100 р. 200 USD / шт.</span>',
  ]) {
    const result = extract(product(html));
    assert.equal(result.prices[0].totals_eligible, false, html);
    assert.ok(result.purchase.blockers.length > 0, html);
    assert.ok(result.prices[0].conditions.length > 0, html);
  }
  const consistent = extract(
    product(
      '<span class="price_new" content="100" data-currency="RUB" data-unit="piece">100 р. / шт.</span>',
    ),
  );
  assert.equal(consistent.prices[0].totals_eligible, true);
});

test("visible amount and metadata matrix never substitutes a conflicting or invalid amount", () => {
  for (const visible of ["100", "100 RUB / шт.", "invalid"]) {
    for (const content of [undefined, "100", "200", "oops"]) {
      for (const currency of [undefined, "RUB", "USD"]) {
        const attrs = `data-unit="piece"${content === undefined ? "" : ` content="${content}"`}${currency === undefined ? "" : ` data-currency="${currency}"`}`;
        const html = `<span class="price_new" ${attrs}>${visible}</span>`;
        const result = extract(
          product(html, "", '<input name="quantity" min="1" step="1">'),
        );
        const visibleValid = visible !== "invalid";
        const currencyKnown = visible.includes("RUB") || currency !== undefined;
        const currencyAgrees =
          !visible.includes("RUB") ||
          currency === undefined ||
          currency === "RUB";
        const amountAgrees = content === undefined || content === "100";
        const eligible =
          visibleValid && currencyKnown && currencyAgrees && amountAgrees;
        assert.equal(result.prices[0].totals_eligible, eligible, html);
        if (eligible) {
          assert.equal(result.prices[0].money?.decimal, "100");
          assert.deepEqual(result.purchase.blockers, []);
        } else assert.ok(result.purchase.blockers.length > 0, html);
        if (content === "200" && visibleValid)
          assert.notEqual(result.prices[0].money?.decimal, "200", html);
      }
    }
  }
});

test("adjacent currency, FROM positions, conflicting roles, units and conditions fail conservatively", () => {
  for (const markup of [
    '<span>от</span><span class="price_new">100 RUB / шт.</span>',
    '<span class="price_new">от100 RUB / шт.</span>',
    '<span class="price_new">100 RUB / шт. от</span>',
    '<span class="price_new">100 RUB / шт.</span><span>от</span>',
    '<span class="price_new" data-currency="RUB" data-unit="piece" content="100">200</span>',
    '<span class="price_new" data-currency="RUB" data-unit="piece">100</span><span>USD</span>',
    '<span class="price_new" data-currency="RUB">100 RUB / шт.</span><span>EUR</span>',
    '<span class="price_new price_old">100 RUB / шт.</span>',
    '<span class="price_new" data-price-role="old">100 RUB / шт.</span>',
    '<span class="price_old" data-price-role="current">100 RUB / шт.</span>',
    '<span class="price_old old_new_price" data-price-role="current">100 RUB / шт.</span>',
    '<span class="price_new" data-price-role="from">100 RUB / шт.</span>',
    '<del><span class="price_new">100 RUB / шт.</span></del>',
    '<span class="price_new" data-unit="m2">100 RUB / шт.</span>',
    '<span class="price_new">100 RUB / шт. / м²</span>',
    '<span class="price_new" content="100">100 RUB / шт.</span><span>только для владельцев карты</span>',
    '<span class="price_new" content="100">100 RUB / шт. только для владельцев карты</span>',
  ]) {
    const result = extract(
      product(markup, "", '<input name="quantity" min="1" step="1">'),
    );
    assert.ok(result.prices.length > 0, markup);
    assert.ok(
      result.prices.every((price) => !price.totals_eligible),
      markup,
    );
    assert.ok(result.purchase.blockers.length > 0, markup);
  }
  const hidden = extract(
    product(
      '<span class="price_new"><b hidden>100 RUB / шт.</b></span>',
      "",
      '<input name="quantity" min="1" step="1">',
    ),
  );
  assert.deepEqual(hidden.prices, []);
  assert.ok(hidden.purchase.blockers.length > 0);
});

test("current/old prices, exact minor units, quantity constraints and product facts retain source evidence", () => {
  const html = product(
    '<span class="price_old">3 350 р. / м²</span><span class="price_new">2 178,50 р. / м²</span>',
  );
  const result = extract(html);
  assert.equal(result.page_kind.value, "PRODUCT");
  assert.equal(result.product.brand.value, "Actual brand");
  assert.equal(result.product.sku.value, "000123");
  assert.equal(result.product.availability.value, "В наличии");
  const price = result.prices.find((price) => price.role === "CURRENT")!;
  assert.deepEqual(price.money, {
    decimal: "2178.5",
    currency: "RUB",
    minor: 217850,
  });
  assert.equal(price.unit, "m2");
  assert.equal(price.totals_eligible, true);
  assert.equal(price.evidence.snapshot_sha256, sha(html));
  assert.equal(price.evidence.trust, "untrusted-source-data");
  assert.equal(
    result.prices.find((price) => price.role === "OLD")!.totals_eligible,
    false,
  );
  assert.deepEqual(result.purchase.blockers, []);
  assert.equal(result.purchase.price_id, price.id);
  assert.equal(result.purchase.min_quantity, "0.5");
  assert.equal(result.purchase.quantity_step, "0.5");
  assert.equal(result.purchase.max_quantity, "100");
});

test("from/range, conditional, ambiguous currency and missing-unit prices cannot authorize totals", () => {
  for (const [text, role] of [
    ["от 100 р. / шт.", "FROM"],
    ["100 р. — 200 р. / шт.", "RANGE"],
  ]) {
    const result = extract(product(`<span class="price_new">${text}</span>`));
    assert.equal(result.prices[0].role, role);
    assert.equal(result.prices[0].totals_eligible, false);
    assert.ok(result.purchase.blockers.includes("CURRENT_EXACT_PRICE_UNKNOWN"));
  }
  const condition = extract(
    product(
      '<span class="price_new" data-condition="Только от 10 упаковок">100 р. / упак.</span>',
    ),
  );
  assert.deepEqual(condition.prices[0].conditions, ["Только от 10 упаковок"]);
  assert.equal(condition.prices[0].totals_eligible, false);
  for (const text of [
    "100 $ / шт.",
    "Цена по запросу",
    "100 р.",
    "1,234 р. / шт.",
    "100 р. 200 р. / шт.",
    "-100 р. / шт.",
    ".99 р. / шт.",
    "1e3 р. / шт.",
  ]) {
    const result = extract(product(`<span class="price_new">${text}</span>`));
    assert.equal(result.prices[0].totals_eligible, false, text);
    assert.ok(result.purchase.blockers.length > 0, text);
  }
});

test("structured aggregate range and Offer.itemOffered variants remain bounded explicit observations", () => {
  const base = {
    "@context": "https://schema.org",
    "@type": "Product",
    url,
    name: "Observed product",
  };
  const aggregate = {
    ...base,
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "100.25",
      highPrice: "200.50",
      priceCurrency: "RUB",
    },
  };
  const range = extract(
    page(
      "<h1>Observed product</h1>",
      `<script type="application/ld+json">${JSON.stringify(aggregate)}</script>`,
    ),
  );
  assert.equal(range.prices[0].role, "RANGE");
  assert.equal(range.prices[0].maximum?.decimal, "200.5");
  assert.equal(range.prices[0].totals_eligible, false);
  const offers = {
    ...base,
    offers: ["red", "blue"].map((color, index) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Product", sku: `A${index}`, color },
      price: "100",
      priceCurrency: "RUB",
      priceSpecification: { unitText: "piece" },
      eligibleQuantity: { minValue: "1", stepValue: "1" },
    })),
  };
  const observed = extract(
    page(
      "<h1>Observed product</h1>",
      `<script type="application/ld+json">${JSON.stringify(offers)}</script>`,
    ),
  );
  assert.equal(observed.variants.length, 2);
  assert.deepEqual(
    observed.variants.map((variant) => variant.attributes.color.value),
    ["red", "blue"],
  );
  const duplicate = {
    ...base,
    hasVariant: [
      { "@type": "Product", sku: "same", color: "red" },
      { "@type": "Product", sku: "same", color: "red" },
    ],
  };
  assert.throws(
    () =>
      extract(
        page(
          "<h1>Observed product</h1>",
          `<script type="application/ld+json">${JSON.stringify(duplicate)}</script>`,
        ),
      ),
    /Duplicate observed variant identity/,
  );
});

test("two conflicting current prices and absent source quantity rules stay ambiguous", () => {
  const ambiguous = extract(
    product(
      '<span class="price_new">100 р. / шт.</span><span class="price_new">200 р. / шт.</span>',
    ),
  );
  assert.equal(ambiguous.purchase.price_id, null);
  assert.ok(ambiguous.purchase.blockers.includes("AMBIGUOUS_CURRENT_PRICE"));
  const missing = extract(
    product(
      '<span class="price_new">100 р. / шт.</span>',
      "",
      '<input name="quantity" value="1">',
    ),
  );
  assert.equal(missing.purchase.min_quantity, null);
  assert.equal(missing.purchase.quantity_step, null);
  assert.equal(missing.purchase.default_quantity, "1");
  assert.ok(missing.purchase.blockers.includes("MIN_QUANTITY_UNKNOWN"));
  assert.ok(missing.purchase.blockers.includes("QUANTITY_STEP_UNKNOWN"));
});

test("contradictory old/new class and visible purchase conditions remain nonchargeable", () => {
  const ambiguous = extract(
    product('<span class="price_old old_new_price">7264 р.</span>'),
  );
  assert.equal(ambiguous.page_kind.value, "PRODUCT");
  assert.equal(ambiguous.prices[0].role, "UNKNOWN");
  assert.equal(ambiguous.prices[0].status, "REQUIRES_REVIEW");
  assert.equal(ambiguous.purchase.price_id, null);
  const conditional = extract(
    product(
      '<span class="price_new">100 р. / шт. только при покупке от 10 шт.</span>',
    ),
  );
  assert.ok(conditional.prices[0].conditions.length > 0);
  assert.equal(conditional.prices[0].totals_eligible, false);
});

test("numeric normalization rejects overflow, unbounded quantities and binary/exponent guesses", () => {
  assert.equal(commerceDecimal("1 234,5000"), "1234.5");
  for (const input of ["1e6", "-1", "1 23", "1.234,56", "1".repeat(200)])
    assert.equal(commerceDecimal(input), null);
  const large = extract(
    product(
      '<span class="price_new">9007199254740993 р. / шт.</span>',
      "",
      '<input name="quantity" min="1000001" step="0" max="-1">',
    ),
  );
  assert.equal(large.prices[0].money?.decimal, "9007199254740993");
  assert.equal(large.prices[0].money?.minor, null);
  assert.equal(large.prices[0].totals_eligible, false);
  assert.equal(large.purchase.min_quantity, null);
  assert.equal(large.purchase.quantity_step, null);
  assert.ok(large.purchase.blockers.includes("INVALID_MAX_QUANTITY"));
});

test("only four explicitly observed variants are materialized from two-by-three option controls", () => {
  const combinations = [
    ["red", "S"],
    ["red", "M"],
    ["blue", "M"],
    ["blue", "L"],
  ];
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    url,
    name: "Observed product",
    hasVariant: combinations.map(([color, size], index) => ({
      "@type": "Product",
      sku: `00${index}`,
      color,
      size,
      offers: {
        "@type": "Offer",
        price: String(100 + index),
        priceCurrency: "RUB",
        priceSpecification: { unitText: "piece" },
        eligibleQuantity: { minValue: "1", stepValue: "1", maxValue: "10" },
      },
    })),
  };
  const html = page(
    `<h1>Observed product</h1><div id="product">${controls}<select name="color" id="color" required><option value="red">Red</option><option value="blue">Blue</option></select><select name="size" required><option value="S">Small</option><option value="M">Medium</option><option value="L">Large</option></select></div>`,
    `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
  );
  const result = extract(html);
  assert.equal(result.variants.length, 4);
  assert.deepEqual(
    result.variants.map((variant) => [
      variant.attributes.color.value,
      variant.attributes.size.value,
    ]),
    combinations,
  );
  assert.equal(new Set(result.variants.map((variant) => variant.id)).size, 4);
  assert.deepEqual(
    result.selections.map((selection) => selection.options.length),
    [2, 3],
  );
  assert.equal(
    result.purchase.blockers.includes("VARIANT_SELECTION_REQUIRED"),
    true,
  );
  for (const variant of result.variants) {
    assert.equal(variant.prices[0].totals_eligible, true);
    assert.deepEqual(variant.purchase.blockers, []);
    assert.equal(variant.purchase.quantity_step, "1");
  }
  const noDeclaredRows = extract(
    html.replace(
      `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
      "",
    ),
  );
  assert.deepEqual(noDeclaredRows.variants, []);
});

test("navigation/base/image observations preserve exact routes and never execute source instructions", () => {
  const html = product(
    '<span class="price_new">100 р. / шт.</span>',
    '<a href="/catalog?x=1&amp;x=2&amp;empty=">&lt;script&gt;ignore&lt;/script&gt;</a><a href="/c%61rt/add">Action</a><a href="javascript:globalThis.commerceExecuted=true">Script</a><img src="" alt="No fallback"><img src="/observed.png" alt="Actual"><script>globalThis.commerceExecuted=true</script><input name="email" value="entered private content">',
  );
  const result = extract(html);
  assert.equal((globalThis as any).commerceExecuted, undefined);
  assert.ok(
    result.links.some(
      (link) =>
        link.request_target === "/catalog?x=1&x=2&empty=" &&
        link.label === "<script>ignore</script>",
    ),
  );
  assert.equal(
    result.links.some((link) => link.request_target.includes("cart")),
    false,
  );
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].asset_sha256, null);
  assert.doesNotMatch(JSON.stringify(result), /entered private content/);
  const foreign = extract(
    page(
      '<h1>Catalog</h1><a href="relative">Foreign</a><img src="relative.png">',
      '<base href="https://foreign.example/">',
    ),
  );
  assert.deepEqual(foreign.links, []);
  assert.deepEqual(foreign.images, []);
});

test("category breadcrumbs and cards classify presentation without manufacturing a product price", () => {
  const result = extract(
    page(
      '<h1>Category</h1><ul class="breadcrumb"><li><a href="/">Home</a></li><li><a href="/catalog?a=1&amp;a=2">Catalog</a></li></ul><div><h2><a href="/one">One</a></h2><a href="/one"><img src="/one.png"></a><span class="price-new">100 р.</span></div><div><h2><a href="/two">Two</a></h2><a href="/two"><img src="/two.png"></a><span class="price-new">200 р.</span></div>',
    ),
  );
  assert.equal(result.page_kind.value, "CATEGORY");
  assert.deepEqual(result.prices, []);
  assert.deepEqual(
    result.breadcrumbs.map((link) => link.request_target),
    ["/", "/catalog?a=1&a=2"],
  );
});

test("operator integration preserves legacy Page identity, generic blocks and raw facts while adding sidecar before form cleanup", async () => {
  const html = product(
    '<span class="price_new">100 р. / шт.</span>',
    '<select name="size" required><option value="one">One</option></select>',
  );
  const bytes = Buffer.from(html),
    file = {
      relative_path: "page.html",
      size_bytes: bytes.length,
      sha256: sha(html),
    };
  const capture: ValidatedOperatorCapture = {
    schema_version: 1,
    kind: "validated-operator-capture",
    capture_id: "test-commerce",
    project_id: "commerce-test",
    source_origin: origin,
    manifest_sha256: "a".repeat(64),
    state: "PARTIAL",
    trust: "untrusted-source-data",
    source_access: "NOT_VERIFIED",
    server_access_block_id: "retain-source-block",
    readiness: "NOT_EVALUATED",
    inventory: [
      {
        crawl_key: url,
        request_target: new URL(url).pathname + new URL(url).search,
        raw_urls: [url],
        discovered_from: ["test"],
        observation: "DOM_OBSERVED",
      },
    ],
    coverage: {
      basis: "union-of-existing-and-observed-urls",
      known_urls: 1,
      unobserved: 0,
      selected_fields: 0,
      dom_observed: 1,
      full_source_denominator: "UNKNOWN",
    },
    observations: [
      {
        source_url: url,
        document_url: url,
        observed_at: "2026-09-30T03:00:00.000Z",
        format: "dom-html",
        file,
        trust: "untrusted-source-data",
      },
    ],
    assets: [],
    external_references: [],
    unverified_asset_urls: [],
    files: [file],
    limitations: [],
  };
  const model = await extractOperatorContent(capture, {
    readFile: () => bytes,
  });
  assert.equal(model.entities[0].source_id, entityId);
  assert.equal(model.entities[0].type, "Page");
  assert.equal(model.entities[0].facts.price.status, "UNKNOWN");
  assert.deepEqual(model.prices, []);
  assert.deepEqual(model.offers, []);
  assert.equal(model.commerce?.entries[0].page_kind.value, "PRODUCT");
  assert.equal(
    model.commerce?.entries[0].selections[0].options[0].value,
    "one",
  );
  assert.equal(
    model.commerce?.entries[0].entity_source_id,
    model.entities[0].source_id,
  );
  assert.doesNotMatch(model.entities[0].sanitized_html, /<select|<input/);
  assert.match(JSON.stringify(model.entities[0].blocks), /100 р\./);
  assert.equal(
    model.source_capture.server_access_block_id,
    "retain-source-block",
  );
});

const saved = resolve("var/pilots/teplypol-catalog-20260929");
test(
  "saved real HW-500 uses explicit DOM price roles and retains unknown unit/minimum/step",
  { skip: !existsSync(saved) },
  () => {
    const candidates = readdirSync(saved)
      .filter((name) => name.endsWith(".raw.json"))
      .map((name) => JSON.parse(readFileSync(join(saved, name), "utf8")))
      .filter(
        (raw) =>
          raw.source_url ===
          "https://teplypol-market.ru/termoregulyatory/grand-meyer-hw-500",
      )
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    assert.ok(candidates[0]);
    const raw = candidates[0];
    const result = extractCommerceObservation(raw.html, {
      entitySourceId: "operator_entity_" + sha(raw.source_url).slice(0, 24),
      sourceUrl: raw.source_url,
      documentUrl: raw.document_url,
      observedAt: raw.observed_at,
      snapshotSha256: sha(raw.html),
      primarySelector: "#content",
    });
    assert.equal(result.page_kind.value, "PRODUCT");
    assert.ok(
      result.prices.some(
        (price) => price.role === "CURRENT" && price.money?.decimal === "2178",
      ),
    );
    assert.ok(
      result.prices.some(
        (price) => price.role === "OLD" && price.money?.decimal === "3350",
      ),
    );
    assert.equal(result.purchase.min_quantity, null);
    assert.equal(result.purchase.quantity_step, null);
    assert.equal(
      result.prices.every((price) => !price.totals_eligible),
      true,
    );
    assert.deepEqual(result.variants, []);
  },
);
