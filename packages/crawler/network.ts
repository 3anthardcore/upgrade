import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class CrawlError extends Error {
  code: string;
  redirectChain?: { url: string; status: number; location: string }[];
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export interface UrlIdentity {
  raw_url: string;
  origin: string;
  request_target: string;
  crawl_key: string;
  fragment: string;
}

/** Queue identity is deliberately exact. No case folding, query sorting, slash decoding or canonical merging. */
export function identifyUrl(raw: string, base?: string): UrlIdentity {
  if (/[\u0000-\u0020\u007f\\]/u.test(raw))
    throw new CrawlError(
      "INVALID_URL",
      "URL contains control characters, spaces or a backslash",
    );
  let absolute = raw;
  if (!/^https?:\/\//i.test(raw)) {
    if (!base)
      throw new CrawlError("INVALID_URL", "Absolute HTTP(S) URL required");
    absolute = new URL(raw, base).href;
  }
  const parsed = new URL(absolute);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new CrawlError(
      "INVALID_URL",
      "Only HTTP(S) URLs without credentials are allowed",
    );
  const suffix = absolute.match(/^https?:\/\/[^/?#]+([^#]*)/i)?.[1] ?? "";
  let target = suffix.startsWith("?") ? `/${suffix}` : suffix || "/";
  // HTTP transports require encoded non-ASCII bytes, but preserve existing escape spelling and all query punctuation.
  target = target.replace(/[^\x21-\x7e]/gu, (value) =>
    encodeURIComponent(value),
  );
  return {
    raw_url: absolute,
    origin: parsed.origin,
    request_target: target,
    crawl_key: parsed.origin + target,
    fragment: parsed.hash,
  };
}

export function isPublicAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version === 6) {
    // Only global unicast. This rejects mapped/compatible IPv4, loopback, ULA, link-local and multicast.
    const block = new net.BlockList();
    block.addSubnet("2000::", 3, "ipv6");
    if (!block.check(address, "ipv6")) return false;
    const denied = new net.BlockList();
    denied.addSubnet("2001::", 23, "ipv6"); // special-purpose and transition ranges
    denied.addSubnet("2001:db8::", 32, "ipv6");
    denied.addSubnet("2002::", 16, "ipv6"); // 6to4 can tunnel to otherwise forbidden IPv4
    return !denied.check(address, "ipv6");
  }
  return false;
}

export interface FetchOptions {
  allowedOrigins: string[];
  fixtureOrigins?: string[];
  maxResponseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Fresh DNS resolution and validation before EVERY connection; connect to that exact pinned address. */
export async function safeFetch(
  raw: string,
  options: FetchOptions,
): Promise<HttpResponse> {
  const started = Date.now(),
    timeoutMs = options.timeoutMs ?? 15_000;
  const identity = identifyUrl(raw);
  if (!options.allowedOrigins.includes(identity.origin))
    throw new CrawlError(
      "ORIGIN_BLOCKED",
      `Origin outside scope: ${identity.origin}`,
    );
  const url = new URL(identity.crawl_key);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const fixture = (options.fixtureOrigins ?? []).includes(identity.origin);
  if (fixture && !["127.0.0.1", "::1", "localhost"].includes(hostname))
    throw new CrawlError(
      "INVALID_FIXTURE",
      "Fixture exceptions must be exact loopback origins",
    );
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let addresses: { address: string; family: number }[];
  try {
    addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await Promise.race([
          dns.lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            dnsTimer = setTimeout(
              () => reject(new CrawlError("TIMEOUT", "DNS lookup timed out")),
              timeoutMs,
            );
          }),
        ]);
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) =>
      fixture
        ? !["127.0.0.1", "::1"].includes(address)
        : !isPublicAddress(address),
    )
  ) {
    throw new CrawlError(
      "SSRF_BLOCKED",
      `Forbidden DNS/IP destination: ${hostname}`,
    );
  }
  const pinned = addresses[0];
  return await new Promise<HttpResponse>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: identity.request_target,
        method: "GET",
        agent: false,
        servername: hostname,
        signal: options.signal,
        lookup: ((
          _host: string,
          lookupOptions: { all?: boolean },
          callback: (
            error: Error | null,
            address: string | { address: string; family: number }[],
            family?: number,
          ) => void,
        ) => {
          // Node's autoSelectFamily requests `all:true`; still expose exactly one validated/pinned address.
          if (lookupOptions.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        }) as never,
        headers: {
          "User-Agent": "UpgradeResearch/0.1 (+read-only snapshot)",
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const encoding = response.headers["content-encoding"];
        if (encoding && encoding !== "identity") {
          response.destroy();
          reject(
            new CrawlError(
              "ENCODING_BLOCKED",
              "Compressed responses require an explicit bounded decoder",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > (options.maxResponseBytes ?? 8_000_000)) {
            response.destroy(
              new CrawlError("RESPONSE_LIMIT", "Response exceeds byte limit"),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          // Never persist Set-Cookie, authentication or arbitrary sensitive headers from a source.
          const headers: Record<string, string> = {};
          for (const name of [
            "content-type",
            "content-length",
            "location",
            "etag",
            "last-modified",
            "retry-after",
            "x-robots-tag",
            "content-language",
            "cf-mitigated",
          ]) {
            const value = response.headers[name];
            if (value !== undefined)
              headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            url: identity.crawl_key,
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    const deadlineTimer = setTimeout(
      () =>
        request.destroy(
          new CrawlError(
            "TIMEOUT",
            "Absolute source request deadline exceeded",
          ),
        ),
      Math.max(1, timeoutMs - (Date.now() - started)),
    );
    request.once("close", () => clearTimeout(deadlineTimer));
    request.setTimeout(timeoutMs, () =>
      request.destroy(
        new CrawlError("TIMEOUT", "Source request inactivity timed out"),
      ),
    );
    request.on("error", reject);
    request.end();
  });
}
