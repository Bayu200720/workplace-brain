import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./corpus.js";
import { ask, AskError } from "./answer.js";
import { auditLog } from "./audit.js";
import { canAudit, publicUser } from "./policy.js";
import { runSecurityChecks } from "./security.js";
import { bearerToken, identityForToken, loadTokenRegistry } from "./tokens.js";

const DEMO_ROOT = resolve(
  fileURLToPath(new URL("../../demo", import.meta.url))
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, status, text, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function readJson(request, limitBytes = 16_384) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new AskError("payload_too_large", "Body terlalu besar.", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AskError("invalid_json", "Body harus JSON yang valid.", 400));
      }
    });

    request.on("error", () => {
      reject(new AskError("request_error", "Gagal membaca request.", 400));
    });
  });
}

function createRateLimiter({ windowMs = 60_000, max = 60 } = {}) {
  const buckets = new Map();
  return function allow(key) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= max) return false;
    bucket.count += 1;
    return true;
  };
}

async function serveStatic(response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split("?")[0]);
  } catch {
    sendText(response, 400, "Bad request");
    return;
  }

  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = normalize(join(DEMO_ROOT, relativePath));
  const inside = relative(DEMO_ROOT, filePath);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(file);
  } catch {
    sendText(response, 404, "Not found");
  }
}

export function createAppServer({
  corpus = loadCorpus(),
  audit = auditLog,
  refreshCorpus = loadCorpus
} = {}) {
  const allowRequest = createRateLimiter();
  const registry = loadTokenRegistry();

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    // Re-stat the corpus files so ACL or document edits apply on the next
    // request. A broken seed file keeps the last known-good corpus serving.
    try {
      refreshCorpus();
    } catch (error) {
      process.emitWarning(`Corpus reload dilewati: ${error.message}`);
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          org: corpus.org.name,
          documents: corpus.documents.length,
          users: corpus.users.length
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/users") {
        sendJson(response, 200, {
          ok: true,
          org: corpus.org,
          users: corpus.users.map(publicUser)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJson(request);
        const requestedUserId = typeof body.userId === "string" ? body.userId : "";
        const query = typeof body.query === "string" ? body.query : "";

        let userId = requestedUserId;
        if (registry.enabled) {
          const tokenUser = identityForToken(registry, bearerToken(request.headers));
          if (!tokenUser) {
            sendJson(response, 401, {
              ok: false,
              error: "unauthorized",
              message: "Access token Nalar tidak ada atau tidak valid."
            });
            return;
          }
          if (requestedUserId && requestedUserId !== tokenUser) {
            sendJson(response, 403, {
              ok: false,
              error: "identity_mismatch",
              message:
                "userId pada body tidak cocok dengan identitas pada token. Identitas mengikuti token."
            });
            return;
          }
          userId = tokenUser;
        }

        if (!allowRequest(`ask:${userId || request.socket.remoteAddress}`)) {
          sendJson(response, 429, {
            ok: false,
            decision: "blocked",
            reason_code: "rate_limited",
            message: "Terlalu banyak pertanyaan. Coba lagi dalam satu menit."
          });
          return;
        }

        // Any extra fields (role, clearance, groups) are intentionally ignored.
        const result = ask({
          corpus,
          userId,
          query,
          audit,
          surface: registry.enabled ? "connector" : "web"
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/audit") {
        const requestedUserId = url.searchParams.get("userId") ?? "";
        let userId = requestedUserId;
        if (registry.enabled) {
          const tokenUser = identityForToken(registry, bearerToken(request.headers));
          if (!tokenUser) {
            sendJson(response, 401, {
              ok: false,
              error: "unauthorized",
              message: "Access token Nalar tidak ada atau tidak valid."
            });
            return;
          }
          userId = tokenUser;
        }
        const user = corpus.userById.get(userId);
        if (!canAudit(user)) {
          sendJson(response, 403, {
            ok: false,
            error: "forbidden",
            message: "Audit hanya tersedia untuk grup audit."
          });
          return;
        }
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        sendJson(response, 200, {
          ok: true,
          integrity: audit.verify(),
          entries: audit.recent(Number.isFinite(limit) ? limit : 50)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/audit/verify") {
        const requestedUserId = url.searchParams.get("userId") ?? "";
        let userId = requestedUserId;
        if (registry.enabled) {
          const tokenUser = identityForToken(registry, bearerToken(request.headers));
          if (!tokenUser) {
            sendJson(response, 401, {
              ok: false,
              error: "unauthorized",
              message: "Access token Nalar tidak ada atau tidak valid."
            });
            return;
          }
          userId = tokenUser;
        }
        const user = corpus.userById.get(userId);
        if (!canAudit(user)) {
          sendJson(response, 403, {
            ok: false,
            error: "forbidden",
            message: "Verifikasi audit hanya tersedia untuk grup audit."
          });
          return;
        }
        sendJson(response, 200, { ok: true, integrity: audit.verify() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/selftest") {
        const body = await readJson(request);
        let userId = typeof body.userId === "string" ? body.userId : "";
        if (registry.enabled) {
          const tokenUser = identityForToken(registry, bearerToken(request.headers));
          if (!tokenUser) {
            sendJson(response, 401, {
              ok: false,
              error: "unauthorized",
              message: "Access token Nalar tidak ada atau tidak valid."
            });
            return;
          }
          userId = tokenUser;
        }
        const user = corpus.userById.get(userId);
        if (!canAudit(user)) {
          sendJson(response, 403, {
            ok: false,
            error: "forbidden",
            message: "Uji kebocoran hanya tersedia untuk grup audit."
          });
          return;
        }
        sendJson(response, 200, { ok: true, ...runSecurityChecks(corpus) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/mode") {
        sendJson(response, 200, {
          ok: true,
          mode: registry.enabled ? "token" : "open",
          demo_tokens_enabled: process.env.NALAR_DEMO_TOKENS === "1"
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/demo/tokens") {
        if (!registry.enabled || process.env.NALAR_DEMO_TOKENS !== "1") {
          sendJson(response, 404, { ok: false, error: "not_found" });
          return;
        }
        const byUser = {};
        for (const [token, userId] of registry.tokens) byUser[userId] = token;
        sendJson(response, 200, { ok: true, tokens: byUser });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const known = new Set([
          "/api/health",
          "/api/users",
          "/api/ask",
          "/api/audit",
          "/api/audit/verify",
          "/api/selftest",
          "/api/auth/mode",
          "/api/demo/tokens"
        ]);
        sendJson(response, known.has(url.pathname) ? 405 : 404, {
          ok: false,
          error: known.has(url.pathname) ? "method_not_allowed" : "not_found"
        });
        return;
      }

      if (request.method === "GET") {
        await serveStatic(response, url.pathname);
        return;
      }

      sendJson(response, 405, { ok: false, error: "method_not_allowed" });
    } catch (error) {
      if (error instanceof AskError) {
        sendJson(response, error.status, {
          ok: false,
          error: error.code,
          message: error.message
        });
        return;
      }
      console.error("[nalar] unhandled:", error);
      sendJson(response, 500, {
        ok: false,
        error: "internal_error",
        message: "Terjadi kesalahan internal."
      });
    }
  });
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? "4173", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`Nalar Workplace Brain berjalan di http://${host}:${port}`);
    console.log("Demo identity switcher tersedia di halaman utama.");
  });
}
