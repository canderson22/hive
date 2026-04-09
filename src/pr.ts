// src/pr.ts — PR creation, viewing, and cache management

import type { PrInfo, State, Task } from "./types.ts";
import { run, runOk } from "./run.ts";
import { saveState } from "./config.ts";
import { log } from "./log.ts";
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

export function generatePrTitle(branch: string, branchPrefix: string): string {
  let name = branch;
  if (branchPrefix && name.startsWith(branchPrefix)) {
    name = name.slice(branchPrefix.length);
  }
  // Convert dashes to spaces, capitalize first letter
  name = name.replace(/-/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

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

  // Check there are actually commits to PR
  if (!commitLog.trim()) {
    throw new Error("No commits to create a PR — the branch has no changes from " + task.baseBranch);
  }

  // Ensure branch is pushed
  await run(["git", "push", "-u", "origin", task.branch], { cwd: task.worktreePath });

  // Detect repo PR guidelines
  const guidelines = await detectPrGuidelines(task.worktreePath);

  const title = generatePrTitle(task.branch, branchPrefix);
  const body = generatePrBody(commitLog, diffStat, guidelines);

  const result = await run(
    [
      "gh",
      "pr",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--base",
      task.baseBranch,
      "--head",
      task.branch,
    ],
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
