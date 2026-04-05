// src/tui.ts — dashboard rendering, key dispatch, dialog flows

import * as clack from "@clack/prompts";
import type { Config, State, Task, TaskStatus, Status } from "./types.ts";
import { pollAll } from "./monitor.ts";
import { attachSession, hasSession } from "./tmux.ts";
import { closeTask, createTask, openEditor, restartTask, type CreateTaskOpts } from "./tasks.ts";
import { loadConfig, loadState, saveConfig, saveState } from "./config.ts";
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

export function renderTaskLine(task: Task, status: TaskStatus, selected: boolean): string {
  const cursor = selected ? ">" : " ";
  const icon = statusColor(status.status, statusIcon(status.status));
  const name = selected ? bold(task.id) : task.id;
  const snippet = status.snippet ? dim(status.snippet) : "";

  // Pad name to 24 chars for alignment
  const paddedName = name + " ".repeat(Math.max(0, 24 - stripAnsi(name).length));

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

  lines.push("");
  lines.push(bold("  hive") + dim(` — ${visibleTasks.length} task${visibleTasks.length === 1 ? "" : "s"}`));
  lines.push("");

  if (visibleTasks.length === 0) {
    lines.push(dim("  No tasks. Press n to create one."));
    lines.push("");
  }

  for (let i = 0; i < visibleTasks.length; i++) {
    const task = visibleTasks[i];
    const status = statuses.get(task.id) ?? { status: "stopped" as Status, snippet: "" };
    lines.push(renderTaskLine(task, status, i === selectedIndex));
  }

  if (!showAll && stale.length > 0) {
    lines.push("");
    lines.push(dim(`  ${stale.length} stale task${stale.length === 1 ? "" : "s"} hidden (press a to show)`));
  }

  lines.push("");
  lines.push(dim("  n:new  d:close  r:restart  e:editor  enter:attach  ?:help  q:quit"));
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
  }
}

async function configDialog(config: Config): Promise<Config> {
  const action = await clack.select({
    message: "Config",
    options: [
      { value: "add-repo", label: "Add repo" },
      { value: "remove-repo", label: "Remove repo" },
      { value: "set-prefix", label: `Branch prefix (${config.branchPrefix || "none"})` },
      { value: "set-editor", label: `Editor (${config.editor})` },
      { value: "set-program", label: `Default program (${config.defaults.program})` },
      { value: "back", label: "Back" },
    ],
  });
  if (clack.isCancel(action) || action === "back") return config;

  if (action === "add-repo") {
    const name = await clack.text({ message: "Repo name (e.g. my-project)", placeholder: "my-project" });
    if (clack.isCancel(name)) return config;

    const url = await clack.text({ message: "Git URL", placeholder: "https://github.com/org/repo.git" });
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
    const program = await clack.text({ message: "Default program", initialValue: config.defaults.program });
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
  console.log("  d              Close task");
  console.log("  r              Restart task");
  console.log("  e              Open editor in worktree");
  console.log("  a              Toggle fresh/all tasks");
  console.log("  c              Config");
  console.log("  ?              This help");
  console.log("  q              Quit");
  console.log(dim("\n  Press any key to return..."));
}

// --- Main Loop ---

export async function runDashboard(): Promise<void> {
  let config = await loadConfig();
  let state = await loadState();
  const bgFetch = startBackgroundFetch(config);

  let selectedIndex = 0;
  let showAll = false;
  let running = true;
  let lastRender = "";

  const taskList = () => {
    const tasks = Object.values(state.tasks);
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return tasks;
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

      if (key.key === "e" && selectedTask) {
        await openEditor(selectedTask, config.editor);
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
