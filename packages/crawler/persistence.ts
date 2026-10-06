/** Local crawler WAL. Callers hold crawl.lock; no Store or target database is used. */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  lstat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { CrawlResult } from "./index.ts";

const sha = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const validSha = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const keys = new Set([
  "schema_version",
  "project_id",
  "source_origin",
  "output_dir",
  "started_at",
  "finished_at",
  "state",
  "access",
  "limitations",
  "counters",
  "discovery",
  "policy",
  "completeness",
]);
const MAX_STATE = 512_000_000,
  MAX_LINE = 16_000_000,
  MAX_JOURNAL = 256_000_000;
async function directoryBudget(directory: string) {
  const names = await readdir(directory);
  requireValue(
    names.length <= 128,
    "Journal generation/file count limit reached; preserve orphan evidence for review",
  );
  let total = 0;
  for (const name of names) {
    const info = await lstat(path.join(directory, name));
    requireValue(
      info.isFile() && !info.isSymbolicLink(),
      "Journal paths must be regular files",
    );
    total += info.size;
  }
  requireValue(total <= 2_000_000_000, "Journal storage byte limit reached");
  return { count: names.length, bytes: total };
}
type Pending = {
  first_url: string;
  last_url: string;
  first_request: number;
  last_request: number;
} | null;
type Change =
  | { group: "entry" | "asset"; index: number; value: unknown }
  | { group: "meta"; key: string; present: boolean; value?: unknown };
type Head = {
  version: 1;
  generation: string;
  sequence: number;
  chain: string;
  checkpoint_sha256: string;
  checkpoint_bytes: number;
};
type Checkpoint = {
  version: 1;
  sequence: number;
  chain: string;
  pending: Pending;
  reservation: { sequence: number; chain: string } | null;
  state: CrawlResult;
};
type Watermark = {
  version: 1;
  sequence: number;
  chain: string;
  requests: number;
  bytes: number;
};
export class CrawlPersistenceError extends Error {
  code = "CRAWL_PERSISTENCE_CORRUPT";
}
const requireValue: (v: unknown, message: string) => asserts v = (
  v,
  message,
) => {
  if (!v) throw new CrawlPersistenceError(message);
};
async function bounded(filename: string, cap: number) {
  const info = await lstat(filename);
  requireValue(
    info.isFile() && !info.isSymbolicLink() && info.size <= cap,
    "Persistence file exceeds its finite size limit",
  );
  const bytes = await readFile(filename);
  requireValue(
    bytes.length === info.size && bytes.length <= cap,
    "Persistence file changed while reading",
  );
  return bytes;
}
async function durableFile(filename: string, bytes: string | Buffer) {
  const f = await open(filename, "wx", 0o600);
  try {
    await f.writeFile(bytes);
    await f.sync();
  } finally {
    await f.close();
  }
}
async function syncDirectory(directory: string) {
  // Windows does not expose directory fsync. File flush + atomic same-volume rename
  // is used there; sudden power-loss directory durability is not claimed.
  if (process.platform === "win32") return;
  const f = await open(directory, "r");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
function checkState(state: any): asserts state is CrawlResult {
  requireValue(
    state &&
      state.schema_version === 1 &&
      Array.isArray(state.entries) &&
      Array.isArray(state.assets),
    "Invalid crawl checkpoint state",
  );
  requireValue(
    state.entries.length <= 1_000_000 && state.assets.length <= 1_000_000,
    "Crawl registry storage limit exceeded",
  );
  for (const key of ["requests", "bytes", "pages"])
    requireValue(
      Number.isSafeInteger(state.counters?.[key]) && state.counters[key] >= 0,
      "Invalid persisted crawl budget",
    );
}
function checkPending(v: any): asserts v is Pending {
  requireValue(
    v === null ||
      (v &&
        typeof v.first_url === "string" &&
        typeof v.last_url === "string" &&
        Number.isSafeInteger(v.first_request) &&
        v.first_request >= 1 &&
        Number.isSafeInteger(v.last_request) &&
        v.last_request >= v.first_request),
    "Invalid request reservation",
  );
}
function apply(state: CrawlResult, changes: Change[]) {
  requireValue(
    Array.isArray(changes) && changes.length <= 100_000,
    "Invalid journal change list",
  );
  for (const c of changes) {
    if (c.group === "meta") {
      requireValue(
        keys.has(c.key) && typeof c.present === "boolean",
        "Unknown journal metadata key",
      );
      if (c.present) (state as any)[c.key] = c.value;
      else delete (state as any)[c.key];
    } else {
      requireValue(
        c.group === "entry" || c.group === "asset",
        "Unknown journal record group",
      );
      const rows = c.group === "entry" ? state.entries : state.assets;
      requireValue(
        Number.isSafeInteger(c.index) &&
          c.index >= 0 &&
          c.index <= rows.length &&
          c.index < 1_000_000 &&
          c.value &&
          typeof c.value === "object",
        "Journal record index is not contiguous",
      );
      rows[c.index] = c.value as never;
    }
  }
}

export class CrawlPersistence {
  readonly directory: string;
  readonly output: string;
  state?: CrawlResult;
  pending: Pending = null;
  readonly changedEntries = new Set<number>();
  private dirtyAssets = new Set<number>();
  private dirtyMeta = new Set<string>();
  private head?: Head;
  private sequence = 0;
  private chain = "0".repeat(64);
  private journalBytes = 0;
  private storageBytes = 0;
  private failed = false;
  private pendingDirty = false;
  private journal?: FileHandle;
  private reservationFile?: FileHandle;
  private watermark: Watermark | null = null;
  private proxies = new WeakMap<object, Map<string, object>>();
  private raw = new WeakMap<object, object>();
  /** Test fault seam: no CLI flag or external callback is accepted by crawler. */
  fault?: (
    point:
      | "before_append"
      | "after_append_sync"
      | "after_reservation_sync"
      | "after_checkpoint_sync"
      | "after_head_rename",
  ) => void;
  constructor(output: string) {
    this.output = path.resolve(output);
    this.directory = path.join(this.output, "crawl-state");
  }
  static async load(output: string) {
    const p = new CrawlPersistence(output);
    let bytes: Buffer;
    try {
      bytes = await bounded(path.join(p.directory, "head.json"), 4096);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      let remnants: string[] = [];
      try {
        remnants = await readdir(p.directory);
      } catch (dirError) {
        if ((dirError as NodeJS.ErrnoException).code !== "ENOENT")
          throw dirError;
      }
      requireValue(
        remnants.length === 0,
        "Missing journal head; refusing legacy fallback over durable state",
      );
      try {
        p.state = JSON.parse(
          (
            await bounded(path.join(p.output, "crawl.json"), MAX_STATE)
          ).toString("utf8"),
        );
        checkState(p.state);
      } catch (legacy) {
        if ((legacy as NodeJS.ErrnoException).code !== "ENOENT") throw legacy;
      }
      return p;
    }
    p.storageBytes = (await directoryBudget(p.directory)).bytes;
    const h = JSON.parse(bytes.toString("utf8")) as Head;
    requireValue(
      h.version === 1 &&
        /^[a-f0-9-]{36}$/.test(h.generation) &&
        Number.isSafeInteger(h.sequence) &&
        h.sequence >= 0 &&
        validSha(h.chain) &&
        validSha(h.checkpoint_sha256) &&
        Number.isSafeInteger(h.checkpoint_bytes),
      "Invalid checkpoint head",
    );
    const snapshot = await bounded(
      path.join(p.directory, `checkpoint-${h.generation}.json`),
      MAX_STATE,
    );
    requireValue(
      snapshot.length === h.checkpoint_bytes &&
        sha(snapshot) === h.checkpoint_sha256,
      "Checkpoint SHA-256 mismatch",
    );
    const c = JSON.parse(snapshot.toString("utf8")) as Checkpoint;
    requireValue(
      c.version === 1 && c.sequence === h.sequence && c.chain === h.chain,
      "Checkpoint order mismatch",
    );
    checkState(c.state);
    checkPending(c.pending);
    requireValue(
      c.reservation === null ||
        (c.reservation &&
          Number.isSafeInteger(c.reservation.sequence) &&
          c.reservation.sequence >= 0 &&
          validSha(c.reservation.chain)),
      "Invalid checkpoint reservation binding",
    );
    try {
      const bytes = await bounded(
        path.join(p.directory, "reservation.json"),
        4096,
      );
      requireValue(bytes.length === 4096, "Torn reservation watermark");
      const { checksum, ...mark } = JSON.parse(bytes.toString("utf8"));
      requireValue(
        validSha(checksum) &&
          sha(JSON.stringify(mark)) === checksum &&
          mark.version === 1 &&
          Number.isSafeInteger(mark.sequence) &&
          mark.sequence >= 0 &&
          validSha(mark.chain) &&
          Number.isSafeInteger(mark.requests) &&
          mark.requests >= 1 &&
          Number.isSafeInteger(mark.bytes) &&
          mark.bytes >= 0,
        "Invalid reservation watermark checksum or budget",
      );
      p.watermark = mark as Watermark;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (c.reservation)
      requireValue(
        p.watermark && p.watermark.sequence >= c.reservation.sequence,
        "Missing or rolled-back reservation watermark",
      );
    let reservationMatched = p.watermark === null;
    if (p.watermark && p.watermark.sequence <= c.sequence) {
      requireValue(
        p.watermark.sequence === c.sequence
          ? p.watermark.chain === c.chain
          : c.reservation?.sequence === p.watermark.sequence &&
              c.reservation.chain === p.watermark.chain,
        "Checkpoint reservation chain mismatch",
      );
      reservationMatched = true;
    }
    p.state = c.state;
    p.pending = c.pending;
    p.sequence = c.sequence;
    p.chain = c.chain;
    p.head = h;
    const journal = await bounded(
      path.join(p.directory, `journal-${h.generation}.jsonl`),
      MAX_JOURNAL,
    );
    p.journalBytes = journal.length;
    // Never discard an incomplete last reservation: fail closed before any network.
    requireValue(
      !journal.length || journal.at(-1) === 10,
      "Torn journal tail; budget outcome requires explicit recovery",
    );
    let start = 0;
    while (start < journal.length) {
      const end = journal.indexOf(10, start);
      requireValue(
        end >= start && end - start <= MAX_LINE,
        "Journal line limit exceeded",
      );
      const line = journal.subarray(start, end),
        row = JSON.parse(line.toString("utf8"));
      const { checksum, ...body } = row;
      requireValue(
        validSha(checksum) && sha(JSON.stringify(body)) === checksum,
        "Journal checksum mismatch",
      );
      requireValue(
        body.version === 1 &&
          body.sequence === p.sequence + 1 &&
          body.previous === p.chain,
        "Journal sequence/chain mismatch",
      );
      checkPending(body.pending);
      apply(p.state!, body.changes);
      p.pending = body.pending;
      p.sequence = body.sequence;
      p.chain = checksum;
      if (p.watermark?.sequence === p.sequence) {
        requireValue(
          p.watermark.chain === checksum,
          "Reservation journal chain mismatch",
        );
        reservationMatched = true;
      }
      start = end + 1;
    }
    checkState(p.state);
    requireValue(
      reservationMatched &&
        (!p.watermark || p.state!.counters.requests >= p.watermark.requests),
      "Journal truncated below durable request reservation",
    );
    return p;
  }
  attach(state: CrawlResult): CrawlResult {
    this.state = state;
    const tracked = (value: any, group: string): any => {
      if (!value || typeof value !== "object") return value;
      value = this.raw.get(value) ?? value;
      const cached = this.proxies.get(value)?.get(group);
      if (cached) return cached;
      const dirty = () => {
        if (group.startsWith("entry:"))
          this.changedEntries.add(Number(group.slice(6)));
        else if (group.startsWith("asset:"))
          this.dirtyAssets.add(Number(group.slice(6)));
        else if (group.startsWith("meta:")) this.dirtyMeta.add(group.slice(5));
      };
      const proxy = new Proxy(value, {
        get: (target, key, receiver) => {
          const child = Reflect.get(target, key, receiver);
          if (typeof key !== "string") return child;
          if (group === "root")
            return tracked(
              child,
              key === "entries"
                ? "entries"
                : key === "assets"
                  ? "assets"
                  : `meta:${key}`,
            );
          if ((group === "entries" || group === "assets") && /^\d+$/.test(key))
            return tracked(
              child,
              `${group === "entries" ? "entry" : "asset"}:${key}`,
            );
          return tracked(child, group);
        },
        set: (target, key, next) => {
          next =
            next && typeof next === "object"
              ? (this.raw.get(next) ?? next)
              : next;
          if (target[key] === next) return true;
          if (group === "root") {
            requireValue(
              typeof key === "string" && keys.has(key),
              "Registry replacement is forbidden",
            );
            this.dirtyMeta.add(key);
          } else if (group === "entries" || group === "assets") {
            requireValue(
              typeof key === "string" &&
                /^\d+$/.test(key) &&
                Number(key) <= target.length,
              "Registry truncation or sparse mutation is forbidden",
            );
            (group === "entries" ? this.changedEntries : this.dirtyAssets).add(
              Number(key),
            );
          } else dirty();
          return Reflect.set(target, key, next);
        },
        deleteProperty: (target, key) => {
          requireValue(
            group !== "entries" && group !== "assets",
            "Registry deletion is forbidden",
          );
          if (group === "root") {
            requireValue(
              typeof key === "string" && keys.has(key),
              "Unknown metadata field",
            );
            this.dirtyMeta.add(key);
          } else dirty();
          return Reflect.deleteProperty(target, key);
        },
      });
      const map = this.proxies.get(value) ?? new Map();
      map.set(group, proxy);
      this.proxies.set(value, map);
      this.raw.set(proxy, value);
      return proxy;
    };
    return tracked(state, "root");
  }
  reserve(url: string, request: number) {
    this.pending = this.pending
      ? { ...this.pending, last_url: url, last_request: request }
      : {
          first_url: url,
          last_url: url,
          first_request: request,
          last_request: request,
        };
    this.pendingDirty = true;
  }
  async flush(settle = false, durable = true) {
    requireValue(
      !this.failed && this.state,
      "Persistence writer is poisoned after an unknown write",
    );
    if (settle && this.pending) {
      this.pending = null;
      this.pendingDirty = true;
    }
    if (!this.head) {
      await this.checkpoint();
      if (durable && this.pending) await this.markReservation();
      return;
    }
    const changes: Change[] = [];
    for (const index of [...this.changedEntries].sort((a, b) => a - b))
      changes.push({ group: "entry", index, value: this.state.entries[index] });
    for (const index of [...this.dirtyAssets].sort((a, b) => a - b))
      changes.push({ group: "asset", index, value: this.state.assets[index] });
    for (const key of [...this.dirtyMeta].sort())
      changes.push({
        group: "meta",
        key,
        present: Object.hasOwn(this.state, key),
        value: (this.state as any)[key],
      });
    if (!changes.length && !this.pendingDirty) return;
    const body = {
        version: 1,
        sequence: this.sequence + 1,
        previous: this.chain,
        changes,
        pending: this.pending,
      },
      checksum = sha(JSON.stringify(body)),
      bytes = Buffer.from(JSON.stringify({ ...body, checksum }) + "\n");
    requireValue(
      bytes.length <= MAX_LINE &&
        this.storageBytes + bytes.length <= 2_000_000_000,
      "Journal mutation exceeds finite line cap",
    );
    this.changedEntries.clear();
    this.dirtyAssets.clear();
    this.dirtyMeta.clear();
    this.pendingDirty = false;
    try {
      this.fault?.("before_append");
      this.journal ??= await open(
        path.join(this.directory, `journal-${this.head.generation}.jsonl`),
        "a",
      );
      await this.journal.writeFile(bytes);
      if (durable) await this.journal.sync();
      this.fault?.("after_append_sync");
      this.sequence++;
      this.chain = checksum;
      this.journalBytes += bytes.length;
      this.storageBytes += bytes.length;
      if (durable && this.pending) await this.markReservation();
      if (
        this.journalBytes >=
        Math.min(
          128_000_000,
          Math.max(4_000_000, this.head.checkpoint_bytes * 2),
        )
      )
        await this.checkpoint();
    } catch (e) {
      this.failed = true;
      await this.close();
      throw e;
    }
  }
  async checkpoint() {
    requireValue(
      !this.failed && this.state,
      "Cannot checkpoint poisoned writer",
    );
    try {
      if (this.journal) {
        await this.journal.sync();
        await this.close();
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const budget = await directoryBudget(this.directory);
      const generation = randomUUID(),
        old = this.head;
      const bytes = Buffer.from(
        JSON.stringify({
          version: 1,
          sequence: this.sequence,
          chain: this.chain,
          pending: this.pending,
          reservation: this.watermark
            ? { sequence: this.watermark.sequence, chain: this.watermark.chain }
            : null,
          state: this.state,
        }),
      );
      requireValue(
        bytes.length <= MAX_STATE,
        "Checkpoint exceeds finite state cap",
      );
      requireValue(
        budget.count + 3 <= 128 &&
          budget.bytes + bytes.length + 4096 <= 2_000_000_000,
        "Checkpoint exceeds remaining journal storage budget",
      );
      // Capture and clear before awaiting IO; mutations from concurrent browser
      // callbacks remain dirty for the next serialized flush.
      this.changedEntries.clear();
      this.dirtyAssets.clear();
      this.dirtyMeta.clear();
      this.pendingDirty = false;
      const head: Head = {
        version: 1,
        generation,
        sequence: this.sequence,
        chain: this.chain,
        checkpoint_sha256: sha(bytes),
        checkpoint_bytes: bytes.length,
      };
      await durableFile(
        path.join(this.directory, `checkpoint-${generation}.json`),
        bytes,
      );
      await durableFile(
        path.join(this.directory, `journal-${generation}.jsonl`),
        "",
      );
      await syncDirectory(this.directory);
      this.fault?.("after_checkpoint_sync");
      const temporary = path.join(this.directory, `head-${generation}.tmp`);
      await durableFile(temporary, JSON.stringify(head));
      await rename(temporary, path.join(this.directory, "head.json"));
      await syncDirectory(this.directory);
      this.fault?.("after_head_rename");
      this.head = head;
      this.journalBytes = 0;
      if (old)
        for (const name of [
          `checkpoint-${old.generation}.json`,
          `journal-${old.generation}.jsonl`,
        ])
          await unlink(path.join(this.directory, name));
      this.storageBytes = (await directoryBudget(this.directory)).bytes;
    } catch (e) {
      this.failed = true;
      throw e;
    }
  }
  async project() {
    await this.flush();
    if (this.head) {
      const journal = await open(
        path.join(this.directory, `journal-${this.head.generation}.jsonl`),
        "r+",
      );
      try {
        await journal.sync();
      } finally {
        await journal.close();
      }
    }
    const budget = await directoryBudget(this.directory);
    const temporary = path.join(
      this.directory,
      `projection-${randomUUID()}.tmp`,
    );
    const bytes = JSON.stringify(this.state, null, 2);
    requireValue(
      Buffer.byteLength(bytes) <= MAX_STATE &&
        budget.count + 1 <= 128 &&
        budget.bytes + Buffer.byteLength(bytes) <= 2_000_000_000,
      "Legacy projection exceeds finite state cap",
    );
    await durableFile(temporary, bytes);
    await rename(temporary, path.join(this.output, "crawl.json"));
    await syncDirectory(this.directory);
    await syncDirectory(this.output);
    await this.close();
  }
  private async markReservation() {
    const mark: Watermark = {
      version: 1,
      sequence: this.sequence,
      chain: this.chain,
      requests: this.state!.counters.requests,
      bytes: this.state!.counters.bytes,
    };
    const encoded = Buffer.from(
      JSON.stringify({ ...mark, checksum: sha(JSON.stringify(mark)) }),
    );
    requireValue(
      encoded.length <= 4096,
      "Reservation watermark exceeds fixed size",
    );
    const fixed = Buffer.alloc(4096, 32);
    encoded.copy(fixed);
    const fresh = this.watermark === null;
    try {
      if (fresh) {
        const budget = await directoryBudget(this.directory);
        requireValue(
          budget.count + 1 <= 128 &&
            budget.bytes + fixed.length <= 2_000_000_000,
          "Reservation exceeds remaining journal storage budget",
        );
      }
      this.reservationFile ??= await open(
        path.join(this.directory, "reservation.json"),
        fresh ? "wx" : "r+",
        0o600,
      );
      const written = await this.reservationFile.write(
        fixed,
        0,
        fixed.length,
        0,
      );
      requireValue(
        written.bytesWritten === fixed.length,
        "Partial reservation watermark write",
      );
      await this.reservationFile.sync();
      if (fresh) {
        await syncDirectory(this.directory);
        this.storageBytes += fixed.length;
      }
      this.watermark = mark;
      this.fault?.("after_reservation_sync");
    } catch (e) {
      this.failed = true;
      await this.close();
      throw e;
    }
  }
  async close() {
    const handle = this.journal;
    const reservation = this.reservationFile;
    this.journal = undefined;
    this.reservationFile = undefined;
    if (handle) await handle.close();
    if (reservation) await reservation.close();
  }
}
