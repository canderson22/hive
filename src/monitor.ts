// src/monitor.ts — signal file reading, status classification, snippet extraction

import type { Signal, Task, TaskStatus } from "./types.ts";
import { signalPath } from "./paths.ts";
import { hasSession } from "./tmux.ts";
import { log } from "./log.ts";

const HIVE_META_RE = /<!-- hive: (\w+) \| (.+?) -->/;
const MAX_SNIPPET_LEN = 60;

export function parseSignal(raw: string): Signal {
  const newline = raw.indexOf("\n");
  if (newline === -1) {
    return { event: raw.trim(), json: {} };
  }
  const event = raw.slice(0, newline).trim();
  const jsonStr = raw.slice(newline + 1).trim();
  let json: Record<string, unknown> = {};
  if (jsonStr) {
    try {
      json = JSON.parse(jsonStr);
    } catch {
      // Malformed JSON — proceed without it
    }
  }
  return { event, json };
}

export function classifyStatus(
  event: string | null,
  json: Record<string, unknown>,
  tmuxAlive: boolean,
): TaskStatus {
  if (event === "prompt" || event === "tool") {
    return { status: "working", snippet: extractSnippet(event, json) };
  }

  if (event === "stop") {
    const msg = (json.last_assistant_message as string) ?? "";
    const match = msg.match(HIVE_META_RE);
    if (match) {
      const metaStatus = match[1] as string;
      const metaSnippet = match[2] as string;
      if (metaStatus === "done") return { status: "done", snippet: metaSnippet };
      if (metaStatus === "waiting") return { status: "waiting", snippet: metaSnippet };
    }
    return { status: "idle", snippet: extractSnippet(event, json) };
  }

  if (event === "notification") {
    const type = json.type as string;
    const snippet = extractSnippet(event, json);
    if (type === "permission_prompt") return { status: "blocked", snippet };
    if (type === "elicitation_dialog") return { status: "waiting", snippet };
    if (type === "idle_prompt") return { status: "idle", snippet };
    return { status: "working", snippet };
  }

  // No signal
  if (!tmuxAlive) return { status: "stopped", snippet: "" };
  return { status: "idle", snippet: "" };
}

export function extractSnippet(
  event: string,
  json: Record<string, unknown>,
): string {
  let snippet = "";

  if (event === "tool") {
    const toolName = json.tool_name as string ?? "tool";
    const filePath = json.file_path as string;
    const command = json.command as string;
    const pattern = json.pattern as string;

    if (filePath) {
      snippet = `${toolName} ${filePath}`;
    } else if (command) {
      snippet = `${toolName}: ${command}`;
    } else if (pattern) {
      snippet = `${toolName}: ${pattern}`;
    } else {
      snippet = toolName;
    }
  } else if (event === "prompt") {
    snippet = (json.prompt as string) ?? (json.user_prompt as string) ?? "";
  } else if (event === "stop") {
    const msg = (json.last_assistant_message as string) ?? "";
    // Strip hive metadata comment if present
    const clean = msg.replace(HIVE_META_RE, "").trim();
    const lines = clean.split("\n");
    snippet = lines[lines.length - 1] ?? "";
  } else if (event === "notification") {
    snippet = (json.message as string) ?? "";
  }

  return truncate(snippet, MAX_SNIPPET_LEN);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

export async function readSignal(sessionName: string): Promise<Signal | null> {
  const path = signalPath(sessionName);
  try {
    const raw = await Deno.readTextFile(path);
    return parseSignal(raw);
  } catch {
    return null;
  }
}

export async function removeSignal(sessionName: string): Promise<void> {
  try {
    await Deno.remove(signalPath(sessionName));
  } catch {
    // ok if doesn't exist
  }
}

export async function pollTask(task: Task): Promise<TaskStatus> {
  const signal = await readSignal(task.tmuxSession);
  const alive = await hasSession(task.tmuxSession);

  if (signal) {
    return classifyStatus(signal.event, signal.json, alive);
  }
  return classifyStatus(null, {}, alive);
}

export async function pollAll(tasks: Task[]): Promise<Map<string, TaskStatus>> {
  const results = new Map<string, TaskStatus>();
  await Promise.all(
    tasks.map(async (task) => {
      try {
        const status = await pollTask(task);
        results.set(task.id, status);
      } catch (e) {
        await log.error("Poll failed for task", { taskId: task.id, error: String(e) });
        results.set(task.id, { status: "stopped", snippet: "" });
      }
    }),
  );
  return results;
}
