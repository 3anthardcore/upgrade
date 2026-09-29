import test from "node:test";
import assert from "node:assert/strict";
import { verifyRoutes, readiness } from "../../packages/verifier/index.ts";
test("failed source URLs stay in coverage denominator and block acceptance", async () => {
  const qa = await verifyRoutes({
    scope: {
      urls: [{ crawl_key: "https://x/a" }, { crawl_key: "https://x/b" }],
      exclusions: [],
    },
    scopeHash: "immutable",
    routes: { routes: [{ source_origin: "https://x", request_target: "/a" }] },
    model: { entities: [] },
  });
  assert.equal(qa.coverage.total_in_scope, 2);
  assert.equal(qa.coverage.verified_in_scope, 0);
  assert.equal(qa.counts.failed, 1);
  assert.equal(qa.readiness, "NOT_READY");
  assert.equal(
    qa.checks.find((c) => c.id === "scope-route-completeness")?.status,
    "FAIL",
  );
});
test("NOT_RUN and a single failed check cannot become ready", () => {
  assert.equal(readiness([{ id: "bitrix", status: "NOT_RUN" }]), "NOT_READY");
  assert.equal(readiness([{ id: "qa", status: "FAIL" }]), "NOT_READY");
  assert.equal(readiness([]), "NOT_READY");
});
