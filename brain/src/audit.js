import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../audit/audit.jsonl"
);

const GENESIS = "genesis";
const MAX_ANSWER_CHARS = 4000;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digest(prevHash, payload) {
  return createHash("sha256")
    .update(`${prevHash}\n${stableStringify(payload)}`)
    .digest("hex");
}

export class AuditLog {
  constructor({ file = DEFAULT_FILE, memoryOnly = false, maxMemory = 500 } = {}) {
    this.file = file;
    this.memoryOnly = memoryOnly;
    this.maxMemory = maxMemory;
    this.entries = [];

    if (!memoryOnly && file && existsSync(file)) {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(-maxMemory)) {
        try {
          this.entries.push(JSON.parse(line));
        } catch {
          // A corrupt line must never break the audit reader.
        }
      }
    }
  }

  record(entry) {
    const payload = { ts: new Date().toISOString(), ...entry };
    if (typeof payload.answer === "string" && payload.answer.length > MAX_ANSWER_CHARS) {
      payload.answer = payload.answer.slice(0, MAX_ANSWER_CHARS);
      payload.answer_truncated = true;
    }

    const prevHash = this.entries.length
      ? this.entries[this.entries.length - 1].hash ?? GENESIS
      : GENESIS;
    const item = { ...payload, prev_hash: prevHash };
    item.hash = digest(prevHash, payload);

    this.entries.push(item);
    if (this.entries.length > this.maxMemory) this.entries.shift();

    if (!this.memoryOnly && this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(item)}\n`, "utf8");
    }

    return item;
  }

  recent(limit = 50) {
    const safeLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 200)
      : 50;
    return this.entries.slice(-safeLimit).reverse();
  }

  /**
   * Recompute the hash chain for every retained entry. Each entry carries its
   * own `prev_hash`, so verification still works on a truncated tail.
   */
  verify() {
    const broken = [];
    let previous = null;
    let legacy = 0;
    let chainStarted = false;

    this.entries.forEach((entry, index) => {
      const { hash, prev_hash: prevHash, ...payload } = entry;

      // Entries written before the hash chain existed carry neither digest nor
      // link, and are only tolerated as a contiguous prefix. A missing digest
      // on an entry that still has a prev_hash means the hash was stripped.
      if (typeof hash !== "string") {
        if (chainStarted || typeof prevHash === "string") {
          broken.push({
            index,
            ts: entry.ts ?? null,
            request_id: entry.request_id ?? null,
            reason: "hash_missing"
          });
          return;
        }
        legacy += 1;
        previous = null;
        return;
      }

      chainStarted = true;
      const expected = digest(prevHash ?? GENESIS, payload);
      const linkOk =
        index === 0 || previous === null || prevHash === previous;
      if (hash !== expected || !linkOk) {
        broken.push({
          index,
          ts: entry.ts ?? null,
          request_id: entry.request_id ?? null,
          reason: hash !== expected ? "hash_mismatch" : "chain_break"
        });
      }
      previous = hash;
    });

    return {
      ok: broken.length === 0,
      entries: this.entries.length,
      legacy_entries: legacy,
      broken,
      first_prev_hash: this.entries[0]?.prev_hash ?? GENESIS,
      last_hash: this.entries[this.entries.length - 1]?.hash ?? GENESIS
    };
  }
}

export const auditLog = new AuditLog();
