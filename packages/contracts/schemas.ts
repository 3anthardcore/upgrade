import { Ajv } from "ajv";
import { resultSchema, taskRequired } from "./index.ts";
const text = { type: "string" },
  strings = { type: "array", items: text },
  integer = { type: "integer", minimum: 0 },
  nullableText = { type: ["string", "null"] };
export const taskSchema = {
  type: "object",
  required: taskRequired,
  properties: {
    schema_version: { const: 1 },
    task_id: text,
    project_id: text,
    run_id: text,
    stage: text,
    role: text,
    goal: text,
    input_artifact_ids: strings,
    depends_on: strings,
    allowed_paths: strings,
    allowed_tools: strings,
    acceptance_checks: strings,
    status: {
      enum: [
        "PENDING",
        "READY",
        "RUNNING",
        "VALIDATING",
        "ACCEPTED",
        "RETRY_WAIT",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "STALE",
      ],
    },
    attempt: integer,
    max_attempts: { type: "integer", minimum: 1, maximum: 3 },
    lease_owner: nullableText,
    lease_until: { type: ["number", "null"] },
    fencing_token: integer,
    budget: {
      type: "object",
      required: ["max_seconds", "reserved_units"],
      properties: {
        max_seconds: { type: "number", minimum: 1, maximum: 86400 },
        reserved_units: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    idempotency_key: text,
    created_at: text,
    updated_at: text,
    input_hash: text,
    result: resultSchema,
    retry_after: integer,
    attempt_started_at: integer,
  },
  additionalProperties: false,
};
export const eventSchema = {
  type: "object",
  required: [
    "event_id",
    "sequence",
    "project_id",
    "run_id",
    "task_id",
    "type",
    "actor",
    "timestamp_utc",
    "correlation_id",
    "causation_id",
    "payload",
  ],
  properties: {
    event_id: text,
    sequence: integer,
    project_id: text,
    run_id: nullableText,
    task_id: nullableText,
    type: text,
    actor: text,
    timestamp_utc: text,
    correlation_id: nullableText,
    causation_id: nullableText,
    payload: { type: "object" },
  },
  additionalProperties: false,
};
export const artifactSchema = {
  type: "object",
  required: [
    "artifact_id",
    "project_id",
    "run_id",
    "type",
    "relative_path",
    "sha256",
    "size_bytes",
    "schema_version",
    "producer_task_id",
    "input_hashes",
    "created_at",
    "validation_status",
  ],
  properties: {
    artifact_id: text,
    project_id: text,
    run_id: text,
    type: text,
    relative_path: text,
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    size_bytes: integer,
    schema_version: { const: 1 },
    producer_task_id: nullableText,
    input_hashes: strings,
    created_at: text,
    validation_status: { enum: ["VALID", "INVALID"] },
  },
  additionalProperties: false,
};
export const projectSchema = {
  type: "object",
  required: ["schema_version", "project_id", "source", "target", "created_at"],
  properties: {
    schema_version: { const: 1 },
    project_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" },
    source: {
      type: "object",
      required: ["entry_url", "allowed_hosts", "mode"],
      properties: {
        entry_url: text,
        allowed_hosts: strings,
        mode: { enum: ["public-demo", "owner-migration", "bitrix-redesign"] },
      },
      additionalProperties: false,
    },
    target: {
      type: "object",
      required: ["platform", "environment_profile"],
      properties: { platform: { const: "bitrix" }, environment_profile: text },
      additionalProperties: false,
    },
    created_at: text,
  },
  additionalProperties: false,
};
const range = (min: number, max: number, def: number) => ({
  type: "integer",
  minimum: min,
  maximum: max,
  default: def,
});
export const profileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "profile", "crawl", "agents", "demo"],
  properties: {
    schema_version: { const: 1 },
    profile: text,
    crawl: {
      type: "object",
      additionalProperties: false,
      required: [
        "max_html_pages",
        "max_assets",
        "max_download_bytes",
        "max_wall_time_minutes",
        "requests_per_second_per_host",
        "concurrency_per_host",
        "respect_robots",
        "max_redirects",
      ],
      properties: {
        max_html_pages: range(1, 1000000, 10000),
        max_assets: range(1, 1000000, 50000),
        max_download_bytes: range(1, 100000000000, 10737418240),
        max_wall_time_minutes: range(1, 1440, 240),
        requests_per_second_per_host: {
          type: "number",
          minimum: 0.1,
          maximum: 10,
          default: 1,
        },
        concurrency_per_host: range(1, 2, 2),
        respect_robots: { const: true },
        max_redirects: range(0, 10, 5),
      },
    },
    agents: {
      type: "object",
      additionalProperties: false,
      required: [
        "max_workers",
        "max_task_attempts",
        "max_fix_cycles",
        "max_tasks",
        "max_wall_time_seconds",
      ],
      properties: {
        max_workers: range(1, 3, 3),
        max_task_attempts: range(1, 3, 3),
        max_fix_cycles: range(0, 2, 2),
        max_tasks: range(1, 1000, 100),
        max_wall_time_seconds: range(1, 86400, 3600),
      },
    },
    demo: {
      type: "object",
      additionalProperties: false,
      required: ["access", "indexing", "outbound_integrations"],
      properties: {
        access: { const: "authenticated" },
        indexing: { const: "disabled" },
        outbound_integrations: { const: "disabled" },
      },
    },
  },
};
export const schemas = {
  task: taskSchema,
  event: eventSchema,
  artifact: artifactSchema,
  project: projectSchema,
  result: resultSchema,
  profile: profileSchema,
};
const ajv = new Ajv();
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]),
);
export function validateContract(name: keyof typeof schemas, value: unknown) {
  const validator = validators[name];
  if (!validator(value))
    throw new Error(
      `${name} schema invalid: ${JSON.stringify(validator.errors)}`,
    );
}
