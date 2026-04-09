# CI Column & PR Guidelines Detection

## Overview

Two features for the Hive dashboard:
1. **CI column** — automatically run tests when a task goes idle/done, display pass/fail in the dashboard
2. **PR guidelines** — detect repo-specific PR templates and guidelines, inject them into PR body generation

## Feature 1: CI Column

### Trigger

When `pollTask()` detects a task transitioning to `"idle"` or `"done"` status, Hive kicks off a test run in that task's worktree. Additionally, the user can press `t` to manually trigger tests for the selected task.

Tests should only auto-trigger once per status transition — not on every poll cycle that sees idle/done.

### Test Command Detection

Auto-detect the test command by scanning the worktree root in this order:

1. `deno.json` or `deno.jsonc` exists → `deno test`
2. `package.json` exists with a `"test"` script in `"scripts"` → `npm test`
3. `Makefile` exists with a `test` target → `make test`
4. `pytest.ini`, `pyproject.toml`, or `setup.py` exists → `pytest`
5. If none matched → prompt the user for a test command, store it as `testCommand` in the repo config

Cache the detected command per-repo so detection only runs once.

### Execution

- Run the test command as a background subprocess with `cwd` set to `task.worktreePath`
- Do NOT run inside the tmux session — this is Hive's own process
- Capture the exit code: 0 = passed, non-zero = failed
- Set a reasonable timeout (5 minutes default) to avoid hung test processes
- If a new test run is triggered while one is already running, kill the old one

### State

Add to types:

```typescript
type CiStatus = "passed" | "failed" | "running" | null;
```

Store CI status per-task. Options:
- In-memory map (simplest, resets on restart) — preferred since CI status is transient
- Could persist to state.json if we want status to survive restarts, but probably not worth it

Also store the detected test command per-repo in config:

```typescript
interface RepoConfig {
  url: string;
  defaultBranch: string;
  localPath?: string;
  testCommand?: string; // Added: cached or user-provided test command
}
```

### Dashboard Display

New `CI` column between `PR` and `Activity`:

```
  ◦ Task                     PR           CI       Activity
  > feature-auth             #42 open     Passed   Read src/auth.ts
    fix-login                —            Failed   —
    refactor-db              #38 draft    Running  —
    new-feature              —            —        Writing tests
```

- `Passed` — green
- `Failed` — red
- `Running` — yellow
- `—` — dim (no tests run yet)

Column width: 8 characters.

### Key Binding

`t` — run tests for the currently selected task. Works regardless of task status.

## Feature 2: PR Guidelines Detection

### When

During `createPr()` in `src/pr.ts`, before generating the PR title and body.

### Files to Scan

Scan the task's worktree for these files, in priority order:

1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE/*.md` (all files in directory)
3. `CONTRIBUTING.md`
4. `CLAUDE.md`
5. `AGENTS.md`
6. `.claude/rules/*.md` — only files containing "PR" or "pull request" (case-insensitive)

### Behavior

If a PR template is found (option 1 or 2), use it as the structure for the PR body instead of Hive's stock template. Fill in sections with commit log and diff stat data.

If contributing guidelines or agent rules are found (options 3-6), append their relevant content as context that shapes the PR — e.g., required sections, naming conventions, review checklists.

### Implementation

Create a `detectPrGuidelines(worktreePath: string)` function that returns:

```typescript
interface PrGuidelines {
  template?: string;    // Content of PR template file
  guidelines?: string;  // Aggregated content from CONTRIBUTING, CLAUDE.md, rules
}
```

Modify `generatePrBody()` to accept optional `PrGuidelines` and use the template when available, falling back to the current stock format.

## Files Changed

- **New: `src/ci.ts`** — test command detection, test execution, CI status management
- **Modify: `src/types.ts`** — add `CiStatus` type, `testCommand` to `RepoConfig`
- **Modify: `src/tui.ts`** — add CI column to `renderDashboard`, `renderTaskLine`; add `t` key handler; trigger tests on status transition
- **Modify: `src/pr.ts`** — add `detectPrGuidelines()`, modify `generatePrBody()` to use templates
- **Modify: `src/ansi.ts`** — add CI status color helper if needed
- **Modify: `src/config.ts`** — handle `testCommand` in repo config
