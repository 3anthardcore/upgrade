import type { CrawlResult } from "../crawler/index.ts";
import { identifyUrl } from "../crawler/index.ts";
import type { ContentModel } from "../extractor/index.ts";

export interface PlannedRoute {
  source_url: string;
  source_origin: string;
  request_target: string;
  target_route: string;
  page_type: string;
  entity_source_id: string | null;
  expected_status: number;
  redirect_to: string | null;
  query_policy: "preserve-exact";
  query_parameters: { raw: string; name: string; classification: string }[];
  canonical_url: string | null;
  reason: string;
  rule_version: 1;
  tests: string[];
  source_status: string;
}
export interface RouteManifest {
  schema_version: 1;
  project_id: string;
  source_scope_count: number;
  mapped_count: number;
  routes: PlannedRoute[];
  exclusions: { source_url: string; reason: string; rule: string }[];
  unresolved: { source_url: string; reason: string }[];
  conflicts: { source_url: string; reason: string }[];
  origin_map: Record<string, string>;
  limitations: string[];
}
export function planRoutes(
  crawl: CrawlResult,
  model: ContentModel,
  options: { demoOrigin?: string; physicalPaths?: string[] } = {},
): RouteManifest {
  if (crawl.project_id !== model.project_id)
    throw new Error("Route/model project mismatch");
  const demoOrigin = options.demoOrigin
    ? identifyUrl(options.demoOrigin).origin
    : "https://demo.invalid";
  const manifest: RouteManifest = {
    schema_version: 1,
    project_id: crawl.project_id,
    source_scope_count: crawl.entries.length,
    mapped_count: 0,
    routes: [],
    exclusions: [],
    unresolved: [],
    conflicts: [],
    origin_map: { [crawl.source_origin]: demoOrigin },
    limitations: [],
  };
  for (const entry of crawl.entries) {
    if (entry.status === "EXCLUDED") {
      manifest.exclusions.push({
        source_url: entry.crawl_key,
        reason: entry.reason ?? "Excluded",
        rule: entry.rule ?? "unspecified",
      });
      continue;
    }
    if (
      !["FETCHED", "RENDERED"].includes(entry.status) ||
      entry.http_status === undefined
    ) {
      manifest.unresolved.push({
        source_url: entry.crawl_key,
        reason: entry.reason ?? entry.status,
      });
      continue;
    }
    const pathname = entry.request_target.split("?")[0];
    const decodedForCollision = (() => {
      try {
        return decodeURIComponent(pathname);
      } catch {
        return pathname;
      }
    })();
    if (
      /^\/(bitrix|local|upload|api|upgrade)(?:\/|$)/i.test(
        decodedForCollision,
      ) ||
      options.physicalPaths?.includes(pathname)
    ) {
      manifest.conflicts.push({
        source_url: entry.crawl_key,
        reason: "Reserved or physical target path collision",
      });
      continue;
    }
    const entity = model.entities.find(
      (item) => item.source_url === entry.crawl_key,
    );
    if (entry.http_status === 200 && !entity) {
      manifest.unresolved.push({
        source_url: entry.crawl_key,
        reason: "HTTP 200 has no extracted content entity",
      });
      continue;
    }
    const query = entry.request_target.includes("?")
      ? entry.request_target.slice(entry.request_target.indexOf("?") + 1)
      : "";
    const queryParameters = query
      ? query.split("&").map((raw) => {
          let name = raw.split("=")[0];
          try {
            name = decodeURIComponent(name.replace(/\+/g, " "));
          } catch {
            /* preserve invalid literal */
          }
          const classification = /^(utm_.+|gclid|yclid|fbclid)$/i.test(name)
            ? "tracking"
            : /^(page|p|PAGEN_\d+)$/i.test(name)
              ? "pagination"
              : /^(sort|order)$/i.test(name)
                ? "sort"
                : /^(variant|offer|color|size)$/i.test(name)
                  ? "variant"
                  : "unknown-preserved";
          return { raw, name, classification };
        })
      : [];
    let redirectTo: string | null = null;
    if (entry.redirect_chain.length) {
      const next = identifyUrl(entry.redirect_chain[0].location);
      redirectTo =
        next.origin === crawl.source_origin
          ? next.request_target
          : next.crawl_key;
    }
    manifest.routes.push({
      source_url: entry.crawl_key,
      source_origin: crawl.source_origin,
      request_target: entry.request_target,
      target_route: entry.request_target,
      page_type:
        entity?.page_type ??
        (entry.http_status === 404 ? "not-found" : "redirect"),
      entity_source_id: entity?.source_id ?? null,
      expected_status: entry.http_status,
      redirect_to: redirectTo,
      query_policy: "preserve-exact",
      query_parameters: queryParameters,
      canonical_url: entry.canonical_url
        ? (() => {
            const canonical = identifyUrl(entry.canonical_url!);
            return canonical.origin === crawl.source_origin
              ? demoOrigin + canonical.request_target
              : canonical.crawl_key;
          })()
        : null,
      reason: "Preserve observed source request target and status",
      rule_version: 1,
      tests: [
        "exact-request-target",
        "expected-http-status",
        ...(entity ? ["source-content-evidence"] : []),
      ],
      source_status: entry.status,
    });
  }
  manifest.mapped_count = manifest.routes.length;
  if (
    manifest.unresolved.length ||
    manifest.conflicts.length ||
    crawl.state !== "COMPLETE"
  )
    manifest.limitations.push(
      "Route completeness is not established; unresolved scope or blocking collisions remain.",
    );
  manifest.limitations.push(
    "Query variants are exact observed routes; unbounded parameter spaces require explicit behavior contracts.",
  );
  return manifest;
}
