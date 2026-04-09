// src/ci.ts — test command detection and CI execution

import { join } from "@std/path";
import type { CiStatus } from "./types.ts";

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
