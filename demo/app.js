const CLEARANCE_LABEL = {
  public: "Publik",
  internal: "Internal",
  confidential: "Rahasia",
  restricted: "Sangat rahasia"
};

const SUGGESTIONS = {
  budi: [
    "Berapa cuti tahunan?",
    "Berapa salary band Senior Backend Engineer?",
    "Status migrasi billing?",
    "Postmortem INC-142?"
  ],
  rina: [
    "Berapa salary band Senior Backend Engineer?",
    "Ada rencana PHK?",
    "Kontak darurat Budi?",
    "Siklus performance review?"
  ],
  tomi: [
    "Berapa salary band Senior Backend Engineer?",
    "Kontak darurat Budi?",
    "Checklist offboarding?",
    "Berapa cuti tahunan?"
  ],
  agus: [
    "Nilai kontrak Acme?",
    "Pipeline sales Q4?",
    "Berapa cuti tahunan?",
    "Postmortem INC-142?"
  ],
  sari: [
    "Kalender payroll 2026?",
    "Nilai kontrak Acme?",
    "Status migrasi billing?",
    "Kebijakan reimbursement?"
  ],
  maya: [
    "Nilai kontrak Acme?",
    "Apa keputusan board September?",
    "Kebijakan retensi data?",
    "Ada rencana PHK?"
  ],
  joko: [
    "Berapa cuti tahunan?",
    "Catatan onboarding vendor?",
    "Postmortem INC-142?",
    "Checklist onboarding IT?"
  ],
  dewi: [
    "Ada rencana PHK?",
    "Nilai kontrak Acme?",
    "Apa keputusan board September?",
    "Pipeline sales Q4?"
  ]
};

const state = {
  users: [],
  currentUserId: "budi",
  sessions: new Map(),
  busy: false,
  authMode: "open",
  tokens: {}
};

const dom = {
  userList: document.getElementById("user-list"),
  identityCard: document.getElementById("identity-card"),
  messages: document.getElementById("messages"),
  suggestions: document.getElementById("suggestions"),
  form: document.getElementById("ask-form"),
  query: document.getElementById("query"),
  send: document.getElementById("send"),
  activeHint: document.getElementById("active-user-hint"),
  orgPill: document.getElementById("org-pill"),
  docPill: document.getElementById("doc-pill"),
  tabs: [...document.querySelectorAll(".tab")],
  views: {
    chat: document.getElementById("view-chat"),
    tests: document.getElementById("view-tests"),
    audit: document.getElementById("view-audit")
  },
  testsTab: document.getElementById("tests-tab"),
  auditTab: document.getElementById("audit-tab"),
  testSummary: document.getElementById("test-summary"),
  testResults: document.getElementById("test-results"),
  runTests: document.getElementById("run-tests"),
  refreshAudit: document.getElementById("refresh-audit"),
  auditResults: document.getElementById("audit-results")
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function currentUser() {
  return state.users.find((user) => user.id === state.currentUserId) ?? null;
}

function sessionFor(userId) {
  if (!state.sessions.has(userId)) {
    state.sessions.set(userId, { messages: [] });
  }
  return state.sessions.get(userId);
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function isAuditor(user) {
  return Boolean(user && (user.groups ?? []).includes("audit"));
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {})
  };
  const token = state.tokens[state.currentUserId];
  if (state.authMode === "token" && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function renderUsers() {
  dom.userList.replaceChildren();

  for (const user of state.users) {
    const button = el("button", "user-item");
    button.type = "button";
    button.dataset.userId = user.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(user.id === state.currentUserId));
    if (user.id === state.currentUserId) button.classList.add("active");

    const avatar = el("span", "avatar", initials(user.name));
    const copy = el("span", "user-item-copy");
    copy.append(el("span", "user-item-name", user.name));
    copy.append(el("span", "user-item-role", user.title));

    const clearance = el(
      "span",
      `clearance ${user.clearance}`,
      CLEARANCE_LABEL[user.clearance] ?? user.clearance
    );

    button.append(avatar, copy, clearance);
    button.addEventListener("click", () => selectUser(user.id));
    dom.userList.append(button);
  }
}

function renderIdentity(user) {
  if (!user) {
    dom.identityCard.replaceChildren();
    return;
  }

  dom.identityCard.replaceChildren();
  dom.identityCard.append(el("h2", "", "Atribut identitas"));

  const grid = el("dl", "identity-grid");
  const rows = [
    ["Departemen", user.department],
    ["Clearance", CLEARANCE_LABEL[user.clearance] ?? user.clearance],
    ["Grup", (user.groups ?? []).join(", ") || "—"],
    ["Proyek", (user.projects ?? []).join(", ") || "—"]
  ];

  for (const [label, value] of rows) {
    grid.append(el("dt", "", label));
    grid.append(el("dd", "", value));
  }

  dom.identityCard.append(grid);
  dom.identityCard.append(
    el(
      "p",
      "identity-note",
      "Kebijakan dievaluasi server-side. Teks pertanyaan tidak bisa menaikkan clearance."
    )
  );
}

function renderSuggestions(user) {
  dom.suggestions.replaceChildren();
  const items = SUGGESTIONS[user?.id] ?? ["Berapa cuti tahunan?"];

  for (const text of items) {
    const button = el("button", "suggestion", text);
    button.type = "button";
    button.addEventListener("click", () => {
      if (state.busy) return;
      dom.query.value = text;
      submitQuery(text);
    });
    dom.suggestions.append(button);
  }
}

function renderWelcome(user) {
  const article = el("article", "message assistant");
  article.append(el("div", "msg-avatar", "N"));

  const body = el("div", "msg-body");
  const card = el("div", "welcome-card");
  card.append(el("h2", "", `Halo, ${user.name.split(" ")[0]}.`));
  card.append(
    el(
      "p",
      "",
      `Anda masuk sebagai ${user.title} (${CLEARANCE_LABEL[user.clearance] ?? user.clearance}, ${user.department}). ` +
        "Saya menjawab dari chat, drive, task board, dan HRIS — tetapi hanya bagian yang boleh Anda lihat."
    )
  );

  const points = el("ul", "welcome-points");
  [
    "Setiap jawaban wajib punya sitasi dokumen asli.",
    "Kebijakan akses berjalan sebelum pencarian, bukan setelah jawaban disusun.",
    "Coba pertanyaan yang sama sebagai Rina atau Dewi untuk melihat perbedaan hasil."
  ].forEach((text) => points.append(el("li", "", text)));

  card.append(points);
  body.append(card);
  article.append(body);
  return article;
}

function renderAnswerText(container, text) {
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("- ")) {
      container.append(el("div", "answer-line", line.slice(2)));
    } else {
      container.append(el("div", "answer-para", line));
    }
  }
}

function decisionMeta(result) {
  if (result.decision === "answer") {
    return {
      badge: "ok",
      label: "Terjawab",
      className: "",
      note: ""
    };
  }
  if (result.decision === "blocked") {
    return {
      badge: "bad",
      label: "Ditolak kebijakan",
      className: "blocked",
      note: "Permintaan ditolak sebelum retrieval. Tidak ada dokumen yang dibaca."
    };
  }
  return {
    badge: "warn",
    label: "Tidak ditemukan",
    className: "unknown",
    note: "Pencarian hanya dijalankan pada dokumen yang lolos kebijakan. Nalar tidak mengonfirmasi keberadaan data terbatas."
  };
}

function renderCitation(citation) {
  const box = el("div", "citation");
  const top = el("div", "citation-top");
  top.append(el("span", "cite-index", String(citation.index)));
  top.append(el("span", "cite-title", citation.title));
  top.append(
    el(
      "span",
      `cite-class ${citation.classification}`,
      citation.classification
    )
  );
  if (citation.untrusted_content) {
    top.append(el("span", "untrusted-flag", "konten tak tepercaya"));
  }
  box.append(top);

  box.append(
    el(
      "div",
      "cite-meta",
      `${citation.source_label} · ${citation.updated_at} · ${citation.source_ref}`
    )
  );

  if (citation.snippet) {
    box.append(el("p", "cite-snippet", citation.snippet));
  }

  if ((citation.fields ?? []).length > 0) {
    const fields = el("div", "cite-fields");
    for (const field of citation.fields) {
      fields.append(el("span", "field-chip", `${field.label}: ${field.value}`));
    }
    box.append(fields);
  }

  return box;
}

function renderTrace(result) {
  const details = el("details", "trace");
  details.append(el("summary", "", "Jejak kebijakan & akses"));

  const body = el("div", "trace-body");
  const grid = el("div", "trace-grid");
  const access = result.access ?? {};
  const meta = result.meta ?? {};

  const items = [
    ["Identitas", access.user ? `${access.user.name} (${access.user.id})` : "—"],
    ["Clearance", access.user ? CLEARANCE_LABEL[access.user.clearance] : "—"],
    ["Sumber dipakai", (access.sources_used ?? []).join(", ") || "—"],
    ["Dokumen boleh diakses", String(meta.allowed_documents ?? "—")],
    ["Kandidat relevan", String(meta.candidates ?? "—")],
    ["Field diredaksi", String(access.redacted_fields ?? 0)]
  ];

  for (const [label, value] of items) {
    const item = el("div", "trace-item");
    item.append(el("span", "trace-label", label));
    item.append(el("span", "trace-value", value));
    grid.append(item);
  }

  body.append(grid);
  body.append(el("p", "trace-note", access.note ?? "Deny-by-default."));
  details.append(body);
  return details;
}

function renderResult(result) {
  const article = el("article", "message assistant");
  article.append(el("div", "msg-avatar", "N"));

  const body = el("div", "msg-body");
  const meta = decisionMeta(result);
  const card = el("div", `answer-card ${meta.className}`.trim());

  const head = el("div", "answer-head");
  head.append(el("span", `answer-badge ${meta.badge}`, meta.label));
  const count = result.citations?.length ?? 0;
  const details = el("span", "answer-meta");
  details.append(el("strong", "", String(count)));
  details.append(document.createTextNode(count === 1 ? " sumber" : " sumber"));
  if (result.access?.redacted_fields) {
    details.append(document.createTextNode(" · "));
    details.append(
      el("strong", "", String(result.access.redacted_fields))
    );
    details.append(document.createTextNode(" field diredaksi"));
  }
  head.append(details);
  card.append(head);

  const text = el("div", "answer-text");
  renderAnswerText(text, result.answer ?? result.message ?? "Tidak ada jawaban.");
  card.append(text);

  if (meta.note) {
    card.append(el("div", "note-box", meta.note));
  }

  if ((result.citations ?? []).length > 0) {
    const citations = el("div", "citations");
    for (const citation of result.citations) {
      citations.append(renderCitation(citation));
    }
    card.append(citations);
  }

  card.append(renderTrace(result));
  body.append(card);
  article.append(body);
  return article;
}

function renderError(message) {
  const article = el("article", "message assistant");
  article.append(el("div", "msg-avatar", "N"));
  const body = el("div", "msg-body");
  const card = el("div", "answer-card blocked");
  const head = el("div", "answer-head");
  head.append(el("span", "answer-badge bad", "Gagal"));
  head.append(el("span", "answer-meta", "Permintaan tidak selesai"));
  card.append(head);
  const text = el("div", "answer-text");
  text.append(el("div", "error-state", message));
  card.append(text);
  body.append(card);
  article.append(body);
  return article;
}

function scrollMessages() {
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderMessages() {
  const user = currentUser();
  const session = sessionFor(state.currentUserId);
  dom.messages.replaceChildren();

  if (session.messages.length === 0) {
    dom.messages.append(renderWelcome(user));
  }

  for (const message of session.messages) {
    if (message.role === "user") {
      const article = el("article", "message user");
      const body = el("div", "msg-body");
      body.append(el("div", "user-bubble", message.text));
      article.append(body);
      dom.messages.append(article);
    } else if (message.role === "assistant") {
      dom.messages.append(renderResult(message.result));
    } else {
      dom.messages.append(renderError(message.message));
    }
  }

  scrollMessages();
}

function appendTyping() {
  const article = el("article", "message assistant");
  article.append(el("div", "msg-avatar", "N"));
  const body = el("div", "msg-body");
  const card = el("div", "answer-card");
  const typing = el("div", "typing");
  typing.append(el("span"), el("span"), el("span"));
  card.append(typing);
  body.append(card);
  article.append(body);
  dom.messages.append(article);
  scrollMessages();
  return article;
}

function setBusy(busy) {
  state.busy = busy;
  dom.send.disabled = busy;
  dom.query.disabled = busy;
  dom.suggestions.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}

async function submitQuery(rawQuery) {
  const query = String(rawQuery ?? "").trim();
  const user = currentUser();
  if (!query || !user || state.busy) return;

  const userId = user.id;
  const session = sessionFor(userId);
  session.messages.push({ role: "user", text: query });

  dom.query.value = "";
  setBusy(true);
  renderMessages();
  const typing = appendTyping();

  try {
    const result = await api("/api/ask", {
      method: "POST",
      body: JSON.stringify({ userId, query })
    });
    session.messages.push({ role: "assistant", result });
  } catch (error) {
    session.messages.push({
      role: "error",
      message:
        error.status === 429
          ? error.message
          : `Tidak bisa menyelesaikan pertanyaan: ${error.message}`
    });
  } finally {
    typing.remove();
    setBusy(false);
    if (state.currentUserId === userId) renderMessages();
  }
}

function setView(view) {
  const user = currentUser();
  const allowed =
    view === "chat" ||
    (view === "tests" && isAuditor(user)) ||
    (view === "audit" && isAuditor(user));
  const target = allowed ? view : "chat";

  for (const tab of dom.tabs) {
    tab.classList.toggle("active", tab.dataset.view === target);
    tab.setAttribute("aria-selected", String(tab.dataset.view === target));
  }

  for (const [name, section] of Object.entries(dom.views)) {
    section.classList.toggle("active", name === target);
  }

  if (target === "audit") loadAudit();
}

function selectUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;

  state.currentUserId = userId;
  renderUsers();
  renderIdentity(user);
  renderSuggestions(user);
  dom.activeHint.textContent = `${user.name} · ${user.title}`;

  const auditor = isAuditor(user);
  dom.testsTab.hidden = !auditor;
  dom.auditTab.hidden = !auditor;

  const activeView = dom.tabs.find((tab) => tab.classList.contains("active"))?.dataset.view;
  if (!auditor && (activeView === "tests" || activeView === "audit")) {
    setView("chat");
  } else {
    setView(activeView ?? "chat");
  }

  renderMessages();
}

function renderTestSummary(data) {
  dom.testSummary.hidden = false;
  dom.testSummary.replaceChildren();

  const stats = [
    ["Total uji", String(data.summary.total), ""],
    ["Lulus", String(data.summary.passed), "good"],
    ["Gagal", String(data.summary.failed), data.summary.failed > 0 ? "bad" : ""]
  ];

  for (const [label, value, tone] of stats) {
    const box = el("div", "stat");
    box.append(el("span", "stat-label", label));
    box.append(el("span", `stat-value ${tone}`.trim(), value));
    dom.testSummary.append(box);
  }
}

function renderTests(data) {
  renderTestSummary(data);
  dom.testResults.replaceChildren();

  if (!data.checks?.length) {
    dom.testResults.append(el("div", "empty-state", "Tidak ada hasil uji."));
    return;
  }

  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["Status", "Skenario", "Identitas", "Keputusan", "Sitasi"]) {
    headRow.append(el("th", "", label));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const check of data.checks) {
    const row = el("tr");

    const status = el("td");
    status.append(
      el(
        "span",
        `status-badge ${check.pass ? "pass" : "fail"}`,
        check.pass ? "lulus" : "gagal"
      )
    );
    row.append(status);

    const scenario = el("td");
    scenario.append(el("strong", "", check.name));
    if (check.note) scenario.append(el("div", "cell-muted", check.note));
    row.append(scenario);

    row.append(el("td", "cell-muted", check.user_id === "*" ? "semua" : check.user_id));
    row.append(el("td", "cell-muted", check.decision));
    row.append(
      el(
        "td",
        "cell-muted",
        check.cited_doc_ids?.length ? check.cited_doc_ids.join(", ") : "—"
      )
    );
    tbody.append(row);
  }

  table.append(tbody);
  dom.testResults.append(table);
}

async function runTests() {
  const user = currentUser();
  if (!user || !isAuditor(user)) return;

  dom.runTests.disabled = true;
  dom.runTests.textContent = "Menjalankan…";
  dom.testResults.replaceChildren(el("div", "empty-state", "Menjalankan 16 skenario…"));

  try {
    const data = await api("/api/selftest", {
      method: "POST",
      body: JSON.stringify({ userId: user.id })
    });
    renderTests(data);
  } catch (error) {
    dom.testResults.replaceChildren(
      el("div", "error-state", error.message)
    );
  } finally {
    dom.runTests.disabled = false;
    dom.runTests.textContent = "Jalankan uji";
  }
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderAudit(entries) {
  dom.auditResults.replaceChildren();

  if (!entries.length) {
    dom.auditResults.append(
      el("div", "empty-state", "Belum ada aktivitas. Ajukan pertanyaan terlebih dahulu.")
    );
    return;
  }

  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["Waktu", "Pengguna", "Pertanyaan", "Keputusan", "Dokumen", "Redaksi"]) {
    headRow.append(el("th", "", label));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const entry of entries) {
    const row = el("tr");
    row.append(el("td", "cell-muted", formatTime(entry.ts)));
    row.append(el("td", "", `${entry.user_name} (${entry.user_id})`));
    row.append(el("td", "cell-muted", entry.query));
    row.append(el("td", "cell-muted", entry.decision));
    row.append(
      el(
        "td",
        "cell-muted",
        entry.cited_doc_ids?.length ? entry.cited_doc_ids.join(", ") : "—"
      )
    );
    row.append(el("td", "cell-muted", String(entry.redacted_fields ?? 0)));
    tbody.append(row);
  }

  table.append(tbody);
  dom.auditResults.append(table);
}

async function loadAudit() {
  const user = currentUser();
  if (!user || !isAuditor(user)) return;

  dom.auditResults.replaceChildren(el("div", "empty-state", "Memuat audit…"));
  try {
    const data = await api(
      `/api/audit?userId=${encodeURIComponent(user.id)}&limit=100`
    );
    renderAudit(data.entries ?? []);
  } catch (error) {
    dom.auditResults.replaceChildren(
      el("div", "error-state", error.message)
    );
  }
}

function bindEvents() {
  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuery(dom.query.value);
  });

  for (const tab of dom.tabs) {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  }

  dom.runTests.addEventListener("click", runTests);
  dom.refreshAudit.addEventListener("click", loadAudit);
}

async function boot() {
  bindEvents();

  try {
    const [usersPayload, health] = await Promise.all([
      api("/api/users"),
      api("/api/health")
    ]);

    state.users = usersPayload.users ?? [];
    dom.orgPill.textContent = health.org ?? "Organisasi";
    dom.docPill.textContent = `${health.documents ?? 0} sumber`;

    try {
      const mode = await api("/api/auth/mode");
      state.authMode = mode.mode ?? "open";
      if (state.authMode === "token" && mode.demo_tokens_enabled) {
        const demo = await api("/api/demo/tokens");
        state.tokens = demo.tokens ?? {};
      }
    } catch {
      state.authMode = "open";
    }

    if (!state.users.some((user) => user.id === state.currentUserId)) {
      state.currentUserId = state.users[0]?.id ?? "";
    }

    renderUsers();
    selectUser(state.currentUserId);
  } catch (error) {
    dom.messages.replaceChildren(
      renderError(
        "Tidak bisa menghubungi API Nalar. Jalankan `npm start` lalu muat ulang halaman. " +
          `(${error.message})`
      )
    );
  }
}

boot();
