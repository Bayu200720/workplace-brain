import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROJ = "C:/Users/anira/.codebuddy/projects/c-xampp-htdocs-workby";
const OUT = "C:/xampp/htdocs/workby/docs/evidence";
const sessionId = process.argv[2];
const label = process.argv[3] ?? sessionId;

if (!sessionId) {
  console.error("Pakai: node scripts/save-evidence.mjs <sessionId> [label]");
  process.exit(2);
}

const raw = readFileSync(join(PROJ, `${sessionId}.jsonl`), "utf8")
  .trim()
  .split("\n");

const messages = [];
for (const line of raw) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    continue;
  }
  if (obj.type !== "message") continue;
  const role = obj.role;
  const text = (obj.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  if (!text) continue;
  messages.push({ role, text });
}

mkdirSync(OUT, { recursive: true });

const transcript = messages
  .map((m) => `### ${m.role}\n\n${m.text}`)
  .join("\n\n---\n\n");

writeFileSync(join(OUT, `${label}-transcript.md`), transcript, "utf8");
writeFileSync(
  join(OUT, `${label}-transcript.json`),
  JSON.stringify(messages, null, 2),
  "utf8"
);

console.log(`saved -> ${OUT}/${label}-transcript.md (${messages.length} pesan)`);
