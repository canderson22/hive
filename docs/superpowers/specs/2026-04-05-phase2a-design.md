# Phase 2a: PR Integration, Branch Stacking, Import

Design spec for the first batch of Phase 2 features for hive.

## 1. PR Integration (`p` key)

When the user presses `p` on a selected task:

**If no PR exists:**

1. Run `git log <baseBranch>..HEAD` and `git diff <baseBranch>..HEAD --stat` in the task's worktree
   to gather context (commit messages, files changed)
2. Auto-generate a PR title from the branch name (strip prefix, convert dashes to spaces, title
   case)
3. Auto-generate a PR body with:
   - **Summary**: derived from commit messages
   - **Files changed**: from `git diff --stat`
   - **Test notes**: placeholder section for reviewer
4. Create the PR via
   `gh pr create --title <title> --body <body> --base <baseBranch> --head <branch>`
   (non-interactive)
5. Cache the PR metadata in `state.prCache["repo:branch"]` with `{ number, state, url }`

**If PR already exists:**

- Run `gh pr view <branch> --json number,state,url` and open in browser via `gh pr view --web`

**Dashboard display:**

- Show PR info next to the task name: `#1234 open` or `#1234 draft`
- PR state is refreshed from cache; cache is updated on `p` press and periodically (piggyback on
  background fetch loop)

**Data model addition to State:**

```typescript
prCache?: Record<string, { number: number; state: string; url: string }>;
```

Key format: `"<repoName>:<branch>"` (e.g. `"canderson22-tempo:charles-feature-auth"`)

## 2. Branch Stacking (`s` key)

When the user presses `s` on a selected task:

1. Prompt for the new task name (same clack text input as `n`)
2. Fetch the parent task's branch into the bare clone
3. Create a new task with `baseBranch` set to the parent task's branch (not the repo default)
4. The worktree branches off the parent's HEAD via `origin/<parentBranch>`

The parent-child relationship is implicit via `baseBranch` — no new data model needed. When the
stacked task creates a PR, `--base` is set to the parent's branch, so the PR only shows the
incremental diff.

## 3. Import Existing Branches (`i` key)

When the user presses `i`:

1. Prompt for repo (if multiple repos configured, otherwise auto-select)
2. Prompt for branch name (text input)
3. Fetch that branch from remote into the bare clone
4. Create worktree using the existing branch (uses the branch-exists fallback in `createWorktree` —
   no `-b` flag)
5. Install hooks, launch Claude in tmux, save task
6. The `baseBranch` is set to the repo's default branch

## 4. Multi-Repo Task Display

When tasks span multiple repos, prefix the task name with the repo name for clarity:

- **Multiple repos in task list**: show `Tempo/feature-auth`
- **Single repo in task list**: show just `feature-auth` (no prefix)

Detection: check if `new Set(tasks.map(t => t.repo)).size > 1`.

The repo display name is the config key (e.g. "Tempo"), not the derived repo name (e.g.
"canderson22-tempo"). This requires storing the config key on the Task or looking it up from config.

**Approach**: Add `repoDisplayName` to Task (set at creation time from the config key) so the TUI
doesn't need to reverse-lookup from URL-derived names.

```typescript
interface Task {
  // ... existing fields
  repoDisplayName?: string; // config key, e.g. "Tempo"
}
```

## Files Changed

- **Modify**: `src/types.ts` — add `prCache` to State, add `repoDisplayName` to Task
- **Create**: `src/pr.ts` — PR creation, viewing, cache management
- **Modify**: `src/tasks.ts` — add stacking support (baseBranch from parent), import flow, set
  repoDisplayName
- **Modify**: `src/tui.ts` — add `p`, `s`, `i` key handlers; update renderTaskLine for PR info and
  repo prefix
- **Modify**: `src/background.ts` — refresh PR cache during periodic fetch
