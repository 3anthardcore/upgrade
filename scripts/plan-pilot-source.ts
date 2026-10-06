/** Offline queue planning from pinned capture inventory and inert raw DOM exports.
 * No browser, network, Store, import, action execution or source permission changes.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  mkdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { Ajv } from "ajv";
import { identifyUrl } from "../packages/crawler/network.ts";
import { detectAccessChallenge } from "../packages/crawler/access.ts";
import { operatorCaptureSchema } from "../packages/crawler/operator.ts";
import type { OperatorCaptureManifest } from "../packages/crawler/operator.ts";

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const SOURCE_QUEUE_LIMITS = Object.freeze({
  fileBytes: 30_000_000,
  totalBytes: 800_000_000,
  rawFiles: 2000,
  entries: 50_000,
  witnesses: 1_000_000,
  witnessBytes: 256_000_000,
  identityBytes: 40_000_000,
  previousBytes: 180_000_000,
});
const limits = SOURCE_QUEUE_LIMITS;
const producer = "upgrade-offline-source-queue/1";
export class SourceQueueError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
const fail = (code: string, message: string): never => {
  throw new SourceQueueError(code, message);
};
const str = (v: unknown, name: string, max = 8192): string => {
  if (typeof v !== "string" || v.length > max)
    fail("QUEUE_FORMAT", `Invalid ${name}`);
  return v as string;
};
const timestamp = (v: unknown): string => {
  const value = str(v, "observation timestamp", 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("QUEUE_FORMAT", "Invalid observation timestamp");
  return value;
};
const parse = (bytes: Uint8Array): any => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("QUEUE_FORMAT", "Expected valid UTF-8 JSON");
  }
};

export interface SourceQueueOptions {
  rawDirs: string[];
  capturePath: string;
  expectedCaptureSha256: string;
  previousQueuePath?: string;
  expectedPreviousSha256?: string;
  batchSize?: number;
  /** May only reduce the hard in-memory provenance budget. */
  maxWitnessBytes?: number;
  /** May only reduce the fixed occurrence cap; does not change byte budgets. */
  maxWitnesses?: number;
}
export interface QueueInput {
  id: string;
  kind: "capture" | "capture-observation" | "raw-export";
  relative_path: string;
  sha256: string;
  size_bytes: number;
}
export interface QueueWitness {
  kind:
    | "capture-inventory"
    | "raw-link"
    | "dom-link"
    | "observation"
    | "requested-url"
    | "selected-link";
  input_id: string;
  input_sha256: string;
  html_sha256: string | null;
  source_url: string | null;
  observed_at: string | null;
  locator: string;
  raw_reference: string;
  base_url: string | null;
  label: string | null;
  role: "heading" | "navigation" | "other";
  action_control: boolean;
  fragment_only: boolean;
}
export interface QueueObservation {
  input_id: string;
  source_url: string;
  document_url: string;
  observed_at: string;
  snapshot_sha256: string;
  format: "dom-html" | "selected-fields-json";
  status:
    | "DOM_OBSERVED"
    | "SELECTED_FIELDS_ONLY"
    | "ACCESS_CHALLENGE"
    | "DOCUMENT_MISMATCH";
}
export type QueueClassification =
  | "CONTENT_CANDIDATE"
  | "HTTP_NAVIGATION_UNVERIFIED"
  | "QUERY_VARIANT_REVIEW"
  | "SOURCE_ACTION_REVIEW"
  | "PROTECTED_REVIEW"
  | "FOREIGN_ORIGIN_REVIEW"
  | "MEDIA_REVIEW"
  | "DOCUMENT_REVIEW"
  | "FRAGMENT_REVIEW"
  | "INVALID_URL_REVIEW"
  | "UNWITNESSED_INVENTORY_REVIEW";
export interface QueueEntry {
  id: string;
  url: string | null;
  request_target: string | null;
  origin: string | null;
  identity_reference: string;
  identity_base: string | null;
  in_capture_inventory: boolean;
  witnesses: QueueWitness[];
  observations: QueueObservation[];
  classification: QueueClassification;
  queue_status: "ALREADY_OBSERVED" | "OUTSTANDING" | "REVIEW_REQUIRED";
  observation_status: QueueObservation["status"] | "NOT_OBSERVED";
  priority: number;
  priority_reason: string;
  review_reasons: string[];
}
export interface SourceQueue {
  schema_version: 1;
  kind: "pilot-source-queue";
  producer: typeof producer;
  source_origin: string;
  project_id: string;
  full_source_denominator: "UNKNOWN";
  source_access: "UNCHANGED_NOT_VERIFIED";
  selection_is_not_completion: true;
  as_of_observation: string | null;
  inputs: QueueInput[];
  entries: QueueEntry[];
  counts: {
    entries: number;
    same_origin_http_identities: number;
    capture_inventory_identities: number;
    observed_dom: number;
    outstanding: number;
    review_required: number;
    classifications: Record<string, number>;
  };
  next_batch: Array<{
    entry_id: string;
    url: string;
    request_target: string;
    priority: number;
    reason: string;
    witness: QueueWitness;
  }>;
  limitations: string[];
}

// Lossless on-disk normalization: repeated page/hash/time metadata is stored once.
// API and standalone next-batch witnesses remain self-contained.
type WitnessContext = Pick<
  QueueWitness,
  | "kind"
  | "input_id"
  | "input_sha256"
  | "html_sha256"
  | "source_url"
  | "observed_at"
  | "base_url"
>;
type CompactWitness = Omit<QueueWitness, keyof WitnessContext> & {
  context: number;
};
interface StoredSourceQueue extends Omit<SourceQueue, "entries"> {
  witness_encoding: "contexts-v1";
  witness_contexts: WitnessContext[];
  entries: Array<
    Omit<QueueEntry, "witnesses"> & { witnesses: CompactWitness[] }
  >;
}
const witnessContext = (w: QueueWitness): WitnessContext => ({
  kind: w.kind,
  input_id: w.input_id,
  input_sha256: w.input_sha256,
  html_sha256: w.html_sha256,
  source_url: w.source_url,
  observed_at: w.observed_at,
  base_url: w.base_url,
});
export function encodeSourceQueue(queue: SourceQueue): StoredSourceQueue {
  const context = witnessContext;
  const uniqueContexts = new Set<string>();
  for (const entry of queue.entries)
    for (const witness of entry.witnesses)
      uniqueContexts.add(JSON.stringify(context(witness)));
  const keys = [...uniqueContexts].sort(cmp);
  const positions = new Map(keys.map((key, index) => [key, index]));
  return {
    ...queue,
    witness_encoding: "contexts-v1",
    witness_contexts: keys.map((key) => JSON.parse(key)),
    entries: queue.entries.map((e) => ({
      ...e,
      witnesses: e.witnesses.map((w) => ({
        context: positions.get(JSON.stringify(context(w)))!,
        locator: w.locator,
        raw_reference: w.raw_reference,
        label: w.label,
        role: w.role,
        action_control: w.action_control,
        fragment_only: w.fragment_only,
      })),
    })),
  };
}
export function decodeSourceQueue(value: unknown): SourceQueue {
  const queue = value as StoredSourceQueue;
  if (!queue || typeof queue !== "object")
    return fail("QUEUE_PREVIOUS", "Previous queue must be an object");
  if (!("witness_encoding" in queue)) return value as SourceQueue;
  if (
    queue.witness_encoding !== "contexts-v1" ||
    !Array.isArray(queue.witness_contexts) ||
    queue.witness_contexts.length > limits.witnesses ||
    !Array.isArray(queue.entries) ||
    queue.entries.length > limits.entries
  )
    return fail("QUEUE_PREVIOUS", "Previous witness encoding invalid");
  const {
    witness_encoding: _encoding,
    witness_contexts: contexts,
    ...rest
  } = queue;
  return {
    ...rest,
    entries: queue.entries.map((e) => ({
      ...e,
      witnesses: e.witnesses.map((w) => {
        if (
          !Number.isInteger(w.context) ||
          w.context < 0 ||
          w.context >= contexts.length
        )
          return fail("QUEUE_PREVIOUS", "Previous witness context unavailable");
        const c = contexts[w.context];
        // Rebuild exact canonical API property order, so resumed planning remains byte-stable.
        return {
          kind: c.kind,
          input_id: c.input_id,
          input_sha256: c.input_sha256,
          html_sha256: c.html_sha256,
          source_url: c.source_url,
          observed_at: c.observed_at,
          locator: w.locator,
          raw_reference: w.raw_reference,
          base_url: c.base_url,
          label: w.label,
          role: w.role,
          action_control: w.action_control,
          fragment_only: w.fragment_only,
        };
      }),
    })),
  };
}

async function safeRead(
  root: string,
  relative: string,
  maxBytes: number,
): Promise<Buffer> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("QUEUE_PATH", "Expected safe relative input path");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    fail("QUEUE_PATH", "Input root must be a regular directory");
  const canonicalRoot = await realpath(root);
  let cursor = root;
  for (const segment of relative.split("/")) {
    cursor = path.join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink())
      fail("QUEUE_PATH", "Symlink input rejected");
  }
  const physical = await realpath(cursor);
  if (!physical.startsWith(canonicalRoot + path.sep))
    fail("QUEUE_PATH", "Input escaped declared directory");
  const handle = await open(
    cursor,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes)
      fail("QUEUE_LIMIT", "Input exceeds file budget or is not regular");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.length > maxBytes ||
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      fail("QUEUE_CHANGED", "Input changed while reading");
    return bytes;
  } finally {
    await handle.close();
  }
}
async function readPinned(filename: string, pin: string, maxBytes: number) {
  if (!/^[a-f0-9]{64}$/.test(pin))
    fail("QUEUE_PIN", "Trusted lowercase SHA-256 pin required");
  const full = path.resolve(filename);
  const bytes = await safeRead(
    path.dirname(full),
    path.basename(full),
    maxBytes,
  );
  if (digest(bytes) !== pin)
    fail("QUEUE_PIN", "Input SHA-256 differs from caller pin");
  return bytes;
}
function identity(reference: string, base: string | null) {
  if (!reference.trim() || reference !== reference.trim()) return null;
  try {
    return identifyUrl(reference, base ?? undefined);
  } catch {
    return null;
  }
}
function keyFor(reference: string, base: string | null) {
  const id = identity(reference, base);
  return {
    identity: id,
    key: id
      ? `url:${id.crawl_key}`
      : `unresolved:${JSON.stringify([reference, base])}`,
  };
}

export async function planPilotSource(
  options: SourceQueueOptions,
): Promise<SourceQueue> {
  const batchSize = options.batchSize ?? 50;
  const maxWitnessBytes = options.maxWitnessBytes ?? limits.witnessBytes;
  const maxWitnesses = options.maxWitnesses ?? limits.witnesses;
  if (
    !Number.isSafeInteger(maxWitnesses) ||
    maxWitnesses < 1 ||
    maxWitnesses > limits.witnesses
  )
    fail("QUEUE_OPTIONS", "Witness count must be within the fixed safety cap");
  if (
    !Number.isSafeInteger(maxWitnessBytes) ||
    maxWitnessBytes < 1 ||
    maxWitnessBytes > limits.witnessBytes
  )
    fail(
      "QUEUE_OPTIONS",
      "Witness byte budget must be within the fixed safety cap",
    );
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    !options.rawDirs.length
  )
    fail("QUEUE_OPTIONS", "Raw directory and batch size 1..500 required");
  const captureBytes = await readPinned(
    options.capturePath,
    options.expectedCaptureSha256,
    2_000_000,
  );
  const capture = parse(captureBytes) as OperatorCaptureManifest;
  const validate = new Ajv({ strict: true, allErrors: true }).compile(
    operatorCaptureSchema,
  );
  if (!validate(capture))
    fail("QUEUE_FORMAT", "Capture manifest schema invalid");
  const sourceOrigin = identifyUrl(capture.source_origin).origin;
  if (capture.source_origin !== sourceOrigin)
    fail("QUEUE_ORIGIN", "Capture source_origin must be an exact origin");
  const entries = new Map<string, QueueEntry>();
  const witnessKeys = new Map<string, Set<string>>();
  const witnessOrder = new WeakMap<QueueWitness, string>();
  const budgetContexts = new Set<string>();
  const observationKeys = new Map<string, Set<string>>();
  const inputs = new Map<string, QueueInput>();
  let witnessCount = 0,
    witnessBytes = 0,
    identityBytes = 0,
    totalBytes = captureBytes.length;
  const input = (
    kind: QueueInput["kind"],
    relative: string,
    bytes: Uint8Array,
  ): QueueInput => {
    const sha256 = digest(bytes),
      id = `${kind}:${sha256}`;
    const value = {
      id,
      kind,
      relative_path: relative,
      sha256,
      size_bytes: bytes.length,
    };
    const prior = inputs.get(id);
    if (!prior || cmp(relative, prior.relative_path) < 0) inputs.set(id, value);
    return value;
  };
  const add = (
    reference: string,
    base: string | null,
    witness: QueueWitness,
    inInventory = false,
  ) => {
    str(reference, "source reference");
    const { key, identity: resolved } = keyFor(reference, base);
    let entry = entries.get(key);
    if (!entry) {
      identityBytes +=
        Buffer.byteLength(key) +
        Buffer.byteLength(reference) +
        Buffer.byteLength(base ?? "") +
        Buffer.byteLength(resolved?.request_target ?? "");
      if (identityBytes > limits.identityBytes)
        fail(
          "QUEUE_LIMIT",
          "Identity byte budget exceeded; registry is not truncated",
        );
      if (entries.size >= limits.entries)
        fail(
          "QUEUE_LIMIT",
          "URL registry budget exceeded; nothing is silently truncated",
        );
      entry = {
        id: digest(key),
        url: resolved?.crawl_key ?? null,
        request_target: resolved?.request_target ?? null,
        origin: resolved?.origin ?? null,
        identity_reference: reference,
        identity_base: base,
        in_capture_inventory: false,
        witnesses: [],
        observations: [],
        classification: "CONTENT_CANDIDATE",
        queue_status: "OUTSTANDING",
        observation_status: "NOT_OBSERVED",
        priority: 99,
        priority_reason: "Unclassified",
        review_reasons: [],
      };
      entries.set(key, entry);
      witnessKeys.set(key, new Set());
      observationKeys.set(key, new Set());
    }
    // Canonical representative does not depend on input-directory or discovery order.
    if (
      cmp(
        JSON.stringify([reference, base]),
        JSON.stringify([entry.identity_reference, entry.identity_base]),
      ) < 0
    ) {
      entry.identity_reference = reference;
      entry.identity_base = base;
    }
    entry.in_capture_inventory ||= inInventory;
    const witnessJson = JSON.stringify(witness);
    const witnessKey = digest(witnessJson);
    if (!witnessKeys.get(key)!.has(witnessKey)) {
      if (++witnessCount > maxWitnesses)
        fail("QUEUE_LIMIT", "Witness budget exceeded; split inputs explicitly");
      const contextJson = JSON.stringify(witnessContext(witness)),
        contextKey = digest(contextJson);
      if (!budgetContexts.has(contextKey)) {
        budgetContexts.add(contextKey);
        witnessBytes += Buffer.byteLength(contextJson);
      }
      // Charge actual per-reference fields plus a conservative reference/hash allowance;
      // common source metadata is shared, not multiplied once per link occurrence.
      witnessBytes +=
        Buffer.byteLength(
          JSON.stringify({
            locator: witness.locator,
            raw_reference: witness.raw_reference,
            label: witness.label,
            role: witness.role,
            action_control: witness.action_control,
            fragment_only: witness.fragment_only,
          }),
        ) + 128;
      if (witnessBytes > maxWitnessBytes)
        fail(
          "QUEUE_LIMIT",
          "Witness byte budget exceeded; retain prior snapshot and split/review inputs explicitly",
        );
      witnessKeys.get(key)!.add(witnessKey);
      witnessOrder.set(witness, witnessKey);
      entry.witnesses.push(witness);
    }
    return entry;
  };
  const addObservation = (entry: QueueEntry, observation: QueueObservation) => {
    const key = keyFor(entry.identity_reference, entry.identity_base).key;
    const value = JSON.stringify(observation);
    if (!observationKeys.get(key)!.has(value)) {
      observationKeys.get(key)!.add(value);
      entry.observations.push(observation);
    }
  };
  const makeWitness = (
    i: QueueInput,
    kind: QueueWitness["kind"],
    reference: string,
    source: string | null,
    at: string | null,
    htmlHash: string | null,
    locator: string,
    base: string | null,
  ): QueueWitness => ({
    kind,
    input_id: i.id,
    input_sha256: i.sha256,
    html_sha256: htmlHash,
    source_url: source,
    observed_at: at,
    locator,
    raw_reference: reference,
    base_url: base,
    label: null,
    role: "other",
    action_control: false,
    fragment_only: reference.startsWith("#"),
  });

  if (options.previousQueuePath) {
    const previous = decodeSourceQueue(
      parse(
        await readPinned(
          options.previousQueuePath,
          options.expectedPreviousSha256 ?? "",
          limits.previousBytes,
        ),
      ),
    );
    if (
      previous.schema_version !== 1 ||
      previous.kind !== "pilot-source-queue" ||
      previous.producer !== producer ||
      previous.source_origin !== sourceOrigin ||
      previous.project_id !== capture.project_id ||
      !Array.isArray(previous.entries) ||
      previous.entries.length > limits.entries ||
      !Array.isArray(previous.inputs)
    )
      fail("QUEUE_PREVIOUS", "Previous queue binding/schema invalid");
    for (const i of previous.inputs) {
      if (
        !i ||
        !/^[a-f0-9]{64}$/.test(i.sha256) ||
        i.id !== `${i.kind}:${i.sha256}` ||
        !["capture", "capture-observation", "raw-export"].includes(i.kind)
      )
        fail("QUEUE_PREVIOUS", "Previous input registry invalid");
      inputs.set(i.id, i);
    }
    for (const old of previous.entries) {
      const reference = str(old.identity_reference, "previous reference"),
        base =
          old.identity_base === null
            ? null
            : str(old.identity_base, "previous base");
      if (
        digest(keyFor(reference, base).key) !== old.id ||
        !Array.isArray(old.witnesses) ||
        !old.witnesses.length ||
        !Array.isArray(old.observations)
      )
        fail("QUEUE_PREVIOUS", "Previous identity/witness invalid");
      let entry: QueueEntry | undefined;
      for (const w of old.witnesses) {
        if (
          !inputs.has(w.input_id) ||
          inputs.get(w.input_id)!.sha256 !== w.input_sha256 ||
          typeof w.raw_reference !== "string" ||
          typeof w.locator !== "string" ||
          w.locator.length > 10000
        )
          fail("QUEUE_PREVIOUS", "Previous witness is not bound to an input");
        entry = add(reference, base, w, old.in_capture_inventory === true);
      }
      for (const o of old.observations) {
        if (
          !inputs.has(o.input_id) ||
          !/^[a-f0-9]{64}$/.test(o.snapshot_sha256) ||
          ![
            "DOM_OBSERVED",
            "SELECTED_FIELDS_ONLY",
            "ACCESS_CHALLENGE",
            "DOCUMENT_MISMATCH",
          ].includes(o.status)
        )
          fail("QUEUE_PREVIOUS", "Previous observation invalid");
        timestamp(o.observed_at);
        addObservation(entry!, o);
      }
    }
  } else if (options.expectedPreviousSha256)
    fail("QUEUE_OPTIONS", "Previous pin supplied without previous queue");

  const captureInput = input(
    "capture",
    path.basename(options.capturePath),
    captureBytes,
  );
  for (const [index, url] of capture.inventory.urls.entries())
    add(
      url,
      null,
      makeWitness(
        captureInput,
        "capture-inventory",
        url,
        null,
        null,
        null,
        `inventory.urls[${index}]`,
        null,
      ),
      true,
    );
  const processObservation = (
    i: QueueInput,
    source: string,
    document: string,
    at: string,
    html: string,
    format: QueueObservation["format"],
    rawLinks?: string[],
    requested?: string,
  ) => {
    const sourceId = identity(source, null),
      documentId = identity(document, null);
    if (
      !sourceId ||
      !documentId ||
      sourceId.origin !== sourceOrigin ||
      documentId.origin !== sourceOrigin
    )
      return fail(
        "QUEUE_ORIGIN",
        "Observation source/document outside capture origin",
      );
    const snapshotHash = digest(html),
      challenge =
        format === "dom-html"
          ? detectAccessChallenge(html)
          : detectAccessChallenge(
              `<title>${str(
                parse(Buffer.from(html)).document_title,
                "selected document title",
              )
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</title>`,
            );
    const status: QueueObservation["status"] = challenge
      ? "ACCESS_CHALLENGE"
      : sourceId.crawl_key !== documentId.crawl_key
        ? "DOCUMENT_MISMATCH"
        : format === "dom-html"
          ? "DOM_OBSERVED"
          : "SELECTED_FIELDS_ONLY";
    const witness = makeWitness(
      i,
      "observation",
      source,
      sourceId.crawl_key,
      at,
      snapshotHash,
      "source_url",
      null,
    );
    const entry = add(source, null, witness);
    addObservation(entry, {
      input_id: i.id,
      source_url: sourceId.crawl_key,
      document_url: documentId.crawl_key,
      observed_at: at,
      snapshot_sha256: snapshotHash,
      format,
      status,
    });
    if (sourceId.crawl_key !== documentId.crawl_key)
      add(document, null, {
        ...witness,
        raw_reference: document,
        locator: "document_url",
      });
    if (requested)
      add(
        requested,
        null,
        makeWitness(
          i,
          "requested-url",
          requested,
          sourceId.crawl_key,
          at,
          snapshotHash,
          "requested_url",
          null,
        ),
      );
    // Challenge HTML remains evidence, not content or permission to follow its links.
    if (challenge) return;
    let base: string | null = documentId.crawl_key;
    const $ = format === "dom-html" ? load(html) : null;
    if ($) {
      const rawBase = $("base[href]").first().attr("href");
      if (rawBase)
        base = identity(rawBase, documentId.crawl_key)?.raw_url ?? null;
    }
    for (const [index, link] of (rawLinks ?? []).entries())
      add(
        str(link, "raw link"),
        base,
        makeWitness(
          i,
          format === "dom-html" ? "raw-link" : "selected-link",
          link,
          sourceId.crawl_key,
          at,
          format === "dom-html" ? snapshotHash : null,
          `links[${index}]`,
          base,
        ),
      );
    if (!$) return;
    $("a[href],area[href],link[rel=alternate][href]").each((index, element) => {
      const raw = $(element).attr("href") ?? "";
      const w = makeWitness(
        i,
        "dom-link",
        raw,
        sourceId.crawl_key,
        at,
        snapshotHash,
        `a/area/link[href][${index}]`,
        base,
      );
      w.label = $(element).text().slice(0, 8192);
      w.role = $(element).closest("h1,h2,h3,h4,h5,h6").length
        ? "heading"
        : $(element).closest("nav,[role=navigation]").length
          ? "navigation"
          : "other";
      w.action_control =
        Object.keys(element.attribs).some((name) => /^on/i.test(name)) ||
        $(element).is("[role=button],[data-action],[data-cart]");
      add(raw, base, w);
    });
  };
  for (const observation of capture.observations) {
    const bytes = await safeRead(
      path.dirname(path.resolve(options.capturePath)),
      observation.file.relative_path,
      limits.fileBytes,
    );
    totalBytes += bytes.length;
    if (
      bytes.length !== observation.file.size_bytes ||
      digest(bytes) !== observation.file.sha256
    )
      fail("QUEUE_PIN", "Capture observation hash/size mismatch");
    if (totalBytes > limits.totalBytes)
      fail("QUEUE_LIMIT", "Total input byte budget exceeded");
    const i = input(
      "capture-observation",
      observation.file.relative_path,
      bytes,
    );
    const at = timestamp(observation.observed_at);
    if (observation.format === "dom-html")
      processObservation(
        i,
        observation.source_url,
        observation.document_url,
        at,
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        observation.format,
      );
    else {
      const selected = parse(bytes);
      if (
        !Array.isArray(selected.links) ||
        typeof selected.source_url !== "string" ||
        selected.source_url !== observation.source_url
      )
        fail("QUEUE_FORMAT", "Selected observation binding invalid");
      processObservation(
        i,
        observation.source_url,
        observation.document_url,
        at,
        bytes.toString("utf8"),
        observation.format,
        selected.links.map((v: unknown) => str(v, "selected link")),
      );
    }
  }
  const rawFiles: Array<{ root: string; name: string }> = [];
  for (const root of [
    ...new Set(options.rawDirs.map((p) => path.resolve(p))),
  ].sort(cmp)) {
    for (const name of (await readdir(root))
      .filter((name) => name.endsWith(".raw.json"))
      .sort(cmp))
      rawFiles.push({ root, name });
  }
  if (rawFiles.length > limits.rawFiles)
    fail("QUEUE_LIMIT", "Raw file budget exceeded");
  for (const { root, name } of rawFiles) {
    const bytes = await safeRead(root, name, limits.fileBytes),
      raw = parse(bytes);
    totalBytes += bytes.length;
    const html = str(raw.html, "raw HTML", limits.fileBytes),
      source = str(raw.source_url, "raw source URL"),
      document = str(raw.document_url, "raw document URL"),
      at = timestamp(raw.observed_at);
    if (!Array.isArray(raw.links) || raw.links.length > limits.entries)
      fail("QUEUE_FORMAT", "Raw link registry invalid");
    const paired = await safeRead(
      root,
      name.replace(/\.raw\.json$/, ".html"),
      limits.fileBytes,
    );
    totalBytes += paired.length;
    if (totalBytes > limits.totalBytes)
      fail("QUEUE_LIMIT", "Total input byte budget exceeded");
    if (!paired.equals(Buffer.from(html)))
      fail(
        "QUEUE_PIN",
        "Raw JSON HTML differs from paired immutable HTML file",
      );
    const i = input("raw-export", name, bytes);
    processObservation(
      i,
      source,
      document,
      at,
      html,
      "dom-html",
      raw.links.map((v: unknown) => str(v, "raw link")),
      raw.requested_url === undefined
        ? undefined
        : str(raw.requested_url, "requested URL"),
    );
  }
  for (const entry of entries.values()) {
    entry.witnesses.sort((a, b) =>
      cmp(witnessOrder.get(a)!, witnessOrder.get(b)!),
    );
    entry.observations.sort(
      (a, b) =>
        cmp(a.observed_at, b.observed_at) ||
        cmp(a.snapshot_sha256, b.snapshot_sha256) ||
        cmp(a.input_id, b.input_id),
    );
    const latest = entry.observations.at(-1);
    entry.observation_status = latest?.status ?? "NOT_OBSERVED";
    // A browser navigation is evidence about what document was reached, not an
    // HTTP response/Location chain for the originally requested identity. Bind
    // the witness to its exact pinned final observation, including on resume.
    const navigationWitnesses = entry.witnesses.filter((w) => {
      if (
        w.kind !== "requested-url" ||
        !entry.url ||
        !w.source_url ||
        w.source_url === entry.url ||
        !w.observed_at ||
        !w.html_sha256 ||
        identity(w.raw_reference, w.base_url)?.crawl_key !== entry.url
      )
        return false;
      const final = entries.get(keyFor(w.source_url, null).key);
      return (
        final?.origin === sourceOrigin &&
        final.observations.some(
          (o) =>
            o.input_id === w.input_id &&
            o.source_url === w.source_url &&
            o.document_url === w.source_url &&
            o.snapshot_sha256 === w.html_sha256 &&
            o.observed_at === w.observed_at,
        )
      );
    });
    const pendingNavigation = navigationWitnesses.some(
      (w) =>
        !latest || Date.parse(w.observed_at!) >= Date.parse(latest.observed_at),
    );
    let classification: QueueClassification = "CONTENT_CANDIDATE";
    const reasons: string[] = [];
    const referenceWitness = entry.witnesses.some((w) =>
      ["raw-link", "dom-link", "selected-link"].includes(w.kind),
    );
    if (!entry.url) {
      classification = "INVALID_URL_REVIEW";
      reasons.push(
        "Non-HTTP, empty, malformed or unresolvable reference; raw evidence retained",
      );
    } else if (entry.origin !== sourceOrigin) {
      classification = "FOREIGN_ORIGIN_REVIEW";
      reasons.push("Foreign origin is outside source permissions");
    } else {
      const url = new URL(entry.url);
      let decodedPath = url.pathname;
      try {
        decodedPath = decodeURIComponent(decodedPath);
      } catch {
        reasons.push("Malformed percent encoding requires review");
      }
      const protectedPath =
        /(?:^|\/)(?:admin|bitrix|local|login|logout|register|account|auth|private)(?:[/.]|$)/i.test(
          decodedPath,
        );
      const actionPath =
        /(?:^|\/)(?:cart|checkout|payment|payments|order|orders|wishlist|compare|api|add|remove|delete|\.write_feed)(?:[/.]|$)/i.test(
          decodedPath,
        );
      const actionQuery = [...url.searchParams].some(
        ([k, v]) =>
          /^(?:action|do|act|add|remove|delete|submit|checkout|logout|login|payment|order|quantity|cart|token|sessid|csrf|csrf_token)$/i.test(
            k,
          ) ||
          (k.toLowerCase() === "route" &&
            /(?:^|\/)(?:account|checkout|payment|api|tool|cart|compare|wishlist)(?:\/|$)/i.test(
              v,
            )),
      );
      if (protectedPath) {
        classification = "PROTECTED_REVIEW";
        reasons.push(
          "Protected/account path cannot be treated as public content",
        );
      } else if (
        actionPath ||
        actionQuery ||
        entry.witnesses.some((w) => w.action_control)
      ) {
        classification = "SOURCE_ACTION_REVIEW";
        reasons.push(
          "Potential source mutation/control; do not execute or submit",
        );
      } else if (/\.pdf$/i.test(url.pathname)) {
        classification = "DOCUMENT_REVIEW";
        reasons.push(
          "Document capture requires verified file bytes; not a DOM page completion",
        );
      } else if (
        /\.(?:jpe?g|png|gif|webp|avif|svg|ico|css|js|woff2?|ttf|zip|mp4|webm)$/i.test(
          url.pathname,
        )
      ) {
        classification = "MEDIA_REVIEW";
        reasons.push(
          "Media/resource witness retained separately from page-capture candidates",
        );
      } else if (entry.witnesses.every((w) => w.fragment_only)) {
        classification = "FRAGMENT_REVIEW";
        reasons.push("Only in-document fragment references observed");
      } else if (!referenceWitness && !latest) {
        classification = "UNWITNESSED_INVENTORY_REVIEW";
        reasons.push(
          "Inventory identity retained, but no raw link witness available in supplied inputs",
        );
      } else if (entry.request_target!.includes("?")) {
        classification = "QUERY_VARIANT_REVIEW";
        reasons.push(
          "Exact query identity retained; significance/alias must be reviewed, never silently merged",
        );
      }
    }
    if (latest?.status === "ACCESS_CHALLENGE")
      reasons.push(
        "Latest observed bytes are an access challenge; server access is not cleared",
      );
    if (latest?.status === "DOCUMENT_MISMATCH")
      reasons.push(
        "Observed document differs from requested source; redirect mapping requires review",
      );
    if (latest?.status === "SELECTED_FIELDS_ONLY")
      reasons.push("Selected fields are partial, not full DOM observation");
    if (
      pendingNavigation &&
      [
        "CONTENT_CANDIDATE",
        "QUERY_VARIANT_REVIEW",
        "UNWITNESSED_INVENTORY_REVIEW",
      ].includes(classification)
    ) {
      classification = "HTTP_NAVIGATION_UNVERIFIED";
      reasons.push(
        "Requested navigation reached a different observed document; exact requested/final identities and pinned requested-url witnesses are retained. HTTP status, Location chain and redirect/alias mapping remain unverified; review before another attempt.",
      );
    }
    entry.classification = classification;
    entry.queue_status =
      classification === "HTTP_NAVIGATION_UNVERIFIED"
        ? "REVIEW_REQUIRED"
        : latest?.status === "DOM_OBSERVED"
          ? "ALREADY_OBSERVED"
          : classification === "CONTENT_CANDIDATE" && !latest
            ? "OUTSTANDING"
            : "REVIEW_REQUIRED";
    entry.review_reasons = reasons;
    const navigation = entry.witnesses.some((w) => w.role === "navigation"),
      heading = entry.witnesses.some((w) => w.role === "heading");
    const info =
      /(?:^|\/)(?:about|contact|kontak|dostav|oplata|garant|instruction|instruk|document|support|news|novosti|article)/i.test(
        entry.request_target ?? "",
      );
    entry.priority = navigation
      ? 10
      : heading
        ? 20
        : info
          ? 30
          : (entry.request_target?.split("/").length ?? 0) > 2
            ? 40
            : 50;
    entry.priority_reason = navigation
      ? "Observed in source navigation; category/site-structure candidate"
      : heading
        ? "Observed heading link; product/detail/article candidate"
        : info
          ? "Information/documentation path heuristic"
          : entry.priority === 40
            ? "Observed nested content path; semantic type unverified"
            : "Observed ordinary page link";
  }
  const all = [...entries.values()].sort((a, b) =>
    cmp(a.url ?? a.id, b.url ?? b.id),
  );
  const outstanding = all
    .filter((e) => e.queue_status === "OUTSTANDING")
    .sort((a, b) => a.priority - b.priority || cmp(a.url!, b.url!));
  const classifications: Record<string, number> = {};
  for (const e of all)
    classifications[e.classification] =
      (classifications[e.classification] ?? 0) + 1;
  const observedTimes = all
    .flatMap((e) => e.observations.map((o) => o.observed_at))
    .sort(cmp);
  return {
    schema_version: 1,
    kind: "pilot-source-queue",
    producer,
    source_origin: sourceOrigin,
    project_id: capture.project_id,
    full_source_denominator: "UNKNOWN",
    source_access: "UNCHANGED_NOT_VERIFIED",
    selection_is_not_completion: true,
    as_of_observation: observedTimes.at(-1) ?? null,
    inputs: [...inputs.values()].sort((a, b) => cmp(a.id, b.id)),
    entries: all,
    counts: {
      entries: all.length,
      same_origin_http_identities: all.filter((e) => e.origin === sourceOrigin)
        .length,
      capture_inventory_identities: all.filter((e) => e.in_capture_inventory)
        .length,
      observed_dom: all.filter((e) => e.observation_status === "DOM_OBSERVED")
        .length,
      outstanding: outstanding.length,
      review_required: all.filter((e) => e.queue_status === "REVIEW_REQUIRED")
        .length,
      classifications: Object.fromEntries(
        Object.entries(classifications).sort(([a], [b]) => cmp(a, b)),
      ),
    },
    next_batch: outstanding.slice(0, batchSize).map((e) => ({
      entry_id: e.id,
      url: e.url!,
      request_target: e.request_target!,
      priority: e.priority,
      reason: e.priority_reason,
      witness: e.witnesses.find((w) =>
        ["raw-link", "dom-link", "selected-link"].includes(w.kind),
      )!,
    })),
    limitations: [
      "Offline planning only; source HTML, links and labels are untrusted data, never instructions or authorization.",
      "Known inventory is a growing lower bound, not complete source scope; full denominator remains UNKNOWN.",
      "DOM_OBSERVED means supplied snapshot bytes were read and bound, not independent factual truth, source HTTP status, extraction acceptance, import or scenario success.",
      "HTTP_NAVIGATION_UNVERIFIED retains an original requested URL whose pinned browser observation reached another document; it is neither a verified HTTP redirect nor a DOM observation of the original URL, and is not automatically retried.",
      "A selected batch does not complete or skip entries; only a subsequent supplied observation changes observation status.",
      "Previous pinned queues retain unresolved identities/witnesses even when an input file is no longer supplied; no automatic exclusion or alias/query normalization occurs.",
      "Action/protected/foreign/resource/query classifications require review; they are retained in the registry and are not permission to navigate or submit.",
      "Priority is an auditable heuristic from source link placement/path; it does not declare Product typing, price, stock or commerce support.",
    ],
  };
}

export async function writeSourceQueue(queue: SourceQueue, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  if ((await lstat(outputDir)).isSymbolicLink())
    fail("QUEUE_PATH", "Output directory cannot be a symlink");
  const bytes = Buffer.from(JSON.stringify(encodeSourceQueue(queue)) + "\n"),
    sha256 = digest(bytes);
  if (bytes.length > limits.previousBytes)
    fail(
      "QUEUE_LIMIT",
      "Queue snapshot exceeds the bounded resume-reader size; no unreadable snapshot is written",
    );
  const basename = `queue-${sha256}`;
  const queuePath = path.resolve(outputDir, basename + ".json");
  const batchPath = path.resolve(outputDir, basename + "-next-batch.json");
  const reportPath = path.resolve(outputDir, basename + "-report.md");
  const immutable = async (filename: string, data: string | Buffer) => {
    let handle;
    try {
      handle = await open(filename, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (
        (await lstat(filename)).isSymbolicLink() ||
        !(await readFile(filename)).equals(Buffer.from(data))
      )
        fail("QUEUE_IMMUTABLE", "Existing output differs; never overwritten");
      return;
    }
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  };
  await immutable(queuePath, bytes);
  await immutable(
    batchPath,
    JSON.stringify(
      {
        schema_version: 1,
        queue_sha256: sha256,
        full_source_denominator: "UNKNOWN",
        selection_is_not_completion: true,
        entries: queue.next_batch,
      },
      null,
      2,
    ) + "\n",
  );
  // Raw source strings remain inside JSON evidence, never rendered into executable report markup.
  await immutable(
    reportPath,
    `# Source continuation queue\n\nQueue SHA-256: ${sha256}\n\nKnown entries: ${queue.counts.entries}; same-origin HTTP identities: ${queue.counts.same_origin_http_identities}; pinned capture inventory identities: ${queue.counts.capture_inventory_identities}.\n\nDOM observed: ${queue.counts.observed_dom}; outstanding content candidates: ${queue.counts.outstanding}; review required: ${queue.counts.review_required}; next batch: ${queue.next_batch.length}.\n\nFull source denominator: UNKNOWN. Server source access: unchanged / not verified. Selection is not completion.\n\n${queue.limitations.map((v) => `- ${v}`).join("\n")}\n`,
  );
  return {
    sha256,
    queuePath,
    batchPath,
    reportPath,
    counts: queue.counts,
    next_batch_count: queue.next_batch.length,
  };
}
async function main(args: string[]) {
  if (args.includes("--help")) {
    console.log(
      "Offline: --raw-dir DIR [repeat] --capture FILE --capture-sha256 SHA --output DIR [--previous FILE --previous-sha256 SHA] [--batch-size 50] [--max-witness-bytes 256000000]",
    );
    return;
  }
  const values = new Map<string, string[]>();
  const allowed = new Set([
    "--raw-dir",
    "--capture",
    "--capture-sha256",
    "--output",
    "--previous",
    "--previous-sha256",
    "--batch-size",
    "--max-witness-bytes",
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !allowed.has(key) ||
      !value ||
      value.startsWith("--") ||
      (values.has(key) && key !== "--raw-dir")
    )
      fail("QUEUE_OPTIONS", "Unknown, missing or duplicate CLI option");
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  const required = (name: string) =>
    values.get(name)?.[0] ?? fail("QUEUE_OPTIONS", `Required ${name}`);
  const result = await planPilotSource({
    rawDirs: values.get("--raw-dir") ?? [],
    capturePath: required("--capture"),
    expectedCaptureSha256: required("--capture-sha256"),
    previousQueuePath: values.get("--previous")?.[0],
    expectedPreviousSha256: values.get("--previous-sha256")?.[0],
    batchSize: values.has("--batch-size")
      ? Number(values.get("--batch-size")![0])
      : 50,
    maxWitnessBytes: values.has("--max-witness-bytes")
      ? Number(values.get("--max-witness-bytes")![0])
      : undefined,
  });
  console.log(
    JSON.stringify(await writeSourceQueue(result, required("--output"))),
  );
}
if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => "")) ===
    (await realpath(fileURLToPath(import.meta.url)))
) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(
      JSON.stringify({
        error: error.code ?? "QUEUE_FAILURE",
        message: error.message,
      }),
    );
    process.exitCode = 1;
  });
}
