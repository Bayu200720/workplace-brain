/**
 * End-to-end smoke test for the WorkBuddy MCP connector:
 *   Nalar API (token mode)  <--  connector/server.mjs (stdio MCP)
 *
 * Usage: node scripts/verify-mcp.mjs
 */
import { spawn } from "node:child_process";
import { once } from "node:events";

const API_PORT = 4174;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const TOKENS = { tok_rina: "rina", tok_budi: "budi", tok_dewi: "dewi" };

const api = spawn(process.execPath, ["brain/src/server.js"], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    NALAR_TOKENS: JSON.stringify(TOKENS)
  },
  stdio: ["ignore", "pipe", "pipe"]
});
api.stdout.on("data", () => {});
api.stderr.on("data", (chunk) => process.stderr.write(`[api:err] ${chunk}`));

async function waitForApi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("API Nalar tidak siap");
}

await waitForApi();
console.log("[1] API Nalar siap di", API_URL);

const mcp = spawn(process.execPath, ["connector/server.mjs"], {
  env: {
    ...process.env,
    NALAR_BASE_URL: API_URL,
    NALAR_TOKEN: "tok_rina"
  },
  stdio: ["pipe", "pipe", "pipe"]
});

let buffer = "";
const responses = new Map();
mcp.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined) responses.set(message.id, message);
  }
});
mcp.stderr.on("data", (chunk) => process.stderr.write(`[mcp:err] ${chunk}`));

function send(message) {
  mcp.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitFor(id, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const tick = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(tick);
        resolvePromise(responses.get(id));
      } else if (Date.now() > until) {
        clearInterval(tick);
        reject(new Error(`timeout menunggu response id=${id}`));
      }
    }, 100);
  });
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-mcp", version: "1.0.0" }
  }
});
const init = await waitFor(1);
console.log("[2] initialize ->", JSON.stringify(init.result.serverInfo));

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const tools = await waitFor(2);
console.log("[3] tools/list ->", tools.result.tools.map((tool) => tool.name).join(", "));

send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "ask", arguments: { query: "Berapa salary band Senior Backend Engineer?" } }
});
const call = await waitFor(3);
const payload = JSON.parse(call.result.content[0].text);
console.log("[4] tools/call (tok_rina) ->", payload.decision, "| sitasi:", payload.citations.map((c) => c.doc_id).join(","));
console.log("    nominal terlihat:", payload.answer.includes("28.000.000") ? "ya" : "tidak");

mcp.kill();
api.kill();
await once(mcp, "exit").catch(() => {});

if (payload.decision !== "answer" || !payload.answer.includes("28.000.000")) {
  console.error("GAGAL: connector tidak menghasilkan jawaban yang diharapkan");
  process.exit(1);
}
console.log("\nOK: connector MCP -> Nalar API (mode token) bekerja end-to-end.");
