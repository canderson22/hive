// src/tui_test.ts
import { assert, assertEquals } from "@std/assert";
import { renderTaskLine, formatTitle } from "./tui.ts";
import type { Task, TaskStatus } from "./types.ts";

const TASK: Task = {
  id: "feature-auth",
  repo: "org-repo",
  branch: "charles-feature-auth",
  baseBranch: "main",
  worktreePath: "/tmp/wt",
  tmuxSession: "hive-feature-auth",
  program: "claude",
  createdAt: "2026-04-05T00:00:00Z",
};

Deno.test("renderTaskLine shows status icon, name, and snippet", () => {
  const status: TaskStatus = { status: "working", snippet: "Edit src/auth.ts" };
  const line = renderTaskLine(TASK, status, false, false);
  assert(line.includes("feature-auth"));
  assert(line.includes("Edit src/auth.ts"));
  assert(line.includes("●"));
});

Deno.test("renderTaskLine highlights selected task", () => {
  const status: TaskStatus = { status: "waiting", snippet: "which db?" };
  const selected = renderTaskLine(TASK, status, true, false);
  assert(selected.includes(">"));
  const unselected = renderTaskLine(TASK, status, false, false);
  assert(unselected.includes(" "));
});

Deno.test("renderTaskLine shows repo prefix in multi-repo mode", () => {
  const task = { ...TASK, repoDisplayName: "Tempo" };
  const status: TaskStatus = { status: "working", snippet: "" };
  const line = renderTaskLine(task, status, false, true);
  assert(line.includes("Tempo/feature-auth"));
});

Deno.test("renderTaskLine shows PR info", () => {
  const status: TaskStatus = { status: "idle", snippet: "" };
  const pr = { number: 42, state: "open", url: "https://github.com/org/repo/pull/42" };
  const line = renderTaskLine(TASK, status, false, false, pr);
  assert(line.includes("#42"));
  assert(line.includes("open"));
});

Deno.test("formatTitle summarizes statuses", () => {
  const statuses = new Map<string, TaskStatus>();
  statuses.set("a", { status: "working", snippet: "" });
  statuses.set("b", { status: "waiting", snippet: "" });
  statuses.set("c", { status: "working", snippet: "" });
  const title = formatTitle(statuses);
  assertEquals(title, "hive: 1 waiting, 2 working");
});

Deno.test("formatTitle handles empty", () => {
  const title = formatTitle(new Map());
  assertEquals(title, "hive");
});
