import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus.js";
import { createAppServer } from "../src/server.js";
import { AuditLog } from "../src/audit.js";

const corpus = loadCorpus();
const audit = new AuditLog({ memoryOnly: true });

const TOKENS = {
  tok_rina: "rina",
  tok_budi: "budi",
  tok_dewi: "dewi"
};

let server;
let base;
let previousTokens;

before(async () => {
  previousTokens = process.env.NALAR_TOKENS;
  process.env.NALAR_TOKENS = JSON.stringify(TOKENS);
  server = createAppServer({ corpus, audit });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (previousTokens === undefined) delete process.env.NALAR_TOKENS;
  else process.env.NALAR_TOKENS = previousTokens;
});

async function ask(body, token) {
  const response = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

test("mode token aktif dan dilaporkan", async () => {
  const response = await fetch(`${base}/api/auth/mode`);
  const data = await response.json();
  assert.equal(data.mode, "token");
});

test("tanpa token ditolak 401", async () => {
  const { status } = await ask({ query: "Berapa cuti tahunan?" });
  assert.equal(status, 401);
});

test("token tidak dikenal ditolak 401", async () => {
  const { status } = await ask({ query: "Berapa cuti tahunan?" }, "tok_hantu");
  assert.equal(status, 401);
});

test("identitas mengikuti token, bukan body request", async () => {
  const { status, data } = await ask({ query: "Berapa cuti tahunan?" }, "tok_rina");
  assert.equal(status, 200);
  assert.equal(data.decision, "answer");
  assert.equal(data.access.user.id, "rina");
});

test("userId body yang bertentangan dengan token ditolak 403", async () => {
  const { status, data } = await ask(
    { userId: "budi", query: "Berapa cuti tahunan?" },
    "tok_rina"
  );
  assert.equal(status, 403);
  assert.equal(data.error, "identity_mismatch");
});

test("token budi tidak mendapat data kompensasi meski userId=rina", async () => {
  const { status, data } = await ask(
    { userId: "rina", query: "Berapa salary band Senior Backend Engineer?" },
    "tok_budi"
  );
  assert.equal(status, 403);

  const allowed = await ask(
    { query: "Berapa salary band Senior Backend Engineer?" },
    "tok_budi"
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.decision, "no_evidence");
  assert.ok(!JSON.stringify(allowed.data).includes("28.000.000"));
});

test("audit hanya untuk token dengan grup audit", async () => {
  const denied = await fetch(`${base}/api/audit?userId=dewi`, {
    headers: { Authorization: "Bearer tok_budi" }
  });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${base}/api/audit?userId=dewi`, {
    headers: { Authorization: "Bearer tok_dewi" }
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.ok(Array.isArray(payload.entries));
});

test("selftest menolak token non-auditor", async () => {
  const response = await fetch(`${base}/api/selftest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer tok_budi"
    },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 403);
});

test("demo token endpoint mati secara default", async () => {
  const response = await fetch(`${base}/api/demo/tokens`);
  assert.equal(response.status, 404);
});
