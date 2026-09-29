import { chromium } from "playwright";
import type { HttpResponse } from "./network.ts";

export interface RenderOptions {
  request: (url: string) => Promise<HttpResponse>;
  executablePath?: string;
  timeoutMs?: number;
}

/** Browser HTTP transport is entirely fulfilled by the DNS-pinned GET-only loader. */
export async function renderPage(url: string, options: RenderOptions) {
  const blocked: string[] = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: options.executablePath,
    args: [
      "--proxy-server=http://127.0.0.1:9",
      "--proxy-bypass-list=<-loopback>",
      "--disable-background-networking",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.routeWebSocket("**/*", (socket) => {
      blocked.push(`WebSocket ${socket.url()}`);
      socket.close();
    });
    await context.addInitScript(() => {
      // Defense in depth: transport routing and dead proxy are still required; DOM monkey patches alone are insufficient.
      for (const name of [
        "WebSocket",
        "WebTransport",
        "RTCPeerConnection",
        "webkitRTCPeerConnection",
        "Worker",
        "SharedWorker",
      ]) {
        try {
          Object.defineProperty(globalThis, name, {
            value: undefined,
            writable: false,
            configurable: false,
          });
        } catch {
          /* browser-specific global */
        }
      }
      Object.defineProperty(navigator, "sendBeacon", {
        value: () => false,
        configurable: false,
      });
    });
    let transportFailure: unknown;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.method() !== "GET" ||
        ["websocket", "eventsource"].includes(request.resourceType()) ||
        (request.isNavigationRequest() && request.url() !== url)
      ) {
        blocked.push(`${request.method()} ${request.url()}`);
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const response = await options.request(request.url());
        const headers: Record<string, string> = {
          "content-type":
            response.headers["content-type"] ?? "application/octet-stream",
        };
        if (response.headers.location)
          headers.location = response.headers.location;
        if (headers["content-type"].includes("html"))
          headers["content-security-policy"] =
            "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
        await route.fulfill({
          status: response.status,
          headers,
          body: response.body,
        });
      } catch (error) {
        blocked.push(
          `Blocked ${request.url()}: ${error instanceof Error ? error.message : String(error)}`,
        );
        const code = (error as { code?: string }).code;
        if (code && ["BUDGET_LIMIT", "ABORTED"].includes(code))
          transportFailure = error;
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    page.on("download", (download) => {
      void download.cancel();
    });
    page.on("popup", (popup) => {
      blocked.push(`popup ${popup.url()}`);
      void popup.close();
    });
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 15_000,
    });
    await page.waitForTimeout(150);
    for (let count = 0; count < 3; count++) {
      await page.evaluate(() =>
        window.scrollBy(0, Math.min(window.innerHeight, 900)),
      );
      await page.waitForTimeout(100);
    }
    if (transportFailure) throw transportFailure;
    const html = await page.content();
    await context.close();
    return {
      html,
      profile: {
        viewport: { width: 1440, height: 900 },
        locale: "ru-RU",
        cookies: "fresh-empty" as const,
        blocked_requests: blocked,
      },
    };
  } finally {
    await browser.close();
  }
}
