# hive — Multi-Session Claude Code Coordinator

Design spec for an open-source CLI tool that manages multiple parallel Claude Code sessions from a
single terminal dashboard.

## Problem

Claude Code runs in a single terminal session. Working on multiple tasks — features, bug fixes,
stacked PRs — means juggling terminal tabs, losing track of which agent needs input, and manually
setting up worktrees and branches. There's no unified view of what all your agents are doing.

## Solution

A compiled Deno binary (`hive`) that:

- Manages multiple Claude Code sessions running in tmux
- Each task gets its own git worktree and branch (full isolation)
- Shows live status of every agent (working, waiting, blocked, done, idle, stopped)
- Lets you jump between sessions with a keypress
- Handles the full lifecycle: create task, launch Claude, monitor, restart, close and clean up

## Tech Stack

| Component    | Choice                                                                  | Rationale                                                        |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Runtime      | Deno (native TS)                                                        | Native TS, `deno compile` for single binary                      |
| File I/O     | `Deno.readTextFile` / `Deno.writeTextFile` / `Deno.stat` / `Deno.mkdir` | Idiomatic Deno, no Node compat                                   |
| Subprocesses | `Deno.Command`                                                          | For git, tmux, gh, terminal-notifier                             |
| TUI dialogs  | `@clack/prompts`                                                        | Structured prompts (text, select, confirm, spinners)             |
| Dashboard    | Custom ANSI to stdout                                                   | Live-updating task list, status colors, layout                   |
| Keypress     | Custom raw stdin reader                                                 | Vim-style j/k navigation                                         |
| Git          | Shell out to `git`                                                      | Worktree/bare-clone operations aren't well-served by JS git libs |
| Tmux         | Shell out to `tmux`                                                     | Direct CLI interaction                                           |
| Config       | JSON                                                                    | Simple, no dependencies                                          |

### Deno Permissions

```
--allow-env --allow-read --allow-write --allow-run --allow-net
```

### Distribution

- **Primary**: `deno compile` for darwin-arm64, darwin-x64, linux-x64. Published as GitHub release
  artifacts. Optional Homebrew tap.
- **Secondary**: `deno install -g` from source URL for Deno users.
- **Dev**: `deno run -A cli.ts` locally.

CI: GitHub Actions workflow runs `deno compile --target=<arch> --output=hive-<arch>` on tag push,
attaches binaries to the release. Compiled binary is ~60-80MB (includes Deno runtime).

## Core Concepts

**Task** = a named unit of work. Composed of:

- A repo + branch + git worktree (isolated working directory)
- A tmux session running Claude Code
- A base branch (for stacking)

**Status** = what the agent is doing right now, derived at read time from signal files + tmux
liveness (never stored):

- `working` — actively processing (running tools, thinking)
- `waiting` — needs user input (asked a question)
- `blocked` — permission prompt pending (approve/deny)
- `done` — agent reports it finished its work
- `idle` — session exists, agent stopped but didn't self-report status
- `stopped` — tmux session is dead

**Snippet** = a short description of the agent's last action (e.g. "Edit src/auth.ts", "Bash: yarn
test", "which database approach?")

## Architecture

```
+-------------------------------------------+
|  TUI (terminal dashboard)                 |
|  - renders task list with live status     |
|  - clack for dialogs, ANSI for dashboard  |
|  - vim-style navigation (j/k)            |
|  - attach/detach tmux sessions            |
+------------------+------------------------+
                   |
            +------+------+
            |   Monitor   |  polls signal files + tmux has-session
            +------+------+  every 1-2 seconds
                   | reads
            +------+--------------------+
            |  Signal Files             |
            |  ~/.hive/signals/<session>|
            +------+--------------------+
                   | written by
            +------+----------------------------+
            |  Claude Code Hooks                |
            |  (in .claude/settings.local.json) |
            |  UserPromptSubmit -> "prompt"      |
            |  PostToolUse      -> "tool"        |
            |  Stop             -> "stop"        |
            |  Notification     -> "notification"|
            +-----------------------------------+
```

## Data Model

### Task

```typescript
interface Task {
  id: string; // slug derived from name, e.g. "feature-auth"
  repo: string; // key into config.repos
  branch: string; // git branch name (prefixed with branchPrefix)
  baseBranch: string; // what it branched from (default branch or parent for stacks)
  worktreePath: string; // ~/.hive/worktrees/<repo>/<branch>/
  tmuxSession: string; // tmux session name, e.g. "hive-feature-auth"
  program: string; // command to run, e.g. "claude --model sonnet"
  createdAt: string; // ISO timestamp
}
```

### Config (`~/.hive/config.json`)

```typescript
interface Config {
  repos: Record<string, RepoConfig>;
  branchPrefix: string; // e.g. "charles-"
  editor: string; // "code" | "cursor" | custom
  openEditorOnCreate: boolean;
  agentStatusReporting: boolean; // Phase 2: inject rules for rich status
  notifications: boolean; // Phase 2: desktop notifications
  tmuxMouse: boolean;
  tmuxStatusBar: boolean;
  defaults: {
    program: string; // e.g. "claude --model sonnet"
  };
  staleThresholdHours: number; // default 25
}

interface RepoConfig {
  url: string; // git remote URL
  defaultBranch: string; // "main" or "master"
  localPath?: string; // existing clone for --reference
}
```

### State (`~/.hive/state.json`)

```typescript
interface State {
  tasks: Record<string, Task>;
  lastRepo?: string;
  prCache?: Record<string, PrInfo>; // Phase 2: "repo:branch" -> PR metadata
  waitingSince?: Record<string, string>; // task ID -> ISO timestamp
}
```

Config is user-edited settings. State is machine-managed task data. Both are plain JSON via
`Deno.readTextFile`/`Deno.writeTextFile`.

## Components

### 1. Git (`git.ts`)

Manages bare clones, worktrees, and the ready worktree optimization.

**Bare clones** live at `~/.hive/repos/<name>.git` where name is `org-repo` with `/` replaced by `-`
(e.g. `anthropics-claude-code.git`). Created with `git clone --bare <url>`. If `localPath` is set in
config, uses `--reference <localPath> --dissociate` to speed up initial clone while keeping the bare
clone self-contained.

**Refspec fix**: bare clones default to `+refs/heads/*:refs/heads/*` which breaks `origin/<branch>`
references. `ensureRefspec()` reconfigures to `+refs/heads/*:refs/remotes/origin/*` on first use.

**Fetch lock**: a per-repo promise chain (`Map<string, Promise>`) serializes concurrent fetches to
avoid git ref lock contention.

**Worktrees** live at `~/.hive/worktrees/<repo>/<branch>/`.

#### Ready Worktree Optimization

Pre-provisioned worktrees at `~/.hive/worktrees/<repo>/_ready` eliminate the expensive index diff
that `git worktree add` performs on large repos (~3s down to ~36ms for a 229K file repo).

**How it works:**

- `ensureReadyWorktree(repo, defaultBranch)` creates a detached HEAD worktree at
  `origin/<defaultBranch>`
- Deduplication: checks disk (`hasReadyWorktree`) and tracks in-flight provisioning promises in a
  `Map` to prevent double-provisioning
- `consumeReadyWorktree` awaits any in-flight provisioning, then moves the worktree:
  `git worktree move _ready -> <branch>`, then `git checkout -b <branch>` +
  `git reset --hard <baseRef>`

**Three reprovisioning triggers:**

1. **Task creation** — fire-and-forget after consuming the ready worktree
2. **Task close** — fire-and-forget after removing the task's worktree
3. **TUI background fetch loop** — runs on startup then every 15 minutes; fetches default branch,
   refreshes existing ready worktrees (`git reset --hard` to latest), provisions missing ones

**Operations:**

- `ensureBareClone(repo)` — clone if missing, `git fetch origin` if exists
- `ensureRefspec(repoPath)` — fix bare clone refspec for origin refs
- `createWorktree(repo, branch, baseBranch)` —
  `git worktree add -b <branch> <path> origin/<baseBranch>`. Checks for stale paths from failed
  attempts and removes them. Falls back to `git worktree add <path> <branch>` (no `-b`) if branch
  already exists (import flow).
- `removeWorktree(path)` — `git worktree remove --force <path>`
- `fetchBranches(repo, branches)` — fetch specific refs (faster than full fetch for large repos)
- `resolveHead(worktreePath)` — `git rev-parse HEAD`
- `hasReadyWorktree(repo)` — check if `_ready` worktree exists
- `ensureReadyWorktree(repo, defaultBranch)` — provision ready worktree (with dedup)
- `consumeReadyWorktree(repo, branch, baseRef)` — move + checkout ready worktree
- `refreshReadyWorktree(repo, defaultBranch)` — reset existing ready worktree to latest
- `scanDirectory(path)` — walk directory to discover git repos (checks for `.git`, reads remote URL,
  detects default branch)

### 2. Hooks (`hooks.ts`)

Installs Claude Code hooks that write signal files on lifecycle events.

**Hook script** (`~/.hive/hooks/hive-signal`):

```sh
#!/bin/sh
EVENT="${1:?}" SESSION="${2:?}"
SIGDIR="${HIVE_HOME:-$HOME/.hive}/signals"
mkdir -p "$SIGDIR"
INPUT="$(cat)"
# Skip idle_prompt if signal already exists (preserves richer stop signal)
if [ "$EVENT" = "notification" ]; then
  case "$INPUT" in *'"idle_prompt"'*) [ -f "$SIGDIR/$SESSION" ] && exit 0 ;; esac
fi
printf '%s\n%s' "$EVENT" "$INPUT" > "$SIGDIR/$SESSION"
```

**Installation**: before launching Claude in a worktree, write `.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "command": "~/.hive/hooks/hive-signal prompt <session>" }],
    "PostToolUse": [{ "command": "~/.hive/hooks/hive-signal tool <session>" }],
    "Stop": [{ "command": "~/.hive/hooks/hive-signal stop <session>" }],
    "Notification": [{ "command": "~/.hive/hooks/hive-signal notification <session>" }]
  }
}
```

Each hook receives JSON on stdin from Claude Code. Signal file format: line 1 = event name, rest =
raw JSON.

The `idle_prompt` skip preserves richer signals — if a `stop` with done/waiting metadata already
exists, an incoming `idle_prompt` won't overwrite it.

### 3. Monitor (`monitor.ts`)

Stateless status derivation. Reads signal files and tmux liveness on every poll.

```
pollAll(tasks) -> for each task:
  1. readSignal(session) — parse signal file (line 1 = event, rest = JSON)
  2. hasSession(tmuxSession) — tmux has-session check
  3. classify(event, json, tmuxAlive) -> { status, snippet }
```

**Status classification:**

| Signal Event          | Condition                           | Status    |
| --------------------- | ----------------------------------- | --------- |
| `prompt` or `tool`    | —                                   | `working` |
| `stop`                | has `<!-- hive: done \| ... -->`    | `done`    |
| `stop`                | has `<!-- hive: waiting \| ... -->` | `waiting` |
| `stop`                | no metadata                         | `idle`    |
| `notification`        | `permission_prompt`                 | `blocked` |
| `notification`        | `elicitation_dialog`                | `waiting` |
| `notification`        | `idle_prompt`                       | `idle`    |
| no signal + tmux dead | —                                   | `stopped` |

**Snippet extraction:**

- Tool calls: `tool_name + file_path`, or `Bash: <command prefix>`, or `tool_name: <pattern>`
- Prompts: user's prompt text (truncated)
- Stop: last line of `last_assistant_message`
- Notifications: notification message text

**Polling interval**: 1-2 seconds via `setInterval`. Re-renders only if state changed.

### 4. Tasks (`tasks.ts`)

Full task lifecycle management.

**Create:**

1. Ensure bare clone exists and is fetched
2. Consume ready worktree if available, else create fresh worktree
3. Push new branch to remote
4. Install hooks (`.claude/settings.local.json`) + optional rules file
5. Run project hooks (`WorktreeCreate`) if `.hive/settings.jsonc` exists in repo
6. Create tmux session, send Claude launch command via `send-keys`
7. Fire-and-forget ready worktree reprovisioning
8. Save task to state

**Restart:**

1. Read active session ID from `.claude/projects/` session files in the worktree
2. Cache session `.jsonl` files to `~/.hive/sessions/<id>/`
3. Kill the tmux session
4. Create fresh tmux session in same worktree
5. Launch Claude with `--resume <sessionId>`
6. If resumed conversation was already complete (Claude exits immediately), kill and start fresh
   without `--resume`

**Close:**

1. Cache session files
2. Kill tmux session
3. Remove worktree
4. Remove signal file
5. Delete task from state
6. Fire-and-forget ready worktree reprovisioning

**Stack:**

1. Fetch the parent task's branch into the bare clone
2. Create new task with `baseBranch` set to parent's branch
3. Worktree branches off parent's HEAD

**Import:**

1. Take an existing branch name (already pushed)
2. Fetch that branch
3. Create worktree using the branch-exists fallback (no `-b` flag)
4. Install hooks, create tmux session, save task

### 5. Tmux (`tmux.ts`)

Thin wrapper — every function is a `Deno.Command` call to `tmux`.

- `createSession(name, cwd, program, opts)` — `tmux new-session -d -s <name> -c <cwd>`, set options,
  then `send-keys` to launch the program
- `attachSession(name)` — `tmux attach-session -t <name>` (blocks until detach)
- `detachFromSession(name)` — `tmux detach-client -s <name>`
- `hasSession(name)` — `tmux has-session -t <name>` (exit code 0 = alive)
- `killSession(name)` — `tmux kill-session -t <name>`
- `sendKeys(name, keys)` — `tmux send-keys -t <name> <keys>`
- `capturePane(name)` — `tmux capture-pane -t <name> -p`

**Session options:**

- Mouse mode enabled (if `config.tmuxMouse`)
- Vi copy-mode bindings
- Custom status bar: back hint (click to detach), task title, copy mode indicator
- `HIVE_HOME` env var propagated so hook scripts find the right signals directory

Claude Code runs as a foreground process inside a shell in the tmux pane. When Claude exits, the
shell remains — the session stays alive but monitor detects status change. Tasks survive terminal
crashes and disconnects.

### 6. TUI (`tui.ts`)

Two rendering modes: custom ANSI for the dashboard, clack for dialogs.

**Dashboard** — custom ANSI output to stdout:

- Clears and redraws on each poll cycle (only if state changed)
- Task list with status icon, name, PR info, snippet

```
  ● feature-auth          #1234 open    Edit src/middleware/auth.ts
> ◉ fix-timezone          —            which timezone library to use?
  ○ refactor-api          #1230 draft
  ✕ add-logging           —
```

Status icons: `●` working, `◉` waiting/blocked, `○` idle/done, `✕` stopped

- Fresh/stale split: tasks waiting > `staleThresholdHours` (default 25) collapse into a stale
  section
- Terminal title updated with summary: `hive: 1 waiting, 2 working`

**Key bindings:**

| Key               | Action                         | Phase |
| ----------------- | ------------------------------ | ----- |
| `j`/`k` or arrows | Move selection                 | 1     |
| `Enter`           | Attach (or restart if stopped) | 1     |
| `n`               | New task                       | 1     |
| `d`               | Close task (clack confirm)     | 1     |
| `r`               | Restart task                   | 1     |
| `s`               | Stack on selected task         | 2     |
| `p`               | Open/create PR via `gh`        | 2     |
| `e`               | Open editor in worktree        | 1     |
| `i`               | Import existing branch         | 2     |
| `a`               | Toggle fresh/all tasks         | 1     |
| `c`               | Config screen                  | 1     |
| `?`               | Help                           | 1     |
| `q`               | Quit                           | 1     |

**Attach/detach flow**: `Enter` calls `tmux attach-session`, which takes over the terminal. The TUI
process blocks. On detach (`Ctrl-b d` or status bar click), control returns to the TUI, which
resumes its poll loop and re-renders.

### 7. Keypress (`keypress.ts`)

Raw stdin reader for dashboard navigation.

- Sets `Deno.stdin.setRaw(true)`
- Reads bytes from stdin, maps to key events
- Handles single keys, arrow key escape sequences, and Ctrl combinations
- Dispatches to TUI key handler

### 8. Config (`config.ts`)

Manages `~/.hive/config.json` and `~/.hive/state.json`.

- `loadConfig()` / `saveConfig()` — read/write config with defaults
- `loadState()` / `saveState()` — read/write task state
- `addRepo(name, url, opts)` — register a new repo
- `removeRepo(name)` — unregister
- Config screen in TUI uses clack prompts for editing

## Phase 2 Features

Designed but implemented after Phase 1 core loop is solid.

### PR Integration

`p` key runs `gh pr create` or `gh pr view` via `Deno.Command`. PR metadata (number, status, URL)
cached in `state.prCache` keyed by `repo:branch`. Dashboard shows PR number and state next to task
name.

### Desktop Notifications (`notifications.ts`)

Fires on transitions to `waiting`, `blocked`, or `done`. Uses `terminal-notifier` on macOS (detected
via `Deno.build.os`). Click handler writes a `.attach` signal file that the TUI picks up to switch
sessions. Configurable sound. Linux support deferred.

### Rich Agent Status Reporting

Opt-in via `config.agentStatusReporting`. Installs `.claude/rules/hive.local.md` instructing Claude
to append `<!-- hive: done | summary -->` or `<!-- hive: waiting | question -->` to responses.
Monitor parses these from the Stop hook's `last_assistant_message`.

### Auto-Accept Startup Prompts

Best-effort tmux pane capture + regex matching for known prompt patterns. Opt-in via config. Sends
keystrokes to dismiss trust/MCP dialogs.

### Project Hooks (`hive-hooks.ts`)

Repo-level lifecycle hooks defined in `.hive/settings.jsonc` at the repo root.

```jsonc
{
  "hooks": {
    "WorktreeCreate": [
      { "command": "npm install" },
      { "command": "npm run build:watch", "async": true }
    ]
  },
  "commands": [
    { "key": "t", "label": "test", "command": "open http://localhost:3000" }
  ]
}
```

- `WorktreeCreate` hooks run after worktree setup, before Claude starts
- Blocking by default; `async: true` for background processes; exit code 2 = hard stop
- Custom commands add key bindings to the TUI for the selected task

### Session Caching & Resume

On restart/close, `.jsonl` session files copied to `~/.hive/sessions/<id>/`. Restart reads session
ID from `.claude/projects/` and passes `--resume <id>`.

### Branch Stacking

Create tasks whose base branch is another task's branch. Enables incremental PR stacks.

### Import Existing Branches

Create a task around an already-pushed branch. Useful for picking up work started elsewhere.

## File Layout

```
~/.hive/
  config.json              # user configuration
  state.json               # task state (persisted across restarts)
  hive.log                 # structured log file
  hooks/
    hive-signal            # shell script installed once
  signals/
    <session-name>         # one signal file per active task
  repos/
    <repo-name>.git/       # bare clones
  worktrees/
    <repo>/
      _ready/              # pre-provisioned ready worktree
      <branch>/            # task worktrees
  sessions/
    <task-id>/             # cached Claude session .jsonl files
```

## Project Structure

```
hive/
  cli.ts                   # entry point
  deno.json                # tasks, imports, permissions
  src/
    config.ts              # config + state management
    git.ts                 # bare clones, worktrees, ready worktree optimization
    hooks.ts               # Claude Code hook installation + signal script
    monitor.ts             # signal file reading + status classification
    tasks.ts               # task lifecycle (create, restart, close, stack, import)
    tmux.ts                # tmux command wrapper
    tui.ts                 # dashboard rendering (custom ANSI) + clack dialogs
    keypress.ts            # raw stdin key reader
    notifications.ts       # Phase 2: desktop notifications
    hive-hooks.ts          # Phase 2: project lifecycle hooks
```

## Phase Boundaries

**Phase 1 — Core loop:**

1. Config management (add repos, set branch prefix, edit settings)
2. Git bare clone + worktree management (including ready worktree optimization)
3. Hook installation and signal file writing
4. Monitor: signal file polling + status classification
5. Tmux session creation with Claude Code
6. TUI dashboard with status rendering, attach/detach
7. Task create, restart, close
8. Keypress handling (j/k navigation, Enter, n, d, r, e, a, c, ?, q)

**Phase 2 — Polish:**

1. PR integration via `gh`
2. Branch stacking
3. Import existing branches
4. Desktop notifications
5. Project hooks (`.hive/settings.jsonc`)
6. Custom commands
7. Rich agent status reporting
8. Auto-accept startup prompts
9. Session caching and `--resume` on restart
