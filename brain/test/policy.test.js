import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus.js";
import { canAccess, filterFields, canAudit } from "../src/policy.js";

const corpus = loadCorpus();

const MATRIX = [
  ["dewi", "D07", true],
  ["dewi", "D18", false],
  ["rina", "D07", false],
  ["rina", "D18", true],
  ["rina", "D05", true],
  ["budi", "D05", false],
  ["tomi", "D05", true],
  ["tomi", "D18", false],
  ["joko", "D01", true],
  ["joko", "D03", false],
  ["joko", "D14", false],
  ["joko", "D23", true],
  ["budi", "D23", true],
  ["budi", "D09", true],
  ["agus", "D09", false],
  ["agus", "D12", true],
  ["budi", "D12", false],
  ["sari", "D04", true],
  ["rina", "D04", false],
  ["maya", "D12", true],
  ["maya", "D08", false],
  ["dewi", "D08", true]
];

test("matriks akses sesuai klasifikasi, grup, departemen, dan proyek", () => {
  for (const [userId, docId, expected] of MATRIX) {
    const user = corpus.userById.get(userId);
    const doc = corpus.docById.get(docId);
    const decision = canAccess(user, doc);
    assert.equal(
      decision.allowed,
      expected,
      `${userId} -> ${docId}: expected ${expected}, got ${decision.allowed} (${decision.reason})`
    );
  }
});

test("deny-by-default: visibility tidak dikenal ditolak", () => {
  const user = corpus.userById.get("dewi");
  const doc = {
    ...corpus.docById.get("D01"),
    acl: { visibility: "everyone", departments: [], groups: [], users: [], projects: [] }
  };
  const decision = canAccess(user, doc);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no_rule");
});

test("explicit deny mengalahkan grant grup", () => {
  const user = corpus.userById.get("dewi");
  const doc = {
    ...corpus.docById.get("D01"),
    acl: {
      visibility: "groups",
      groups: ["exec"],
      deny_users: ["dewi"],
      departments: [],
      users: [],
      projects: []
    }
  };
  const decision = canAccess(user, doc);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "explicit_deny");
});

test("clearance di bawah klasifikasi selalu ditolak", () => {
  const user = corpus.userById.get("joko");
  const doc = corpus.docById.get("D05");
  const decision = canAccess(user, doc);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "clearance");
});

test("field kompensasi diredaksi untuk HR Ops tanpa grup comp", () => {
  const tomi = corpus.userById.get("tomi");
  const rina = corpus.userById.get("rina");
  const doc = corpus.docById.get("D05");

  const tomiFields = filterFields(tomi, doc);
  assert.equal(tomiFields.fields.length, 0);
  assert.equal(tomiFields.hidden, 3);

  const rinaFields = filterFields(rina, doc);
  assert.equal(rinaFields.fields.length, 3);
  assert.match(rinaFields.fields[0].value, /28\.000\.000/);
});

test("audit hanya untuk grup audit", () => {
  assert.equal(canAudit(corpus.userById.get("dewi")), true);
  assert.equal(canAudit(corpus.userById.get("budi")), false);
  assert.equal(canAudit(corpus.userById.get("rina")), false);
  assert.equal(canAudit(undefined), false);
});
