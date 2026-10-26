import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEED_PATH = fileURLToPath(new URL("../data/seed.json", import.meta.url));
const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../data/docs");

function readSnapshot(seedPath, docsDir) {
  const seedText = readFileSync(seedPath, "utf8");
  const documents = [];

  let names = [];
  try {
    names = readdirSync(docsDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    // No extra document directory: seed.json alone is the corpus.
  }

  const hash = createHash("sha1").update(seedText);
  for (const name of names) {
    const text = readFileSync(join(docsDir, name), "utf8");
    hash.update(`\u0000${name}\u0000${text}`);
    documents.push(text);
  }

  return { seedText, documents, fingerprint: hash.digest("hex") };
}

function validate(raw, extraDocuments) {
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
    if (!doc.body || !doc.body.trim()) {
      throw new Error(`Dokumen ${doc.id} tidak punya body.`);
    }
  }
}

function build(snapshot) {
  const raw = JSON.parse(snapshot.seedText);
  const extraDocuments = snapshot.documents.map((text) => JSON.parse(text));
  validate(raw, extraDocuments);

  const documents = [...raw.documents, ...extraDocuments];
  return {
    org: raw.org,
    users: raw.users,
    documents,
    userById: new Map(raw.users.map((user) => [user.id, user])),
    docById: new Map(documents.map((doc) => [doc.id, doc])),
    fingerprint: snapshot.fingerprint
  };
}

/**
 * Loader that fingerprints the corpus files on every call, so permission or
 * document edits apply on the next request instead of requiring a restart.
 * Reloads mutate the cached object in place, keeping existing references valid.
 */
export function createCorpusLoader({ seedPath = SEED_PATH, docsDir = DOCS_DIR } = {}) {
  let cached = null;

  return function loadCorpus({ force = false } = {}) {
    const snapshot = readSnapshot(seedPath, docsDir);
    if (cached && !force && snapshot.fingerprint === cached.fingerprint) {
      return cached;
    }

    const next = build(snapshot);
    if (cached) {
      Object.assign(cached, next);
      return cached;
    }
    cached = next;
    return cached;
  };
}

export const loadCorpus = createCorpusLoader();

export function getUser(corpus, userId) {
  return corpus.userById.get(userId) ?? null;
}

export function getUserIds(corpus) {
  return corpus.users.map((user) => user.id);
}
