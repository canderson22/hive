# CI Column & PR Guidelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI column to the dashboard that auto-runs tests on idle/done transitions, and make PR creation respect repo-specific templates and guidelines.

**Architecture:** New `src/ci.ts` module handles test command detection and execution. The TUI polls CI status alongside task status. PR creation in `src/pr.ts` gains a `detectPrGuidelines()` function that scans worktrees for templates before generating PR bodies.

**Tech Stack:** Deno, TypeScript, `Deno.Command` for subprocess execution

---

### Task 1: Add CiStatus type and testCommand to RepoConfig

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add CiStatus type and update RepoConfig**

In `src/types.ts`, add the `CiStatus` type after the `Status` type on line 3, and add `testCommand` to `RepoConfig`:

```typescript
export type CiStatus = "passed" | "failed" | "running" | null;
```

Add to `RepoConfig` (after `localPath?`):

```typescript
export interface RepoConfig {
  url: string;
  defaultBranch: string;
  localPath?: string;
  testCommand?: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `deno check src/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add CiStatus type and testCommand to RepoConfig"
```

---

### Task 2: Test command auto-detection

**Files:**
- Create: `src/ci.ts`
- Create: `src/ci_test.ts`

- [ ] **Step 1: Write failing tests for detectTestCommand**

Create `src/ci_test.ts`:

```typescript
// src/ci_test.ts
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { detectTestCommand } from "./ci.ts";

Deno.test("detectTestCommand finds deno.json", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "deno.json"), "{}");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "deno test");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds package.json with test script", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "jest" } }),
  );
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "npm test");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand skips package.json without test script", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { build: "tsc" } }),
  );
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds Makefile with test target", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "Makefile"), "test:\n\tpytest\n");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "make test");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds pytest.ini", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "pytest.ini"), "[pytest]\n");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "pytest");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds pyproject.toml", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "pyproject.toml"), "[tool.pytest]\n");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "pytest");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand returns null for empty dir", async () => {
  const dir = await Deno.makeTempDir();
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand prefers deno.json over package.json", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "deno.json"), "{}");
  await Deno.writeTextFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "jest" } }),
  );
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "deno test");
  await Deno.remove(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test src/ci_test.ts --allow-env --allow-read --allow-write`
Expected: FAIL — `detectTestCommand` not found

- [ ] **Step 3: Implement detectTestCommand**

Create `src/ci.ts`:

```typescript
// src/ci.ts — test command detection and CI execution

import { join } from "@std/path";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectTestCommand(worktreePath: string): Promise<string | null> {
  // 1. Deno project
  if (
    await fileExists(join(worktreePath, "deno.json")) ||
    await fileExists(join(worktreePath, "deno.jsonc"))
  ) {
    return "deno test";
  }

  // 2. Node project with test script
  const pkgPath = join(worktreePath, "package.json");
  if (await fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
      if (pkg?.scripts?.test) {
        return "npm test";
      }
    } catch {
      // Malformed package.json — skip
    }
  }

  // 3. Makefile with test target
  const makefilePath = join(worktreePath, "Makefile");
  if (await fileExists(makefilePath)) {
    const content = await Deno.readTextFile(makefilePath);
    if (/^test\s*:/m.test(content)) {
      return "make test";
    }
  }

  // 4. Python project
  if (
    await fileExists(join(worktreePath, "pytest.ini")) ||
    await fileExists(join(worktreePath, "pyproject.toml")) ||
    await fileExists(join(worktreePath, "setup.py"))
  ) {
    return "pytest";
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test src/ci_test.ts --allow-env --allow-read --allow-write`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ci.ts src/ci_test.ts
git commit -m "feat: add test command auto-detection"
```

---

### Task 3: Test execution with runTests

**Files:**
- Modify: `src/ci.ts`
- Modify: `src/ci_test.ts`

- [ ] **Step 1: Write failing test for runTests**

Append to `src/ci_test.ts`:

```typescript
import { runTests } from "./ci.ts";

Deno.test("runTests returns passed for exit code 0", async () => {
  const dir = await Deno.makeTempDir();
  const result = await runTests("true", dir);
  assertEquals(result, "passed");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("runTests returns failed for non-zero exit code", async () => {
  const dir = await Deno.makeTempDir();
  const result = await runTests("false", dir);
  assertEquals(result, "failed");
  await Deno.remove(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `deno test src/ci_test.ts --allow-env --allow-read --allow-write --allow-run`
Expected: New tests FAIL — `runTests` not found

- [ ] **Step 3: Implement runTests**

Add to `src/ci.ts` after the `detectTestCommand` function:

```typescript
import type { CiStatus } from "./types.ts";

const TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function runTests(
  testCommand: string,
  worktreePath: string,
): Promise<CiStatus> {
  const parts = testCommand.split(/\s+/);
  const command = new Deno.Command(parts[0], {
    args: parts.slice(1),
    cwd: worktreePath,
    stdout: "null",
    stderr: "null",
  });

  const process = command.spawn();

  const timeout = setTimeout(() => {
    try {
      process.kill();
    } catch {
      // Process may have already exited
    }
  }, TEST_TIMEOUT_MS);

  const output = await process.output();
  clearTimeout(timeout);

  return output.success ? "passed" : "failed";
}
```

Also update the existing import at the top of `src/ci.ts` to include the type:

```typescript
import type { CiStatus } from "./types.ts";
```

- [ ] **Step 4: Run all ci_test tests**

Run: `deno test src/ci_test.ts --allow-env --allow-read --allow-write --allow-run`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ci.ts src/ci_test.ts
git commit -m "feat: add runTests for CI execution"
```

---

### Task 4: CI status manager (CiManager)

**Files:**
- Modify: `src/ci.ts`
- Modify: `src/ci_test.ts`

- [ ] **Step 1: Write failing tests for CiManager**

Append to `src/ci_test.ts`:

```typescript
import { CiManager } from "./ci.ts";

Deno.test("CiManager.getStatus returns null initially", () => {
  const mgr = new CiManager();
  assertEquals(mgr.getStatus("task-1"), null);
});

Deno.test("CiManager.trigger runs tests and stores result", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new CiManager();
  await mgr.trigger("task-1", "true", dir);
  // Wait for async execution
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(mgr.getStatus("task-1"), "passed");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("CiManager.trigger stores failed result", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new CiManager();
  await mgr.trigger("task-2", "false", dir);
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(mgr.getStatus("task-2"), "failed");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("CiManager.trigger sets running while in progress", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new CiManager();
  // Use sleep 1 to create a process that takes time
  const promise = mgr.trigger("task-3", "sleep 1", dir);
  assertEquals(mgr.getStatus("task-3"), "running");
  await promise;
  await Deno.remove(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `deno test src/ci_test.ts --allow-env --allow-read --allow-write --allow-run`
Expected: New tests FAIL — `CiManager` not found

- [ ] **Step 3: Implement CiManager**

Add to `src/ci.ts`:

```typescript
export class CiManager {
  private statuses = new Map<string, CiStatus>();
  private running = new Map<string, AbortController>();
  private commandCache = new Map<string, string | null>();

  getStatus(taskId: string): CiStatus {
    return this.statuses.get(taskId) ?? null;
  }

  async trigger(taskId: string, testCommand: string, worktreePath: string): Promise<void> {
    // Kill any existing run for this task
    const existing = this.running.get(taskId);
    if (existing) {
      existing.abort();
      this.running.delete(taskId);
    }

    this.statuses.set(taskId, "running");

    const controller = new AbortController();
    this.running.set(taskId, controller);

    try {
      const result = await runTests(testCommand, worktreePath);
      if (!controller.signal.aborted) {
        this.statuses.set(taskId, result);
      }
    } catch {
      if (!controller.signal.aborted) {
        this.statuses.set(taskId, "failed");
      }
    } finally {
      this.running.delete(taskId);
    }
  }

  cacheCommand(repo: string, command: string | null): void {
    this.commandCache.set(repo, command);
  }

  getCachedCommand(repo: string): string | null | undefined {
    return this.commandCache.has(repo) ? this.commandCache.get(repo)! : undefined;
  }
}
```

- [ ] **Step 4: Run all ci_test tests**

Run: `deno test src/ci_test.ts --allow-env --allow-read --allow-write --allow-run`
Expected: All 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ci.ts src/ci_test.ts
git commit -m "feat: add CiManager for tracking CI status per task"
```

---

### Task 5: Add CI column to dashboard rendering

**Files:**
- Modify: `src/tui.ts`
- Modify: `src/tui_test.ts`

- [ ] **Step 1: Write failing tests for CI column in renderTaskLine**

Add to `src/tui_test.ts`:

```typescript
import type { CiStatus } from "./types.ts";

Deno.test("renderTaskLine shows Passed in CI column", () => {
  const status: TaskStatus = { status: "idle", snippet: "" };
  const line = renderTaskLine(TASK, status, false, false, undefined, 0, "passed");
  assert(line.includes("Passed"));
});

Deno.test("renderTaskLine shows Failed in CI column", () => {
  const status: TaskStatus = { status: "idle", snippet: "" };
  const line = renderTaskLine(TASK, status, false, false, undefined, 0, "failed");
  assert(line.includes("Failed"));
});

Deno.test("renderTaskLine shows Running in CI column", () => {
  const status: TaskStatus = { status: "working", snippet: "" };
  const line = renderTaskLine(TASK, status, false, false, undefined, 0, "running");
  assert(line.includes("Running"));
});

Deno.test("renderTaskLine shows dash when CI is null", () => {
  const status: TaskStatus = { status: "working", snippet: "" };
  const line = renderTaskLine(TASK, status, false, false, undefined, 0, null);
  // Should contain dash for CI column (in addition to PR dash)
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
  // Count dashes — should have at least 2 (one for PR, one for CI)
  const dashes = stripped.split("—").length - 1;
  assert(dashes >= 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test src/tui_test.ts --allow-env --allow-read --allow-write`
Expected: FAIL — `renderTaskLine` doesn't accept ciStatus parameter yet

- [ ] **Step 3: Update renderTaskLine to include CI column**

In `src/tui.ts`, update the `renderTaskLine` function signature and body. Add `ciStatus` parameter and CI column rendering:

Update the function signature (line 32-40):

```typescript
export function renderTaskLine(
  task: Task,
  status: TaskStatus,
  selected: boolean,
  multiRepo: boolean,
  prInfo?: PrInfo,
  depth?: number,
  ciStatus?: CiStatus,
): string {
```

Add the CI column rendering after the `paddedPr` line (before the return). Replace the return statement:

```typescript
  // CI column
  const ciText = ciStatus === "passed"
    ? green("Passed")
    : ciStatus === "failed"
    ? red("Failed")
    : ciStatus === "running"
    ? yellow("Running")
    : dim("—");
  const ciPlain = ciStatus === "passed"
    ? "Passed"
    : ciStatus === "failed"
    ? "Failed"
    : ciStatus === "running"
    ? "Running"
    : "—";
  const paddedCi = ciText + " ".repeat(Math.max(0, 8 - ciPlain.length));

  return `${cursor} ${icon} ${paddedName} ${paddedPr} ${paddedCi} ${snippet}`;
```

Add these imports at the top of `src/tui.ts`:

```typescript
import type { CiStatus, Config, PrInfo, State, Status, Task, TaskStatus } from "./types.ts";
```

And add to the ansi imports:

```typescript
import {
  bold,
  clearScreen,
  dim,
  green,
  hideCursor,
  red,
  setTitle,
  showCursor,
  statusColor,
  statusIcon,
  stripAnsi,
  yellow,
} from "./ansi.ts";
```

- [ ] **Step 4: Update column header in renderDashboard**

In `src/tui.ts`, update line 119 — the column header:

```typescript
    lines.push(dim("    ◦ Task                     PR           CI       Activity"));
```

- [ ] **Step 5: Run tests**

Run: `deno test src/tui_test.ts --allow-env --allow-read --allow-write`
Expected: All tests PASS (existing tests still pass since `ciStatus` is optional)

- [ ] **Step 6: Commit**

```bash
git add src/tui.ts src/tui_test.ts
git commit -m "feat: add CI column to dashboard rendering"
```

---

### Task 6: Wire CI auto-trigger and `t` key into the dashboard loop

**Files:**
- Modify: `src/tui.ts`

- [ ] **Step 1: Import CiManager and detectTestCommand**

Add to `src/tui.ts` imports:

```typescript
import { CiManager, detectTestCommand } from "./ci.ts";
```

- [ ] **Step 2: Initialize CiManager in runDashboard**

In `runDashboard()`, after the `let prevStatuses` line (line 510), add:

```typescript
  const ciManager = new CiManager();
```

- [ ] **Step 3: Add auto-trigger logic in the poll function**

In the `poll` function, after the notifications block (after line 581 `);`), add CI auto-trigger logic:

```typescript
    // Auto-trigger CI on idle/done transitions
    for (const task of tasks) {
      const ts = statuses.get(task.id);
      if (!ts) continue;
      const prev = prevStatuses.get(task.id);
      if (prev !== ts.status && (ts.status === "idle" || ts.status === "done")) {
        // Detect or use cached test command
        let testCmd = ciManager.getCachedCommand(task.repo);
        if (testCmd === undefined) {
          testCmd = await detectTestCommand(task.worktreePath);
          ciManager.cacheCommand(task.repo, testCmd);
        }
        if (testCmd) {
          ciManager.trigger(task.id, testCmd, task.worktreePath);
        }
      }
    }
```

- [ ] **Step 4: Pass ciStatus to renderTaskLine in renderDashboard call**

In the `poll` function, update the `renderDashboard` call to pass `ciManager`:

First, update the `renderDashboard` function signature to accept a `getCiStatus` callback:

```typescript
export function renderDashboard(
  tasks: Task[],
  statuses: Map<string, TaskStatus>,
  selectedIndex: number,
  showAll: boolean,
  staleThresholdHours: number,
  waitingSince: Record<string, string>,
  prCache: Record<string, PrInfo>,
  getCiStatus?: (taskId: string) => CiStatus,
): string {
```

In the `renderDashboard` loop where `renderTaskLine` is called (line 144), update to pass CI status:

```typescript
    const ci = getCiStatus ? getCiStatus(task.id) : null;
    lines.push(renderTaskLine(task, status, i === selectedIndex, multiRepo, prInfo, depth, ci));
```

Then in the `poll` function, update the `renderDashboard` call to pass the CI getter:

```typescript
    const render = renderDashboard(
      tasks,
      statuses,
      selectedIndex,
      showAll,
      config.staleThresholdHours,
      state.waitingSince ?? {},
      state.prCache ?? {},
      (taskId) => ciManager.getStatus(taskId),
    );
```

- [ ] **Step 5: Add `t` key handler**

In the key handling section, add the `t` key handler after the `e` key handler block (after line 946):

```typescript
        if (key.key === "t" && selectedTask) {
          let testCmd = ciManager.getCachedCommand(selectedTask.repo);
          if (testCmd === undefined) {
            testCmd = await detectTestCommand(selectedTask.worktreePath);
            ciManager.cacheCommand(selectedTask.repo, testCmd);
          }
          if (testCmd) {
            ciManager.trigger(selectedTask.id, testCmd, selectedTask.worktreePath);
          } else {
            // No test command detected — prompt user
            clearInterval(pollTimer);
            disableRawMode();
            write(showCursor());

            const cmd = await clack.text({
              message: `No test command detected for ${selectedTask.repo}. Enter test command:`,
              placeholder: "npm test",
            });

            if (!clack.isCancel(cmd) && cmd) {
              const testCommand = (cmd as string).trim();
              ciManager.cacheCommand(selectedTask.repo, testCommand);
              // Save to config
              const repoEntry = Object.entries(config.repos).find(([_, rc]) =>
                repoNameFromUrl(rc.url) === selectedTask.repo
              );
              if (repoEntry) {
                repoEntry[1].testCommand = testCommand;
                await saveConfig(config);
              }
              ciManager.trigger(selectedTask.id, testCommand, selectedTask.worktreePath);
            }

            enableRawMode();
            write(hideCursor());
            pollTimer = setInterval(poll, POLL_INTERVAL_MS);
            lastRender = "";
          }
          await poll();
          continue;
        }
```

- [ ] **Step 6: Update help text**

In `showHelp()` (line 381), add `t` to the help and update the bottom bar:

After the `e` editor line, add:

```typescript
  console.log("  t              Run tests");
```

Update the bottom bar (line 155):

```typescript
  lines.push(dim("  n:new  s:stack  i:import  p:pr  t:test  d:close  r:restart  e:editor  ?:help  q:quit"));
```

- [ ] **Step 7: Check for saved testCommand in auto-trigger**

In the auto-trigger logic added in Step 3, before the `detectTestCommand` call, check if the repo has a saved `testCommand` in config. Update the auto-trigger block:

```typescript
    // Auto-trigger CI on idle/done transitions
    for (const task of tasks) {
      const ts = statuses.get(task.id);
      if (!ts) continue;
      const prev = prevStatuses.get(task.id);
      if (prev !== ts.status && (ts.status === "idle" || ts.status === "done")) {
        let testCmd = ciManager.getCachedCommand(task.repo);
        if (testCmd === undefined) {
          // Check config first
          const repoEntry = Object.entries(config.repos).find(([_, rc]) =>
            repoNameFromUrl(rc.url) === task.repo
          );
          testCmd = repoEntry?.[1].testCommand ?? await detectTestCommand(task.worktreePath);
          ciManager.cacheCommand(task.repo, testCmd);
        }
        if (testCmd) {
          ciManager.trigger(task.id, testCmd, task.worktreePath);
        }
      }
    }
```

- [ ] **Step 8: Run all tests**

Run: `deno test --allow-env --allow-read --allow-write --allow-run`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/tui.ts
git commit -m "feat: wire CI auto-trigger and t key into dashboard"
```

---

### Task 7: PR guidelines detection

**Files:**
- Modify: `src/pr.ts`
- Modify: `src/pr_test.ts`

- [ ] **Step 1: Write failing tests for detectPrGuidelines**

Add to `src/pr_test.ts`:

```typescript
import { join } from "@std/path";
import { detectPrGuidelines } from "./pr.ts";

Deno.test("detectPrGuidelines finds PR template", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, ".github"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".github", "pull_request_template.md"),
    "## What\n\n## Why\n\n## Testing\n",
  );
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.template !== undefined, true);
  assertEquals(guidelines.template!.includes("## What"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines finds CONTRIBUTING.md", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "CONTRIBUTING.md"), "# Contributing\nPlease include tests.");
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.guidelines !== undefined, true);
  assertEquals(guidelines.guidelines!.includes("include tests"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines finds CLAUDE.md", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "CLAUDE.md"), "PR titles must be lowercase.");
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.guidelines !== undefined, true);
  assertEquals(guidelines.guidelines!.includes("lowercase"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines returns empty for bare dir", async () => {
  const dir = await Deno.makeTempDir();
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.template, undefined);
  assertEquals(guidelines.guidelines, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines finds rules with PR mention", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, ".claude", "rules"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".claude", "rules", "pr-process.md"),
    "When creating a PR, always include a test plan.",
  );
  // Also write a non-PR rule that should be ignored
  await Deno.writeTextFile(
    join(dir, ".claude", "rules", "coding-style.md"),
    "Use 2-space indentation.",
  );
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.guidelines !== undefined, true);
  assertEquals(guidelines.guidelines!.includes("test plan"), true);
  assertEquals(guidelines.guidelines!.includes("indentation"), false);
  await Deno.remove(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test src/pr_test.ts --allow-env --allow-read --allow-write`
Expected: FAIL — `detectPrGuidelines` not found

- [ ] **Step 3: Implement detectPrGuidelines**

Add to `src/pr.ts`:

```typescript
import { join } from "@std/path";

export interface PrGuidelines {
  template?: string;
  guidelines?: string;
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

export async function detectPrGuidelines(worktreePath: string): Promise<PrGuidelines> {
  const result: PrGuidelines = {};

  // 1. Check for PR template
  const templatePaths = [
    join(worktreePath, ".github", "pull_request_template.md"),
    join(worktreePath, ".github", "PULL_REQUEST_TEMPLATE.md"),
  ];

  for (const p of templatePaths) {
    const content = await readFileIfExists(p);
    if (content) {
      result.template = content;
      break;
    }
  }

  // Also check PULL_REQUEST_TEMPLATE directory
  if (!result.template) {
    const templateDir = join(worktreePath, ".github", "PULL_REQUEST_TEMPLATE");
    try {
      const entries: string[] = [];
      for await (const entry of Deno.readDir(templateDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const content = await Deno.readTextFile(join(templateDir, entry.name));
          entries.push(content);
        }
      }
      if (entries.length > 0) {
        result.template = entries.join("\n\n---\n\n");
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  // 2. Collect guidelines from various sources
  const guidelineParts: string[] = [];

  const contributingContent = await readFileIfExists(join(worktreePath, "CONTRIBUTING.md"));
  if (contributingContent) guidelineParts.push(contributingContent);

  const claudeContent = await readFileIfExists(join(worktreePath, "CLAUDE.md"));
  if (claudeContent) guidelineParts.push(claudeContent);

  const agentsContent = await readFileIfExists(join(worktreePath, "AGENTS.md"));
  if (agentsContent) guidelineParts.push(agentsContent);

  // 3. Check .claude/rules/ for PR-related rules
  const rulesDir = join(worktreePath, ".claude", "rules");
  try {
    for await (const entry of Deno.readDir(rulesDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        const content = await Deno.readTextFile(join(rulesDir, entry.name));
        if (/\bPR\b|pull request/i.test(content)) {
          guidelineParts.push(content);
        }
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }

  if (guidelineParts.length > 0) {
    result.guidelines = guidelineParts.join("\n\n");
  }

  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `deno test src/pr_test.ts --allow-env --allow-read --allow-write`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pr.ts src/pr_test.ts
git commit -m "feat: add PR guidelines detection from repo files"
```

---

### Task 8: Integrate guidelines into PR body generation

**Files:**
- Modify: `src/pr.ts`
- Modify: `src/pr_test.ts`

- [ ] **Step 1: Write failing tests for generatePrBody with guidelines**

Add to `src/pr_test.ts`:

```typescript
Deno.test("generatePrBody uses template when provided", () => {
  const template = "## What\n\n## Why\n\n## Testing\n";
  const body = generatePrBody(
    "- add auth\n- add tests",
    " src/auth.ts | 50 +++\n 1 file changed",
    { template },
  );
  assertEquals(body.includes("## What"), true);
  assertEquals(body.includes("add auth"), true);
  // Should NOT use default Summary header when template is provided
  assertEquals(body.includes("## Summary"), false);
});

Deno.test("generatePrBody appends guidelines when provided", () => {
  const body = generatePrBody(
    "- fix bug",
    " src/fix.ts | 5 +\n 1 file changed",
    { guidelines: "Always include a test plan in PRs." },
  );
  // Default format still used
  assertEquals(body.includes("## Summary"), true);
  assertEquals(body.includes("## Guidelines"), true);
  assertEquals(body.includes("test plan"), true);
});

Deno.test("generatePrBody works with both template and guidelines", () => {
  const body = generatePrBody(
    "- refactor",
    " src/main.ts | 10 +\n 1 file changed",
    { template: "## Description\n\n## Testing\n", guidelines: "Keep PRs small." },
  );
  assertEquals(body.includes("## Description"), true);
  assertEquals(body.includes("## Guidelines"), true);
  assertEquals(body.includes("Keep PRs small"), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test src/pr_test.ts --allow-env --allow-read --allow-write`
Expected: FAIL — `generatePrBody` doesn't accept `PrGuidelines` parameter

- [ ] **Step 3: Update generatePrBody to accept and use guidelines**

Update the `generatePrBody` signature and implementation in `src/pr.ts`:

```typescript
export function generatePrBody(
  commitLog: string,
  diffStat: string,
  guidelines?: PrGuidelines,
): string {
  const lines: string[] = [];

  if (guidelines?.template) {
    // Use the repo's PR template as the structure
    lines.push(guidelines.template);
    lines.push("");
    lines.push("## Commits");
    lines.push("");
    for (const line of commitLog.split("\n")) {
      const trimmed = line.trim();
      if (
        trimmed && !trimmed.startsWith("commit ") && !trimmed.startsWith("Author:") &&
        !trimmed.startsWith("Date:")
      ) {
        lines.push(`- ${trimmed.replace(/^- /, "")}`);
      }
    }
    lines.push("");
    lines.push("## Files Changed");
    lines.push("");
    lines.push("```");
    lines.push(diffStat.trim());
    lines.push("```");
  } else {
    // Default format
    lines.push("## Summary");
    lines.push("");
    for (const line of commitLog.split("\n")) {
      const trimmed = line.trim();
      if (
        trimmed && !trimmed.startsWith("commit ") && !trimmed.startsWith("Author:") &&
        !trimmed.startsWith("Date:")
      ) {
        lines.push(`- ${trimmed.replace(/^- /, "")}`);
      }
    }

    lines.push("");
    lines.push("## Files Changed");
    lines.push("");
    lines.push("```");
    lines.push(diffStat.trim());
    lines.push("```");

    lines.push("");
    lines.push("## Test Notes");
    lines.push("");
    lines.push("_Describe how to test these changes._");
  }

  if (guidelines?.guidelines) {
    lines.push("");
    lines.push("## Guidelines");
    lines.push("");
    lines.push(guidelines.guidelines);
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Update createPr to detect and pass guidelines**

In the `createPr` function, after gathering commit log and diff stat, add guidelines detection:

```typescript
  // Detect repo PR guidelines
  const guidelines = await detectPrGuidelines(task.worktreePath);

  const title = generatePrTitle(task.branch, branchPrefix);
  const body = generatePrBody(commitLog, diffStat, guidelines);
```

- [ ] **Step 5: Run all tests**

Run: `deno test --allow-env --allow-read --allow-write --allow-run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/pr.ts src/pr_test.ts
git commit -m "feat: integrate PR guidelines into body generation"
```

---

### Task 9: Final integration test and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `deno test --allow-env --allow-read --allow-write --allow-run`
Expected: All tests PASS

- [ ] **Step 2: Run type check**

Run: `deno check src/tui.ts src/ci.ts src/pr.ts`
Expected: No type errors

- [ ] **Step 3: Verify the compile still works**

Run: `deno compile --allow-env --allow-read --allow-write --allow-run --allow-net cli.ts --output /tmp/hive-test`
Expected: Compiles successfully

- [ ] **Step 4: Commit any final fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: address integration issues"
```
