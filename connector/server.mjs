#!/usr/bin/env node
/**
 * Nalar MCP server (stdio transport).
 *
 * Exposes exactly one tool, `ask`, which forwards the question to the Nalar
 * API. The identity is derived from the access token (NALAR_TOKEN) that
 * WorkBuddy injects at connect time - the model can never choose who it is.
 */

import { createInterface } from "node:readline";

const BASE_URL = String(process.env.NALAR_BASE_URL ?? "http://127.0.0.1:4173").replace(
  /\/+$/,
  ""
);
const TOKEN = String(process.env.NALAR_TOKEN ?? "").trim();

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "ask",
    description:
      "Jawab pertanyaan perusahaan (cuti, payroll, kontrak, insiden, task board, kebijakan) memakai knowledge Nalar yang sudah difilter akses. Mengembalikan jawaban bersitasi, daftar sumber, dan catatan bila ada field yang diredaksi.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Pertanyaan pengguna, maksimal 500 karakter."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callNalar(query) {
  const response = await fetch(`${BASE_URL}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000)
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Respons Nalar bukan JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(payload?.message ?? `Nalar API HTTP ${response.status}`);
  }

  return payload;
}

async function handle(message) {
  const { id, method, params } = message ?? {};
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nalar-workplace-brain", version: "1.0.0" }
      });
      return;
    case "notifications/initialized":
    case "initialized":
      return;
    case "ping":
      if (isRequest) reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const query = String(params?.arguments?.query ?? "").trim();
      if (!query) {
        fail(id, -32602, "Parameter 'query' wajib diisi.");
        return;
      }
      try {
        const result = await callNalar(query);
        reply(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  decision: result.decision,
                  reason_code: result.reason_code,
                  answer: result.answer,
                  citations: result.citations,
                  access: {
                    redacted_fields: result.access?.redacted_fields ?? 0,
                    sources_used: result.access?.sources_used ?? []
                  }
                },
                null,
                2
              )
            }
          ],
          isError: false
        });
      } catch (error) {
        reply(id, {
          content: [{ type: "text", text: `Nalar gagal: ${error.message}` }],
          isError: true
        });
      }
      return;
    }
    default:
      if (isRequest) fail(id, -32601, `Method tidak didukung: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  try {
    await handle(message);
  } catch (error) {
    if (message?.id !== undefined) {
      fail(message.id, -32603, error.message);
    }
  }
});

rl.on("close", () => process.exit(0));
