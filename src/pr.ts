// src/pr.ts — PR creation, viewing, and cache management

import type { PrInfo, State, Task } from "./types.ts";
import { run, runOk } from "./run.ts";
import { saveState } from "./config.ts";
import { log } from "./log.ts";

export function generatePrTitle(branch: string, branchPrefix: string): string {
  let name = branch;
  if (branchPrefix && name.startsWith(branchPrefix)) {
    name = name.slice(branchPrefix.length);
  }
  // Convert dashes to spaces, capitalize first letter
  name = name.replace(/-/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function generatePrBody(commitLog: string, diffStat: string): string {
  const lines: string[] = [];

  lines.push("## Summary");
  lines.push("");
  for (const line of commitLog.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("commit ") && !trimmed.startsWith("Author:") && !trimmed.startsWith("Date:")) {
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

  return lines.join("\n");
}

export async function createPr(
  task: Task,
  branchPrefix: string,
  state: State,
): Promise<PrInfo | null> {
  // Gather context from git
  const commitLog = await runOk(
    ["git", "log", `origin/${task.baseBranch}..HEAD`, "--pretty=format:%s"],
    { cwd: task.worktreePath },
  ).catch(() => "");

  const diffStat = await runOk(
    ["git", "diff", `origin/${task.baseBranch}..HEAD`, "--stat"],
    { cwd: task.worktreePath },
  ).catch(() => "");

  // Ensure branch is pushed
  await run(["git", "push", "-u", "origin", task.branch], { cwd: task.worktreePath });

  const title = generatePrTitle(task.branch, branchPrefix);
  const body = generatePrBody(commitLog, diffStat);

  const result = await run(
    ["gh", "pr", "create", "--title", title, "--body", body, "--base", task.baseBranch, "--head", task.branch],
    { cwd: task.worktreePath },
  );

  if (!result.success) {
    // PR might already exist
    if (result.stderr.includes("already exists")) {
      return await getPrInfo(task);
    }
    throw new Error(`Failed to create PR: ${result.stderr}`);
  }

  // Parse PR URL from output to get number
  const prInfo = await getPrInfo(task);
  if (prInfo) {
    const cacheKey = `${task.repo}:${task.branch}`;
    state.prCache = state.prCache ?? {};
    state.prCache[cacheKey] = prInfo;
    await saveState(state);
  }

  await log.info("Created PR", { task: task.id, pr: prInfo?.number });
  return prInfo;
}

export async function getPrInfo(task: Task): Promise<PrInfo | null> {
  const result = await run(
    ["gh", "pr", "view", task.branch, "--json", "number,state,url"],
    { cwd: task.worktreePath },
  );

  if (!result.success) return null;

  try {
    const data = JSON.parse(result.stdout);
    return {
      number: data.number,
      state: data.state.toLowerCase(),
      url: data.url,
    };
  } catch {
    return null;
  }
}

export async function openPrInBrowser(task: Task): Promise<void> {
  await run(["gh", "pr", "view", task.branch, "--web"], { cwd: task.worktreePath });
}

export async function refreshPrCache(
  tasks: Task[],
  state: State,
): Promise<void> {
  state.prCache = state.prCache ?? {};
  for (const task of tasks) {
    const cacheKey = `${task.repo}:${task.branch}`;
    const info = await getPrInfo(task);
    if (info) {
      state.prCache[cacheKey] = info;
    }
  }
}
