import type { CommerceEvidence, CommerceObservation } from "./commerce.ts";

/** A separate overlay: page identity and URL ownership are never regenerated. */
export interface CatalogPageReference {
  source_id: string;
  stable_key: string;
  payload_sha256: string;
  source_url: string;
  title: string;
}
export interface CatalogExactPrice {
  source_price_id: string;
  decimal: string;
  currency: "RUB" | "USD" | "EUR";
  minor: number;
  unit: string;
  min_quantity: string;
  quantity_step: string;
  max_quantity: string | null;
  evidence: CommerceEvidence;
  quantity_evidence: CommerceEvidence;
}
export interface CatalogOffer {
  offer_key: string;
  observed_variant_id: string;
  source_url: string | null;
  sku: string | null;
  attributes: Record<string, string>;
  evidence: CommerceEvidence;
  price: CatalogExactPrice | null;
  blockers: string[];
}
export interface CatalogCategory {
  category_key: string;
  page: CatalogPageReference;
  name: string;
  evidence: CommerceEvidence;
  observation: CommerceObservation;
}
export interface CatalogProduct {
  page: CatalogPageReference;
  category_keys: string[];
  sku: string | null;
  attributes: Record<string, string>;
  price: CatalogExactPrice | null;
  offers: CatalogOffer[];
  blockers: string[];
  /** Source evidence remains inspectable, including unknown availability/controls. */
  observation: CommerceObservation;
}
export interface CatalogProjection {
  schema_version: 1;
  kind: "native-catalog-overlay";
  project_id: string;
  target_id: string;
  content_manifest_sha256: string;
  model_sha256: string;
  state: "PARTIAL";
  runtime_verification: "NOT_RUN";
  categories: CatalogCategory[];
  products: CatalogProduct[];
  blockers: string[];
  limitations: string[];
}
export interface CatalogTargetProfile {
  schema_version: 1;
  project_id: string;
  target_id: string;
  /** Existing content iblock; may never be replaced by a Product-derived identity. */
  product_iblock_id: number;
  /** Explicitly provisioned dedicated offers iblock and E property linked to products. */
  offers_iblock_id: number;
  sku_property_id: number;
  product_metadata_property_id: number;
  offer_metadata_property_id: number;
  price_group_id: number;
  measures: Record<string, { id: number; code: number }>;
  /** Explicit authorization of catalog registration, not native sale enablement. */
  sale_policy: "isolated-demo-no-orders";
}
