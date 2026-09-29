import { load } from "cheerio";

export interface AccessChallenge {
  provider?: "KillBot" | "Cloudflare";
  reason: "ACCESS_CHALLENGE" | "ROBOTS_HTML";
  signals: string[];
}

/** Parse inert bytes only. Provider mentions, CAPTCHA widgets and generic titles are not evidence. */
export function detectAccessChallenge(
  body: Buffer | string,
  headers: Record<string, string> = {},
): AccessChallenge | undefined {
  if (headers["cf-mitigated"]?.trim().toLowerCase() === "challenge")
    return {
      provider: "Cloudflare",
      reason: "ACCESS_CHALLENGE",
      signals: ["cf-mitigated: challenge"],
    };
  const html = typeof body === "string" ? body : body.toString("utf8");
  // A product article can mention this phrase in prose. Only the known interstitial title counts.
  const title = load(html)("title").first().text().trim();
  if (
    /^KillBot user verification(?:\s+\[[^\]\r\n]*\])*(?:\.{3})?$/i.test(title)
  )
    return {
      provider: "KillBot",
      reason: "ACCESS_CHALLENGE",
      signals: ["known KillBot user verification document title"],
    };
  return undefined;
}

/** HTML at robots.txt is not an empty robots policy, even without a recognized challenge vendor. */
export function isHtmlResponse(
  body: Buffer | string,
  headers: Record<string, string> = {},
): boolean {
  if (
    /\b(?:text\/html|application\/xhtml\+xml)\b/i.test(
      headers["content-type"] ?? "",
    )
  )
    return true;
  const start = (typeof body === "string" ? body : body.toString("utf8")).slice(
    0,
    65_536,
  );
  // A proxy may return only an HTML fragment under text/plain; no particular root tag is required.
  // Anchor to the response start so examples inside ordinary robots comments/directives stay text.
  return /^\s*(?:<!--[^]*?-->\s*)*<(?:!doctype\s+html\b|[a-z][a-z0-9:-]*(?:\s|\/?>))/i.test(
    start,
  );
}

export type AccessStage =
  | "robots"
  | "sitemap"
  | "page"
  | "asset"
  | "browser_http"
  | "browser_dom"
  | "stored_snapshot";
export interface AccessResume {
  blockId: string;
  acknowledgementId: string;
  reason: string;
}
export interface AccessBlock extends AccessChallenge {
  id: string;
  url: string;
  stage: AccessStage;
  source_entry_url?: string;
  body_sha256: string;
  evidence_kind: "http" | "dom";
  http_status?: number;
  headers?: Record<string, string>;
  observed_at: string;
  resume?: {
    acknowledgement_id: string;
    reason: string;
    acknowledged_at: string;
  };
}
