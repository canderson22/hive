// src/log.ts — structured JSON-line logger to ~/.hive/hive.log

import { logPath } from "./paths.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.224.0/path/mod.ts";

let logFile: Deno.FsFile | null = null;

async function getLogFile(): Promise<Deno.FsFile> {
  if (!logFile) {
    const path = logPath();
    await ensureDir(dirname(path));
    logFile = await Deno.open(path, { create: true, append: true });
  }
  return logFile;
}

async function write(level: string, msg: string, data?: Record<string, unknown>): Promise<void> {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }) + "\n";
  try {
    const file = await getLogFile();
    await file.write(new TextEncoder().encode(entry));
  } catch {
    // Logging should never crash the app
  }
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  close: () => {
    logFile?.close();
    logFile = null;
  },
};
