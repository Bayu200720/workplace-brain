# Evidence — run nyata di WorkBuddy desktop (5.8.4)

Semua file di folder ini adalah rekaman nyata dari aplikasi WorkBuddy desktop di
mesin ini (bukan simulasi). Sumber: transcript sesi WorkBuddy
`~/.workbuddy-ai/projects/<workspace>/`.

| File | Isi |
|---|---|
| `workflow-export.md` | **file ekspor workflow** untuk lampiran submission: prompt → skill → tool call → keputusan engine → jawaban |
| `workflow-export.json` | bentuk JSON dari export yang sama |
| `desktop-<id>-answer.md` | satu task lengkap: prompt, tool call, hasil tool, jawaban, cek kebocoran |
| `desktop-<id>-evidence.json` | transcript terstruktur dari task yang sama |

## Sesi `dde353ab-f090-48f0-99df-5a4c97a2a74b`

| File | Isi |
|---|---|
| `desktop-dde353ab-…-answer.md` | prompt, tool call, hasil tool, jawaban agent, cek kebocoran |
| `desktop-dde353ab-…-evidence.json` | struktur JSON dari transcript yang sama |

### Rantai yang terekam

```text
function_call        Skill  -> base dir: <USER_HOME>\.workbuddy-ai\skills\workplace-brain
function_call        Bash   -> node ".../scripts/ask.mjs" --query "Berapa cuti tahunan saya?"
function_call_result Bash   -> {"ok":true,"decision":"answer","reason_code":"grounded_evidence",...}
function_call        Bash   -> node ".../scripts/ask.mjs" --query "Berapa salary band Senior Backend Engineer?"
function_call_result Bash   -> {"ok":false,"decision":"no_evidence","reason_code":"no_accessible_evidence",...}
```

### Dua hasil dalam satu task, satu sesi

| Pertanyaan | Identitas host | `decision` | Sitasi | Nilai sensitif bocor |
|---|---|---|---|---|
| Berapa cuti tahunan saya? | rina | `answer` | D01 (Handbook Karyawan 2026) | tidak |
| Berapa salary band Senior Backend Engineer? | budi | `no_evidence` | — | **tidak** |

### Jawaban agent (apa yang tampil ke pengguna)

```text
Setiap karyawan tetap menerima **12 hari cuti berbayar per tahun**. [1]

Sumber:
[1] Handbook Karyawan 2026 — Drive · 2026-01-08
    Drive/People/Handbook-Karyawan-2026.pdf
```

```text
Tidak ada sumber yang boleh diakses untuk pertanyaan tersebut. Nalar tidak
dapat memastikan apakah data salary band Senior Backend Engineer tidak tersedia
atau aksesnya dibatasi oleh kebijakan.

Saran: Hubungi People Ops (untuk kebijakan karyawan) atau Finance (untuk
anggaran) untuk informasi salary band, atau ajukan permintaan akses resmi
melalui jalur internal.
```

Poin yang dibuktikan run ini:

1. WorkBuddy memuat skill Nalar dari `~/.workbuddy-ai/skills/workplace-brain/`.
2. Agent memanggil bridge lewat Bash tool, bukan membaca dokumen mentah.
3. Identitas datang dari file host `~/.nalar/identity` — bukan dari teks prompt.
4. Pertanyaan yang sama menghasilkan **jawaban berbeda** sesuai izin.
5. Penolakan tidak mengonfirmasi keberadaan data (tidak menyebut dokumen
   kompensasi, tidak menyebut angka).
6. `leaks: []` — tidak ada nilai sensitif (gaji, kode PHK, nilai kontrak, PII)
   yang bocor ke jawaban maupun ke log.
