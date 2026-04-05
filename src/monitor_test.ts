// src/monitor_test.ts
import { assertEquals } from "@std/assert";
import { classifyStatus, extractSnippet, parseSignal } from "./monitor.ts";

// --- parseSignal ---

Deno.test("parseSignal parses event and JSON", () => {
  const raw = `tool\n{"tool_name":"Edit","file_path":"src/auth.ts"}`;
  const signal = parseSignal(raw);
  assertEquals(signal.event, "tool");
  assertEquals(signal.json.tool_name, "Edit");
});

Deno.test("parseSignal handles event-only (no JSON)", () => {
  const signal = parseSignal("stop\n");
  assertEquals(signal.event, "stop");
  assertEquals(Object.keys(signal.json).length, 0);
});

Deno.test("parseSignal handles malformed JSON", () => {
  const signal = parseSignal("tool\nnot json");
  assertEquals(signal.event, "tool");
  assertEquals(Object.keys(signal.json).length, 0);
});

// --- classifyStatus ---

Deno.test("classifyStatus: tool event → working", () => {
  const result = classifyStatus("tool", {}, true);
  assertEquals(result.status, "working");
});

Deno.test("classifyStatus: prompt event → working", () => {
  const result = classifyStatus("prompt", {}, true);
  assertEquals(result.status, "working");
});

Deno.test("classifyStatus: stop with done metadata → done", () => {
  const json = {
    last_assistant_message: "All done.\n<!-- hive: done | implemented auth middleware -->",
  };
  const result = classifyStatus("stop", json, true);
  assertEquals(result.status, "done");
});

Deno.test("classifyStatus: stop with waiting metadata → waiting", () => {
  const json = { last_assistant_message: "Question\n<!-- hive: waiting | which database? -->" };
  const result = classifyStatus("stop", json, true);
  assertEquals(result.status, "waiting");
});

Deno.test("classifyStatus: stop without metadata → idle", () => {
  const json = { last_assistant_message: "Finished some work" };
  const result = classifyStatus("stop", json, true);
  assertEquals(result.status, "idle");
});

Deno.test("classifyStatus: notification permission_prompt → blocked", () => {
  const json = { type: "permission_prompt", message: "Allow Bash?" };
  const result = classifyStatus("notification", json, true);
  assertEquals(result.status, "blocked");
});

Deno.test("classifyStatus: notification elicitation_dialog → waiting", () => {
  const json = { type: "elicitation_dialog", message: "Select option" };
  const result = classifyStatus("notification", json, true);
  assertEquals(result.status, "waiting");
});

Deno.test("classifyStatus: notification idle_prompt → idle", () => {
  const json = { type: "idle_prompt" };
  const result = classifyStatus("notification", json, true);
  assertEquals(result.status, "idle");
});

Deno.test("classifyStatus: no signal + tmux dead → stopped", () => {
  const result = classifyStatus(null, {}, false);
  assertEquals(result.status, "stopped");
});

Deno.test("classifyStatus: no signal + tmux alive → idle", () => {
  const result = classifyStatus(null, {}, true);
  assertEquals(result.status, "idle");
});

// --- extractSnippet ---

Deno.test("extractSnippet: Edit tool with file path", () => {
  const snippet = extractSnippet("tool", { tool_name: "Edit", file_path: "src/auth.ts" });
  assertEquals(snippet, "Edit src/auth.ts");
});

Deno.test("extractSnippet: Bash tool with command", () => {
  const snippet = extractSnippet("tool", { tool_name: "Bash", command: "yarn test --watch src/" });
  assertEquals(snippet, "Bash: yarn test --watch src/");
});

Deno.test("extractSnippet: Bash tool truncates long command", () => {
  const longCmd = "yarn test --watch " + "a".repeat(100);
  const snippet = extractSnippet("tool", { tool_name: "Bash", command: longCmd });
  assertEquals(snippet.length <= 65, true);
  assertEquals(snippet.endsWith("..."), true);
});

Deno.test("extractSnippet: Grep tool with pattern", () => {
  const snippet = extractSnippet("tool", { tool_name: "Grep", pattern: "TODO" });
  assertEquals(snippet, "Grep: TODO");
});

Deno.test("extractSnippet: prompt shows user text", () => {
  const snippet = extractSnippet("prompt", { prompt: "fix the auth bug" });
  assertEquals(snippet, "fix the auth bug");
});

Deno.test("extractSnippet: stop shows last line", () => {
  const snippet = extractSnippet("stop", { last_assistant_message: "Line 1\nLine 2\nDone." });
  assertEquals(snippet, "Done.");
});

Deno.test("extractSnippet: notification shows message", () => {
  const snippet = extractSnippet("notification", { message: "Allow Bash?" });
  assertEquals(snippet, "Allow Bash?");
});
