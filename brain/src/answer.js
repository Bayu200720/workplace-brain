import { randomUUID } from "node:crypto";
import { getUser } from "./corpus.js";
import { canAccess, publicUser } from "./policy.js";
import { search, pickSentence, tokenize } from "./retrieval.js";
import { detectConflicts } from "./conflicts.js";

const CREDENTIAL_REQUEST =
  /\b(tampilkan|berikan|kirim|sebutkan|minta|dump|export|ekspor|lihat|buka|show|give|send|list)\b.{0,60}\b(password|passwd|api[\s-]?key|token|secret|kredensial|credential|private key|otp)\b/i;

const BULK_REQUEST =
  /\b(tampilkan|berikan|kirim|dump|export|ekspor|daftar(?:kan)?|list|show|give)\b.{0,50}\b(semua|seluruh|all)\b.{0,50}\b(gaji|salary|karyawan|employee|kontak|contact|nomor|dokumen|document|drive|data)\b/i;

const AGGREGATE_REQUEST =
  /\b(total|jumlah|rekap|aggregate)\b.{0,25}\b(gaji|salary|payroll|karyawan|employee)\b/i;

const SOURCE_LABEL = {
  chat: "Chat",
  drive: "Drive",
  taskboard: "Task Board",
  wiki: "Wiki",
  email: "Email",
  hris: "HRIS"
};

export class AskError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AskError";
    this.code = code;
    this.status = status;
  }
}

export function detectSensitiveIntent(query) {
  if (CREDENTIAL_REQUEST.test(query)) {
    return {
      code: "credential_request",
      message:
        "Permintaan ini saya tolak. Nalar tidak mengambil atau menampilkan password, API key, token, atau kredensial. Gunakan vault dan jalur break-glass resmi Security."
    };
  }

  if (BULK_REQUEST.test(query) || AGGREGATE_REQUEST.test(query)) {
    return {
      code: "bulk_extraction",
      message:
        "Permintaan ini saya tolak. Nalar tidak mengekspor atau merangkum data massal (gaji, kontak, dokumen) lewat chat. Ajukan laporan resmi ke pemilik data dengan tujuan yang jelas."
    };
  }

  return null;
}

function selectFields(fields, query) {
  const terms = tokenize(query);

  const scored = fields.map((field) => {
    const text = `${field.label} ${field.value}`.toLowerCase();
    const score = terms.reduce(
      (count, term) => count + (text.includes(term) ? 1 : 0),
      0
    );
    return { field, score };
  });

  const maxScore = scored.reduce((max, item) => Math.max(max, item.score), 0);
  if (maxScore === 0) return [];

  return scored
    .filter((item) => item.score === maxScore)
    .slice(0, 2)
    .map((item) => item.field);
}

function buildGroundedAnswer(results, query) {
  const lines = [];
  const citations = [];
  let redactedFields = 0;

  results.forEach((result, index) => {
    const marker = index + 1;
    const sentence = pickSentence(
      result.chunks.map((chunk) => chunk.text),
      query
    );
    if (sentence) {
      lines.push(`- ${sentence} [${marker}]`);
    } else {
      lines.push(`- ${result.doc.title} [${marker}]`);
    }

    const visibleFields = selectFields(result.fields, query);
    for (const field of visibleFields) {
      lines.push(`- ${field.label}: ${field.value} [${marker}]`);
    }
    redactedFields += result.hidden;

    citations.push({
      index: marker,
      doc_id: result.doc.id,
      title: result.doc.title,
      source: result.doc.source,
      source_label: SOURCE_LABEL[result.doc.source] ?? result.doc.source,
      source_ref: result.doc.source_ref,
      updated_at: result.doc.updated_at,
      classification: result.doc.classification,
      snippet: sentence,
      fields: visibleFields,
      untrusted_content: result.untrusted
    });
  });

  let answer = `Berdasarkan ${citations.length} sumber yang boleh Anda akses:\n${lines.join("\n")}`;

  const conflicts = detectConflicts(results);
  if (conflicts.length > 0) {
    const conflictLines = conflicts.map((conflict) => {
      const values = conflict.values
        .map(
          (value) =>
            `- ${value.raw} — ${value.title} (${value.source}, ${value.updated_at})`
        )
        .join("\n");
      const winnerIsNewer =
        String(conflict.winner.updated_at ?? "") >=
        String(conflict.loser.updated_at ?? "");
      const reason =
        `sumber ${conflict.winner.source} memiliki otoritas lebih tinggi daripada ` +
        `${conflict.loser.source} (${conflict.winner.updated_at} vs ${conflict.loser.updated_at})` +
        `${winnerIsNewer ? ", dan juga yang terbaru" : ""}`;
      return (
        `Terdapat perbedaan informasi di antara sumber yang boleh Anda akses:\n${values}\n` +
        `Yang berlaku: ${conflict.chosen} — ${reason}.`
      );
    });
    answer += `\n\n${conflictLines.join("\n\n")}`;
  }

  if (redactedFields > 0) {
    answer += `\n\nCatatan: ${redactedFields} rincian sensitif disembunyikan sesuai kebijakan akses.`;
  }

  return { answer, citations, redactedFields, conflicts };
}

/**
 * Answer a question for one authenticated identity. `userId` must come from
 * the host's session, never from model-generated text or request claims.
 */
export function ask({
  corpus,
  userId,
  query,
  audit = null,
  recordAudit = true,
  surface = "api"
}) {
  const user = getUser(corpus, userId);
  if (!user) throw new AskError("unknown_user", "Identitas pengguna tidak dikenal.", 401);

  const cleanQuery = String(query ?? "").trim();
  if (!cleanQuery) throw new AskError("empty_query", "Pertanyaan tidak boleh kosong.");
  if (cleanQuery.length > 500) {
    throw new AskError("query_too_long", "Pertanyaan maksimal 500 karakter.");
  }

  const requestId = randomUUID();
  const base = {
    request_id: requestId,
    access: {
      user: publicUser(user),
      policy: "deny-by-default",
      sources_used: [],
      redacted_fields: 0,
      note: "Hanya dokumen yang lolos kebijakan akses yang dimuat ke indeks."
    }
  };

  const intent = detectSensitiveIntent(cleanQuery);
  if (intent) {
    const result = {
      ok: false,
      decision: "blocked",
      reason_code: intent.code,
      message: intent.message,
      answer: intent.message,
      citations: [],
      ...base
    };
    if (recordAudit && audit) {
      audit.record({
        request_id: requestId,
        user_id: user.id,
        user_name: user.name,
        query: cleanQuery,
        decision: result.decision,
        reason_code: result.reason_code,
        cited_doc_ids: [],
        sources: [],
        redacted_fields: 0,
        surface
      });
    }
    return result;
  }

  const allowedDocs = corpus.documents.filter(
    (doc) => canAccess(user, doc).allowed
  );
  const results = search(allowedDocs, cleanQuery, user, { limit: 4 });

  if (results.length === 0) {
    const message =
      "Saya tidak menemukan sumber yang boleh Anda akses untuk pertanyaan itu. " +
      "Nalar tidak bisa memastikan apakah datanya tidak ada atau aksesnya dibatasi. " +
      "Hubungi pemilik topik (People Ops untuk kebijakan karyawan, Finance untuk anggaran, Legal untuk kontrak) atau ajukan permintaan akses resmi.";
    const result = {
      ok: false,
      decision: "no_evidence",
      reason_code: "no_accessible_evidence",
      message,
      answer: message,
      citations: [],
      conflicts: [],
      ...base,
      meta: {
        allowed_documents: allowedDocs.length,
        candidates: 0
      }
    };
    if (recordAudit && audit) {
      audit.record({
        request_id: requestId,
        user_id: user.id,
        user_name: user.name,
        query: cleanQuery,
        decision: result.decision,
        reason_code: result.reason_code,
        cited_doc_ids: [],
        sources: [],
        redacted_fields: 0,
        surface
      });
    }
    return result;
  }

  // Defense in depth: authorize again immediately before composing evidence.
  const safeResults = results.filter(
    (result) => canAccess(user, result.doc).allowed
  );

  if (safeResults.length === 0) {
    throw new AskError(
      "authorization_invariant",
      "Tidak ada evidence yang lolos verifikasi akhir.",
      500
    );
  }

  const { answer, citations, redactedFields, conflicts } = buildGroundedAnswer(
    safeResults,
    cleanQuery
  );
  const sources = [...new Set(citations.map((citation) => citation.source_label))];

  const result = {
    ok: true,
    decision: "answer",
    reason_code: "grounded_evidence",
    message: answer,
    answer,
    citations,
    conflicts,
    ...base,
    access: {
      ...base.access,
      sources_used: sources,
      redacted_fields: redactedFields
    },
    meta: {
      allowed_documents: allowedDocs.length,
      candidates: safeResults.length
    }
  };

  if (recordAudit && audit) {
    audit.record({
      request_id: requestId,
      user_id: user.id,
      user_name: user.name,
      query: cleanQuery,
      decision: result.decision,
      reason_code: result.reason_code,
      answer,
      citations: citations.map((citation) => ({
        index: citation.index,
        doc_id: citation.doc_id,
        title: citation.title,
        source: citation.source,
        source_ref: citation.source_ref,
        updated_at: citation.updated_at,
        classification: citation.classification
      })),
      cited_doc_ids: citations.map((citation) => citation.doc_id),
      conflicts: result.conflicts.map((conflict) => ({
        winner: conflict.winner.docId,
        loser: conflict.loser.docId,
        chosen: conflict.chosen
      })),
      sources,
      redacted_fields: redactedFields,
      surface
    });
  }

  return result;
}
