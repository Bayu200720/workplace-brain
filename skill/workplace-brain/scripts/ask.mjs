#!/usr/bin/env node
/**
 * WorkBuddy bridge for Nalar.
 *
 * Identity is resolved from the host, never from the conversation:
 *   1. BRAIN_USER environment variable
 *   2. NALAR_IDENTITY_FILE (path to a file whose first line is the user id)
 *   3. ~/.nalar/identity (default identity file)
 *
 * The model may pass a query, never an identity or role. This is deliberate:
 * prompt text cannot escalate access.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const FORBIDDEN_FLAGS = new Set([
  "--user",
  "-u",
  "--as",
  "--role",
  "--clearance",
  "--groups",
  "--projects",
  "--admin"
]);

function fail(message, code = 2, errorCode = "configuration_error") {
  console.log(
    JSON.stringify(
      {
        ok: false,
        decision: "error",
        error: errorCode,
        message
      },
      null,
      2
    )
  );
  process.exit(code);
}

function resolveIdentity() {
  const fromEnv = String(process.env.BRAIN_USER ?? "").trim();
  if (fromEnv) return { id: fromEnv, source: "BRAIN_USER" };

  const identityFile = resolve(
    String(process.env.NALAR_IDENTITY_FILE ?? join(homedir(), ".nalar", "identity"))
  );
  if (existsSync(identityFile)) {
    const id = readFileSync(identityFile, "utf8").split(/\r?\n/)[0]?.trim() ?? "";
    if (id) return { id, source: identityFile };
  }

  return { id: "", source: "" };
}

const args = process.argv.slice(2);
let query = "";
const positional = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (FORBIDDEN_FLAGS.has(arg)) {
    fail(
      `Flag identitas "${arg}" ditolak. Identitas hanya boleh berasal dari environment BRAIN_USER atau file identitas host.`
    );
  }

  if (arg === "--query" || arg === "-q") {
    query = args[index + 1] ?? "";
    index += 1;
    continue;
  }

  if (arg === "--help" || arg === "-h") {
    console.log(
      [
        "Pemakaian: node scripts/ask.mjs --query \"<pertanyaan>\"",
        "",
        "Identitas (dari host, bukan dari teks):",
        "  1. BRAIN_USER=<id>",
        "  2. file identitas: NALAR_IDENTITY_FILE atau ~/.nalar/identity",
        "",
        "Pengubahan identitas adalah tindakan operator di luar skill ini."
      ].join("\n")
    );
    process.exit(0);
  }

  positional.push(arg);
}

if (!query) query = positional.join(" ").trim();

const identity = resolveIdentity();
if (!identity.id) {
  fail(
    "Identitas belum diatur di host. Minta operator mengaturnya lewat tooling " +
    "host (di luar WorkBuddy), lalu ulangi. Skill tidak menerima identitas dari teks pengguna."
  );
}

if (!/^[a-z0-9_-]{1,64}$/i.test(identity.id)) {
  fail("Identitas host tidak valid.");
}

if (!query) {
  fail("Pertanyaan kosong. Kirim --query \"<pertanyaan>\".");
}

if (query.length > 500) {
  fail("Pertanyaan maksimal 500 karakter.");
}

const baseUrl = String(process.env.BRAIN_URL ?? "http://127.0.0.1:4173").replace(
  /\/+$/,
  ""
);

try {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("protokol harus http atau https");
  }
} catch {
  fail("BRAIN_URL tidak valid.");
}

let response;
try {
  response = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: identity.id, query }),
    signal: AbortSignal.timeout(15_000)
  });
} catch (error) {
  fail(
    `Nalar API tidak dapat dihubungi di ${baseUrl}. Jalankan "npm start" di folder proyek Nalar. (${error.message})`,
    2,
    "service_unavailable"
  );
}

let payload;
try {
  payload = await response.json();
} catch {
  fail(`Respons Nalar bukan JSON (HTTP ${response.status}).`);
}

if (!response.ok) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        decision: "error",
        error: payload?.error ?? "http_error",
        status: response.status,
        message: payload?.message ?? `HTTP ${response.status}`
      },
      null,
      2
    )
  );
  process.exit(2);
}

console.log(JSON.stringify(payload, null, 2));
