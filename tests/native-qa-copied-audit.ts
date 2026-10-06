/** Read-only repeat of supplied copied receipt consistency; no Store, native runtime or network. */
import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  validateNativeQaReceipts,
  type NativeQaManifest,
} from "../packages/core/native-qa-evidence.ts";
const base = resolve(process.argv[2] ?? "var/evidence/continuation-20260930");
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const read = (p: string, cap = 128_000_000) => {
  if (!statSync(p).isFile() || statSync(p).size > cap)
    throw Error("Bounded regular input required");
  return readFileSync(p);
};
const directory = join(base, "native-stage389-data"),
  manifestBytes = read(join(directory, "manifest.json")),
  manifest = JSON.parse(manifestBytes.toString("utf8"));
const data = (name: string) => {
  const bytes = read(join(directory, "data", name + ".json"));
  if (hash(bytes) !== manifest.files[`data/${name}.json`])
    throw Error("Package metadata pin mismatch");
  return JSON.parse(bytes.toString("utf8"));
};
const metadata = {
  entities: data("entities"),
  routes: data("routes"),
  assets: data("assets"),
  scope: data("operator-scope"),
  snapshot: data("demo-snapshot"),
};
const names = {
  facts_before:
    "3-upgrade-install-20260929-native-v8-stage-r15-facts-before-http.json",
  facts_after:
    "4-upgrade-install-20260929-native-v8-stage-r15-facts-after-http.json",
  http_routes: "5-upgrade-install-20260929-native-v8-stage-r15-http.json",
  activation: "12-interactive-r15-activation-result.json",
  http_scenarios: "6-native-demo-http-r15-receipt.json",
  browser: "7-native-browser-r15-receipt.json",
};
const files: any = Object.fromEntries(
  Object.entries(names).map(([role, name]) => [
    role,
    read(join(base, "native-0710", name), 16_000_000),
  ]),
);
for (const [role, name] of Object.entries({
  historical_plan: "accepted-plan.json",
  historical_intent: "intent.json",
  historical_result: "result.json",
  historical_events: "events.jsonl",
}))
  files[role] = read(join(base, "native-recovery-v6-details", name), 8_000_000);
// Deliberate placeholders: the pure receipt checker does not attest Store bindings.
const ref = {
  artifact_id: "NOT_EVALUATED_BY_PURE_RECEIPT_CHECK",
  sha256: "a".repeat(64),
};
const m: NativeQaManifest = {
  schema_version: 1,
  kind: "native-qa-evidence",
  project_id: manifest.project_id,
  target_id: "target-teplypol-20260929",
  build_record_id: "a".repeat(64),
  model_record_id: metadata.scope.input_hash,
  build_artifact: ref,
  model_artifact: ref,
  route_artifact: ref,
  scope_artifact: ref,
  target_evidence: {
    record_id: "a".repeat(64),
    result_artifact_id: ref.artifact_id,
    sha256: ref.sha256,
  },
  package_manifest_sha256: hash(manifestBytes),
  snapshot: {
    id: metadata.snapshot.snapshot_id,
    sha256: manifest.files["data/demo-snapshot.json"],
  },
  origin: "https://upgrade.help-ai-ru.ru",
  attestation: {
    kind: "operator-copied-native-receipts",
    recorded_at: new Date().toISOString(),
  },
  files: Object.fromEntries(
    Object.entries(files).map(([role, b]) => [
      role,
      {
        relative_path: role + ".json",
        sha256: hash(b as Buffer),
        size_bytes: (b as Buffer).length,
      },
    ]),
  ),
};
console.log(
  JSON.stringify(
    {
      scope: "OFFLINE_COPIED_RECEIPT_CONSISTENCY_ONLY",
      store_binding: "NOT_EVALUATED",
      native_execution: "NOT_RUN",
      manifest_sha256: m.package_manifest_sha256,
      input_pins: m.files,
      result: validateNativeQaReceipts(m, files, metadata),
    },
    null,
    2,
  ),
);
