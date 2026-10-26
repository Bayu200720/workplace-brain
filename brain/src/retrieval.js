import { filterFields } from "./policy.js";

const STOPWORDS = new Set(
  `
  yang dan di ke dari untuk dengan pada adalah itu ini atau juga akan sudah belum
  bisa dapat apakah apa siapa kapan dimana bagaimana berapa ada tidak ya kami kita
  saya anda mereka dia dalam oleh sebagai per serta agar karena jika maka telah
  masih hanya lebih paling secara sesuai tentang terhadap bagi tanpa setelah
  sebelum saat ketika maupun para suatu seorang semua seluruh mohon tolong minta
  the a an of to for and or is are was were be been being what who when where how
  do does did can could should would please tell me about in on at by with from
  this that these those our we you i it has have had much many
  `
    .split(/\s+/)
    .filter(Boolean)
);

const SYNONYMS = {
  gaji: ["salary", "kompensasi", "upah", "payroll", "band", "compensation"],
  salary: ["gaji", "kompensasi", "band", "compensation", "upah"],
  kompensasi: ["gaji", "salary", "band", "compensation"],
  compensation: ["kompensasi", "gaji", "salary", "band"],
  band: ["gaji", "salary", "kompensasi", "range", "rentang"],
  cuti: ["leave", "libur", "vacation", "holiday"],
  leave: ["cuti", "libur"],
  tahunan: ["tahun", "annual", "yearly"],
  tahun: ["tahunan", "annual", "year"],
  phk: [
    "layoff",
    "efisiensi",
    "restrukturisasi",
    "terminasi",
    "severance",
    "pesangon",
    "pengurangan",
    "pemutusan"
  ],
  layoff: ["phk", "efisiensi", "restrukturisasi", "severance"],
  efisiensi: ["phk", "layoff", "restrukturisasi"],
  severance: ["pesangon", "phk", "layoff"],
  pesangon: ["severance", "phk"],
  kontrak: ["contract", "perjanjian", "klien", "nilai"],
  contract: ["kontrak", "perjanjian", "nilai"],
  nilai: ["value", "harga", "nominal", "besaran"],
  klien: ["client", "customer", "pelanggan", "kontrak"],
  renewal: ["perpanjangan", "perbarui"],
  incident: ["insiden", "gangguan", "postmortem"],
  insiden: ["incident", "gangguan", "postmortem"],
  migrasi: ["migration", "cutover", "backfill", "peralihan"],
  migration: ["migrasi", "cutover", "backfill"],
  cutover: ["migrasi", "peralihan"],
  akses: ["access", "izin", "permission"],
  access: ["akses", "izin"],
  darurat: ["emergency", "kontak"],
  emergency: ["darurat", "kontak"],
  nomor: ["number", "telepon", "kontak"],
  telepon: ["phone", "nomor", "kontak"],
  vendor: ["mitra", "pemasok", "kontraktor"],
  board: ["direksi", "notulen", "direktur"],
  direksi: ["board", "direktur"],
  akuisisi: ["acquisition", "merger", "due-diligence"],
  merger: ["akuisisi", "due-diligence"],
  pipeline: ["prospek", "sales", "penjualan"],
  prospek: ["pipeline", "sales"],
  payroll: ["gaji", "slip"],
  slip: ["payroll", "gaji"],
  reimbursement: ["klaim", "biaya", "perjalanan"],
  klaim: ["reimbursement", "biaya"],
  performance: ["kinerja", "review", "penilaian"],
  review: ["performance", "penilaian"],
  onboard: ["orientasi", "masuk"],
  onboarding: ["orientasi", "masuk"],
  offboarding: ["exit", "keluar", "serah-terima"],
  profil: ["profile", "perusahaan", "company"],
  perusahaan: ["company", "profil"],
  tunjangan: ["allowance", "benefit", "subsidi"],
  allowance: ["tunjangan", "benefit", "subsidi"],
  benefit: ["tunjangan", "allowance"],
  bbm: ["fuel", "bensin", "transport", "transportasi"],
  fuel: ["bbm", "bensin", "transport"],
  bensin: ["bbm", "fuel"],
  transport: ["transportasi", "bbm", "perjalanan"],
  transportasi: ["transport", "bbm", "perjalanan"],
  perjalanan: ["travel", "trip", "dinas", "reimbursement"],
  travel: ["perjalanan", "dinas", "trip"],
  trip: ["perjalanan", "dinas"],
  dinas: ["travel", "perjalanan", "trip"],
  kebijakan: ["policy", "aturan"],
  policy: ["kebijakan", "aturan"],
  aturan: ["policy", "kebijakan"],
  prosedur: ["procedure", "sop"],
  sop: ["procedure", "prosedur"],
  procedure: ["prosedur", "sop"],
  keamanan: ["security"],
  security: ["keamanan"],
  laporan: ["report", "reporting"],
  report: ["laporan"],
  rapat: ["meeting", "notulen"],
  meeting: ["rapat", "notulen"],
  notulen: ["minutes", "meeting", "rapat"],
  biaya: ["cost", "expense"],
  cost: ["biaya", "expense"],
  expense: ["biaya", "cost", "reimbursement"],
  harga: ["price", "nilai"],
  price: ["harga", "nilai"],
  pengumuman: ["announcement", "memo", "edaran"],
  announcement: ["pengumuman", "memo"],
  penyimpanan: ["retention", "retensi", "storage"],
  retensi: ["retention", "penyimpanan"],
  retention: ["retensi", "penyimpanan"],
  keluar: ["exit", "offboarding", "resign"],
  exit: ["keluar", "offboarding"],
  annual: ["tahunan", "tahun", "yearly"],
  yearly: ["tahunan", "tahun"],
  day: ["hari"],
  days: ["hari"],
  week: ["minggu"],
  month: ["bulan"],
  year: ["tahun"],
  hours: ["jam"],
  hour: ["jam"]
};

const INJECTION_PATTERN =
  /(abaikan|ignore).{0,60}(aturan|instruksi|instruction|prompt)|system prompt|tampilkan salary|seluruh nomor telepon|reveal (all|the) (salary|phone)/i;

export function isInjectionText(text) {
  return INJECTION_PATTERN.test(text ?? "");
}

export function stripInjection(text) {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !isInjectionText(sentence))
        .join(" ")
    )
    .filter((paragraph) => paragraph.trim().length > 0)
    .join("\n\n");
}

export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function tokenize(text, { keepStopwords = false } = {}) {
  const tokens = normalize(text).match(/[a-z0-9]+/g) ?? [];
  return tokens.filter((token) => keepStopwords || !STOPWORDS.has(token));
}

function unique(tokens) {
  return [...new Set(tokens)];
}

function chunkBody(body, title = "") {
  const normalizedTitle = normalize(title);
  const paragraphs = String(body ?? "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((part) => {
      const normalized = normalize(part);
      if (!normalizedTitle) return true;
      if (normalized === normalizedTitle) return false;
      return !(
        normalized.startsWith(normalizedTitle) &&
        part.length <= title.length + 24
      );
    });

  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 520) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if (!current) {
        current = sentence;
      } else if (`${current} ${sentence}`.length <= 420) {
        current = `${current} ${sentence}`;
      } else {
        chunks.push(current);
        current = sentence;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [String(body ?? "").slice(0, 400)];
}

function fieldText(fields) {
  return fields.map((field) => `${field.label} ${field.value}`).join(" ");
}

function buildIndex(documents, user) {
  const entries = [];
  let totalLength = 0;
  let totalChunks = 0;

  for (const doc of documents) {
    const { fields, hidden } = filterFields(user, doc);
    const fieldsText = fieldText(fields);
    const tagText = (doc.tags ?? []).join(" ");
    const safeBody = stripInjection(doc.body);
    const chunks = chunkBody(safeBody, doc.title).map((text) => {
      const tokens = tokenize(`${doc.title} ${tagText} ${text}`);
      totalLength += tokens.length;
      totalChunks += 1;
      return { text, tokens };
    });

    const allTokens = tokenize(
      `${doc.title} ${tagText} ${safeBody} ${fieldsText}`
    );
    const titleTokens = new Set(tokenize(`${doc.title} ${tagText}`));
    const fieldTokens = new Set(tokenize(fieldsText));

    entries.push({
      doc,
      fields,
      hidden,
      chunks,
      allTokens,
      titleTokens,
      fieldTokens
    });
  }

  const df = new Map();
  const termDocFreq = new Map();
  for (const entry of entries) {
    for (const token of new Set(entry.allTokens)) {
      termDocFreq.set(token, (termDocFreq.get(token) ?? 0) + 1);
    }
    for (const chunk of entry.chunks) {
      for (const token of new Set(chunk.tokens)) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
  }

  return {
    entries,
    df,
    termDocFreq,
    avgLength: totalChunks > 0 ? totalLength / totalChunks : 0,
    totalChunks
  };
}

function queryTerms(query) {
  const original = unique(tokenize(query));
  const weights = new Map();

  for (const term of original) {
    weights.set(term, 1);
    for (const synonym of SYNONYMS[term] ?? []) {
      if (!weights.has(synonym)) weights.set(synonym, 0.35);
    }
  }

  return { original, weights };
}

function bm25(index, chunk, weights, k1 = 1.5, b = 0.75) {
  const frequencies = new Map();
  for (const token of chunk.tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const [term, weight] of weights) {
    const tf = frequencies.get(term) ?? 0;
    if (tf === 0) continue;
    const docFreq = index.df.get(term) ?? 0;
    const idf = Math.log(1 + (index.totalChunks - docFreq + 0.5) / (docFreq + 0.5));
    const denominator =
      tf + k1 * (1 - b + b * (chunk.tokens.length / (index.avgLength || 1)));
    score += weight * idf * ((tf * (k1 + 1)) / denominator);
  }
  return score;
}

function coverage(entry, originalTerms) {
  const searchable = new Set(entry.allTokens);
  return originalTerms.reduce((count, term) => {
    if (searchable.has(term)) return count + 1;
    const synonyms = SYNONYMS[term] ?? [];
    return count + (synonyms.some((synonym) => searchable.has(synonym)) ? 1 : 0);
  }, 0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Terms that look like proper nouns or identifiers ("Acme", "INC-142", "Merpati").
 * Only these may invalidate a document when they are missing from it; ordinary
 * question words ("lama", "banyak") must not.
 */
function distinctiveTerms(originalTerms, query) {
  const raw = String(query ?? "");
  return originalTerms.filter((term) => {
    if (/\d/.test(term) || /[-_]/.test(term)) return true;
    const match = new RegExp(`\\b${escapeRegExp(term)}`, "i").exec(raw);
    if (!match) return false;
    return match[0][0] === match[0][0].toUpperCase();
  });
}

/**
 * Retrieval runs only over documents the user may access. Hidden fields are
 * excluded from the index entirely, so neither ranking nor snippets can leak
 * their values.
 */
export function search(documents, query, user, { limit = 4 } = {}) {
  const { original, weights } = queryTerms(query);
  if (original.length === 0) return [];

  const index = buildIndex(documents, user);
  const requiredCoverage = original.length <= 2 ? 1 : 2;
  const results = [];

  for (const entry of index.entries) {
    const matched = coverage(entry, original);
    if (matched < requiredCoverage) continue;

    const searchable = new Set(entry.allTokens);
    const rareMatched = original.filter(
      (term) =>
        searchable.has(term) && (index.termDocFreq.get(term) ?? 0) <= 3
    ).length;

    // Partial matches must include at least one discriminative term. This
    // stops "nilai kontrak Acme" from matching an unrelated pipeline doc that
    // only shares the generic words "nilai" and "kontrak".
    if (matched < original.length && rareMatched === 0) continue;

    // If a query contains a highly specific term (a proper noun or an
    // identifier such as a client name) that this document does not contain,
    // the document is not a match even when it shares generic words.
    const missingVeryRare = distinctiveTerms(original, query).some(
      (term) =>
        !searchable.has(term) && (index.termDocFreq.get(term) ?? 0) <= 2
    );
    if (missingVeryRare) continue;

    const titleBoost = original.reduce(
      (sum, term) => sum + (entry.titleTokens.has(term) ? 0.55 : 0),
      0
    );
    const fieldBoost = original.reduce(
      (sum, term) => sum + (entry.fieldTokens.has(term) ? 0.65 : 0),
      0
    );

    let best = null;
    const scoredChunks = entry.chunks.map((chunk) => ({
      text: chunk.text,
      score: bm25(index, chunk, weights) + titleBoost + fieldBoost
    }));
    scoredChunks.sort((a, b) => b.score - a.score);
    best = scoredChunks[0];

    if (!best || best.score < 1.1) continue;

    results.push({
      doc: entry.doc,
      fields: entry.fields,
      hidden: entry.hidden,
      chunk: best,
      chunks: scoredChunks,
      score: best.score,
      matched,
      untrusted: isInjectionText(entry.doc.body)
    });
  }

  results.sort((a, b) => b.score - a.score || b.matched - a.matched);
  return results.slice(0, limit);
}

export function pickSentence(text, query) {
  const terms = new Set(tokenize(query));
  const wantsNumber =
    /\b(berapa|nilai|harga|total|jumlah|how many|how much|value)\b/i.test(query);
  const sources = Array.isArray(text) ? text : [text];
  const sentences = sources
    .flatMap((source) => String(source ?? "").split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  let best = null;
  let bestScore = -1;

  for (const sentence of sentences) {
    if (isInjectionText(sentence)) continue;
    const tokens = new Set(tokenize(sentence));
    let score = 0;
    for (const term of terms) {
      if (tokens.has(term)) score += 2;
      for (const synonym of SYNONYMS[term] ?? []) {
        if (tokens.has(synonym)) score += 0.5;
      }
    }
    if (wantsNumber && /\d/.test(sentence)) score += 2.5;
    if (sentence.length < 18) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }

  const chosen = best ?? sentences.find((sentence) => !isInjectionText(sentence));
  if (!chosen) return "";
  return chosen.length > 340 ? `${chosen.slice(0, 337).trimEnd()}...` : chosen;
}
