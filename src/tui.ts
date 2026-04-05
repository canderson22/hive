// src/tui.ts — dashboard rendering, key dispatch, dialog flows

import * as clack from "@clack/prompts";
import type { Config, PrInfo, State, Status, Task, TaskStatus } from "./types.ts";
import { pollAll } from "./monitor.ts";
import { attachSession, hasSession } from "./tmux.ts";
import { closeTask, createTask, importTask, openEditor, restartTask } from "./tasks.ts";
import { createPr, openPrInBrowser } from "./pr.ts";
import { repoNameFromUrl } from "./paths.ts";
import { scanDirectory } from "./git.ts";
import { run } from "./run.ts";
import { DEFAULT_CONFIG, loadConfig, loadState, saveConfig } from "./config.ts";
import { disableRawMode, enableRawMode, readKey } from "./keypress.ts";
import {
  bold,
  clearScreen,
  dim,
  hideCursor,
  setTitle,
  showCursor,
  statusColor,
  statusIcon,
  stripAnsi,
} from "./ansi.ts";
import { log } from "./log.ts";
import { startBackgroundFetch } from "./background.ts";

const POLL_INTERVAL_MS = 1500;

// --- Rendering (exported for testing) ---

export function renderTaskLine(
  task: Task,
  status: TaskStatus,
  selected: boolean,
  multiRepo: boolean,
  prInfo?: PrInfo,
  depth?: number,
): string {
  const cursor = selected ? ">" : " ";
  const icon = statusColor(status.status, statusIcon(status.status));

  const indent = depth && depth > 0 ? "  ".repeat(depth) + "└ " : "";

  const displayName = multiRepo && task.repoDisplayName
    ? `${task.repoDisplayName}/${task.id}`
    : task.id;
  const name = selected ? bold(indent + displayName) : indent + displayName;

  const pr = prInfo ? dim(` #${prInfo.number} ${prInfo.state}`) : "";
  const snippet = status.snippet ? dim(status.snippet) : "";

  const nameWithPr = name + pr;
  const paddedName = nameWithPr + " ".repeat(Math.max(0, 30 - stripAnsi(nameWithPr).length));

  return `${cursor} ${icon} ${paddedName} ${snippet}`;
}

export function formatTitle(statuses: Map<string, TaskStatus>): string {
  if (statuses.size === 0) return "hive";

  const counts: Partial<Record<Status, number>> = {};
  for (const { status } of statuses.values()) {
    counts[status] = (counts[status] ?? 0) + 1;
  }

  const parts: string[] = [];
  const order: Status[] = ["waiting", "blocked", "working", "done", "idle", "stopped"];
  for (const s of order) {
    if (counts[s]) parts.push(`${counts[s]} ${s}`);
  }

  return parts.length > 0 ? `hive: ${parts.join(", ")}` : "hive";
}

export function renderDashboard(
  tasks: Task[],
  statuses: Map<string, TaskStatus>,
  selectedIndex: number,
  showAll: boolean,
  staleThresholdHours: number,
  waitingSince: Record<string, string>,
  prCache: Record<string, PrInfo>,
): string {
  const lines: string[] = [];
  const now = Date.now();

  // Split into fresh and stale
  const fresh: Task[] = [];
  const stale: Task[] = [];

  for (const task of tasks) {
    const since = waitingSince[task.id];
    if (since) {
      const hours = (now - new Date(since).getTime()) / (1000 * 60 * 60);
      if (hours > staleThresholdHours) {
        stale.push(task);
        continue;
      }
    }
    fresh.push(task);
  }

  const visibleTasks = showAll ? tasks : fresh;
  const multiRepo = new Set(visibleTasks.map((t) => t.repo)).size > 1;

  lines.push("");
  lines.push(
    bold("  hive") + dim(` — ${visibleTasks.length} task${visibleTasks.length === 1 ? "" : "s"}`),
  );
  lines.push("");

  if (visibleTasks.length === 0) {
    lines.push(dim("  No tasks. Press n to create one."));
    lines.push("");
  } else {
    lines.push(dim("    ◦ Task                     Activity"));
    lines.push("");
  }

  // Compute depth for stacked task indentation
  const taskByBranch = new Map<string, Task>();
  for (const task of visibleTasks) {
    taskByBranch.set(task.branch, task);
  }
  const getDepth = (task: Task): number => {
    let depth = 0;
    let current = task;
    while (taskByBranch.has(current.baseBranch)) {
      depth++;
      current = taskByBranch.get(current.baseBranch)!;
    }
    return depth;
  };

  for (let i = 0; i < visibleTasks.length; i++) {
    const task = visibleTasks[i];
    const status = statuses.get(task.id) ?? { status: "stopped" as Status, snippet: "" };
    const cacheKey = `${task.repo}:${task.branch}`;
    const prInfo = prCache[cacheKey];
    const depth = getDepth(task);
    lines.push(renderTaskLine(task, status, i === selectedIndex, multiRepo, prInfo, depth));
  }

  if (!showAll && stale.length > 0) {
    lines.push("");
    lines.push(
      dim(`  ${stale.length} stale task${stale.length === 1 ? "" : "s"} hidden (press a to show)`),
    );
  }

  lines.push("");
  lines.push(dim("  n:new  s:stack  i:import  p:pr  d:close  r:restart  e:editor  ?:help  q:quit"));
  lines.push("");

  return lines.join("\n");
}

// --- Dialog Flows ---

async function newTaskDialog(config: Config, state: State): Promise<void> {
  const repos = Object.entries(config.repos);
  if (repos.length === 0) {
    clack.log.error("No repos configured. Press c to add one.");
    await new Promise((r) => setTimeout(r, 1500));
    return;
  }

  let repoKey: string;
  if (repos.length === 1) {
    repoKey = repos[0][0];
  } else {
    const selected = await clack.select({
      message: "Repo",
      options: repos.map(([key, rc]) => ({ value: key, label: `${key} (${rc.url})` })),
      initialValue: state.lastRepo ?? repos[0][0],
    });
    if (clack.isCancel(selected)) return;
    repoKey = selected as string;
  }

  const name = await clack.text({
    message: "Task name",
    placeholder: "feature-auth",
    validate: (val) => {
      if (!val.trim()) return "Name is required";
      if (state.tasks[val.trim()]) return "Task already exists";
      if (!/^[a-zA-Z0-9._-]+$/.test(val.trim())) return "Use alphanumeric, dash, dot, underscore";
    },
  });
  if (clack.isCancel(name)) return;

  const repoConfig = config.repos[repoKey];
  const taskName = (name as string).trim();

  const s = clack.spinner();
  s.start(`Creating task ${taskName}...`);

  try {
    await createTask({
      name: taskName,
      repo: repoKey,
      repoConfig,
      program: config.defaults.program,
      branchPrefix: config.branchPrefix,
      config,
    }, state);
    s.stop(`Task ${taskName} created`);
  } catch (e) {
    s.stop(`Failed: ${e}`);
    clack.log.error(String(e));
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function configDialog(config: Config): Promise<Config> {
  const action = await clack.select({
    message: "Config",
    options: [
      { value: "add-repo", label: "Add repo" },
      { value: "scan-dir", label: "Scan directory for repos" },
      { value: "remove-repo", label: "Remove repo" },
      { value: "set-prefix", label: `Branch prefix (${config.branchPrefix || "none"})` },
      { value: "set-editor", label: `Editor (${config.editor})` },
      { value: "set-program", label: `Default program (${config.defaults.program})` },
      { value: "back", label: "Back" },
    ],
  });
  if (clack.isCancel(action) || action === "back") return config;

  if (action === "add-repo") {
    const name = await clack.text({
      message: "Repo name (e.g. my-project)",
      placeholder: "my-project",
    });
    if (clack.isCancel(name)) return config;

    const url = await clack.text({
      message: "Git URL",
      placeholder: "https://github.com/org/repo.git",
    });
    if (clack.isCancel(url)) return config;

    const defaultBranch = await clack.text({ message: "Default branch", initialValue: "main" });
    if (clack.isCancel(defaultBranch)) return config;

    const hasLocal = await clack.confirm({ message: "Do you have a local clone?" });
    let localPath: string | undefined;
    if (!clack.isCancel(hasLocal) && hasLocal) {
      const path = await clack.text({ message: "Path to local clone" });
      if (!clack.isCancel(path)) localPath = path as string;
    }

    config.repos[name as string] = {
      url: url as string,
      defaultBranch: defaultBranch as string,
      localPath,
    };
    await saveConfig(config);
    clack.log.success(`Added repo ${name}`);
  }

  if (action === "scan-dir") {
    const dir = await clack.text({
      message: "Directory to scan",
      initialValue: "~/coding",
      validate: (val) => {
        if (!val || !val.trim()) return "Path is required";
      },
    });
    if (clack.isCancel(dir) || !dir) return config;

    // Expand ~ to home dir
    let scanPath = (dir as string).trim();
    if (scanPath.startsWith("~/")) {
      scanPath = scanPath.replace("~", Deno.env.get("HOME") ?? "");
    }

    const s = clack.spinner();
    s.start("Scanning...");

    const repos = await scanDirectory(scanPath);
    s.stop(`Found ${repos.length} repo${repos.length === 1 ? "" : "s"}`);

    if (repos.length === 0) return config;

    // Let user pick which repos to add
    const choices = await clack.multiselect({
      message: "Select repos to add",
      options: repos
        .filter((r) => !config.repos[r.name])
        .map((r) => ({
          value: r.name,
          label: `${r.name} (${r.defaultBranch})`,
          hint: r.url,
        })),
    });
    if (clack.isCancel(choices)) return config;

    for (const name of choices as string[]) {
      const repo = repos.find((r) => r.name === name)!;
      config.repos[name] = {
        url: repo.url,
        defaultBranch: repo.defaultBranch,
        localPath: repo.path,
      };
    }

    await saveConfig(config);
    clack.log.success(
      `Added ${(choices as string[]).length} repo${(choices as string[]).length === 1 ? "" : "s"}`,
    );
  }

  if (action === "remove-repo") {
    const repos = Object.keys(config.repos);
    if (repos.length === 0) {
      clack.log.info("No repos to remove");
      return config;
    }
    const name = await clack.select({
      message: "Remove which repo?",
      options: repos.map((r) => ({ value: r, label: r })),
    });
    if (!clack.isCancel(name)) {
      delete config.repos[name as string];
      await saveConfig(config);
      clack.log.success(`Removed repo ${name}`);
    }
  }

  if (action === "set-prefix") {
    const prefix = await clack.text({
      message: "Branch prefix (e.g. charles-)",
      initialValue: config.branchPrefix,
    });
    if (!clack.isCancel(prefix)) {
      config.branchPrefix = prefix as string;
      await saveConfig(config);
    }
  }

  if (action === "set-editor") {
    const editor = await clack.text({ message: "Editor command", initialValue: config.editor });
    if (!clack.isCancel(editor)) {
      config.editor = editor as string;
      await saveConfig(config);
    }
  }

  if (action === "set-program") {
    const program = await clack.text({
      message: "Default program",
      initialValue: config.defaults.program,
    });
    if (!clack.isCancel(program)) {
      config.defaults.program = program as string;
      await saveConfig(config);
    }
  }

  return config;
}

function showHelp(): void {
  console.log(clearScreen());
  console.log(bold("\n  hive — keyboard shortcuts\n"));
  console.log("  j/k or arrows  Move selection");
  console.log("  Enter          Attach to session (restart if stopped)");
  console.log("  n              New task");
  console.log("  s              Stack on selected task");
  console.log("  i              Import existing branch");
  console.log("  p              Create/view PR");
  console.log("  d              Close task");
  console.log("  r              Restart task");
  console.log("  e              Open editor in worktree");
  console.log("  a              Toggle fresh/all tasks");
  console.log("  c              Config");
  console.log("  ?              This help");
  console.log("  q              Quit");
  console.log(dim("\n  Press any key to return..."));
}

// --- First-Run Wizard ---

async function firstRunWizard(): Promise<Config> {
  console.log("");
  clack.intro("Welcome to hive! Let's get you set up.");

  const prefix = await clack.text({
    message: "Branch prefix (your branches will be named prefix-taskname)",
    placeholder: "charles-",
  });
  const branchPrefix = clack.isCancel(prefix) ? "" : (prefix as string).trim();

  const editorChoice = await clack.text({
    message: "Editor command",
    initialValue: "cursor",
  });
  const editor = clack.isCancel(editorChoice) ? "cursor" : (editorChoice as string).trim();

  const programChoice = await clack.text({
    message: "Claude command (program launched in each task)",
    initialValue: "claude",
  });
  const program = clack.isCancel(programChoice) ? "claude" : (programChoice as string).trim();

  const config: Config = {
    ...DEFAULT_CONFIG,
    branchPrefix,
    editor,
    defaults: { program },
  };

  // Offer to scan for repos
  const wantScan = await clack.confirm({
    message: "Scan a directory for git repos to add?",
  });

  if (!clack.isCancel(wantScan) && wantScan) {
    const dir = await clack.text({
      message: "Directory to scan",
      initialValue: "~/coding",
      validate: (val) => {
        if (!val || !val.trim()) return "Path is required";
      },
    });

    if (!clack.isCancel(dir) && dir) {
      let scanPath = (dir as string).trim();
      if (scanPath.startsWith("~/")) {
        scanPath = scanPath.replace("~", Deno.env.get("HOME") ?? "");
      }

      const s = clack.spinner();
      s.start("Scanning...");
      const repos = await scanDirectory(scanPath);
      s.stop(`Found ${repos.length} repo${repos.length === 1 ? "" : "s"}`);

      if (repos.length > 0) {
        const choices = await clack.multiselect({
          message: "Select repos to add",
          options: repos.map((r) => ({
            value: r.name,
            label: `${r.name} (${r.defaultBranch})`,
            hint: r.url,
          })),
        });

        if (!clack.isCancel(choices)) {
          for (const name of choices as string[]) {
            const repo = repos.find((r) => r.name === name)!;
            config.repos[name] = {
              url: repo.url,
              defaultBranch: repo.defaultBranch,
              localPath: repo.path,
            };
          }
        }
      }
    }
  }

  await saveConfig(config);
  clack.outro("Setup complete! Launching dashboard...");
  return config;
}

// --- Main Loop ---

export async function runDashboard(): Promise<void> {
  // First-run wizard if no config exists
  const { configPath } = await import("./paths.ts");
  let isFirstRun = false;
  try {
    await Deno.stat(configPath());
  } catch {
    isFirstRun = true;
  }

  let config: Config;
  if (isFirstRun) {
    config = await firstRunWizard();
  } else {
    config = await loadConfig();
  }
  let state = await loadState();
  const bgFetch = startBackgroundFetch(config, state);

  let selectedIndex = 0;
  let showAll = false;
  let running = true;
  let lastRender = "";

  const taskList = () => {
    const tasks = Object.values(state.tasks);
    // Build tree: find root tasks (baseBranch is a default branch, not another task's branch)
    const taskBranches = new Set(tasks.map((t) => t.branch));
    const roots: Task[] = [];
    const children = new Map<string, Task[]>(); // parent branch -> child tasks

    for (const task of tasks) {
      if (taskBranches.has(task.baseBranch)) {
        // This task is stacked on another task
        const list = children.get(task.baseBranch) ?? [];
        list.push(task);
        children.set(task.baseBranch, list);
      } else {
        roots.push(task);
      }
    }

    // Sort roots by creation time (newest first)
    roots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Flatten tree: root, then children recursively
    const result: Task[] = [];
    const addWithChildren = (task: Task) => {
      result.push(task);
      const kids = children.get(task.branch) ?? [];
      kids.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const kid of kids) {
        addWithChildren(kid);
      }
    };
    for (const root of roots) {
      addWithChildren(root);
    }
    return result;
  };

  const write = (s: string) => Deno.stdout.writeSync(new TextEncoder().encode(s));
  write(hideCursor());

  const poll = async () => {
    const tasks = taskList();
    const statuses = await pollAll(tasks);

    // Track waitingSince
    for (const task of tasks) {
      const ts = statuses.get(task.id);
      if (ts && (ts.status === "waiting" || ts.status === "blocked")) {
        if (!state.waitingSince?.[task.id]) {
          state.waitingSince = state.waitingSince ?? {};
          state.waitingSince[task.id] = new Date().toISOString();
        }
      } else {
        delete state.waitingSince?.[task.id];
      }
    }

    if (tasks.length > 0) {
      selectedIndex = Math.max(0, Math.min(selectedIndex, tasks.length - 1));
    }

    const render = renderDashboard(
      tasks,
      statuses,
      selectedIndex,
      showAll,
      config.staleThresholdHours,
      state.waitingSince ?? {},
      state.prCache ?? {},
    );

    if (render !== lastRender) {
      write(clearScreen() + render);
      write(setTitle(formatTitle(statuses)));
      lastRender = render;
    }

    return { tasks, statuses };
  };

  let pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  await poll();

  enableRawMode();

  try {
    while (running) {
      const key = await readKey();

      if (key.key === "q" || (key.ctrl && key.key === "c")) {
        running = false;
        break;
      }

      try {
        const tasks = taskList();

        if (key.key === "j" || key.key === "down") {
          selectedIndex = Math.min(selectedIndex + 1, tasks.length - 1);
          await poll();
          continue;
        }

        if (key.key === "k" || key.key === "up") {
          selectedIndex = Math.max(selectedIndex - 1, 0);
          await poll();
          continue;
        }

        if (key.key === "a") {
          showAll = !showAll;
          selectedIndex = 0;
          await poll();
          continue;
        }

        if (key.key === "?") {
          clearInterval(pollTimer);
          disableRawMode();
          showHelp();
          enableRawMode();
          await readKey();
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        const selectedTask = tasks[selectedIndex];

        if (key.key === "enter" && selectedTask) {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());

          const alive = await hasSession(selectedTask.tmuxSession);
          if (!alive) {
            const s = clack.spinner();
            s.start("Restarting...");
            await restartTask(selectedTask, state, config);
            s.stop("Restarted");
          }

          await attachSession(selectedTask.tmuxSession);

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "n") {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());
          write(clearScreen());

          await newTaskDialog(config, state);
          state = await loadState();

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "d" && selectedTask) {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());

          const confirm = await clack.confirm({
            message: `Close task ${selectedTask.id}? This removes the worktree.`,
          });

          if (!clack.isCancel(confirm) && confirm) {
            const s = clack.spinner();
            s.start("Closing...");
            await closeTask(selectedTask, state, config);
            s.stop(`Closed ${selectedTask.id}`);
            state = await loadState();
          }

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "r" && selectedTask) {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());

          const s = clack.spinner();
          s.start("Restarting...");
          await restartTask(selectedTask, state, config);
          s.stop("Restarted");

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "p" && selectedTask) {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());

          const cacheKey = `${selectedTask.repo}:${selectedTask.branch}`;
          const existing = state.prCache?.[cacheKey];

          if (existing) {
            clack.log.info(`PR #${existing.number} (${existing.state}) — opening in browser...`);
            await openPrInBrowser(selectedTask);
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            const s = clack.spinner();
            s.start("Creating PR...");
            try {
              const pr = await createPr(selectedTask, config.branchPrefix, state);
              if (pr) {
                s.stop(`Created PR #${pr.number}`);
                clack.log.success(pr.url);
                await new Promise((r) => setTimeout(r, 2000));
              } else {
                s.stop("PR created (could not fetch details)");
              }
            } catch (e) {
              s.stop(`Failed: ${e}`);
              clack.log.error(String(e));
              await new Promise((r) => setTimeout(r, 3000));
            }
            state = await loadState();
          }

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "s" && selectedTask) {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());
          write(clearScreen());

          const name = await clack.text({
            message: `Stack on ${selectedTask.id} — new task name`,
            placeholder: "next-step",
            validate: (val) => {
              if (!val?.trim()) return "Name is required";
              if (state.tasks[val.trim()]) return "Task already exists";
              if (!/^[a-zA-Z0-9._-]+$/.test(val.trim())) {
                return "Use alphanumeric, dash, dot, underscore";
              }
            },
          });

          if (!clack.isCancel(name) && name) {
            const taskName = (name as string).trim();
            const repoConfig = Object.entries(config.repos).find(([_, rc]) =>
              repoNameFromUrl(rc.url) === selectedTask.repo
            );

            if (repoConfig) {
              const s = clack.spinner();
              s.start(`Creating stacked task ${taskName}...`);
              try {
                await createTask({
                  name: taskName,
                  repo: repoConfig[0],
                  repoConfig: repoConfig[1],
                  baseBranch: selectedTask.branch,
                  program: config.defaults.program,
                  branchPrefix: config.branchPrefix,
                  config,
                }, state);
                s.stop(`Task ${taskName} created (stacked on ${selectedTask.id})`);
              } catch (e) {
                s.stop(`Failed: ${e}`);
                clack.log.error(String(e));
                await new Promise((r) => setTimeout(r, 3000));
              }
            }
            state = await loadState();
          }

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "i") {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());
          write(clearScreen());

          const repos = Object.entries(config.repos);
          if (repos.length === 0) {
            clack.log.error("No repos configured. Press c to add one.");
            await new Promise((r) => setTimeout(r, 1500));
          } else {
            let repoKey: string;
            if (repos.length === 1) {
              repoKey = repos[0][0];
            } else {
              const selected = await clack.select({
                message: "Repo",
                options: repos.map(([key, rc]) => ({ value: key, label: `${key} (${rc.url})` })),
                initialValue: state.lastRepo ?? repos[0][0],
              });
              if (clack.isCancel(selected)) {
                enableRawMode();
                write(hideCursor());
                pollTimer = setInterval(poll, POLL_INTERVAL_MS);
                lastRender = "";
                await poll();
                continue;
              }
              repoKey = selected as string;
            }

            const branch = await clack.text({
              message: "Branch name to import",
              placeholder: "feature-xyz",
              validate: (val) => {
                if (!val?.trim()) return "Branch name is required";
              },
            });

            if (!clack.isCancel(branch) && branch) {
              const branchName = (branch as string).trim();
              let taskName = branchName;
              if (config.branchPrefix && taskName.startsWith(config.branchPrefix)) {
                taskName = taskName.slice(config.branchPrefix.length);
              }

              const s = clack.spinner();
              s.start(`Importing ${branchName}...`);
              try {
                await importTask({
                  name: taskName,
                  repo: repoKey,
                  repoConfig: config.repos[repoKey],
                  branch: branchName,
                  program: config.defaults.program,
                  config,
                }, state);
                s.stop(`Imported ${branchName} as ${taskName}`);
              } catch (e) {
                s.stop(`Failed: ${e}`);
                clack.log.error(String(e));
                await new Promise((r) => setTimeout(r, 3000));
              }
              state = await loadState();
            }
          }

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "e" && selectedTask) {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());

          // Check if editor is configured and working
          let editor = config.editor;
          const editorCheck = await run(["which", editor]);
          if (!editorCheck.success) {
            const newEditor = await clack.text({
              message: `Editor "${editor}" not found. Which editor to use?`,
              placeholder: "cursor",
            });
            if (!clack.isCancel(newEditor) && newEditor) {
              editor = (newEditor as string).trim();
              config.editor = editor;
              await saveConfig(config);
            }
          }

          try {
            await openEditor(selectedTask, editor);
          } catch (e) {
            clack.log.error(`Failed to open editor: ${e}`);
            await new Promise((r) => setTimeout(r, 2000));
          }

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }

        if (key.key === "c") {
          clearInterval(pollTimer);
          disableRawMode();
          write(showCursor());
          write(clearScreen());

          config = await configDialog(config);

          enableRawMode();
          write(hideCursor());
          pollTimer = setInterval(poll, POLL_INTERVAL_MS);
          lastRender = "";
          await poll();
          continue;
        }
      } catch (e) {
        // Recover dashboard state
        clearInterval(pollTimer);
        disableRawMode();
        write(showCursor());
        clack.log.error(`Error: ${e}`);
        await new Promise((r) => setTimeout(r, 2000));
        enableRawMode();
        write(hideCursor());
        pollTimer = setInterval(poll, POLL_INTERVAL_MS);
        lastRender = "";
        await poll();
      }
    }
  } finally {
    clearInterval(pollTimer);
    disableRawMode();
    write(showCursor());
    write(clearScreen());
    bgFetch.stop();
    log.close();
  }
}
