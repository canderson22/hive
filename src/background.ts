// src/background.ts — background fetch and ready worktree maintenance

import type { Config, State } from "./types.ts";
import { readyWorktreePath, repoNameFromUrl, repoPath } from "./paths.ts";
import { ensureBareClone, ensureReadyWorktree, refreshReadyWorktree } from "./git.ts";
import { refreshPrCache } from "./pr.ts";
import { saveState } from "./config.ts";
import { log } from "./log.ts";

const GIT_FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PR_REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export function startBackgroundFetch(
  config: Config,
  state: State,
): { stop: () => void; refreshPrs: () => Promise<void> } {
  const doGitFetch = async () => {
    for (const [_name, repoConfig] of Object.entries(config.repos)) {
      try {
        const repoName = repoNameFromUrl(repoConfig.url);
        const bare = repoPath(repoName);

        await ensureBareClone(repoConfig.url, bare, repoConfig.localPath);

        const readyPath = readyWorktreePath(repoName);
        await refreshReadyWorktree(readyPath, repoConfig.defaultBranch);
        await ensureReadyWorktree(bare, readyPath, repoConfig.defaultBranch);
      } catch (e) {
        await log.warn("Background fetch failed", { repo: _name, error: String(e) });
      }
    }
  };

  const doPrRefresh = async () => {
    try {
      const tasks = Object.values(state.tasks);
      if (tasks.length > 0) {
        await refreshPrCache(tasks, state);
        await saveState(state);
      }
    } catch (e) {
      await log.warn("PR cache refresh failed", { error: String(e) });
    }
  };

  // Run both on startup
  doGitFetch().catch((e) => log.error("Initial background fetch failed", { error: String(e) }));
  doPrRefresh().catch((e) => log.error("Initial PR refresh failed", { error: String(e) }));

  // Git fetch every 15 minutes
  const gitTimer = setInterval(() => {
    doGitFetch().catch((e) => log.error("Background fetch failed", { error: String(e) }));
  }, GIT_FETCH_INTERVAL_MS);

  // PR refresh every 2 minutes
  const prTimer = setInterval(() => {
    doPrRefresh().catch((e) => log.error("PR refresh failed", { error: String(e) }));
  }, PR_REFRESH_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(gitTimer);
      clearInterval(prTimer);
    },
    refreshPrs: doPrRefresh,
  };
}
