// src/keypress.ts — raw stdin key reader for dashboard navigation

import type { KeyEvent } from "./types.ts";

export function enableRawMode(): void {
  Deno.stdin.setRaw(true);
}

export function disableRawMode(): void {
  try {
    Deno.stdin.setRaw(false);
  } catch {
    // May fail if stdin is already closed
  }
}

export async function readKey(): Promise<KeyEvent> {
  const buf = new Uint8Array(8);
  const n = await Deno.stdin.read(buf);
  if (n === null) {
    return { key: "eof", ctrl: false, raw: new Uint8Array() };
  }

  const bytes = buf.slice(0, n);

  // Ctrl+C
  if (bytes[0] === 3) return { key: "c", ctrl: true, raw: bytes };
  // Ctrl+D
  if (bytes[0] === 4) return { key: "d", ctrl: true, raw: bytes };

  // Enter
  if (bytes[0] === 13 || bytes[0] === 10) return { key: "enter", ctrl: false, raw: bytes };

  // Escape sequences (arrows)
  if (bytes[0] === 27 && n >= 3 && bytes[1] === 91) {
    switch (bytes[2]) {
      case 65:
        return { key: "up", ctrl: false, raw: bytes };
      case 66:
        return { key: "down", ctrl: false, raw: bytes };
      case 67:
        return { key: "right", ctrl: false, raw: bytes };
      case 68:
        return { key: "left", ctrl: false, raw: bytes };
    }
  }

  // Escape alone
  if (bytes[0] === 27 && n === 1) return { key: "escape", ctrl: false, raw: bytes };

  // Regular ASCII character
  if (n === 1 && bytes[0] >= 32 && bytes[0] < 127) {
    return { key: String.fromCharCode(bytes[0]), ctrl: false, raw: bytes };
  }

  // Ctrl + letter (1-26 → a-z)
  if (n === 1 && bytes[0] >= 1 && bytes[0] <= 26) {
    return { key: String.fromCharCode(bytes[0] + 96), ctrl: true, raw: bytes };
  }

  return { key: "unknown", ctrl: false, raw: bytes };
}
