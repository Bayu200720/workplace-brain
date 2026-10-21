import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Access-token registry for the Nalar API.
 *
 * In "token" mode the API no longer trusts a userId in the request body: the
 * identity is derived from the bearer token. The mapping token -> userId lives
 * only on the server, which is what makes the connector safe for multi-user
 * deployments.
 *
 * Configuration:
 *   NALAR_TOKENS       inline JSON: { "<token>": "<userId>" }
 *   NALAR_TOKENS_FILE  path to a JSON file with the same shape
 */
export function loadTokenRegistry(env = process.env) {
  const raw = env.NALAR_TOKENS_FILE
    ? (existsSync(resolve(env.NALAR_TOKENS_FILE))
        ? readFileSync(resolve(env.NALAR_TOKENS_FILE), "utf8")
        : "")
    : env.NALAR_TOKENS ?? "";

  if (!raw.trim()) return { enabled: false, tokens: new Map() };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("NALAR_TOKENS bukan JSON yang valid.");
  }

  const tokens = new Map();
  for (const [token, userId] of Object.entries(parsed)) {
    if (typeof token === "string" && typeof userId === "string" && token && userId) {
      tokens.set(token, userId);
    }
  }

  return { enabled: tokens.size > 0, tokens };
}

export function bearerToken(headers = {}) {
  const raw = headers.authorization ?? headers.Authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : "";
}

export function identityForToken(registry, token) {
  if (!registry.enabled) return null;
  if (!token) return null;
  return registry.tokens.get(token) ?? null;
}
