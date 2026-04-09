// src/git.ts — bare clone, worktree, and fetch management

import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
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

export async function deleteBranch(bareDir: string, branch: string): Promise<void> {
  // Delete local branch ref
  await run(["git", "branch", "-D", branch], { cwd: bareDir }).catch(() => {});
  // Delete remote branch
  await run(["git", "push", "origin", "--delete", branch], { cwd: bareDir }).catch(() => {});
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

// In-flight provisioning promises for deduplication
const provisioningLocks = new Map<string, Promise<void>>();

export async function hasReadyWorktree(readyPath: string): Promise<boolean> {
  return await exists(readyPath);
}

export async function ensureReadyWorktree(
  bareDir: string,
  readyPath: string,
  defaultBranch: string,
): Promise<void> {
  // Already exists on disk
  if (await hasReadyWorktree(readyPath)) return;

  // Already being provisioned — await the in-flight promise
  const existing = provisioningLocks.get(readyPath);
  if (existing) {
    await existing;
    return;
  }

  const provision = (async () => {
    try {
      await ensureDir(dirname(readyPath));
      await runOk(
        ["git", "worktree", "add", "--detach", readyPath, `origin/${defaultBranch}`],
        { cwd: bareDir },
      );
      await log.info("Provisioned ready worktree", { readyPath });
    } finally {
      provisioningLocks.delete(readyPath);
    }
  })();

  provisioningLocks.set(readyPath, provision);
  await provision;
}

export async function consumeReadyWorktree(
  bareDir: string,
  readyPath: string,
  targetPath: string,
  branch: string,
  baseRef: string,
): Promise<void> {
  // Await any in-flight provisioning
  const inflight = provisioningLocks.get(readyPath);
  if (inflight) await inflight;

  if (!(await hasReadyWorktree(readyPath))) {
    throw new Error("No ready worktree to consume");
  }

  await ensureDir(dirname(targetPath));

  // Move the worktree
  await runOk(["git", "worktree", "move", readyPath, targetPath], { cwd: bareDir });

  // Create branch and reset to base
  const checkoutResult = await run(
    ["git", "checkout", "-b", branch],
    { cwd: targetPath },
  );
  if (!checkoutResult.success) {
    // Branch already exists — check it out and reset
    await runOk(["git", "checkout", branch], { cwd: targetPath });
  }
  await runOk(["git", "reset", "--hard", baseRef], { cwd: targetPath });

  await log.info("Consumed ready worktree", { branch, targetPath });
}

export async function refreshReadyWorktree(
  readyPath: string,
  defaultBranch: string,
): Promise<void> {
  if (!(await hasReadyWorktree(readyPath))) return;
  await runOk(["git", "reset", "--hard", `origin/${defaultBranch}`], { cwd: readyPath });
  await log.debug("Refreshed ready worktree", { readyPath });
}

export interface ScannedRepo {
  name: string;
  path: string;
  url: string;
  defaultBranch: string;
}

export async function scanDirectory(dir: string): Promise<ScannedRepo[]> {
  const repos: ScannedRepo[] = [];

  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isDirectory) continue;
    const entryPath = `${dir}/${entry.name}`;
    const gitDir = `${entryPath}/.git`;

    if (!(await exists(gitDir))) continue;

    // Read remote URL
    const urlResult = await run(
      ["git", "config", "--get", "remote.origin.url"],
      { cwd: entryPath },
    );
    if (!urlResult.success || !urlResult.stdout) continue;

    // Detect default branch
    const headResult = await run(
      ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd: entryPath },
    );
    let defaultBranch = "main";
    if (headResult.success && headResult.stdout) {
      // "refs/remotes/origin/main" -> "main"
      defaultBranch = headResult.stdout.replace("refs/remotes/origin/", "");
    }

    repos.push({
      name: entry.name,
      path: entryPath,
      url: urlResult.stdout,
      defaultBranch,
    });
  }

  return repos;
}
