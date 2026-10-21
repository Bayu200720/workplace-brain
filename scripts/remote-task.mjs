/**
 * Remote task runner for WorkBuddy / CodeBuddy agent runtime.
 *
 * Flow:
 *  1. wait for the platform API key file (written by the human, never in chat)
 *  2. start the local agent HTTP service (loopback only, password auth)
 *  3. store the gateway password for subsequent calls
 *  4. create one task per scenario via POST /api/v1/runs
 *  5. collect the agent answer from the session transcript
 *  6. save evidence to docs/evidence/
 *
 * Usage: node scripts/remote-task.mjs [waitMinutes]
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = "C:/Users/anira";
const KEY_FILE = `${HOME}/.workbuddy-ai/codebuddy-api-key.txt`;
const TOKEN_FILE = `${HOME}/.workbuddy-ai/local-api-token.txt`;
const CLI_SETTINGS = `${HOME}/.codebuddy/settings.json`;
const NODE = `${HOME}/.workbuddy-ai/binaries/node/versions/22.22.2-6/node.exe`;
const CLI = `${HOME}/AppData/Local/Programs/WorkBuddyAI/resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs`;
const PROJECTS = `${HOME}/.codebuddy/projects`;
const EVIDENCE = "C:/xampp/htdocs/workby/docs/evidence";
const PORT = 8321;
const BASE = `http://127.0.0.1:${PORT}`;

const waitMinutes = Number(process.argv[2] ?? 15);
const deadline = Date.now() + waitMinutes * 60_000;

function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

async function waitForKey() {
  const until = Date.now() + waitMinutes * 60_000;
  while (Date.now() < until) {
    if (existsSync(KEY_FILE)) {
      const key = readFileSync(KEY_FILE, "utf8").trim();
      if (key) return { key, source: KEY_FILE };
    }
    // Alternative: the human already ran /login inside the CLI.
    const probed = await probeExistingLogin();
    if (probed) return { key: null, source: "cli-session" };
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("timeout menunggu kredensial CLI");
}

function probeExistingLogin() {
  return new Promise((resolvePromise) => {
    const probe = spawn(
      NODE,
      [CLI, "-p", "Balas satu kata: OK"],
      {
        cwd: "C:/xampp/htdocs/workby",
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let out = "";
    const timer = setTimeout(() => {
      probe.kill();
      resolvePromise(false);
    }, 40_000);
    probe.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    probe.stderr.on("data", (chunk) => {
      out += chunk.toString();
    });
    probe.on("close", () => {
      clearTimeout(timer);
      const failed = /Authentication required|not signed in|Please use \/login/i.test(out);
      resolvePromise(!failed && out.trim().length > 0);
    });
  });
}

function gatewayPassword() {
  try {
    const settings = JSON.parse(readFileSync(CLI_SETTINGS, "utf8"));
    const password = settings.gateway?.password;
    return typeof password === "string" ? password : null;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const token = readFileSync(TOKEN_FILE, "utf8").trim();
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "X-CodeBuddy-Request": "1",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

function findProjectDirs() {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PROJECTS, entry.name));
}

function latestTranscript(afterMs) {
  const files = findProjectDirs().flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name))
  );
  const fresh = files
    .map((file) => {
      try {
        return { file, mtime: readFileSync(file, "utf8").length && Date.now() };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  void afterMs;
  return fresh;
}

function parseTranscript(file) {
  const result = { assistant: [], user: [], toolHits: [] };
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return result;
  }
  for (const line of raw.trim().split("\n")) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "message") continue;
    const text = (obj.content ?? []).map((part) => part.text ?? "").join("\n").trim();
    if (!text) continue;
    if (obj.role === "assistant") result.assistant.push(text);
    if (obj.role === "user") result.user.push(text);
    if (/ask\.mjs|workplace-brain/i.test(text)) result.toolHits.push(text.slice(0, 400));
  }
  return result;
}

async function waitForAnswer(sessionNameNeedle, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { body } = await api("/api/v1/sessions");
    const sessions = (body?.data?.sessions ?? []).filter((session) =>
      session.name.includes(sessionNameNeedle)
    );
    for (const session of sessions) {
      for (const dir of findProjectDirs()) {
        const file = join(dir, `${session.id}.jsonl`);
        if (!existsSync(file)) continue;
        const parsed = parseTranscript(file);
        if (parsed.assistant.length > 0) {
          return { session, file, parsed };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

function setIdentity(userId) {
  const file = `${HOME}/.nalar/identity`;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${userId}\n`, "utf8");
}

async function main() {
  log("menunggu kredensial CLI:", KEY_FILE, "atau /login di CLI");
  const credential = await waitForKey();
  log(
    credential.key
      ? `API key ditemukan dari ${credential.source} (panjang ${credential.key.length})`
      : "CLI sudah terautentikasi (sesi /login)"
  );

  const serveEnv = { ...process.env };
  if (credential.key) serveEnv.CODEBUDDY_API_KEY = credential.key;

  const child = spawn(
    NODE,
    [CLI, "--serve", "--port", String(PORT), "--session-id", "nalar", "--permission-mode", "acceptEdits"],
    {
      cwd: "C:/xampp/htdocs/workby",
      env: serveEnv,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stdout.on("data", (chunk) => process.stdout.write(`[serve] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[serve:err] ${chunk}`));

  let password = null;
  while (Date.now() < deadline && !password) {
    password = gatewayPassword();
    if (!password) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!password) throw new Error("password gateway tidak ditemukan");
  writeFileSync(TOKEN_FILE, password, "utf8");
  log("password gateway disimpan di", TOKEN_FILE);

  for (let i = 0; i < 30; i += 1) {
    const health = await api("/api/v1/health");
    if (health.status === 200) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  log("service siap");

  const scenarios = [
    { id: "rina-salary", user: "rina", prompt: "Pakai skill workplace-brain (Nalar) untuk menjawab: Berapa salary band Senior Backend Engineer? Jawaban singkat dengan sitasi sumber." },
    { id: "budi-salary", user: "budi", prompt: "Pakai skill workplace-brain (Nalar) untuk menjawab: Berapa salary band Senior Backend Engineer? Jawaban singkat dengan sitasi sumber." },
    { id: "dewi-layoff", user: "dewi", prompt: "Pakai skill workplace-brain (Nalar) untuk menjawab: Ada rencana PHK? Jawaban singkat dengan sitasi sumber." },
    { id: "budi-layoff", user: "budi", prompt: "Pakai skill workplace-brain (Nalar) untuk menjawab: Ada rencana PHK? Jawaban singkat dengan sitasi sumber." }
  ];

  mkdirSync(EVIDENCE, { recursive: true });

  for (const scenario of scenarios) {
    setIdentity(scenario.user);
    log("membuat task:", scenario.id, "| identitas:", scenario.user);
    const created = await api("/api/v1/runs", {
      method: "POST",
      body: JSON.stringify({
        id: `omp-${scenario.id}`,
        type: "user",
        text: scenario.prompt,
        sender: { id: "omp", name: "omp" }
      })
    });
    log("  run:", JSON.stringify(created.body).slice(0, 160));

    const needle = scenario.prompt.slice(0, 40);
    const result = await waitForAnswer(needle, 240_000);
    if (!result) {
      log("  TIMEOUT untuk", scenario.id);
      continue;
    }
    const answer = result.parsed.assistant.join("\n\n");
    log("  JAWABAN:\n" + answer.slice(0, 1200));
    writeFileSync(
      join(EVIDENCE, `${scenario.id}-answer.md`),
      `# ${scenario.id}\n\nIdentitas host: ${scenario.user}\n\n## Prompt\n\n${scenario.prompt}\n\n## Jawaban agent WorkBuddy\n\n${answer}\n`,
      "utf8"
    );
    writeFileSync(join(EVIDENCE, `${scenario.id}-transcript.json`), result.parsed.assistant.join("\n\n"), "utf8");
  }

  log("selesai. evidence di", EVIDENCE);
  child.kill();
}

main().catch((error) => {
  log("GAGAL:", error.message);
  process.exit(1);
});
