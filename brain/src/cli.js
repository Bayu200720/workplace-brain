#!/usr/bin/env node
import { loadCorpus, getUserIds } from "./corpus.js";
import { ask } from "./answer.js";
import { auditLog } from "./audit.js";

function parseArgs(argv) {
  const options = { user: null, json: false, listUsers: false, query: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--user" || arg === "-u") {
      options.user = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--list-users") {
      options.listUsers = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      options.query.push(arg);
    }
  }

  options.query = options.query.join(" ").trim();
  return options;
}

function usage() {
  return [
    "Nalar — Workplace Brain CLI",
    "",
    "Pemakaian:",
    "  npm run ask -- --user budi \"Berapa cuti tahunan?\"",
    "  npm run ask -- --user dewi --json \"Ada rencana PHK?\"",
    "  npm run ask -- --list-users",
    "",
    "Identitas di CLI hanya untuk demo. Di WorkBuddy, identitas datang dari",
    "environment BRAIN_USER yang di-set host, bukan dari teks pengguna."
  ].join("\n");
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(usage());
  process.exit(0);
}

const corpus = loadCorpus();

if (options.listUsers) {
  for (const user of corpus.users) {
    console.log(
      `${user.id.padEnd(8)} ${user.name.padEnd(20)} ${user.clearance.padEnd(13)} ${user.department}`
    );
  }
  process.exit(0);
}

if (!options.user || !options.query) {
  console.error(usage());
  process.exit(2);
}

const result = ask({
  corpus,
  userId: options.user,
  query: options.query,
  audit: auditLog,
  surface: "cli"
});

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

console.log(`\n${result.answer}\n`);

if (result.citations.length > 0) {
  console.log("Sumber:");
  for (const citation of result.citations) {
    console.log(
      `  [${citation.index}] ${citation.title} — ${citation.source_label} · ${citation.updated_at} · ${citation.classification}`
    );
    console.log(`      ${citation.source_ref}`);
  }
}

console.log(
  `\nKeputusan: ${result.decision} (${result.reason_code}) · user: ${result.access.user.id} · redaksi field: ${result.access.redacted_fields}`
);

process.exit(result.ok ? 0 : 1);
