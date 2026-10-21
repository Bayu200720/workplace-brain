/**
 * Exports the WorkBuddy workflow (task transcripts) into a submission-ready
 * document: prompt -> skill load -> tool call -> tool result -> final answer.
 *
 * Usage: node scripts/export-workflow.mjs [sessionId ...]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus } from "../brain/src/corpus.js";
import { canAccess } from "../brain/src/policy.js";

const PROJECTS = "C:/Users/anira/.workbuddy-ai/projects";
const OUT = "C:/xampp/htdocs/workby/docs/evidence";

// Public repo hygiene: jangan sebutkan home directory mesin pembuat.
const sanitize = (text) =>
  String(text ?? "")
    .replace(/(?:[A-Za-z]:)?[\\/]*Users[\\/]+anira/gi, "<USER_HOME>")
    .replace(/\/c\/Users\/anira/gi, "<USER_HOME>")
    .replace(/c-Users-anira-WorkBuddy AI-[0-9-]+/gi, "<workspace>");

const stripContext = (text) =>
  text
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<user_info>[\s\S]*?<\/user_info>/g, "")
    .replace(/<identity_context>[\s\S]*?<\/identity_context>/g, "")
    .replace(/<user_query>/g, "")
    .replace(/<\/user_query>/g, "")
    .trim();

function allSessions() {
  const sessions = [];
  for (const dir of readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = join(PROJECTS, dir.name);
    for (const name of readdirSync(full)) {
      if (!name.endsWith(".jsonl")) continue;
      sessions.push({ id: name.replace(".jsonl", ""), file: join(full, name), workspace: dir.name });
    }
  }
  return sessions;
}

function parse(file) {
  const out = { prompt: "", calls: [], results: [], answers: [] };
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.trim().split("\n")) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "message" && obj.role === "user") {
      const text = stripContext((obj.content ?? []).map((p) => p.text ?? "").join("\n"));
      if (text && !out.prompt) out.prompt = text;
    }
    if (obj.type === "message" && obj.role === "assistant") {
      const text = (obj.content ?? []).map((p) => p.text ?? "").join("").trim();
      if (text) out.answers.push(text);
    }
    if (obj.type === "function_call") {
      const args = obj.input ?? obj.arguments ?? {};
      out.calls.push({
        name: obj.name,
        command:
          typeof args === "string"
            ? args
            : args.command ?? args.skill ?? args.query ?? JSON.stringify(args)
      });
    }
    if (obj.type === "function_call_result") {
      const output = String(obj.output?.text ?? (typeof obj.output === "string" ? obj.output : ""));
      out.results.push({ name: obj.name, output });
    }
  }
  return out;
}

const CANARIES = ["28.000.000", "Operasi Merpati", "480.000", "0812-5550-4417"];

function decisionOf(output, corpus) {
  const match = /Stdout: ([\s\S]*?)(?:\n\nStderr:|$)/.exec(output);
  if (!match) return null;
  let payload;
  try {
    payload = JSON.parse(match[1].trim());
  } catch {
    return null;
  }

  const identity = payload.access?.user?.id ?? null;
  const cited = (payload.citations ?? []).map((citation) => citation.doc_id);
  const found = CANARIES.filter((value) => String(payload.answer ?? "").includes(value));

  let sensitive = "bersih";
  if (found.length > 0) {
    const user = identity ? corpus.userById.get(identity) : null;
    const authorized =
      user &&
      cited.length > 0 &&
      cited.every((docId) => {
        const doc = corpus.docById.get(docId);
        return doc && canAccess(user, doc).allowed;
      });
    sensitive = authorized
      ? `wajar (identitas ${identity} berwenang): ${found.join(", ")}`
      : `BOCOR: ${found.join(", ")}`;
  }

  return {
    decision: payload.decision,
    reason_code: payload.reason_code,
    identity,
    citations: cited,
    fields: (payload.citations ?? []).flatMap((c) => c.fields ?? []).map((f) => f.value),
    sensitive
  };
}

const requested = process.argv.slice(2);
const corpus = loadCorpus();
const sessions = allSessions().filter((s) =>
  requested.length ? requested.includes(s.id) : true
);

const blocks = [];
const json = [];

for (const session of sessions) {
  const parsed = parse(session.file);
  if (!parsed.prompt) continue;
  if (!/workplace-brain|Nalar|skill nalar/i.test(parsed.prompt)) continue;

  const decisions = parsed.results.map((result) => ({
    tool: result.name,
    decision: decisionOf(result.output, corpus)
  }));

  blocks.push(
    [
      `### Task ${session.id}`,
      "",
      `- Workspace: \`${session.workspace}\``,
      `- Prompt: ${parsed.prompt.split("\n")[0]}`,
      "",
      "**Langkah agent:**",
      "",
      "```",
      ...parsed.calls.map((call) => `${call.name}: ${call.command}`),
      "```",
      "",
      "**Keputusan engine Nalar:**",
      "",
      "| Tool | decision | reason_code | identitas | sitasi | field sensitif | nilai sensitif |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...decisions
        .filter((d) => d.decision)
        .map(
          (d) =>
            `| ${d.tool} | ${d.decision.decision} | ${d.decision.reason_code} | ${
              d.decision.identity ?? "—"
            } | ${d.decision.citations.join(", ") || "—"} | ${
              d.decision.fields.join(" ; ") || "—"
            } | ${d.decision.sensitive} |`
        ),
      "",
      "**Jawaban agent WorkBuddy:**",
      "",
      "```",
      ...(parsed.answers.length > 1
        ? parsed.answers.flatMap((answer, index) => [
            `--- jawaban ${index + 1} ---`,
            answer,
            ""
          ])
        : [parsed.answers[parsed.answers.length - 1] ?? ""]),
      "```",
      ""
    ].join("\n")
  );

  json.push({
    sessionId: session.id,
    workspace: session.workspace,
    prompt: parsed.prompt,
    calls: parsed.calls,
    answers: parsed.answers,
    decisions
  });
}

const header = [
  "# WorkBuddy Workflow Export — Nalar Workplace Brain",
  "",
  "Dihasilkan dari transcript task WorkBuddy desktop (5.8.4) di",
  "`~/.workbuddy-ai/projects/`. Setiap baris di bawah adalah langkah yang",
  "benar-benar dijalankan WorkBuddy: prompt → skill → tool call → evidence →",
  "jawaban.",
  "",
  "Identitas berasal dari file host `~/.nalar/identity` (ditulis oleh",
  "`scripts/set-identity.mjs`), bukan dari teks prompt — sehingga model tidak",
  "pernah bisa menaikkan aksesnya sendiri.",
  "",
  "---",
  ""
].join("\n");

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "workflow-export.md"),
  sanitize(header + blocks.join("\n---\n\n")),
  "utf8"
);
writeFileSync(
  join(OUT, "workflow-export.json"),
  sanitize(JSON.stringify(json, null, 2)),
  "utf8"
);

console.log(`export: ${blocks.length} task -> ${OUT}/workflow-export.md`);
for (const item of json) {
  const decisions = item.decisions
    .filter((d) => d.decision)
    .map((d) => `${d.decision.decision}/${d.decision.reason_code}${d.decision.leaked ? " [LEAK]" : ""}`);
  console.log(` - ${item.sessionId}: ${decisions.join(" | ") || "(tanpa tool Nalar)"}`);
}
