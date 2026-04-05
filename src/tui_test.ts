// src/tui_test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTaskLine, renderDashboard, formatTitle } from "./tui.ts";
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
  const line = renderTaskLine(TASK, status, false);
  assert(line.includes("feature-auth"));
  assert(line.includes("Edit src/auth.ts"));
  assert(line.includes("●"));
});

Deno.test("renderTaskLine highlights selected task", () => {
  const status: TaskStatus = { status: "waiting", snippet: "which db?" };
  const selected = renderTaskLine(TASK, status, true);
  assert(selected.includes(">"));
  const unselected = renderTaskLine(TASK, status, false);
  assert(unselected.includes(" "));
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
