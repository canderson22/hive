// src/tasks.ts — task lifecycle: create, restart, close

import type { Config, RepoConfig, State, Task } from "./types.ts";
import { hiveHome, readyWorktreePath, repoNameFromUrl, repoPath, worktreePath } from "./paths.ts";
import {
  consumeReadyWorktree,
  createWorktree,
  ensureBareClone,
  ensureReadyWorktree,
  fetchBranches,
  hasReadyWorktree,
  pushBranch,
  removeWorktree,
} from "./git.ts";
import { createSession, hasSession, killSession } from "./tmux.ts";
import { installHooksConfig, installSignalScript } from "./hooks.ts";
import { removeSignal } from "./monitor.ts";
import { saveState } from "./config.ts";
import { log } from "./log.ts";

export interface CreateTaskOpts {
  name: string;
  repo: string;
  repoConfig: RepoConfig;
  baseBranch?: string;
  program: string;
  branchPrefix: string;
  config: Config;
}

export async function createTask(
  opts: CreateTaskOpts,
  state: State,
): Promise<Task> {
  const repoName = repoNameFromUrl(opts.repoConfig.url);
  const branch = opts.branchPrefix + opts.name;
  const baseBranch = opts.baseBranch ?? opts.repoConfig.defaultBranch;
  const home = hiveHome();

  // 1. Ensure bare clone
  const bare = repoPath(repoName);
  await ensureBareClone(opts.repoConfig.url, bare, opts.repoConfig.localPath);

  // Fetch the base branch if it's not the default
  if (baseBranch !== opts.repoConfig.defaultBranch) {
    await fetchBranches(bare, [baseBranch]);
  }

  // 2. Create worktree (consume ready if available, else create fresh)
  const wtPath = worktreePath(repoName, branch);
  const readyPath = readyWorktreePath(repoName);
  const baseRef = `origin/${baseBranch}`;

  if (await hasReadyWorktree(readyPath)) {
    await consumeReadyWorktree(bare, readyPath, wtPath, branch, baseRef);
  } else {
    await createWorktree(bare, wtPath, branch, baseRef);
  }

  // 3. Push new branch to remote
  try {
    await pushBranch(wtPath, branch);
  } catch (e) {
    await log.warn("Failed to push branch (may not have remote)", {
      error: String(e),
    });
  }

  // 4. Install hooks
  await installSignalScript(home);
  await installHooksConfig(wtPath, `hive-${opts.name}`, home);

  // 5. Create tmux session and launch Claude
  const tmuxSession = `hive-${opts.name}`;
  await createSession(tmuxSession, wtPath, opts.program, {
    mouse: opts.config.tmuxMouse,
    statusBar: opts.config.tmuxStatusBar,
    hiveHome: home,
  });

  // 6. Fire-and-forget ready worktree reprovisioning
  ensureReadyWorktree(bare, readyPath, opts.repoConfig.defaultBranch).catch(
    (e) =>
      log.warn("Background worktree provision failed", {
        error: String(e),
      }),
  );

  // 7. Save task to state
  const task: Task = {
    id: opts.name,
    repo: repoName,
    branch,
    baseBranch,
    worktreePath: wtPath,
    tmuxSession,
    program: opts.program,
    createdAt: new Date().toISOString(),
  };

  state.tasks[task.id] = task;
  state.lastRepo = opts.repo;
  await saveState(state);

  await log.info("Created task", {
    id: task.id,
    branch,
    worktreePath: wtPath,
  });
  return task;
}

export async function restartTask(
  task: Task,
  _state: State,
  config: Config,
): Promise<void> {
  const home = hiveHome();

  // 1. Kill existing tmux session if alive
  if (await hasSession(task.tmuxSession)) {
    await killSession(task.tmuxSession);
  }

  // 2. Remove old signal file
  await removeSignal(task.tmuxSession);

  // 3. Create fresh tmux session in same worktree
  await createSession(task.tmuxSession, task.worktreePath, task.program, {
    mouse: config.tmuxMouse,
    statusBar: config.tmuxStatusBar,
    hiveHome: home,
  });

  await log.info("Restarted task", { id: task.id });
}

export async function closeTask(
  task: Task,
  state: State,
  config: Config,
): Promise<void> {
  // 1. Kill tmux session
  if (await hasSession(task.tmuxSession)) {
    await killSession(task.tmuxSession);
  }

  // 2. Remove signal file
  await removeSignal(task.tmuxSession);

  // 3. Remove worktree
  const bare = repoPath(task.repo);
  try {
    await removeWorktree(bare, task.worktreePath);
  } catch (e) {
    await log.warn("Failed to remove worktree", { error: String(e) });
  }

  // 4. Delete task from state
  delete state.tasks[task.id];
  delete state.waitingSince?.[task.id];
  await saveState(state);

  // 5. Fire-and-forget ready worktree reprovisioning
  const repoConfig = Object.values(config.repos).find((_rc) => {
    return repoNameFromUrl(_rc.url) === task.repo;
  });
  if (repoConfig) {
    const readyPath = readyWorktreePath(task.repo);
    ensureReadyWorktree(bare, readyPath, repoConfig.defaultBranch).catch(
      (e) =>
        log.warn("Background worktree provision failed", {
          error: String(e),
        }),
    );
  }

  await log.info("Closed task", { id: task.id });
}

export async function openEditor(
  task: Task,
  editor: string,
): Promise<void> {
  const cmd = new Deno.Command(editor, {
    args: [task.worktreePath],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  child.unref();
  await log.info("Opened editor", { editor, path: task.worktreePath });
}
