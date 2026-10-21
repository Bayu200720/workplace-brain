# Paket Submission — Nalar: Workplace Brain untuk WorkBuddy

> Satu halaman ringkas untuk juri. Detail lengkap ada di
> [`PROPOSAL.md`](PROPOSAL.md) (desain & roadmap) dan
> [`evidence/`](evidence/) (bukti run nyata).

## 1. Ringkasan

| | |
|---|---|
| **Nama** | Nalar — Workplace Brain |
| **Platform utama** | Tencent Cloud **WorkBuddy** (skill + MCP Connector, run terbukti di aplikasi desktop 5.8.4) |
| **Challenge** | A — The Workplace Brain: menjawab pertanyaan karyawan dari chat, drive, task board, **tanpa** pernah menunjukkan yang tidak boleh dilihat |
| **Repo publik** | https://github.com/Bayu200720/workplace-brain |
| **Lisensi** | MIT · seluruh data sintetis |

**Klaim utama:** kontrol akses ditegakkan di **lapisan retrieval**, bukan di prompt.
Dokumen yang tidak lolos ACL tidak pernah masuk ke indeks, jadi model WorkBuddy
tidak memiliki data terlarang untuk "bocorkan" — meski ia keliru atau tries to.

## 2. Alur orkestrasi (yang berjalan di WorkBuddy)

```text
Karyawan mengetik di WorkBuddy
  → WorkBuddy memuat skill workplace-brain (dari ~/.workbuddy-ai/skills/)
  → agent memanggil Bash: node ".../scripts/ask.mjs" --query "…"
  → bridge POST /api/ask ke Nalar API
      · validasi identitas (dari host / access token, bukan dari prompt)
      · filter ACL deny-by-default (clearance, grup, departemen, proyek, deny-list)
      · retrieval BM25 hanya atas dokumen yang lolos
      · redaksi field sensitif + guardrail kredensial/ekspor massal
      · verifikasi akses ulang → compose jawaban + sitasi
  → WorkBuddy menyusun jawaban dari evidence, mempertahankan sitasi
  → audit: metadata saja (user, keputusan, dokumen, redaksi)
```

## 3. Bukti (terukur, bukan klaim)

| Bukti | Angka |
|---|---|
| Uji otomatis | **46/46 lulus** (`npm test`) |
| Skenario uji kebocoran live | **16/16 lulus** (tab *Uji Kebocoran* di UI demo) |
| Matriks user × dokumen | **9 user × 31 dokumen** — 0 sitasi terlarang |
| Run nyata di WorkBuddy desktop | **4 task** terekspor (`docs/evidence/workflow-export.md`) |
| Connector MCP | `npm run verify:mcp` → `initialize` → `tools/list` → `tools/call` OK |
| Perbedaan jawaban sesuai identitas | satu task: *boleh* (D01) + *ditolak* (`no_evidence`, 0 sitasi) |

## 4. Yang harus dilampirkan

| # | Lampiran | Lokasi | Status |
|---|---|---|---|
| 1 | **Export workflow WorkBuddy** | `docs/evidence/workflow-export.md` (dari transcript app) + file export asli dari aplikasi | ✅ ada |
| 2 | Bukti run per task | `docs/evidence/desktop-<id>-answer.md` / `.json` | ✅ 4 task |
| 3 | Package skill WorkBuddy | `dist/nalar-workplace-brain-skill.zip` | ✅ |
| 4 | Package MCP Connector | `dist/nalar-connector.zip` | ✅ |
| 5 | Link repo publik | https://github.com/Bayu200720/workplace-brain | ✅ |
| 6 | Proposal + Q&A | `docs/PROPOSAL.md` | ✅ |
| 7 | Rekaman demo (opsional, sangat disarankan) | 3 menit di app WorkBuddy | ⬜ rekam |

## 5. Cara mengambil export workflow WorkBuddy

**Cara A — dari aplikasi (resmi):**
1. Buka task Nalar di WorkBuddy (New Task → skill `workplace-brain`).
2. Di pojok task cari tombol **Share / Export** (nama menu menyesuaikan versi;
   di 5.8.4 task juga bisa di-*publish* sebagai artefak di folder workspace).
3. Simpan file export-nya sebagai lampiran.

**Cara B — dari transcript app (pasti berhasil, sudah dipakai untuk lampiran ini):**

```bash
npm run export:workflow
```

Script membaca transcript task asli dari
`~/.workbuddy-ai/projects/<workspace>/<sessionId>.jsonl` dan menghasilkan
`docs/evidence/workflow-export.md` + `.json` berisi: prompt → skill load →
tool call → keputusan engine (decision, reason_code, identitas, sitasi, field
sensitif) → jawaban agent, plus klasifikasi kebocoran yang **sadar identitas**
(nilai sensitif yang muncul pada jawaban berwenang ditandai "wajar", bukan
"bocor").

## 6. Demo 3 menit (patokan juri)

| Waktu | Aksi | Yang dibuktikan |
|---|---|---|
| 0:00–0:20 | Tampilkan **Connectors** di WorkBuddy (Nalar) | platform utama benar-benar dipakai |
| 0:20–0:50 | Tanya *"Berapa cuti tahunan?"* | jawaban bersitasi, sumber D01 |
| 0:50–1:20 | Tanya *"Berapa salary band Senior Backend Engineer?"* sebagai **budi** | ditolak, 0 sitasi, tanpa angka |
| 1:20–1:40 | Tampilkan tool call `Skill` → `Bash` | orkestrasi agen terbukti |
| 1:40–2:20 | Ganti identitas ke **rina** (host) lalu tanya yang sama | boleh akses + nominal + sitasi D05/D19 |
| 2:20–2:45 | Tab **Uji Kebocoran** (16/16) + tab **Audit** | keamanan terukur, audit metadata-only |
| 2:45–3:00 | Tutup: *"Keamanan ada di retrieval, bukan di prompt."* | klaim utama |

## 7. Pemetaan ke kriteria (asumsi kriteria umum)

| Kriteria | Bukti |
|---|---|
| Platform utama WorkBuddy | skill + MCP Connector, run nyata di app 5.8.4, export workflow |
| Desain agen & orkestrasi | rantai Skill → Bash → Nalar API → evidence → jawaban, lengkap di export |
| Akuntabilitas AI | 5 prinsip: sitasi wajib, identitas terverifikasi, redaksi field, guardrail intent, audit metadata-only |
| Dampak | satu pertanyaan lintas 4 sumber, hak akses berbeda, nol kebocoran terukur |
|kelayakan | Node.js standar, 0 runtime dependency, service lokal 1 perintah, connector siap marketplace |
| Kombinasi tool | connector MCP + skill + skrip pendukung (PDF ingest, export, watcher) — semuanya di repo publik |

## 8. Lima pertanyaan yang akan muncul

**"Ini cuma prompt engineering?"** Bukan. ACL dieksekusi di `brain/src/policy.js`
sebelum retrieval; dokumen terlarang tidak pernah masuk indeks. Prompt hanya
mengatur gaya jawaban.

**"Kenapa model tidak bisa naik akses sendiri?"** Di mode token, identitas
dipetakan dari access token di server. Kami bahkan menemukan dan menutup satu
jalur privilege escalation saat demo (`docs/PROPOSAL.md` §8.8) — utilitas ganti
identitas dipindah keluar bundle skill, divalidasi terhadap daftar user, dan
dijaga test regresi.

**"Bagaimana kalau dokumen berisi perintah jahat?"** Kalimat instruksi dibuang
saat ingest dan saat runtime (`stripInjection`), dan ditandai `untrusted_content`.

**"Kenapa BM25, bukan embedding?"** Demo sengaja deterministik supaya keamanan
bisa diuji tanpa bergantung pada LLM. Roadmap menambah hybrid search, dengan
ACL tetap sebagai pre-filter.

**"Bagaimana kalau tidak ada jawabannya?"** Nalar tidak mengarang dan tidak
mengonfirmasi keberadaan data terbatas; ia mengarahkan ke pemilik topik
(People Ops / Finance / Legal) atau ke permintaan akses resmi.

**"Siapa yang bisa akses apa?"** Atribut identitas (clearance, grup, departemen,
proyek) + ACL per dokumen. Tidak ada superuser: CEO pun tetap terikat ACL
dokumen, dan permintaan kredensial/ekspor massal ditolak untuk semua orang.

Halaman repo publik: https://github.com/Bayu200720/workplace-brain

## 9. Checklist 10 menit sebelum submit

- [ ] `npm test` → 46/46 lulus
- [ ] `npm run verify:mcp` → OK
- [ ] `npm run export:workflow` → workflow-export.md ter-update
- [ ] Rekam 3 menit di app WorkBuddy
- [ ] Unggah `dist/*.zip` (skill & connector) ke WorkBuddy
- [ ] Isi lampiran: export workflow + `docs/evidence/` + link repo
- [ ] Cek repo publik: tidak ada secret, path mesin teranonimkan
