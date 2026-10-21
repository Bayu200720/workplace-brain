#!/usr/bin/env node
/**
 * HOST-ONLY tooling. This file is deliberately NOT part of the WorkBuddy
 * skill bundle.
 *
 * The agent inside WorkBuddy must never be able to change who it is acting
 * as. Identity switching is an operator action (the stand-in for SSO in the
 * demo, a bearer token in production). If this script lives inside the skill
 * folder, the agent can simply call it and escalate its own permissions.
 *
 * The script is intentionally self-contained (no relative imports) so it can
 * be copied anywhere on the host, e.g. ~/.nalar/set-identity.mjs.
 *
 * Usage: node set-identity.mjs <id>
 *        node set-identity.mjs --show
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const identityFile = resolve(
  String(process.env.NALAR_IDENTITY_FILE ?? join(homedir(), ".nalar", "identity"))
);
const apiUrl = String(process.env.NALAR_API_URL ?? "http://127.0.0.1:4173").replace(
  /\/+$/,
  ""
);
const seedCandidates = [
  process.env.NALAR_SEED,
  resolve(process.cwd(), "brain/data/seed.json"),
  resolve(dirname(new URL(import.meta.url).pathname), "../../brain/data/seed.json")
].filter(Boolean);

async function loadUsers() {
  try {
    const response = await fetch(`${apiUrl}/api/users`, {
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload.users)) return payload.users;
    }
  } catch {
    // API tidak hidup: lanjut ke seed lokal.
  }

  for (const candidate of seedCandidates) {
    try {
      if (!existsSync(candidate)) continue;
      const raw = JSON.parse(readFileSync(candidate, "utf8"));
      if (Array.isArray(raw.users)) return raw.users;
    } catch {
      // coba kandidat berikutnya
    }
  }
  return [];
}

const [command] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(
    [
      "Pemakaian: node set-identity.mjs <id>",
      "        node set-identity.mjs --show",
      "",
      `File identitas : ${identityFile}`,
      `API Nalar      : ${apiUrl}`,
      "",
      "Host-only: jangan pernah skrip ini tersedia di dalam folder skill WorkBuddy."
    ].join("\n")
  );
  process.exit(command ? 0 : 2);
}

if (command === "--show") {
  const current = existsSync(identityFile)
    ? readFileSync(identityFile, "utf8").split(/\r?\n/)[0]?.trim()
    : "";
  console.log(
    current
      ? `Identitas aktif: ${current} (${identityFile})`
      : `Belum ada identitas. Jalankan: node set-identity.mjs <id>`
  );
  process.exit(0);
}

if (!/^[a-z0-9_-]{1,64}$/i.test(command)) {
  console.error("ID identitas tidak valid (huruf, angka, - dan _ saja).");
  process.exit(2);
}

const users = await loadUsers();
if (users.length === 0) {
  console.error(
    "Daftar identitas tidak bisa dimuat. Jalankan server Nalar atau set NALAR_SEED ke seed.json."
  );
  process.exit(2);
}

const canonical = users.find(
  (user) => String(user.id).toLowerCase() === command.toLowerCase()
);

if (!canonical) {
  console.error(
    `Identitas "${command}" tidak dikenal. ID yang tersedia: ${users
      .map((user) => user.id)
      .join(", ")}`
  );
  process.exit(2);
}

mkdirSync(dirname(identityFile), { recursive: true });
writeFileSync(identityFile, `${canonical.id}\n`, "utf8");
console.log(
  `Identitas host disetel: ${canonical.id} (${canonical.name}) -> ${identityFile}`
);
