export type TaskStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "VALIDATING"
  | "ACCEPTED"
  | "RETRY_WAIT"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"
  | "STALE";
export interface Task {
  schema_version: 1;
  task_id: string;
  project_id: string;
  run_id: string;
  stage: string;
  role: string;
  goal: string;
  input_artifact_ids: string[];
  depends_on: string[];
  allowed_paths: string[];
  allowed_tools: string[];
  acceptance_checks: string[];
  status: TaskStatus;
  attempt: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_until: number | null;
  fencing_token: number;
  budget: { max_seconds: number; reserved_units: number };
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  input_hash?: string;
  result?: AgentResult;
  retry_after?: number;
  attempt_started_at?: number;
}
export interface AgentResult {
  task_id: string;
  attempt: number;
  input_hash: string;
  artifact_ids: string[];
  summary: string;
  checks: Check[];
  unresolved_issues: string[];
  suggested_followups: string[];
  usage: Record<string, unknown>;
  runtime_version: string;
}
export interface Check {
  id: string;
  status: "PASS" | "FAIL" | "NOT_RUN";
  details?: string;
}
export interface Artifact {
  artifact_id: string;
  project_id: string;
  run_id: string;
  type: string;
  relative_path: string;
  sha256: string;
  size_bytes: number;
  schema_version: 1;
  producer_task_id: string | null;
  input_hashes: string[];
  created_at: string;
  validation_status: "VALID" | "INVALID";
}
export interface Run {
  run_id: string;
  project_id: string;
  phase: string;
  execution_status: string;
  dispatcher_owner: string | null;
  dispatcher_until: number;
  budget: {
    max_units: number;
    spent: number;
    reserved: number;
    unknown: number;
    max_seconds: number;
    started_at: number;
  };
  created_at: string;
}
export interface Project {
  schema_version: 1;
  project_id: string;
  source: {
    entry_url: string;
    allowed_hosts: string[];
    mode: "public-demo" | "owner-migration" | "bitrix-redesign";
  };
  target: { platform: "bitrix"; environment_profile: string };
  created_at: string;
}
export const taskRequired = [
  "schema_version",
  "task_id",
  "project_id",
  "run_id",
  "stage",
  "role",
  "goal",
  "input_artifact_ids",
  "depends_on",
  "allowed_paths",
  "allowed_tools",
  "acceptance_checks",
  "status",
  "attempt",
  "max_attempts",
  "lease_owner",
  "lease_until",
  "fencing_token",
  "budget",
  "idempotency_key",
  "created_at",
  "updated_at",
];
export const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "task_id",
    "attempt",
    "input_hash",
    "artifact_ids",
    "summary",
    "checks",
    "unresolved_issues",
    "suggested_followups",
    "usage",
    "runtime_version",
  ],
  properties: {
    task_id: { type: "string" },
    attempt: { type: "integer", minimum: 1 },
    input_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    artifact_ids: { type: "array", minItems: 1, items: { type: "string" } },
    summary: { type: "string" },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: { type: "string" },
          status: { enum: ["PASS", "FAIL", "NOT_RUN"] },
          details: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    unresolved_issues: { type: "array", items: { type: "string" } },
    suggested_followups: { type: "array", items: { type: "string" } },
    usage: { type: "object" },
    runtime_version: { type: "string" },
  },
};
