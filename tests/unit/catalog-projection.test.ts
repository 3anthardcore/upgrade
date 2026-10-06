import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectNativeCatalog,
  writeCatalogProjection,
} from "../../packages/bitrix-adapter/catalog.ts";
import type {
  CommerceObservation,
  CommerceEvidence,
  CommerceFact,
} from "../../packages/contracts/commerce.ts";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const evidence: CommerceEvidence = {
  source_url: "https://catalog.example/item?x=1&x=2",
  observed_at: "2026-09-30T09:00:00Z",
  locator: "#price",
  snapshot_sha256: sha("snapshot"),
  trust: "untrusted-source-data",
};
const fact = <T>(value: T): CommerceFact<T> => ({
  value,
  status: "OBSERVED",
  evidence,
  reason: null,
});
function observation(id = "legacy-page"): CommerceObservation {
  return {
    schema_version: 1,
    entity_source_id: id,
    source_url: evidence.source_url,
    request_target: "/item?x=1&x=2",
    page_kind: fact("PRODUCT"),
    product: {
      name: fact("Observed item"),
      brand: fact("Observed brand"),
      sku: fact("SAME-SKU"),
      availability: {
        value: null,
        status: "UNKNOWN",
        evidence: null,
        reason: "not observed",
      },
      attributes: {},
    },
    prices: [
      {
        id: "current",
        role: "CURRENT",
        status: "OBSERVED",
        raw_text: "0.10 RUB per piece",
        money: { decimal: "0.10", currency: "RUB", minor: 10 },
        maximum: null,
        unit: "piece",
        conditions: [],
        totals_eligible: true,
        evidence,
      },
    ],
    purchase: {
      price_id: "current",
      min_quantity: "0.5",
      quantity_step: "0.5",
      max_quantity: "10",
      default_quantity: "1",
      quantity_evidence: evidence,
      blockers: [],
    },
    variants: [],
    selections: [],
    breadcrumbs: [],
    links: [],
    images: [],
    limitations: [],
  };
}
function project(entries: CommerceObservation[], extra = {}) {
  return projectNativeCatalog({
    projectId: "catalog-test",
    targetId: "target-1",
    contentManifestSha256: sha("content"),
    modelSha256: sha("model"),
    entities: entries.map((e) => ({
      source_id: e.entity_source_id,
      stable_key: sha("Page:" + e.entity_source_id),
      payload_sha256: sha("payload:" + e.entity_source_id),
      source_url: e.source_url,
      title: "Observed page",
    })),
    commerce: { schema_version: 1, entries },
    ...extra,
  });
}

test("native overlay preserves existing Page key and exact URL, decimal and unknown stock", () => {
  const e = observation();
  const p = project([e]);
  assert.equal(p.products[0]!.page.stable_key, sha("Page:legacy-page"));
  assert.equal(p.products[0]!.page.source_url, evidence.source_url);
  assert.equal(p.products[0]!.price!.decimal, "0.10");
  assert.equal(p.products[0]!.price!.minor, 10);
  assert.equal(
    p.products[0]!.observation.product.availability.status,
    "UNKNOWN",
  );
  assert.equal(p.state, "PARTIAL");
  assert.equal(p.runtime_verification, "NOT_RUN");
  assert.ok(p.limitations.includes("STOCK_AND_AVAILABILITY_NOT_IMPORTED"));
});
test("only four observed combinations become offers and equal SKUs under two parents remain distinct", () => {
  const a = observation("first"),
    b = observation("second");
  for (const e of [a, b]) {
    e.selections = [
      {
        name: "size",
        label: "Size",
        required: true,
        options: ["S", "M"].map((value) => ({
          value,
          label: value,
          selected: false,
          disabled: false,
        })),
        evidence,
      },
      {
        name: "colour",
        label: "Colour",
        required: true,
        options: ["R", "G", "B"].map((value) => ({
          value,
          label: value,
          selected: false,
          disabled: false,
        })),
        evidence,
      },
    ];
    e.variants = [
      ["S", "R"],
      ["S", "B"],
      ["M", "G"],
      ["M", "B"],
    ].map(([size, colour], i) => ({
      id: "observed-" + i,
      source_url: null,
      sku: fact("SAME-SKU"),
      attributes: { size: fact(size!), colour: fact(colour!) },
      prices: structuredClone(e.prices),
      purchase: structuredClone(e.purchase),
      evidence,
    }));
  }
  const p = project([a, b]);
  assert.deepEqual(
    p.products.map((x) => x.offers.length),
    [4, 4],
  );
  assert.equal(
    new Set(p.products.flatMap((x) => x.offers.map((v) => v.offer_key))).size,
    8,
  );
  assert.ok(p.products.every((x) => x.price === null));
  assert.deepEqual(
    p.products[0]!.offers.map((v) => Object.values(v.attributes)),
    [
      ["S", "R"],
      ["S", "B"],
      ["M", "G"],
      ["M", "B"],
    ],
  );
});
test("old/from/range/ambiguous, units, quantity and amount mismatches never become native chargeable prices", () => {
  const cases: ((e: CommerceObservation) => void)[] = [
    (e) => {
      e.prices[0]!.role = "OLD";
    },
    (e) => {
      e.prices[0]!.role = "FROM";
    },
    (e) => {
      e.prices[0]!.role = "RANGE";
    },
    (e) => {
      e.prices[0]!.status = "REQUIRES_REVIEW";
    },
    (e) => {
      e.prices[0]!.unit = null;
    },
    (e) => {
      e.purchase.min_quantity = null;
    },
    (e) => {
      e.purchase.quantity_evidence = null;
    },
    (e) => {
      e.purchase.quantity_step = "0";
    },
    (e) => {
      e.prices[0]!.money!.minor = 11;
    },
    (e) => {
      e.prices[0]!.conditions = ["only with subscription"];
    },
    (e) => {
      e.prices.push(structuredClone(e.prices[0]!));
    },
    (e) => {
      e.prices[0]!.money!.decimal = "1e2";
    },
    (e) => {
      e.purchase.min_quantity = "0.3";
    },
    (e) => {
      e.purchase.max_quantity = "0.1";
    },
  ];
  for (const mutate of cases) {
    const e = observation();
    mutate(e);
    const x = project([e]).products[0]!;
    assert.equal(x.price, null);
    assert.ok(x.blockers.length > 0);
    assert.equal(x.observation.prices.length, e.prices.length);
  }
});
test("categories require explicit observed mapping and never inherit navigation membership", () => {
  const e = observation();
  e.breadcrumbs = [
    { label: "Speculative category", request_target: "/category", evidence },
  ];
  assert.deepEqual(project([e]).categories, []);
  const c = observation("category");
  c.page_kind = fact("CATEGORY");
  c.source_url = "https://catalog.example/category";
  const p = project([e, c], {
    categoryMappings: [
      {
        category_source_id: "category",
        product_source_ids: [e.entity_source_id],
        evidence,
      },
    ],
  });
  assert.equal(p.categories.length, 1);
  assert.deepEqual(p.products[0]!.category_keys, [
    p.categories[0]!.category_key,
  ]);
  assert.throws(
    () =>
      project([e], {
        categoryMappings: [
          {
            category_source_id: e.entity_source_id,
            product_source_ids: [e.entity_source_id],
            evidence,
          },
        ],
      }),
    /CATEGORY_NOT_OBSERVED/,
  );
});
test("identity and incomplete variant evidence are rejected; immutable projection file cannot be overwritten", (t) => {
  const e = observation();
  assert.throws(() => project([e, e]), /REFERENCE_INVALID|DUPLICATE/);
  e.variants = [
    {
      id: "v",
      source_url: null,
      sku: fact("x"),
      attributes: {
        size: {
          value: null,
          status: "UNKNOWN",
          evidence: null,
          reason: "unknown",
        },
      },
      prices: [],
      purchase: e.purchase,
      evidence,
    },
  ];
  assert.throws(() => project([e]), /ATTRIBUTES_INCOMPLETE/);
  const dir = mkdtempSync(join(tmpdir(), "catalog-projection-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = project([observation()]);
  const f = join(dir, "catalog.json");
  const result = writeCatalogProjection(f, p);
  assert.equal(result.sha256, sha(readFileSync(f, "utf8")));
  assert.throws(() => writeCatalogProjection(f, p), /EEXIST/);
});

test("a price or quantity evidence from another page cannot donate a native chargeable amount", () => {
  const e = observation();
  e.prices[0]!.evidence = {
    ...evidence,
    source_url: "https://catalog.example/foreign",
  };
  const p = project([e]).products[0]!;
  assert.equal(p.price, null);
  assert.ok(p.blockers.includes("PRICE_SOURCE_PAGE_MISMATCH"));
  const f = observation();
  f.product.sku.evidence = {
    ...evidence,
    source_url: "https://catalog.example/foreign",
  };
  assert.throws(() => project([f]), /FACT_EVIDENCE_PAGE_MISMATCH/);
});
