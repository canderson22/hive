// src/background.ts — background fetch and ready worktree maintenance

import type { Config } from "./types.ts";
import { repoPath, readyWorktreePath, repoNameFromUrl } from "./paths.ts";
import { ensureBareClone, ensureReadyWorktree, refreshReadyWorktree } from "./git.ts";
import { log } from "./log.ts";

const FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startBackgroundFetch(config: Config): { stop: () => void } {
  let timer: number;

  const doFetch = async () => {
    for (const [_name, repoConfig] of Object.entries(config.repos)) {
      try {
        const repoName = repoNameFromUrl(repoConfig.url);
        const bare = repoPath(repoName);

        // Ensure bare clone exists and fetch
        await ensureBareClone(repoConfig.url, bare, repoConfig.localPath);

        // Refresh or provision ready worktree
        const readyPath = readyWorktreePath(repoName);
        await refreshReadyWorktree(readyPath, repoConfig.defaultBranch);
        await ensureReadyWorktree(bare, readyPath, repoConfig.defaultBranch);
      } catch (e) {
        await log.warn("Background fetch failed", { repo: _name, error: String(e) });
      }
    }
  };

  // Run immediately on startup
  doFetch().catch((e) => log.error("Initial background fetch failed", { error: String(e) }));

  // Then every 15 minutes
  timer = setInterval(() => {
    doFetch().catch((e) => log.error("Background fetch failed", { error: String(e) }));
  }, FETCH_INTERVAL_MS);

  return {
    stop: () => clearInterval(timer),
  };
}
