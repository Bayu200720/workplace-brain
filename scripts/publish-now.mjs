#!/usr/bin/env node
/**
 * Publish helper yang tidak butuh browser: memakai kredensial GitHub yang
 * sudah tersimpan di Windows Credential Manager (dibaca via `git credential
 * fill`, tidak pernah dicetak atau disimpan ke file).
 *
 * Usage: node scripts/publish-now.mjs [repoName]
 */
import { execFileSync } from "node:child_process";

const repoName = process.argv[2] || "workplace-brain";
const description =
  "Access-controlled workplace brain for WorkBuddy: permission-aware retrieval, field-level redaction, mandatory citations.";

function storedCredential() {
  const input = "protocol=https\nhost=github.com\n\n";
  const output = execFileSync("git", ["credential", "fill"], {
    input,
    encoding: "utf8"
  });
  const value = {};
  for (const line of output.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) value[line.slice(0, index)] = line.slice(index + 1);
  }
  if (!value.password) throw new Error("Tidak ada kredensial GitHub tersimpan.");
  return { username: value.username, token: value.password };
}

const { username, token } = storedCredential();
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "nalar-publish"
};

const me = await fetch("https://api.github.com/user", { headers });
if (!me.ok) {
  console.error(
    `Token tersimpan tidak valid untuk API GitHub (HTTP ${me.status}). ` +
      "Buat fine-grained PAT dengan scope repo & Contents: Read and write."
  );
  process.exit(1);
}
const account = await me.json();
console.log(`Akun terautentikasi : ${account.login}`);

const topics = [
  "workbuddy",
  "tencent-cloud",
  "ai-agents",
  "rag",
  "access-control",
  "mcp",
  "hackathon"
];

const existing = await fetch(
  `https://api.github.com/repos/${account.login}/${repoName}`,
  { headers }
);

if (existing.ok) {
  const repo = await existing.json();
  console.log(`Repo sudah ada       : ${repo.html_url}`);
} else {
  const created = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: repoName,
      description,
      private: false,
      auto_init: false,
      has_issues: true,
      has_wiki: false
    })
  });
  if (!created.ok) {
    console.error(`Gagal membuat repo: HTTP ${created.status} ${await created.text()}`);
    process.exit(1);
  }
  const repo = await created.json();
  console.log(`Repo dibuat (publik) : ${repo.html_url}`);
}

const patched = await fetch(
  `https://api.github.com/repos/${account.login}/${repoName}/topics`,
  {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ names: topics })
  }
);
console.log(
  patched.ok
    ? `Topik               : ${topics.join(", ")}`
    : `Topik gagal diatur (HTTP ${patched.status})`
);

console.log(`\nLanjut push:\n  git remote set-url origin https://github.com/${account.login}/${repoName}.git\n  git push -u origin main`);
