import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEED_URL = new URL("../data/seed.json", import.meta.url);
const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../data/docs");

let cached = null;

function loadExtraDocuments() {
  let entries;
  try {
    entries = readdirSync(DOCS_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const full = join(DOCS_DIR, name);
      return JSON.parse(readFileSync(full, "utf8"));
    });
}

export function loadCorpus() {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(SEED_URL, "utf8"));
  const extraDocuments = loadExtraDocuments();

  if (!raw.org || !Array.isArray(raw.users) || !Array.isArray(raw.documents)) {
    throw new Error("seed.json tidak valid: org/users/documents wajib ada.");
  }

  const userIds = new Set();
  for (const user of raw.users) {
    if (userIds.has(user.id)) throw new Error(`User id duplikat: ${user.id}`);
    userIds.add(user.id);
  }

  const docIds = new Set();
  for (const doc of [...raw.documents, ...extraDocuments]) {
    if (docIds.has(doc.id)) throw new Error(`Dokumen id duplikat: ${doc.id}`);
    docIds.add(doc.id);
    if (!doc.acl) throw new Error(`Dokumen ${doc.id} tidak punya ACL.`);
    if (!doc.body || !doc.body.trim()) throw new Error(`Dokumen ${doc.id} tidak punya body.`);
  }

  const documents = [...raw.documents, ...extraDocuments];

  cached = {
    org: raw.org,
    users: raw.users,
    documents,
    userById: new Map(raw.users.map((user) => [user.id, user])),
    docById: new Map(documents.map((doc) => [doc.id, doc]))
  };
  return cached;
}

export function getUser(corpus, userId) {
  return corpus.userById.get(userId) ?? null;
}

export function getUserIds(corpus) {
  return corpus.users.map((user) => user.id);
}
