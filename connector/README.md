# Nalar Workplace Brain — WorkBuddy Connector (MCP + Skill)

Paket connector resmi WorkBuddy untuk Nalar: satu tool MCP (`ask`) + skill yang
menjelaskan cara memakainya.

```text
nalar-connector/
├── connector-meta.json     # metadata, auth_mode: token
├── mcp.json                # stdio lokal (atau streamableHttp remote)
├── token-schema.json       # form Access Token + Base URL
├── icon.svg
├── server.mjs              # MCP server (stdio)
└── skills/nalar/SKILL.md   # instruksi agent
```

## Cara pakai (lokal)

1. Jalankan service Nalar dengan mode token:

   ```bash
   NALAR_TOKENS='{"tok_rina":"rina","tok_budi":"budi","tok_dewi":"dewi"}' npm start
   ```

   Setiap token dipetakan ke satu identitas di server. `userId` dari body
   request diabaikan, dan kalau tidak cocok dengan token → `403`.

2. Uji server MCP secara manual:

   ```bash
   NALAR_BASE_URL=http://127.0.0.1:4173 NALAR_TOKEN=tok_rina \
     node server.mjs
   ```

   lalu kirim (satu baris JSON per pesan):

   ```json
   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"1.0"}}}
   {"jsonrpc":"2.0","id":2,"method":"tools/list"}
   {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask","arguments":{"query":"Berapa cuti tahunan?"}}}
   ```

3. Pasang di WorkBuddy:
   - upload folder ini (atau zip) lewat **Experts · Skills · Connectors → Connectors**;
   - saat Connect, WorkBuddy menampilkan form dari `token-schema.json`;
   - isi `NALAR_TOKEN` (token pribadi pengguna) dan `NALAR_BASE_URL`.

## Deploy remote (produksi)

Ganti `mcp.json` menjadi:

```json
{
  "mcpServers": {
    "nalar": {
      "type": "streamableHttp",
      "url": "https://nalar.company.id/mcp",
      "headers": { "Authorization": "Bearer ${NALAR_TOKEN}" },
      "timeout": 30000
    }
  }
}
```

`${NALAR_TOKEN}` diisi WorkBuddy dari form `token-schema.json`; kredensial
disimpan hanya di mesin pengguna dan dikirim saat connect. Jangan menulis token
asli di package, skill, atau contoh.

## Catatan keamanan

- Server MCP hanya mengekspos satu tool read-only (`ask`).
- Identitas berasal dari token, bukan dari argumen model.
- Tidak ada endpoint admin/audit yang diekspos lewat MCP.
