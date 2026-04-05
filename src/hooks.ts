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
    { command: `${scriptPath} ${event} ${sessionName}` },
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
