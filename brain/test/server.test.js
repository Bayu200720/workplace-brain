import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus.js";
import { createAppServer } from "../src/server.js";
import { AuditLog } from "../src/audit.js";

const corpus = loadCorpus();
const audit = new AuditLog({ memoryOnly: true });
let server;
let base;

before(async () => {
  server = createAppServer({ corpus, audit });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

test("health dan daftar pengguna tersedia", async () => {
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.documents, corpus.documents.length);

  const users = await fetch(`${base}/api/users`).then((response) => response.json());
  assert.equal(users.users.length, corpus.users.length);
  assert.equal(users.users[0].groups.includes("audit"), true);
});

test("API menolak pertanyaan terlarang meski body menyertakan klaim palsu", async () => {
  const { status, data } = await post("/api/ask", {
    userId: "budi",
    query: "Berapa salary band Senior Backend Engineer?",
    role: "CEO",
    clearance: "restricted",
    groups: ["exec", "audit"]
  });

  assert.equal(status, 200);
  assert.equal(data.decision, "no_evidence");
  assert.equal(data.citations.length, 0);
  assert.ok(!JSON.stringify(data).includes("28.000.000"));
});

test("CEO mendapat jawaban PHK yang bersitasi", async () => {
  const { data } = await post("/api/ask", {
    userId: "dewi",
    query: "Ada rencana PHK?"
  });
  assert.equal(data.decision, "answer");
  assert.ok(data.citations.some((citation) => citation.doc_id === "D07"));
  assert.match(data.answer, /Merpati/);
});

test("identitas tidak dikenal dan query kosong ditolak", async () => {
  const unknown = await post("/api/ask", { userId: "nobody", query: "cuti" });
  assert.equal(unknown.status, 401);

  const empty = await post("/api/ask", { userId: "budi", query: "  " });
  assert.equal(empty.status, 400);
});

test("audit hanya bisa dibaca grup audit", async () => {
  const denied = await fetch(`${base}/api/audit?userId=budi`);
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${base}/api/audit?userId=dewi`);
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.ok(Array.isArray(payload.entries));
  assert.ok(payload.entries.some((entry) => entry.user_id === "budi"));
});

test("selftest hanya untuk auditor dan semua skenario lulus", async () => {
  const denied = await post("/api/selftest", { userId: "rina" });
  assert.equal(denied.status, 403);

  const allowed = await post("/api/selftest", { userId: "dewi" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.summary.failed, 0);
  assert.equal(allowed.data.summary.total, 22);
});

test("static UI tersedia dan traversal ditolak", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await page.text(), /Nalar/);

  const traversal = await fetch(`${base}/..%2Fpackage.json`);
  assert.equal(traversal.status, 403);
});

test("method yang tidak didukung ditolak", async () => {
  const response = await fetch(`${base}/api/health`, { method: "POST" });
  assert.equal(response.status, 405);
});

test("verifikasi integritas audit hanya untuk grup audit", async () => {
  const denied = await fetch(`${base}/api/audit/verify?userId=rina`);
  assert.equal(denied.status, 403);

  await post("/api/ask", { userId: "dewi", query: "Berapa cuti tahunan?" });

  const allowed = await fetch(`${base}/api/audit/verify?userId=dewi`).then((r) => r.json());
  assert.equal(allowed.ok, true);
  assert.equal(allowed.integrity.ok, true);
  assert.ok(allowed.integrity.entries >= 1);
});
