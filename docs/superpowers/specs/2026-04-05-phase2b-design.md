# Phase 2b: Resume, Notifications, Rich Status, CI/Release

## 1. Session `--resume`

On restart (`r` key) or auto-restart (Enter on stopped task):

1. Scan `.claude/projects/` in the worktree for session files (`.jsonl`)
2. Find the most recent session ID from the filename
3. Kill old tmux session, create fresh one
4. Launch `claude --resume <sessionId>` instead of plain `claude`
5. If Claude exits within 3 seconds (session was already complete), kill and restart without `--resume`

**Files:** Modify `src/tasks.ts` — update `restartTask` to find session ID and pass `--resume`.

## 2. Desktop Notifications

When a task transitions to `waiting`, `blocked`, or `done` (and wasn't in that state on the previous poll):

- Use `osascript` to fire a macOS notification (no extra dependencies)
- Title: "hive — {taskName}"
- Body: snippet text
- Sound: default system sound
- Configurable via `config.notifications` (default false)
- Add toggle to config menu

**Files:**
- Create `src/notifications.ts` — `notify(title, body)` using osascript
- Modify `src/tui.ts` — track previous statuses, fire notifications on transitions
- Modify `src/tui.ts` — add notifications toggle to config menu

## 3. Rich Agent Status Reporting

When `config.agentStatusReporting` is enabled, install a rules file at `.claude/rules/hive.local.md` in the worktree during task creation. The rules file instructs Claude to append status metadata to responses.

The monitor already parses `<!-- hive: done | ... -->` and `<!-- hive: waiting | ... -->` — this just enables the trigger.

**Files:**
- Modify `src/hooks.ts` — add `installRulesFile(worktreeDir)` function
- Modify `src/tasks.ts` — call `installRulesFile` during create/import when config flag is set
- Modify `src/tui.ts` — add toggle to config menu

## 4. CI / Release Pipeline

GitHub Actions workflow triggered on tag push (`v*`):
1. Run `deno test`
2. `deno compile --target` for darwin-arm64, darwin-x64, linux-x64
3. Create GitHub release with binaries attached

Homebrew tap at `canderson22/homebrew-tap`:
- Formula downloads the binary from the GitHub release
- Install: `brew tap canderson22/tap && brew install hive-cli`

**Files:**
- Create `.github/workflows/release.yml`
- Create Homebrew formula (separate repo or documented)

## Files Changed Summary

- Modify: `src/tasks.ts` — resume logic, rules file install
- Create: `src/notifications.ts` — macOS notifications via osascript
- Modify: `src/hooks.ts` — add installRulesFile
- Modify: `src/tui.ts` — notification transitions, config toggles
- Create: `.github/workflows/release.yml` — CI/CD
