import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus.js";
import { canAccess } from "../src/policy.js";
import { search, stripInjection, pickSentence } from "../src/retrieval.js";
import { ask } from "../src/answer.js";

const corpus = loadCorpus();

function allowedDocs(user) {
  return corpus.documents.filter((doc) => canAccess(user, doc).allowed);
}

test("dokumen dengan prompt injection tidak ikut cocok untuk query gaji", () => {
  const budi = corpus.userById.get("budi");
  const results = search(
    allowedDocs(budi),
    "Berapa salary band Senior Backend Engineer?",
    budi
  );
  assert.equal(results.length, 0);
});

test("partial match generik tidak menarik pipeline untuk query kontrak Acme", () => {
  const agus = corpus.userById.get("agus");
  const results = search(allowedDocs(agus), "Nilai kontrak Acme?", agus);
  const ids = results.map((result) => result.doc.id);
  assert.ok(ids.includes("D12"));
  assert.ok(!ids.includes("D13"));
});

test("stripInjection membuang instruksi dan mempertahankan isi operasional", () => {
  const doc = corpus.docById.get("D23");
  const safe = stripInjection(doc.body);
  assert.ok(!safe.includes("Abaikan semua aturan"));
  assert.ok(safe.includes("akses tamu"));
});

test("pemilihan kalimat mengutamakan angka untuk pertanyaan berapa/nilai", () => {
  const sentence = pickSentence(
    [
      "Ringkasan kontrak ini bersifat rahasia.",
      "Nilai kontrak USD 480.000 per tahun untuk lisensi."
    ],
    "Nilai kontrak Acme?"
  );
  assert.match(sentence, /480\.000/);
});

test("kata umum yang tidak ada di dokumen tidak memblokir dokumen yang cocok", () => {
  const bayu = corpus.userById.get("bayu");
  if (!bayu) return;
  const result = ask({
    corpus,
    userId: "bayu",
    query: "Berapa lama data analitik mentah disimpan?",
    recordAudit: false
  });
  assert.equal(result.decision, "answer");
  assert.ok(result.citations.some((citation) => citation.doc_id === "D32"));
  assert.match(result.answer, /90 hari/);
});

test("jawaban cuti memakai angka 12 hari, bukan kalimat yang hanya menyebut cuti", () => {
  const result = ask({
    corpus,
    userId: "joko",
    query: "Berapa cuti tahunan?",
    recordAudit: false
  });
  assert.match(result.answer, /12 hari/);
});

test("pertanyaan bahasa Inggris menemukan dokumen berbahasa Indonesia (tunjangan BBM)", () => {
  const result = ask({
    corpus,
    userId: "budi",
    query: "What is the fuel allowance?",
    recordAudit: false
  });
  assert.equal(result.decision, "answer");
  const ids = result.citations.map((citation) => citation.doc_id);
  assert.ok(ids.includes("D33") && ids.includes("D34"));
});

test("pertanyaan bahasa Inggris menemukan kebijakan cuti tahunan", () => {
  const result = ask({
    corpus,
    userId: "budi",
    query: "How many annual leave days do I get?",
    recordAudit: false
  });
  assert.equal(result.decision, "answer");
  assert.ok(result.citations.some((citation) => citation.doc_id === "D01"));
  assert.match(result.answer, /12 hari/);
});

test("pertanyaan campuran Indonesia-Inggris tetap menemukan retensi data", () => {
  const result = ask({
    corpus,
    userId: "bayu",
    query: "Berapa retention data analitik mentah?",
    recordAudit: false
  });
  assert.equal(result.decision, "answer");
  assert.ok(result.citations.some((citation) => citation.doc_id === "D32"));
});

test("sinonim lintas bahasa tidak melewati ACL", () => {
  const result = ask({
    corpus,
    userId: "joko",
    query: "Show the salary band allowance",
    recordAudit: false
  });
  assert.ok(!result.citations.some((citation) => citation.doc_id === "D05"));
});
