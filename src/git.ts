// src/git.ts — bare clone, worktree, and fetch management

import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.224.0/path/mod.ts";
import { run, runOk } from "./run.ts";
import { log } from "./log.ts";

// Per-repo fetch lock: serializes concurrent fetches to avoid git ref lock contention
const fetchLocks = new Map<string, Promise<void>>();

function withFetchLock(repoPath: string, fn: () => Promise<void>): Promise<void> {
  const prev = fetchLocks.get(repoPath) ?? Promise.resolve();
  const next = prev.then(fn, fn); // Run fn regardless of previous success/failure
  fetchLocks.set(repoPath, next);
  return next;
}

export async function ensureBareClone(
  url: string,
  bareDir: string,
  localPath?: string,
): Promise<void> {
  if (await exists(bareDir)) {
    await withFetchLock(bareDir, async () => {
      await runOk(["git", "fetch", "origin"], { cwd: bareDir });
    });
    return;
  }

  await ensureDir(dirname(bareDir));
  const args = ["git", "clone", "--bare"];
  if (localPath) {
    args.push("--reference", localPath, "--dissociate");
  }
  args.push(url, bareDir);
  await runOk(args);
  await ensureRefspec(bareDir);
}

export async function ensureRefspec(bareDir: string): Promise<void> {
  const current = await run(["git", "config", "--get", "remote.origin.fetch"], { cwd: bareDir });
  if (current.stdout !== "+refs/heads/*:refs/remotes/origin/*") {
    await runOk(
      ["git", "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
      { cwd: bareDir },
    );
    await log.debug("Fixed refspec", { bareDir });
  }
}

export async function createWorktree(
  bareDir: string,
  wtPath: string,
  branch: string,
  baseRef: string,
): Promise<void> {
  // Clean up stale worktree path from failed previous attempt
  if (await exists(wtPath)) {
    await log.warn("Removing stale worktree path", { wtPath });
    await run(["git", "worktree", "remove", "--force", wtPath], { cwd: bareDir });
    try {
      await Deno.remove(wtPath, { recursive: true });
    } catch { /* ok */ }
  }

  await ensureDir(dirname(wtPath));

  // Try creating with -b (new branch)
  const result = await run(
    ["git", "worktree", "add", "-b", branch, wtPath, baseRef],
    { cwd: bareDir },
  );

  if (!result.success) {
    // Branch already exists (import flow) — retry without -b
    if (result.stderr.includes("already exists")) {
      await runOk(["git", "worktree", "add", wtPath, branch], { cwd: bareDir });
    } else {
      throw new Error(`git worktree add failed: ${result.stderr}`);
    }
  }
}

export async function removeWorktree(bareDir: string, wtPath: string): Promise<void> {
  await run(["git", "worktree", "remove", "--force", wtPath], { cwd: bareDir });
  // Also prune in case removal left stale refs
  await run(["git", "worktree", "prune"], { cwd: bareDir });
}

export async function fetchBranches(bareDir: string, branches: string[]): Promise<void> {
  await withFetchLock(bareDir, async () => {
    for (const branch of branches) {
      await runOk(
        ["git", "fetch", "origin", `${branch}:refs/remotes/origin/${branch}`],
        { cwd: bareDir },
      );
    }
  });
}

export async function resolveHead(wtPath: string): Promise<string> {
  return await runOk(["git", "rev-parse", "HEAD"], { cwd: wtPath });
}

export async function pushBranch(wtPath: string, branch: string): Promise<void> {
  await runOk(["git", "push", "-u", "origin", branch], { cwd: wtPath });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
