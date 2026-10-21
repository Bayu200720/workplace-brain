import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SKILL_DIR = resolve("skill/workplace-brain");
const SCRIPTS_DIR = join(SKILL_DIR, "scripts");
const ASK = join(SCRIPTS_DIR, "ask.mjs");

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

test("bundle skill hanya berisi ask.mjs (bukan alat ganti identitas)", () => {
  const scripts = readdirSync(SCRIPTS_DIR);
  assert.deepEqual(scripts, ["ask.mjs"]);
});

test("tidak ada skrip di bundle skill yang bisa menulis file identitas", () => {
  const files = listFiles(SKILL_DIR);
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    if (file.endsWith("SKILL.md") || file.endsWith(".md")) continue;
    assert.ok(
      !/writeFileSync\([^)]*identity/i.test(content),
      `${file} bisa menulis file identitas`
    );
    assert.ok(
      !/set-identity/.test(content),
      `${file} memuat utilitas set-identity`
    );
  }
});

test("SKILL.md melarang agent mengganti identitas", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(skill, /Jangan pernah/i);
  assert.match(skill, /ganti identitas|identitas aktif/i);
  assert.match(skill, /tindakan operator/i);
});

test("bridge menolak flag identitas dari argumen model", () => {
  const result = spawnSync(
    process.execPath,
    [ASK, "--user", "dewi", "--query", "Berapa cuti tahunan?"],
    { encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "configuration_error");
  assert.match(payload.message, /ditolak/i);
});

test("bridge menolak --as, --role, dan --clearance", () => {
  for (const flag of ["--as", "--role", "--clearance"]) {
    const result = spawnSync(
      process.execPath,
      [ASK, flag, "dewi", "--query", "cuti"],
      { encoding: "utf8" }
    );
    assert.notEqual(result.status, 0, `${flag} seharusnya ditolak`);
    assert.match(result.stdout, /ditolak/i);
  }
});

test("set-identity hanya ada sebagai tooling host di luar bundle skill", () => {
  const hostTool = resolve("scripts/set-identity.mjs");
  assert.ok(
    !listFiles(SKILL_DIR).includes(hostTool),
    "set-identity tidak boleh ada di bundle skill"
  );
  const content = readFileSync(hostTool, "utf8");
  assert.match(content, /HOST-ONLY/);
});

test("tooling host menolak identitas yang tidak dikenal dan menulis id kanonik", () => {
  const hostTool = resolve("scripts/set-identity.mjs");
  const identityFile = resolve("C:/Users/anira/.nalar/identity");
  const original = existsSync(identityFile) ? readFileSync(identityFile, "utf8") : "";

  const invalid = spawnSync(process.execPath, [hostTool, "nobody-hypothetical"], {
    encoding: "utf8"
  });
  assert.notEqual(invalid.status, 0, "id tak dikenal harus ditolak");
  assert.match(invalid.stderr, /tidak dikenal/);

  const canonical = spawnSync(process.execPath, [hostTool, "Dewi"], {
    encoding: "utf8"
  });
  assert.equal(canonical.status, 0, canonical.stderr);
  assert.equal(readFileSync(identityFile, "utf8").trim(), "dewi");

  if (original) writeFileSync(identityFile, original, "utf8");
  else if (existsSync(identityFile)) unlinkSync(identityFile);
});

test("bridge tidak menawarkan alat ganti identitas ke agent", () => {
  const help = execFileSync(process.execPath, [ASK, "--help"], { encoding: "utf8" });
  assert.match(help, /BRAIN_USER/);
  assert.match(help, /tindakan operator/);
  assert.ok(!/set-identity/.test(help), "help tidak boleh menyebut alat ganti identitas");
});
