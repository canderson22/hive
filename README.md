# hive

Multi-session Claude Code coordinator — manage parallel AI agents from a single terminal dashboard.

## Features

- **Multiple sessions** — run several Claude Code instances in parallel, each in its own git worktree
- **Live dashboard** — see what every agent is doing at a glance (working, waiting, blocked, done)
- **Git isolation** — each task gets its own branch and worktree, no conflicts
- **PR integration** — create and track PRs with `p`, auto-generated title and body
- **Branch stacking** — stack tasks with `s` for incremental PR chains
- **Session resume** — restart tasks and pick up where Claude left off
- **Desktop notifications** — get notified when agents need input or finish

## Install

### Homebrew (macOS)

```bash
brew tap canderson22/tap
brew install hive
```

### Download binary

Grab the latest release from [GitHub Releases](https://github.com/canderson22/hive/releases).

### From source (requires Deno)

```bash
deno install -g --allow-env --allow-read --allow-write --allow-run --allow-net https://raw.githubusercontent.com/canderson22/hive/main/cli.ts -n hive
```

## Requirements

- **tmux** — `brew install tmux`
- **git** — already installed on most systems
- **gh** (optional) — `brew install gh` for PR features
- **Claude Code** — the AI coding assistant

## Quick Start

```bash
hive
```

On first launch, hive walks you through setup: branch prefix, editor, and repo scanning.

## Dashboard Keys

| Key | Action |
|-----|--------|
| `j`/`k` | Navigate tasks |
| `Enter` | Attach to session |
| `n` | New task |
| `s` | Stack on selected task |
| `i` | Import existing branch |
| `p` | Create/view PR |
| `d` | Close task |
| `r` | Restart task |
| `e` | Open editor |
| `c` | Config |
| `q` | Quit |

## How It Works

Each task runs Claude Code in a tmux session with its own git worktree. Claude Code hooks write signal files that hive polls every 1.5 seconds to determine status. The dashboard renders with ANSI escape codes for a fast, flicker-free display.

## License

MIT
