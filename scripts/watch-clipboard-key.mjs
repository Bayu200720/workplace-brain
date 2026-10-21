/**
 * Watches the Windows clipboard for a CodeBuddy API key and stores it in the
 * local key file, so the human never has to paste a secret into chat.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT = "C:/Users/anira/.workbuddy-ai/codebuddy-api-key.txt";
const MAX_MINUTES = Number(process.argv[2] ?? 30);
const deadline = Date.now() + MAX_MINUTES * 60_000;

const looksLikeKey = (text) =>
  typeof text === "string" &&
  /^[A-Za-z0-9_\-.]{20,200}$/.test(text.trim()) &&
  !/\s/.test(text.trim());

function readClipboard() {
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "Get-Clipboard -Raw"],
      { encoding: "utf8", timeout: 8000 }
    );
  } catch {
    return "";
  }
}

console.log(`menunggu API key di clipboard (maks ${MAX_MINUTES} menit) -> ${OUT}`);

let last = "";
while (Date.now() < deadline) {
  const text = readClipboard();
  if (text && text !== last) {
    last = text;
    const trimmed = text.trim();
    if (looksLikeKey(trimmed)) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, `${trimmed}\n`, "utf8");
      console.log(
        `API key terdeteksi (len ${trimmed.length}, awalan ${trimmed.slice(0, 3)}***) -> ${OUT}`
      );
      process.exit(0);
    }
  }
  await new Promise((r) => setTimeout(r, 2500));
}

console.log("timeout: tidak ada key di clipboard");
process.exit(1);
