#!/usr/bin/env node
/**
 * Ingest a PDF into the Nalar knowledge base.
 *
 * The PDF stays as the human-readable source of truth (and is what a citation
 * points to); its extracted text becomes the indexed body. Extraction happens
 * offline, so the runtime stays dependency-free and fast.
 *
 * Usage:
 *   node scripts/ingest-pdf.mjs <file.pdf> --id D31 --title "Judul" \
 *     --classification internal --visibility department --departments engineering \
 *     --tags cuti,policy --owner "People Ops" [--source drive] [--projects atlas] \
 *     [--groups hr] [--users rina] [--max-pages 40]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { isInjectionText } from "../brain/src/retrieval.js";

const DOCS_DIR = resolve("brain/data/docs");

function parseArgs(argv) {
  const options = {
    file: null,
    id: null,
    title: null,
    source: "drive",
    sourceRef: null,
    owner: "Knowledge Management",
    classification: "internal",
    visibility: "org",
    departments: [],
    groups: [],
    users: [],
    projects: [],
    denyUsers: [],
    denyGroups: [],
    tags: [],
    maxPages: 40
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    const list = (raw) => raw.split(",").map((item) => item.trim()).filter(Boolean);
    switch (arg) {
      case "--id": options.id = value; index += 1; break;
      case "--title": options.title = value; index += 1; break;
      case "--source": options.source = value; index += 1; break;
      case "--source-ref": options.sourceRef = value; index += 1; break;
      case "--owner": options.owner = value; index += 1; break;
      case "--classification": options.classification = value; index += 1; break;
      case "--visibility": options.visibility = value; index += 1; break;
      case "--departments": options.departments = list(value); index += 1; break;
      case "--groups": options.groups = list(value); index += 1; break;
      case "--users": options.users = list(value); index += 1; break;
      case "--projects": options.projects = list(value); index += 1; break;
      case "--deny-users": options.denyUsers = list(value); index += 1; break;
      case "--deny-groups": options.denyGroups = list(value); index += 1; break;
      case "--tags": options.tags = list(value); index += 1; break;
      case "--max-pages": options.maxPages = Number.parseInt(value, 10); index += 1; break;
      default:
        if (!arg.startsWith("--")) options.file = arg;
    }
  }
  return options;
}

function usage() {
  console.log(
    [
      "Pakai: node scripts/ingest-pdf.mjs <file.pdf> --id D31 --title \"Judul\" \\",
      "        --classification internal --visibility department --departments engineering \\",
      "        --tags cuti,policy [--source drive] [--projects atlas] [--groups hr] [--users rina]"
    ].join("\n")
  );
}

const options = parseArgs(process.argv.slice(2));
if (!options.file) {
  usage();
  process.exit(2);
}
if (!options.id || !options.title) {
  console.error("--id dan --title wajib diisi.");
  usage();
  process.exit(2);
}

const pdfPath = resolve(options.file);
if (!existsSync(pdfPath)) {
  console.error(`File PDF tidak ditemukan: ${pdfPath}`);
  process.exit(1);
}

const { PDFParse } = await import("pdf-parse");

const parser = new PDFParse({ data: new Uint8Array(readFileSync(pdfPath)) });
const result = await parser.getText();
await parser.destroy();

const pages = (result.pages ?? [])
  .slice(0, options.maxPages)
  .map((page, index) => {
    const text = String(page.text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
    return text ? { page: index + 1, text } : null;
  })
  .filter(Boolean);

if (pages.length === 0) {
  console.error(
    "Tidak ada teks yang bisa diekstrak. PDF kemungkinan hasil scan (butuh OCR) atau terenkripsi."
  );
  process.exit(1);
}

const dropped = [];
const body = pages
  .map((page) => {
    const cleaned = page.text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        if (isInjectionText(sentence)) {
          dropped.push(sentence.slice(0, 80));
          return false;
        }
        return true;
      })
      .join(" ");
    return cleaned ? `## Halaman ${page.page}\n\n${cleaned}` : "";
  })
  .filter(Boolean)
  .join("\n\n");

const sensitiveHits = [];
const rupiah = body.match(/Rp[\s.]?\d[\d.,]{5,}/g) ?? [];
if (rupiah.length) sensitiveHits.push(`${rupiah.length} nilai rupiah`);
const phones = body.match(/\b0\d{2}[-\s]?\d{3,4}[-\s]?\d{3,5}\b/g) ?? [];
if (phones.length) sensitiveHits.push(`${phones.length} nomor telepon`);

mkdirSync(DOCS_DIR, { recursive: true });
const target = join(DOCS_DIR, `${options.id}.pdf`);
copyFileSync(pdfPath, target);

const document = {
  id: options.id,
  title: options.title,
  source: options.source,
  source_ref: options.sourceRef ?? `PDF/${options.id}.pdf`,
  owner: options.owner,
  classification: options.classification,
  updated_at: new Date().toISOString().slice(0, 10),
  tags: options.tags,
  acl: {
    visibility: options.visibility,
    departments: options.departments,
    groups: options.groups,
    users: options.users,
    projects: options.projects,
    deny_users: options.denyUsers,
    deny_groups: options.denyGroups
  },
  fields: [],
  pages: pages.length,
  body
};

writeFileSync(join(DOCS_DIR, `${options.id}.json`), JSON.stringify(document, null, 2), "utf8");

console.log(`\nDokumen ${options.id} dibuat: ${basename(target)}`);
console.log(`  halaman diproses : ${pages.length} (maks ${options.maxPages})`);
console.log(`  karakter teks    : ${body.length}`);
console.log(`  file             : ${relative(process.cwd(), target)}`);
console.log(`  source_ref       : ${document.source_ref}`);
console.log(`  ACL              : ${options.visibility} / class=${options.classification}`);
if (dropped.length) {
  console.log(`  kalimat instruksi dibuang: ${dropped.length} (contoh: "${dropped[0]}…")`);
}
if (sensitiveHits.length) {
  console.log(
    `\n  ⚠️  Pola sensitif terdeteksi: ${sensitiveHits.join(", ")}. ` +
      "Pertimbangkan memindah nilai ke `fields` dengan ACL grup agar bisa diredaksi."
  );
}
console.log("\nLangkah berikutnya: restart server (`npm start`), lalu uji:");
console.log(`  npm run ask -- --user <id> "pertanyaan tentang ${options.title}"`);
