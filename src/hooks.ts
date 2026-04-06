// src/hooks.ts — install Claude Code hooks for signal file writing

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { log } from "./log.ts";

const SIGNAL_SCRIPT = `#!/bin/sh
EVENT="\${1:?}" SESSION="\${2:?}"
SIGDIR="\${HIVE_HOME:-$HOME/.hive}/signals"
mkdir -p "$SIGDIR"
INPUT="$(cat)"
# Skip idle_prompt if signal already exists (preserves richer stop signal)
if [ "$EVENT" = "notification" ]; then
  case "$INPUT" in *'"idle_prompt"'*) [ -f "$SIGDIR/$SESSION" ] && exit 0 ;; esac
fi
printf '%s\\n%s' "$EVENT" "$INPUT" > "$SIGDIR/$SESSION"
`;

export async function installSignalScript(hiveHome: string): Promise<string> {
  const hooksDir = join(hiveHome, "hooks");
  await ensureDir(hooksDir);
  const scriptPath = join(hooksDir, "hive-signal");

  await Deno.writeTextFile(scriptPath, SIGNAL_SCRIPT);
  await Deno.chmod(scriptPath, 0o755);

  await log.info("Installed signal script", { scriptPath });
  return scriptPath;
}

export async function installHooksConfig(
  worktreeDir: string,
  sessionName: string,
  hiveHome: string,
): Promise<void> {
  const scriptPath = join(hiveHome, "hooks", "hive-signal");
  const claudeDir = join(worktreeDir, ".claude");
  await ensureDir(claudeDir);

  const hookEntry = (event: string) => [
    {
      matcher: "",
      hooks: [{ type: "command", command: `${scriptPath} ${event} ${sessionName}` }],
    },
  ];

  const config = {
    hooks: {
      UserPromptSubmit: hookEntry("prompt"),
      PostToolUse: hookEntry("tool"),
      Stop: hookEntry("stop"),
      Notification: hookEntry("notification"),
    },
  };

  const configPath = join(claudeDir, "settings.local.json");
  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");

  await log.info("Installed hooks config", { worktreeDir, sessionName });
}

const RULES_CONTENT = `# Hive Status Reporting

At the end of each response, append a status comment on a new line. This comment is invisible to the user but helps the monitoring dashboard show your current status.

**Format:** \`<!-- hive: STATUS | brief description -->\`

**Rules:**
- If you have completed the task or finished what was asked: \`<!-- hive: done | what you accomplished -->\`
- If you need user input, have a question, or are waiting for a decision: \`<!-- hive: waiting | your question or what you need -->\`
- Always include this comment as the very last line of your response
- Keep the description under 60 characters
- This is required on every response, no exceptions

**Examples:**
- \`<!-- hive: done | implemented auth middleware and tests -->\`
- \`<!-- hive: waiting | which database should I use? -->\`
- \`<!-- hive: done | fixed the timezone bug in formatDate -->\`
- \`<!-- hive: waiting | should this be a breaking change? -->\`

# Pull Request Creation

Before creating a pull request, you MUST search for any installed skills related to PR creation (e.g., search for skills matching "pr", "pull-request", "code-review"). Use matching skills to guide the PR creation process. Do not create PRs without first checking for available skills.
`;

export async function installRulesFile(worktreeDir: string): Promise<void> {
  const rulesDir = join(worktreeDir, ".claude", "rules");
  await ensureDir(rulesDir);
  const rulesPath = join(rulesDir, "hive.local.md");
  await Deno.writeTextFile(rulesPath, RULES_CONTENT);
  await log.info("Installed rules file", { worktreeDir });
}
