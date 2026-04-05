# tend — Multi-Session Claude Code Coordinator

Tech spec for an open-source CLI tool that manages multiple parallel Claude Code sessions from a
single terminal dashboard.

## Problem

Claude Code runs in a single terminal session. If you're working on multiple tasks — different
features, bug fixes, stacked PRs — you end up juggling terminal tabs, losing track of which agent is
waiting for input, and manually setting up worktrees and branches. There's no unified view of what
all your agents are doing.

## Solution

A terminal UI that:

- Manages multiple Claude Code sessions running in tmux
- Each task gets its own git worktree and branch (full isolation)
- Shows live status of every agent (working, waiting, blocked, done, idle, stopped)
- Lets you jump between sessions with a keypress
- Handles the full lifecycle: create task, launch Claude, monitor, restart, close and clean up

## Core Concepts

**Task** = a named unit of work. Composed of:

- A repo + branch + git worktree (isolated working directory)
- A tmux session running Claude Code
- A base branch (for stacking)

**Status** = what the agent is doing right now, derived from Claude Code hooks:

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
┌─────────────────────────────────────────┐
│  TUI (terminal dashboard)               │
│  - renders task list with live status    │
│  - vim-style navigation (j/k)           │
│  - attach/detach tmux sessions          │
└──────────┬──────────────────────────────┘
           │
     ┌─────┴─────┐
     │  Monitor   │  polls signal files + tmux has-session
     └─────┬─────┘
           │ reads
     ┌─────┴──────────────────────┐
     │  Signal Files              │
     │  ~/.tend/signals/<session> │
     └─────┬──────────────────────┘
           │ written by
     ┌─────┴──────────────────────────────────┐
     │  Claude Code Hooks                      │
     │  (installed in .claude/settings.local)  │
     │  UserPromptSubmit → "prompt" signal     │
     │  PostToolUse      → "tool" signal       │
     │  Stop             → "stop" signal       │
     │  Notification     → "notification"      │
     └────────────────────────────────────────┘
```

### Key Design Decisions

**Hooks, not screen scraping.** Status detection uses Claude Code's hook system, not tmux pane
content parsing. Hooks fire on lifecycle events and write structured JSON to signal files. This is
reliable, fast, and doesn't depend on terminal rendering.

**Bare clones + worktrees, not full clones.** Each repo gets one bare clone
(`~/.tend/repos/<name>.git`). Tasks create lightweight worktrees from it. This means creating a new
task for a large repo takes seconds, not minutes. If the user has an existing local clone, it's used
as a `--reference` for the initial bare clone.

**tmux for session management.** Each task runs in a tmux session. Claude Code is launched as a
foreground process in a shell inside the tmux pane. When Claude exits, the shell remains (status
becomes `stopped`). The TUI attaches/detaches tmux sessions to let users jump between tasks. This
means tasks survive terminal crashes and disconnects.

**`--resume` on restart.** When restarting a stopped task, the tool reads Claude's session ID from
the `.claude/projects/` directory and passes `--resume <id>` so the conversation continues with full
context.

## Components

### 1. Config (`config.ts`)

Persistent configuration at `~/.tend/config.json`.

```typescript
interface Config {
  repos: Record<string, RepoConfig>; // registered repos
  branchPrefix: string; // e.g. "charles-"
  editor: string; // "code" | "cursor" | custom
  openEditorOnCreate: boolean;
  autoAcceptPrompts: boolean; // auto-dismiss trust/MCP prompts
  agentStatusReporting: boolean; // inject CLAUDE.md rules for rich status
  notifications: boolean; // desktop notifications
  tmuxMouse: boolean;
  tmuxStatusBar: boolean;
  defaults: {
    program: string; // e.g. "claude --model sonnet"
  };
}

interface RepoConfig {
  url: string; // git remote URL
  defaultBranch: string; // "main" or "master"
  localPath?: string; // existing clone for --reference
}
```

Persistent state at `~/.tend/state.json`:

```typescript
interface State {
  tasks: Record<string, Task>;
  lastRepo?: string;
  prCache?: Record<string, PrInfo>; // "repo:branch" → PR metadata
  waitingSince?: Record<string, string>; // task ID → ISO timestamp
}
```

### 2. Git (`git.ts`)

Manages bare clones and worktrees.

Operations:

- `ensureBareClone(repo)` — clone or update `~/.tend/repos/<name>.git` (uses `--reference` if
  localPath set)
- `createWorktree(repo, branch, baseBranch)` — `git worktree add` from the bare clone
- `removeWorktree(path)` — clean up on task close
- `pushNewBranch(repo, branch)` — push so PRs can be created
- `fetchBranches(repo, branches[])` — fetch specific refs
- `resolveHead(worktree)` — get current commit SHA
- `scanDirectory(path)` — find git repos in a directory for bulk import

Worktrees live at `~/.tend/worktrees/<repo>/<branch>/`.

### 3. Hooks (`hooks.ts`)

Installs Claude Code hooks that write signal files on lifecycle events.

**Hook script** (`~/.tend/hooks/tend-signal`):

```sh
#!/bin/sh
EVENT="${1:?}" SESSION="${2:?}"
SIGDIR="${TEND_HOME:-$HOME/.tend}/signals"
mkdir -p "$SIGDIR"
INPUT="$(cat)"
# Skip idle_prompt if signal already exists (preserves richer stop signal)
if [ "$EVENT" = "notification" ]; then
  case "$INPUT" in *'"idle_prompt"'*) [ -f "$SIGDIR/$SESSION" ] && exit 0 ;; esac
fi
printf '%s\n%s' "$EVENT" "$INPUT" > "$SIGDIR/$SESSION"
```

**Installation**: Before launching Claude in a worktree, write `.claude/settings.local.json` with
hook entries for each event type. Each hook calls `tend-signal <event> <session-name>` and pipes
stdin (Claude's hook JSON) into it.

**Signal file format**: Line 1 = event name, rest = raw JSON from Claude Code.

**Rich status reporting** (optional): When enabled, inject a rules file
(`.claude/rules/tend.local.md`) that instructs Claude to append `<!-- tend: done | summary -->` or
`<!-- tend: waiting | question -->` at the end of each response. This HTML comment is invisible in
the terminal but present in the `last_assistant_message` field of the Stop hook, giving
agent-provided status classification and a human-readable summary.

### 4. Monitor (`monitor.ts`)

Determines agent status by reading signal files.

```
readSignal(session) → parse signal file → statusFromSignal() → { status, snippet }
```

Status classification logic:

| Signal Event          | Condition                           | Status    |
| --------------------- | ----------------------------------- | --------- |
| `prompt` or `tool`    | —                                   | `working` |
| `stop`                | has `<!-- tend: done \| ... -->`    | `done`    |
| `stop`                | has `<!-- tend: waiting \| ... -->` | `waiting` |
| `stop`                | no metadata                         | `idle`    |
| `notification`        | `permission_prompt`                 | `blocked` |
| `notification`        | `elicitation_dialog`                | `waiting` |
| `notification`        | `idle_prompt`                       | `idle`    |
| no signal + tmux dead | —                                   | `stopped` |

Snippet extraction from hook JSON:

- Tool calls: `tool_name + file_path`, or `Bash: <command>`, or `tool_name: <pattern>`
- Prompts: user's prompt text
- Stop: last line of `last_assistant_message`
- Notifications: notification message

### 5. Tasks (`tasks.ts`)

Full task lifecycle management.

**Create**:

1. Ensure bare clone exists and is up to date
2. Create worktree from `origin/<defaultBranch>`
3. Push new branch to remote
4. Install hooks (`.claude/settings.local.json` + optional rules file)
5. Create tmux session, send Claude launch command via `send-keys`
6. Auto-accept startup prompts (trust dialog, MCP approval) by detecting prompt text in tmux pane
   capture and sending Enter/Down+Enter

**Restart**:

1. Read active session ID from `.claude/projects/` session files
2. Cache session `.jsonl` files to `~/.tend/sessions/<id>/`
3. Kill the tmux session
4. Create fresh tmux session
5. Launch Claude with `--resume <sessionId>`
6. If resumed conversation was already complete, kill and start fresh without `--resume`

**Close**:

1. Cache session files
2. Kill tmux session
3. Remove worktree
4. Remove signal file
5. Delete task from state

**Stack**: Create a new task whose base branch is the selected task's branch (not the repo default).
The new worktree branches off the parent, enabling incremental PR stacks.

**Import**: Take an existing branch (already pushed) and create a task around it — useful for
picking up work started elsewhere.

### 6. Tmux (`tmux.ts`)

Thin wrapper around tmux commands.

- `createSession(name, cwd, program, opts)` — new-session, set options, send-keys
- `attachSession(name)` — attach-session (blocks until detach)
- `detachFromSession(name)` — detach-client
- `hasSession(name)` — has-session (boolean liveness check)
- `killSession(name)` — kill-session
- `sendKeys(name, keys)` — send-keys for auto-accept and restart
- `capturePane(name)` — capture-pane for prompt detection during setup

Session options:

- Mouse mode with vi copy-mode bindings
- Custom status bar: back button (click to detach), task title, copy mode indicator
- `TEND_HOME` env var propagated so hook scripts find the right signals directory

### 7. TUI (`tui.ts`)

Interactive terminal dashboard using a library like `@clack/prompts` or similar.

**Main view**: List of tasks with status icon, name, PR info, and snippet.

```
  ● feature-auth          #1234 open    Edit src/middleware/auth.ts
> ◉ fix-timezone          —            which timezone library to use?
  ○ refactor-api          #1230 draft
  ✕ add-logging           —
```

**Navigation**:

- `j`/`k` or arrows — move selection
- `Enter` — attach (or restart if stopped)
- `n` — new task
- `s` — stack on selected task
- `p` — open/create PR
- `e` — open editor
- `d` — close task
- `r` — restart (dev mode)
- `i` — import existing branch
- `a` — toggle fresh/all tasks
- `c` — config screen
- `?` — help
- `q` — quit

**Polling loop**: Every 1-2 seconds, read signal files for all tasks, update status, re-render.

**Fresh/stale split**: Tasks that have been waiting for more than N hours (configurable, default 25)
are collapsed into a "stale" section. Keeps the dashboard focused on active work.

**Terminal title**: Update the terminal tab title with a summary like `tend: 1 waiting, 2 working`
so status is visible even when the dashboard isn't focused.

### 8. Notifications (`notifications.ts`)

Desktop notifications (macOS) when a task transitions to `waiting`, `blocked`, or `done`.

- Use `terminal-notifier` or similar
- Auto-detect terminal app for "click to focus" behavior
- Configurable sound
- Click handler writes a `.attach` signal file that the TUI picks up to switch sessions

### 9. Project Hooks (`tend-hooks.ts`)

Repo-level lifecycle hooks defined in `.tend/settings.jsonc` at the repo root.

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
- Blocking hooks (default) run sequentially; exit code 2 = hard stop
- Async hooks run in background alongside Claude
- Custom commands add key bindings to the TUI for the selected task

## Tech Stack

| Component      | Choice                   | Rationale                                                        |
| -------------- | ------------------------ | ---------------------------------------------------------------- |
| Runtime        | Deno (or Node/Bun)       | Good TS support, single binary distribution possible             |
| TUI rendering  | @clack/prompts or ink    | Terminal UI primitives                                           |
| Git operations | Shell out to `git`       | Worktree/bare-clone operations aren't well-served by JS git libs |
| Tmux           | Shell out to `tmux`      | Direct CLI interaction                                           |
| Config format  | JSON                     | Simple, no dependencies                                          |
| Distribution   | npm or standalone binary | `deno compile` for single binary, or npm for Node                |

## File Layout

```
~/.tend/
  config.json              # user configuration
  state.json               # task state (persisted across restarts)
  tend.log                 # structured log file
  hooks/
    tend-signal            # shell script installed once
  signals/
    <session-name>         # one signal file per active task
  repos/
    <repo-name>.git/       # bare clones
  worktrees/
    <repo>/<branch>/       # git worktrees (one per task)
  sessions/
    <task-id>/             # cached Claude session .jsonl files
```

## What's Excluded (Slack-specific)

The following features from slack-tend are intentionally excluded:

- **DevSpaces / remote SSH sessions** — no remote host management, SSH tunneling, or devspace
  provisioning. All tasks are local.
- **DevSpace checkpoint API** — no hibernation/wake detection
- **`slack-github.com` (GHE) support** — standard `github.com` only (via `gh` CLI)
- **`KNOWN_REPOS` hardcoded list** — no pre-populated repo metadata
- **`slack-cli-tools` distribution** — standalone tool, not part of a monolithic CLI suite
- **`cassh` SSH authentication** — standard SSH
- **Remote dotfile syncing** — no `syncClaudeDirs` to remote hosts

These can be re-added as optional plugins or configuration if needed later.

## MVP Scope

Phase 1 — core loop:

1. Config management (add repos, set branch prefix)
2. Git bare clone + worktree management
3. tmux session creation with Claude Code
4. Hook installation and signal file monitoring
5. TUI dashboard with status rendering and attach/detach
6. Task create, restart, close

Phase 2 — polish:

1. PR integration (open/create via `gh`)
2. Branch stacking
3. Import existing branches
4. Desktop notifications
5. Project hooks (`.tend/settings.jsonc`)
6. Custom commands
7. Rich agent status reporting (CLAUDE.md rules injection)
8. Auto-accept startup prompts
9. Session caching and `--resume` on restart

## Open Questions

1. **Distribution**: npm package, standalone Deno binary, or Homebrew formula?
2. **Non-macOS notifications**: What's the equivalent of `terminal-notifier` on Linux?
3. **Multiple GitHub hosts**: Worth supporting GHE out of the box, or leave as a future extension?
4. **Editor integration**: Should "open in editor" support more than VS Code/Cursor? (Neovim, Zed,
   etc.)
