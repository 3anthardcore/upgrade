import test from "node:test";
import assert from "node:assert/strict";
import {
  handoffHash,
  handoffJson,
  handoffRequestId,
  parseHandoff,
  validateHandoffRequest,
  validateHandoffReceipt,
  validateHandoffProfile,
} from "../../packages/contracts/native-handoff.ts";
import type {
  NativeHandoffRequest,
  NativeHandoffReceipt,
} from "../../packages/contracts/native-handoff.ts";
const pin = "a".repeat(64),
  ref = { artifact_id: "art-123", sha256: pin };
function request(): NativeHandoffRequest {
  const r: NativeHandoffRequest = {
    schema_version: 1,
    kind: "native-handoff-request",
    request_id: "",
    binding: {
      schema_version: 1,
      project_id: "pilot",
      target_id: "target",
      profile_id: "private",
      profile_sha256: pin,
      executor_sha256: pin,
      native_profile_sha256: pin,
      journal_identity_sha256: pin,
    },
    build: {
      kind: "operator",
      id: pin,
      record_sha256: pin,
      model: ref,
      routes: ref,
      scope: ref,
      release: ref,
      package_manifest_sha256: pin,
      source_origin: "https://example.test",
      known_urls: 25,
      planned_routes: 1,
      full_source_denominator: "UNKNOWN",
    },
    action: "apply",
  };
  r.request_id = handoffRequestId(r);
  return r;
}
test("strict handoff request rejects command/path injection and identity or denominator drift", () => {
  const original = request();
  validateHandoffRequest(original);
  const mutations: Array<(r: any) => void> = [
    (r) => (r.command = "arbitrary"),
    (r) => (r.journal_dir = "/new-journal"),
    (r) => (r.binding.target_id = "foreign"),
    (r) => (r.build.known_urls = 0),
    (r) => (r.build.full_source_denominator = 0),
    (r) => (r.build.source_origin = "https://x:secret@example.test"),
    (r) => (r.action = "deploy-production"),
    (r) => (r.build.model.sha256 = "bad"),
  ];
  for (const mutate of mutations) {
    const r = structuredClone(original);
    mutate(r);
    assert.throws(() => validateHandoffRequest(r), /HANDOFF_/);
  }
});
test("request identity ignores JSON object order but binds every artifact and action", () => {
  const reverse = (v: any): any =>
    Array.isArray(v)
      ? v.map(reverse)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .reverse()
              .map((k) => [k, reverse(v[k])]),
          )
        : v;
  const r = request();
  assert.equal(handoffRequestId(r), handoffRequestId(reverse(r)));
  assert.notEqual(
    handoffRequestId(r),
    handoffRequestId({ ...r, action: "reconcile" }),
  );
  assert.notEqual(
    handoffRequestId(r),
    handoffRequestId({
      ...r,
      build: {
        ...r.build,
        scope: { ...r.build.scope, sha256: "f".repeat(64) },
      },
    }),
  );
});
test("ambiguous JSON duplicate keys and invalid UTF8 cannot be interpreted as operator authorization", () => {
  assert.throws(
    () => parseHandoff(Buffer.from('{"action":"validate","action":"apply"}')),
    /DUPLICATE_KEY/,
  );
  assert.throws(
    () => parseHandoff(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])),
    /UTF8/,
  );
});
test("confirmation requires exact target, native profile, journal and returned result digest", () => {
  const r = request(),
    result = {
      status: "DATABASE_RECONCILED",
      defects: [],
      _target: {
        project_id: "pilot",
        target_id: "target",
        manifest_sha256: pin,
      },
    };
  const receipt: NativeHandoffReceipt = {
    schema_version: 1,
    kind: "native-handoff-receipt",
    request_id: r.request_id,
    request_sha256: handoffHash(handoffJson(r)),
    binding: r.binding,
    build: r.build,
    action: "apply",
    attempt: 1,
    execution: "NATIVE",
    status: "CONFIRMED",
    recorded_at: "2026-09-30T09:00:00.000Z",
    native_profile_sha256: pin,
    journal_binding_sha256: pin,
    journal_head: {
      status: "CONFIRMED",
      project_id: "pilot",
      target_id: "target",
      manifest_sha256: pin,
      profile_sha256: pin,
      last_result: { sha256: handoffHash(handoffJson(result)) },
    },
    native_result: result,
    activation: "NOT_RUN",
    full_qa: "NOT_RUN",
  };
  validateHandoffReceipt(receipt, r, receipt.request_sha256);
  const mutations: Array<(v: any) => void> = [
    (v) => (v.native_result._target.target_id = "foreign"),
    (v) => v.native_result.defects.push({ reason: "UNVERIFIED" }),
    (v) => (v.journal_head.status = "UNKNOWN"),
    (v) => (v.journal_head.last_result.sha256 = "b".repeat(64)),
    (v) => (v.full_qa = "PASS"),
    (v) => (v.activation = "READY"),
    (v) => (v.native_profile_sha256 = "c".repeat(64)),
    (v) => (v.attempt = 0),
  ];
  for (const mutate of mutations) {
    const value = structuredClone(receipt);
    mutate(value);
    assert.throws(
      () => validateHandoffReceipt(value, r, receipt.request_sha256),
      /HANDOFF_/,
    );
  }
});
test("private profile has no arbitrary callbacks or unversioned extension fields", () => {
  const p = {
    schema_version: 1,
    kind: "private-native-handoff-profile",
    project_id: "pilot",
    target_id: "target",
    profile_id: "private",
    executor_sha256: pin,
    native_profile_path: "/private/native.json",
    native_profile_sha256: pin,
    journal_dir: "/private/journal",
    journal_binding_sha256: pin,
    inbox_root: "/private/inbox",
    outbox_root: "/private/outbox",
  };
  validateHandoffProfile(p);
  assert.throws(
    () => validateHandoffProfile({ ...p, materializer: "/bin/sh" }),
    /PRIVATE_PROFILE_INVALID/,
  );
});
