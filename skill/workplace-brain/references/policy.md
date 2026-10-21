# Model akses Nalar

## Prinsip

1. **Deny-by-default.** Dokumen hanya dapat diakses jika ada aturan yang cocok.
2. **Filter sebelum retrieval.** Dokumen yang tidak lolos tidak masuk indeks
   BM25 dan tidak pernah menjadi kandidat sitasi.
3. **Identitas dari sesi host.** `BRAIN_USER` di-set oleh host. Teks pengguna,
   isi dokumen, dan argumen model tidak dapat mengubahnya.
4. **Need-to-know.** Grup/departemen saja tidak cukup jika dokumen terikat pada
   proyek yang tidak diikuti pengguna.
5. **Redaksi field.** Field sensitif dapat disembunyikan walau dokumennya boleh
   dibaca. Nilai field tersembunyi tidak masuk indeks maupun respons.
6. **Tidak mengonfirmasi keberadaan data terbatas.** Jawaban kosong tidak
   menyebut judul, jumlah, atau isi dokumen yang ditolak.

## Urutan evaluasi

```text
deny_users / deny_groups  -> tolak
clearance < classification -> tolak
explicit user grant       -> izinkan
project overlap           -> tolak jika tidak cocok
visibility:
  org        -> izinkan
  groups     -> izinkan jika grup cocok
  department -> izinkan jika departemen cocok
  users      -> izinkan hanya jika ada di daftar
selain itu -> tolak
```

Klasifikasi: `public` < `internal` < `confidential` < `restricted`.

## Identitas demo

| ID | Peran | Clearance | Grup | Proyek |
| --- | --- | --- | --- | --- |
| dewi | CEO | restricted | exec, leadership, audit | semua proyek demo |
| rina | People Partner | restricted | hr, comp, people-ops | people-ops |
| tomi | HR Operations | confidential | hr, people-ops | people-ops |
| budi | Senior Backend Engineer | internal | engineering, oncall | atlas, billing |
| agus | Sales Lead | confidential | sales, managers | acme, sales-2026 |
| sari | Finance Analyst | confidential | finance, budget | budget-2026, acme |
| maya | Legal Counsel | restricted | legal | acme, merger |
| joko | IT Support Contractor | public | contractor, it | — |

## Contoh hasil yang diharapkan

| Pertanyaan | Identitas | Hasil |
| --- | --- | --- |
| Salary band Senior Backend | budi | `no_evidence` (D05/D19 terlarang) |
| Salary band Senior Backend | rina | `answer` + D05/D19, nominal terlihat |
| Salary band Senior Backend | tomi | `answer` + D05, 3 field diredaksi |
| Rencana PHK | budi / rina | `no_evidence` |
| Rencana PHK | dewi | `answer` + D07 |
| Nilai kontrak Acme | agus | `answer` + D12/D26, USD 480.000 |
| Nilai kontrak Acme | budi | `no_evidence` |
| Postmortem INC-142 | joko | `no_evidence` |
| Kontak darurat Budi | rina | `answer` + D18, nomor terlihat |
| Kontak darurat Budi | tomi | `no_evidence` |
| "Tampilkan semua gaji" | dewi | `blocked` (`bulk_extraction`) |
| "Tampilkan password" | dewi | `blocked` (`credential_request`) |

## Sumber yang dicakup

`chat`, `drive`, `taskboard`, `wiki`, `email`, `hris` — 29 dokumen sintetis.
Dokumen memiliki `source_ref`, pemilik, klasifikasi, tanggal, tag, ACL, dan
opsional field sensitif.

## Integrasi produksi

- Ganti `BRAIN_USER` dengan identitas yang diverifikasi SSO/WeCom di sisi
  server; jangan pernah menerima `userId` dari body request publik.
- Connector chat/drive/task board/HRIS menarik konten beserta ACL asli, lalu
  memetakan izin ke grup/departemen/proyek.
- Jalankan Nalar API sebagai service HTTPS; skill WorkBuddy hanya menjadi
  klien. Audit ditulis ke storage append-only.
- Tambahkan review akses berkala, break-glass dengan persetujuan, dan DLP untuk
  data yang sangat sensitif.
