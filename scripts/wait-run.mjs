import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TOKEN = readFileSync("C:/Users/anira/.workbuddy-ai/local-api-token.txt", "utf8").trim();
const PROJ = "C:/Users/anira/.codebuddy/projects/c-xampp-htdocs-workby";
const BASE = "http://127.0.0.1:8321";
const startedAt = Date.now() - 5000;

const headers = {
  "X-CodeBuddy-Request": "1",
  Authorization: `Bearer ${TOKEN}`
};

function readTranscript(sessionId) {
  try {
    const file = join(PROJ, `${sessionId}.jsonl`);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    const out = { assistant: [], tools: [], errors: [] };
    for (const line of lines) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type === "message" && obj.role === "assistant") {
        for (const part of obj.content ?? []) {
          if (part.type === "output_text" && part.text) out.assistant.push(part.text);
        }
      }
      if (obj.type === "message" && obj.role === "user") {
        for (const part of obj.content ?? []) {
          if (part.type === "input_text" && part.text) out.tools.push(`USER: ${part.text}`);
        }
      }
      if (obj.type === "tool_use" || obj.type === "tool_result") {
        out.tools.push(JSON.stringify(obj).slice(0, 300));
      }
      if (typeof obj.message === "string" && /error|fail/i.test(obj.message)) {
        out.errors.push(obj.message.slice(0, 300));
      }
    }
    return out;
  } catch {
    return null;
  }
}

const deadline = Date.now() + Number(process.argv[2] ?? 150000);

while (Date.now() < deadline) {
  const res = await fetch(`${BASE}/api/v1/sessions`, { headers });
  const payload = await res.json();
  const sessions = (payload.data?.sessions ?? []).filter(
    (s) => new Date(s.createdAt).getTime() > startedAt
  );

  for (const session of sessions) {
    const transcript = readTranscript(session.id);
    if (!transcript) continue;
    const toolText = transcript.tools.join("\n");
    if (/ask\.mjs/.test(toolText)) {
      console.log("SESSION:", session.id, "|", session.name.slice(0, 60));
      console.log("TOOL ACTIVITY:\n" + transcript.tools.join("\n").slice(0, 1500));
      console.log("ANSWER:\n" + transcript.assistant.join("\n").slice(0, 3000));
      if (transcript.errors.length) {
        console.log("ERRORS:\n" + transcript.errors.join("\n"));
      }
      process.exit(0);
    }
    if (transcript.assistant.length > 0) {
      console.log("SESSION:", session.id, "|", session.name.slice(0, 60));
      console.log("ANSWER:\n" + transcript.assistant.join("\n").slice(0, 3000));
      process.exit(0);
    }
  }
  await new Promise((r) => setTimeout(r, 5000));
}

console.log("TIMEOUT: tidak ada tool call/answer dalam batas waktu.");
process.exit(1);
