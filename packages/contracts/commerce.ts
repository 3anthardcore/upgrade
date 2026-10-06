/** Observations only: this contract never grants source access or target readiness. */
export interface CommerceEvidence {
  source_url: string;
  observed_at: string;
  locator: string;
  snapshot_sha256: string;
  trust: "untrusted-source-data";
}
export interface CommerceFact<T> {
  value: T | null;
  status: "OBSERVED" | "UNKNOWN" | "REQUIRES_REVIEW";
  evidence: CommerceEvidence | null;
  reason: string | null;
}
export type CommercePageKind =
  | "PRODUCT"
  | "CATEGORY"
  | "HOME"
  | "ARTICLE"
  | "SERVICE"
  | "CONTENT"
  | "UNKNOWN";
export interface CommerceMoney {
  /** Canonical nonnegative decimal; never a binary floating-point amount. */
  decimal: string;
  currency: string;
  /** Null when scale/currency/overflow cannot be represented safely. */
  minor: number | null;
}
export interface CommercePrice {
  id: string;
  role: "CURRENT" | "OLD" | "FROM" | "RANGE" | "UNKNOWN";
  status: "OBSERVED" | "UNKNOWN" | "REQUIRES_REVIEW";
  raw_text: string;
  money: CommerceMoney | null;
  maximum: CommerceMoney | null;
  unit: string | null;
  conditions: string[];
  totals_eligible: boolean;
  evidence: CommerceEvidence;
}
export interface CommercePurchase {
  price_id: string | null;
  /** Exact observed positive decimals only; absent source constraints remain null. */
  min_quantity: string | null;
  quantity_step: string | null;
  max_quantity: string | null;
  default_quantity: string | null;
  quantity_evidence: CommerceEvidence | null;
  blockers: string[];
}
export interface CommerceVariant {
  id: string;
  source_url: string | null;
  sku: CommerceFact<string>;
  attributes: Record<string, CommerceFact<string>>;
  prices: CommercePrice[];
  purchase: CommercePurchase;
  evidence: CommerceEvidence;
}
export interface CommerceSelection {
  name: string;
  label: string;
  required: boolean;
  options: {
    value: string;
    label: string;
    selected: boolean;
    disabled: boolean;
  }[];
  evidence: CommerceEvidence;
}
export interface CommerceLink {
  label: string;
  request_target: string;
  evidence: CommerceEvidence;
}
export interface CommerceObservation {
  schema_version: 1;
  entity_source_id: string;
  source_url: string;
  request_target: string;
  page_kind: CommerceFact<CommercePageKind>;
  product: {
    name: CommerceFact<string>;
    brand: CommerceFact<string>;
    sku: CommerceFact<string>;
    availability: CommerceFact<string>;
    attributes: Record<string, CommerceFact<string>>;
  };
  prices: CommercePrice[];
  purchase: CommercePurchase;
  variants: CommerceVariant[];
  selections: CommerceSelection[];
  breadcrumbs: CommerceLink[];
  links: CommerceLink[];
  images: {
    source_url: string;
    alt: string;
    asset_sha256: string | null;
    evidence: CommerceEvidence;
  }[];
  limitations: string[];
}
export interface CommerceModel {
  schema_version: 1;
  entries: CommerceObservation[];
}
export const COMMERCE_LIMITS = Object.freeze({
  prices: 200,
  variants: 200,
  selections: 100,
  options: 500,
  links: 2000,
  images: 1000,
  quantityMaximum: "1000000",
  decimalPlaces: 6,
});
