import { createHash } from "node:crypto";
import type { CommerceModel, CommercePurchase } from "../contracts/commerce.ts";
import type { BitrixEntityInput, BitrixRouteInput } from "./index.ts";

/** A private, immutable projection. It does not reinterpret unknown commerce facts. */
export function projectDemoSnapshot(input: {
  projectId: string;
  entities: BitrixEntityInput[];
  routes: BitrixRouteInput[];
  commerce?: CommerceModel;
  assets: Array<{ sha256: string; mime: string; public_path: string }>;
}) {
  const byId = new Map(input.entities.map(e => [e.source_id, e]));
  const routes = new Map<string, string>();
  for (const route of input.routes) {
    const path = decodeURIComponent(route.request_target.split("?")[0]);
    if (/^\/__upgrade(?:\/|$)/i.test(path)) throw Error("DEMO_ROUTE_COLLISION");
    if ((route.expected_status ?? 200) !== 200) continue;
    const id = route.entity_source_id ?? route.source_id;
    if (id && byId.has(id)) routes.set(route.request_target, id);
  }
  const commerce = new Map((input.commerce?.entries ?? []).map(entry => [entry.entity_source_id, entry]));
  if (commerce.size !== (input.commerce?.entries.length ?? 0)) throw Error("DEMO_DUPLICATE_COMMERCE");
  for (const entry of commerce.values()) {
    if (!byId.has(entry.entity_source_id) || routes.get(entry.request_target) !== entry.entity_source_id || byId.get(entry.entity_source_id)?.source_url !== entry.source_url)
      throw Error("DEMO_COMMERCE_BINDING");
  }
  const emptyPurchase = (): CommercePurchase => ({ price_id: null, min_quantity: null, quantity_step: null, max_quantity: null, default_quantity: null, quantity_evidence: null, blockers: ["COMMERCE_NOT_OBSERVED"] });
  const items = input.entities.map(entity => {
    const observation = commerce.get(entity.source_id);
    const requestTarget = observation?.request_target ?? [...routes].find(([, id]) => id === entity.source_id)?.[0];
    if (!requestTarget) throw Error("DEMO_ENTITY_ROUTE_MISSING");
    const kind = observation?.page_kind.status === "OBSERVED" ? observation.page_kind.value : "UNKNOWN";
    const attributes: Record<string, string[]> = Object.create(null);
    for (const [name, fact] of Object.entries(observation?.product.attributes ?? {})) {
      if (fact.status === "OBSERVED" && typeof fact.value === "string" && fact.value.trim()) attributes[name] = [fact.value];
    }
    const breadcrumbs = (observation?.breadcrumbs ?? []).filter(link => routes.has(link.request_target));
    const categoryIds = [...new Set(breadcrumbs.filter(link => {
      const ancestor = commerce.get(routes.get(link.request_target)!);
      return ancestor?.page_kind.status === "OBSERVED" && ancestor.page_kind.value === "CATEGORY";
    }).map(link => routes.get(link.request_target)!))];
    const photo = observation?.images.map(image => input.assets.find(asset => asset.sha256 === image.asset_sha256 && asset.mime.startsWith("image/"))).find(Boolean);
    // Derive searchable text only from retained inert blocks, never from arbitrary object metadata.
    const blockText = (entity.blocks ?? []).flatMap((raw: any) => [raw.text, ...(raw.items ?? []), ...(raw.rows ?? []).flat()]).filter(value => typeof value === "string").join("\n");
    return { id: entity.source_id, title: entity.title, body_text: entity.body_text ?? blockText, request_target: requestTarget,
      is_product: kind === "PRODUCT", page_kind: kind, category_ids: categoryIds, attributes,
      prices: observation?.prices ?? [], purchase: observation?.purchase ?? emptyPurchase(), variants: observation?.variants ?? [],
      thumbnail: photo?.public_path ?? null, breadcrumbs };
  });
  const base = { schema_version: 1, project_id: input.projectId, items };
  const snapshot_id = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  const result = { ...base, snapshot_id };
  if (items.length > 10000 || Buffer.byteLength(JSON.stringify(result)) > 64 * 1024 * 1024) throw Error("DEMO_SNAPSHOT_LIMIT");
  return result;
}
