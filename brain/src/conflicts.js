/**
 * Source-conflict detection and authority-based resolution (kemampuan ④).
 *
 * Ketika dua dokumen yang boleh diakses memberikan nilai berbeda untuk
 * pertanyaan yang sama, jawaban tidak lagi memilih salah satu diam-diam:
 * nilai dengan otoritas tertinggi dipakai, sumber lain tetap dikutip, dan
 * alasan pemilihan ditampilkan ke pengguna.
 */

const AUTHORITY_BY_SOURCE = {
  announcement: 90,
  policy: 80,
  hris: 70,
  legal: 70,
  drive: 40,
  wiki: 30,
  taskboard: 20,
  email: 20,
  chat: 10
};

const CANON = {
  juta: 1_000_000,
  miliar: 1_000_000_000,
  ribu: 1_000
};

const MONEY = /((?:Rp|USD|US\$)\s?[\d.,]+(?:\s?(?:juta|miliar|ribu))?)/gi;
const DURATION = /(\d+(?:[.,]\d+)?)\s?(hari|bulan|tahun)\b/gi;
const PERCENT = /(\d+(?:[.,]\d+)?)\s?%/g;

function parseNumber(token) {
  const value = token.replace(/[Rp\sUSD$]/gi, "").trim();
  const cleaned = value.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const numeric = Number.parseFloat(cleaned.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function canonicalAmount(token) {
  const text = token.replace(/\s+/g, " ").toLowerCase();
  const numeric = parseNumber(text.replace(/(?:juta|miliar|ribu)/, ""));
  const unit = text.match(/(juta|miliar|ribu)/)?.[1];
  if (numeric === null) return text;
  return unit ? numeric * CANON[unit] : numeric;
}

const CONTENT_TOKEN = /[a-z0-9]{3,}/gi;

function tokensOf(text, excludeNumbers = true) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .match(CONTENT_TOKEN) ?? [];
  return excludeNumbers ? tokens.filter((token) => !/\d/.test(token)) : tokens;
}

function overlapRatio(a, b) {
  const setA = new Set(tokensOf(a));
  const setB = new Set(tokensOf(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return { shared, ratio: shared / Math.min(setA.size, setB.size) };
}

function amountsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(MONEY)) {
    found.add(JSON.stringify({ raw: match[1].replace(/\s+/g, ""), value: canonicalAmount(match[1]) }));
  }
  const sentences = String(text ?? "").split(/(?<=[.!?])\s+/);
  return [...found].map((serialized) => {
    const { raw, value } = JSON.parse(serialized);
    const sentence =
      sentences.find((candidate) => candidate.includes(raw.slice(0, 4))) ??
      sentences[0] ??
      raw;
    return { raw, value, context: sentence };
  });
}

function durationsIn(text) {
  const found = [];
  for (const match of text.matchAll(DURATION)) {
    const value = Number.parseFloat(match[1].replace(",", "."));
    found.push({ raw: match[0], value: `${value} ${match[2].toLowerCase()}`, value2: value, context: match[0] });
  }
  return found;
}

export function authorityOf(doc) {
  const explicit = Number.isFinite(doc?.authority) ? doc.authority : undefined;
  const base = explicit ?? AUTHORITY_BY_SOURCE[doc?.source] ?? 25;
  return base;
}

export function authorityLhsWins(lhs, rhs) {
  const authorityDiff = authorityLhs(lhs) - authorityLhs(rhs);
  if (authorityDiff !== 0) return authorityDiff > 0;
  return String(lhs.updatedAt ?? "") >= String(rhs.updatedAt ?? "");
}

function authorityLhs(candidate) {
  return {
    authority: authorityOf(candidate.doc),
    updatedAt: candidate.doc.updated_at ?? "",
    title: candidate.doc.title
  };
}

function authorityLhsRank(candidate) {
  const value = authorityOf(candidate.doc);
  const updated = candidate.doc.updated_at ?? "";
  return { value, updated };
}

function betterCandidate(a, b) {
  const aAuthority = authorityOf(a.doc);
  const bAuthority = authorityOf(b.doc);
  if (aAuthority !== bAuthority) return aAuthority > bAuthority ? a : b;
  return String(a.doc.updated_at ?? "") >= String(b.doc.updated_at ?? "") ? a : b;
}

function authorityLabel(doc) {
  const value = authorityOf(doc);
  return `${doc.title} (${doc.source}, ${doc.updated_at}, otoritas ${value})`;
}

function claimsFor(result) {
  const texts = (result.chunks ?? [result.chunk])
    .map((chunk) => String(chunk?.text ?? ""))
    .filter(Boolean);
  const sentences = new Set(
    texts
      .join("\n")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const amountClaims = new Map();

  for (const sentence of sentences) {
    for (const token of amountsIn(sentence)) {
      const key = `${token.raw.toLowerCase()}@${token.value}`;
      if (!amountClaims.has(key)) amountClaims.set(key, { ...token, context: sentence });
    }
  }

  const fieldClaims = (result.fields ?? []).map((field) => ({
    raw: field.value,
    value: canonicalAmount(field.value) ?? field.value,
    context: field.label,
    isField: true
  }));

  for (const claim of fieldClaims) {
    const key = `${String(claim.raw).toLowerCase()}@${claim.value}`;
    if (!amountClaims.has(key)) amountClaims.set(key, claim);
  }

  return [...amountClaims.values()];
}

function sharesContext(a, b) {
  const textA = `${a.context} ${a.raw}`;
  const textB = `${b.context} ${b.raw}`;
  const { shared, ratio } = overlapRatio(textA, textB);
  return shared >= 3 || ratio >= 0.45;
}

/**
 * Deteksi nilai yang bertentangan antar dokumen terpilih.
 * Output: daftar conflict berisi kandidat nilai beserta pemenang otoritas.
 */
export function detectConflicts(results) {
  const claims = [];
  results.forEach((result, index) => {
    for (const claim of claimsFor(result)) {
      if (!claim.context || claim.context.trim().length < 15) continue;
      claims.push({
        docId: result.doc.id,
        title: result.doc.title,
        updated_at: result.doc.updated_at,
        source: result.doc.source,
        index,
        ...claim
      });
    }
  });

  const conflicts = [];
  const used = new Set();

  for (let i = 0; i < claims.length; i += 1) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < claims.length; j += 1) {
      if (used.has(j)) continue;
      const a = claims[i];
      const b = claims[j];
      if (a.docId === b.docId) continue;
      if (a.value === b.value) continue;
      if (typeof a.value === "string" || typeof b.value === "string") continue;
      if (!sharesContext(a, b)) continue;

      used.add(i);
      used.add(j);

      const winner = betterCandidate(
        { doc: results[a.index].doc, ...a },
        { doc: results[b.index].doc, ...b }
      );
      const winnerDocId = winner.docId;
      const loser = winnerDocId === a.docId ? b : a;

      conflicts.push({
        winner: {
          docId: winner.docId,
          title: winner.title,
          source: winner.source,
          raw: winner.raw,
          updated_at: winner.updated_at
        },
        loser: {
          docId: loser.docId,
          title: loser.title,
          source: loser.source,
          raw: loser.raw,
          updated_at: loser.updated_at
        },
        values: [
          { docId: a.docId, title: a.title, raw: a.raw, updated_at: a.updated_at, source: a.source },
          { docId: b.docId, title: b.title, raw: b.raw, updated_at: b.updated_at, source: b.source }
        ],
        chosen: winner.raw,
        winnerDocId
      });
    }
  }

  return conflicts;
}
