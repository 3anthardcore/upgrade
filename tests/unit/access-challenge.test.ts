import test from "node:test";
import assert from "node:assert/strict";
import {
  detectAccessChallenge,
  isHtmlResponse,
} from "../../packages/crawler/access.ts";

test("known KillBot interstitial title is recognized without executing source code", () => {
  for (const title of [
    "KillBot user verification",
    "KillBot user verification [127.0.0.1] [UpgradeResearch/0.1 (+read-only snapshot)]...",
    "KillBot user verification [51.75.130.17] [curl/8.13.0]...",
  ]) {
    const result = detectAccessChallenge(
      `<html><head><title>${title}</title></head><body><script>throw new Error('must not execute')</script></body></html>`,
    );
    assert.equal(result?.provider, "KillBot");
    assert.equal(result?.reason, "ACCESS_CHALLENGE");
  }
});

test("provider prose, ordinary CAPTCHA contact forms, generic titles and article titles are not challenges", () => {
  for (const html of [
    "<title>Article about KillBot user verification</title><h1>Cloudflare</h1><p>KillBot user verification is a product feature.</p>",
    '<title>Contact us</title><form><div class="g-recaptcha"></div></form><script src="https://www.google.com/recaptcha/api.js"></script>',
    "<title>Just a moment...</title><p>An article about Cloudflare and captcha.</p>",
    "<title>KillBot user verification: how the product works</title>",
    "<title>Cloudflare</title><p>cf-mitigated: challenge</p>",
  ])
    assert.equal(detectAccessChallenge(html), undefined);
  assert.equal(
    detectAccessChallenge("normal", { "cf-mitigated": "managed" }),
    undefined,
  );
  assert.equal(
    detectAccessChallenge("opaque", { "cf-mitigated": "challenge" })?.provider,
    "Cloudflare",
  );
});

test("HTML robots responses are rejected by MIME or markup, while real empty/text robots remains valid", () => {
  assert.equal(
    isHtmlResponse("<div>Sign in</div>", {
      "content-type": "text/html; charset=utf-8",
    }),
    true,
  );
  assert.equal(
    isHtmlResponse(
      "\uFEFF <!-- proxy --> <!DOCTYPE html><html><title>Login</title></html>",
      { "content-type": "text/plain" },
    ),
    true,
  );
  assert.equal(isHtmlResponse("User-agent: *\nDisallow: /private\n"), false);
  assert.equal(
    isHtmlResponse("<div><h1>Sign in</h1></div>", {
      "content-type": "text/plain",
    }),
    true,
  );
  assert.equal(
    isHtmlResponse("<!-- proxy --> <span class='access'>Sign in</span>", {
      "content-type": "text/plain",
    }),
    true,
  );
  assert.equal(
    isHtmlResponse("# Example: <div>\nUser-agent: *\nDisallow: /private\n"),
    false,
  );
  assert.equal(isHtmlResponse("", { "content-type": "text/plain" }), false);
});
