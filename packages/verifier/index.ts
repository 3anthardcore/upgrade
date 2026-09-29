import { load } from "cheerio";
import { safeFetch, identifyUrl } from "../crawler/network.ts";
import type { Check } from "../contracts/index.ts";
export interface VerifyInput {
  scope: any;
  scopeHash: string;
  routes: any;
  model: any;
  targetUrl?: string;
  fixtureOrigins?: string[];
}
export async function verifyRoutes({
  scope,
  scopeHash,
  routes,
  model,
  targetUrl,
  fixtureOrigins = [],
}: VerifyInput) {
  const checks: Check[] = [];
  const rows: Array<Record<string, unknown>> = [];
  let verified = 0;
  const plannedKeys = new Set<string>();
  const add = (id: string, status: Check["status"], details: string) =>
    checks.push({ id, status, details });
  for (const url of scope.urls) {
    const route = routes.routes.find(
      (r: any) => r.source_origin + r.request_target === url.crawl_key,
    );
    const key = url.crawl_key;
    plannedKeys.add(key);
    if (!route) {
      rows.push({
        url: key,
        status: "FAIL",
        reason: "Route missing from source scope",
      });
      continue;
    }
    if (!targetUrl) {
      rows.push({
        url: key,
        status: "NOT_RUN",
        reason: "No target HTTP environment configured",
      });
      continue;
    }
    try {
      const origin = new URL(targetUrl).origin;
      const response = await safeFetch(origin + route.target_route, {
        allowedOrigins: [origin],
        fixtureOrigins,
        maxResponseBytes: 8_000_000,
      });
      const statusOk = response.status === route.expected_status;
      let contentOk = true,
        redirectOk = true,
        reason = "";
      if (response.status >= 300 && response.status < 400) {
        const target = new URL(response.headers.location ?? "", origin);
        const expected = new URL(route.redirect_to ?? "", route.source_origin);
        redirectOk =
          target.origin === origin &&
          identifyUrl(target.href).request_target ===
            identifyUrl(expected.href).request_target;
      }
      if (response.status === 200) {
        const $ = load(response.body.toString("utf8"));
        const entity = model.entities.find(
          (e: any) => e.source_id === route.entity_source_id,
        );
        contentOk =
          Boolean(entity) &&
          $("title").text().trim() === entity.title &&
          $("h1").text().trim().includes(entity.title);
        if (entity?.description)
          contentOk =
            contentOk &&
            $('meta[name="description"]').attr("content") ===
              entity.description;
        if (!$("main").text().trim()) contentOk = false;
        if (!contentOk)
          reason = "Required title/H1/description/main content mismatch";
      }
      const pass = statusOk && redirectOk && contentOk;
      if (pass) verified++;
      rows.push({
        url: key,
        target: origin + route.target_route,
        status: pass ? "PASS" : "FAIL",
        http_status: response.status,
        expected_status: route.expected_status,
        reason,
      });
    } catch (e) {
      rows.push({
        url: key,
        status: "FAIL",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  add(
    "scope-route-completeness",
    rows.some((r) => r.reason === "Route missing from source scope")
      ? "FAIL"
      : "PASS",
    `${routes.routes.length} route records for ${scope.urls.length} source URL records`,
  );
  add(
    "all-source-urls-http",
    !targetUrl
      ? "NOT_RUN"
      : rows.some((r) => r.status !== "PASS")
        ? "FAIL"
        : "PASS",
    `${verified}/${scope.urls.length} independently verified HTTP routes`,
  );
  add(
    "bitrix-runtime",
    "NOT_RUN",
    "Requires real licensed Bitrix, admin editing, importer and target isolation evidence",
  );
  add(
    "required-content-media",
    "NOT_RUN",
    "Full field-level and offline media acceptance remains mandatory",
  );
  add(
    "browser-scenarios",
    "NOT_RUN",
    "Template, mobile, keyboard and functional tests required on actual Bitrix",
  );
  add(
    "backup-restore-bitrix",
    "NOT_RUN",
    "Independent Bitrix restoration and smoke test required",
  );
  return {
    schema_version: 1,
    scope_sha256: scopeHash,
    generated_at: new Date().toISOString(),
    readiness: "NOT_READY",
    coverage: {
      verified_in_scope: verified,
      total_in_scope: scope.urls.length,
      ratio: scope.urls.length ? verified / scope.urls.length : 0,
    },
    counts: {
      discovered: scope.urls.length + (scope.exclusions?.length ?? 0),
      included: scope.urls.length,
      excluded: scope.exclusions?.length ?? 0,
      planned: routes.routes.filter((r: any) =>
        plannedKeys.has(r.source_origin + r.request_target),
      ).length,
      verified,
      failed: rows.filter((r) => r.status === "FAIL").length,
      not_run: rows.filter((r) => r.status === "NOT_RUN").length,
    },
    checks,
    rows,
    limitations: [
      "Coverage denominator is the immutable source scope, including failed URLs.",
      "HTTP content smoke alone cannot establish Bitrix or full content completeness.",
    ],
  };
}
export function readiness(checks: Check[]) {
  return checks.length > 0 && checks.every((c) => c.status === "PASS")
    ? "CHECKS_PASSED"
    : "NOT_READY";
}
