// src/notifications.ts — macOS desktop notifications via osascript

import { run } from "./run.ts";
import { log } from "./log.ts";

export async function notify(title: string, body: string): Promise<void> {
  if (Deno.build.os !== "darwin") return;

  try {
    await run([
      "osascript",
      "-e",
      `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "default"`,
    ]);
  } catch (e) {
    await log.warn("Notification failed", { error: String(e) });
  }
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
