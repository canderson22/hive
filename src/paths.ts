// src/paths.ts — path constants for ~/.hive/ directory structure

import { join } from "@std/path";

export function hiveHome(): string {
  return Deno.env.get("HIVE_HOME") ?? join(homeDir(), ".hive");
}

function homeDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME environment variable not set");
  return home;
}

export function configPath(): string {
  return join(hiveHome(), "config.json");
}

export function statePath(): string {
  return join(hiveHome(), "state.json");
}

export function logPath(): string {
  return join(hiveHome(), "hive.log");
}

export function reposDir(): string {
  return join(hiveHome(), "repos");
}

export function worktreesDir(): string {
  return join(hiveHome(), "worktrees");
}

export function signalsDir(): string {
  return join(hiveHome(), "signals");
}

export function hooksDir(): string {
  return join(hiveHome(), "hooks");
}

export function sessionsDir(): string {
  return join(hiveHome(), "sessions");
}

export function repoPath(repoName: string): string {
  return join(reposDir(), `${repoName}.git`);
}

export function worktreePath(repoName: string, branch: string): string {
  return join(worktreesDir(), repoName, branch);
}

export function readyWorktreePath(repoName: string): string {
  return join(worktreesDir(), repoName, "_ready");
}

export function signalPath(sessionName: string): string {
  return join(signalsDir(), sessionName);
}

export function hookScriptPath(): string {
  return join(hooksDir(), "hive-signal");
}

export function repoNameFromUrl(url: string): string {
  // "https://github.com/org/repo.git" -> "org-repo"
  // "git@github.com:org/repo.git" -> "org-repo"
  const match = url.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot parse repo name from URL: ${url}`);
  return `${match[1]}-${match[2]}`;
}
