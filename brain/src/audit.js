import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../audit/audit.jsonl"
);

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
    const item = {
      ts: new Date().toISOString(),
      ...entry
    };
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
}

export const auditLog = new AuditLog();
