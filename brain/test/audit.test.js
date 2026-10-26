import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus.js";
import { ask } from "../src/answer.js";
import { AuditLog } from "../src/audit.js";

const corpus = loadCorpus();

function askWithAudit(userId, query) {
  const audit = new AuditLog({ memoryOnly: true });
  const result = ask({ corpus, userId, query, audit });
  return { audit, result };
}

test("entri audit menyimpan jawaban lengkap beserta metadata sitasi", () => {
  const { audit } = askWithAudit("rina", "Berapa tunjangan BBM yang berlaku?");
  const [entry] = audit.recent(1);
  assert.match(entry.answer, /Rp750\.000/);
  assert.deepEqual(entry.cited_doc_ids, ["D33", "D34"]);

  const citation = entry.citations.find((item) => item.doc_id === "D34");
  assert.equal(citation.title, "Pengumuman HR: Penyesuaian Tunjangan BBM");
  assert.equal(citation.source, "announcement");
  assert.equal(citation.source_ref, "Pengumuman/HR/Penyesuaian-Tunjangan-BBM-2026");
  assert.equal(citation.updated_at, "2026-10-15");
  assert.equal(citation.classification, "internal");
});

test("entri audit mencatat konflik yang diputuskan otoritas", () => {
  const { audit } = askWithAudit("rina", "Berapa tunjangan BBM yang berlaku?");
  const [entry] = audit.recent(1);
  assert.equal(entry.conflicts.length, 1);
  assert.equal(entry.conflicts[0].winner, "D34");
  assert.equal(entry.conflicts[0].loser, "D33");
  assert.equal(entry.conflicts[0].chosen, "Rp750.000");
});

test("hash chain audit valid dan mendeteksi manipulasi", () => {
  const { audit } = askWithAudit("rina", "Berapa tunjangan BBM yang berlaku?");
  ask({ corpus, userId: "budi", query: "Berapa cuti tahunan?", audit });

  const clean = audit.verify();
  assert.equal(clean.ok, true);
  assert.equal(clean.entries, 2);
  assert.equal(clean.first_prev_hash, "genesis");

  audit.entries[0].decision = "no_evidence";
  const tampered = audit.verify();
  assert.equal(tampered.ok, false);
  assert.equal(tampered.broken[0].reason, "hash_mismatch");
  assert.equal(tampered.broken[0].index, 0);
});

test("entri audit tanpa evidence tetap tercatat dengan rantai hash", () => {
  const { audit } = askWithAudit("joko", "Berapa salary band Senior Backend Engineer?");
  const [entry] = audit.recent(1);
  assert.equal(entry.decision, "no_evidence");
  assert.deepEqual(entry.cited_doc_ids, []);
  assert.equal(typeof entry.hash, "string");
  assert.equal(audit.verify().ok, true);
});
