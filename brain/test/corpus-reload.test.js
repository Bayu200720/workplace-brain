import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCorpusLoader } from "../src/corpus.js";
import { createAppServer } from "../src/server.js";
import { AuditLog } from "../src/audit.js";

function seed(overrides = {}) {
  return {
    org: { name: "Nalar Test" },
    users: [
      { id: "rina", name: "Rina", role: "People Partner", clearance: "restricted", groups: ["comp"] },
      { id: "budi", name: "Budi", role: "Engineer", clearance: "internal", groups: [] }
    ],
    documents: [
      {
        id: "D01",
        title: "Tunjangan BBM",
        source: "drive",
        source_ref: "drive/D01",
        owner: "HR",
        classification: "internal",
        updated_at: "2026-01-01",
        tags: ["tunjangan", "bbm"],
        acl: { visibility: "org", departments: [], groups: [], users: [], projects: [], deny_users: [], deny_groups: [] },
        fields: [],
        body: "Tunjangan BBM sebesar Rp500.000 per bulan.",
        ...overrides
      }
    ]
  };
}

function writeSeed(dir, data) {
  const path = join(dir, "seed.json");
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}

function tempCorpus(t) {
  const dir = mkdtempSync(join(tmpdir(), "nalar-corpus-"));
  const docsDir = join(dir, "docs");
  mkdirSync(docsDir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, docsDir, seedPath: join(dir, "seed.json") };
}

test("perubahan ACL di seed.json berlaku pada permintaan berikutnya tanpa restart", async (t) => {
  const { docsDir, seedPath } = tempCorpus(t);
  writeSeed(join(seedPath, ".."), seed());

  const loadCorpus = createCorpusLoader({ seedPath, docsDir });
  const corpus = loadCorpus();
  const audit = new AuditLog({ memoryOnly: true });
  const server = createAppServer({ corpus, audit, refreshCorpus: loadCorpus });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const askOnce = async () =>
    fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "budi", query: "Berapa tunjangan BBM?" })
    }).then((response) => response.json());

  const before = await askOnce();
  assert.equal(before.decision, "answer");
  assert.deepEqual(before.citations.map((c) => c.doc_id), ["D01"]);

  // Revoke the document for everyone except the comp group.
  writeSeed(join(seedPath, ".."), seed({ acl: { visibility: "restricted", departments: [], groups: ["comp"], users: [], projects: [], deny_users: [], deny_groups: [] } }));

  const after = await askOnce();
  assert.equal(after.decision, "no_evidence");
  assert.deepEqual(after.citations, []);
});

test("objek korpus yang sudah dipegang pemanggil ikut terbarui saat file berubah", (t) => {
  const { docsDir, seedPath } = tempCorpus(t);
  writeSeed(join(seedPath, ".."), seed());

  const loadCorpus = createCorpusLoader({ seedPath, docsDir });
  const corpus = loadCorpus();
  assert.equal(corpus.documents.length, 1);

  writeSeed(join(seedPath, ".."), seed({ title: "Tunjangan BBM (revisi)", updated_at: "2026-05-05" }));
  loadCorpus();

  assert.equal(corpus, loadCorpus(), "identitas objek korpus dipertahankan");
  assert.equal(corpus.docById.get("D01").title, "Tunjangan BBM (revisi)");
});

test("seed rusak tidak mengganti korpus terakhir yang valid", (t) => {
  const { docsDir, seedPath } = tempCorpus(t);
  writeSeed(join(seedPath, ".."), seed());

  const loadCorpus = createCorpusLoader({ seedPath, docsDir });
  const corpus = loadCorpus();

  writeFileSync(seedPath, "{ not json", "utf8");
  assert.throws(() => loadCorpus({ force: true }));
  assert.equal(corpus.documents.length, 1);
});
