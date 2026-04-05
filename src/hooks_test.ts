// src/hooks_test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { installSignalScript, installHooksConfig } from "./hooks.ts";

Deno.test({
  name: "installSignalScript creates executable script",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-hooks-test-" });
    const scriptPath = join(dir, "hooks", "hive-signal");

    await installSignalScript(dir);

    const content = await Deno.readTextFile(scriptPath);
    assert(content.startsWith("#!/bin/sh"));
    assert(content.includes("SIGDIR="));
    assert(content.includes("idle_prompt"));

    // Check executable permission
    const stat = await Deno.stat(scriptPath);
    assert(stat.mode !== null && (stat.mode & 0o111) !== 0, "Script should be executable");
  },
});

Deno.test({
  name: "installHooksConfig writes .claude/settings.local.json",
  sanitizeResources: false,
  async fn() {
    const worktreeDir = await Deno.makeTempDir({ prefix: "hive-hooks-test-" });
    const hiveHome = await Deno.makeTempDir({ prefix: "hive-hooks-test-home-" });
    const sessionName = "hive-test-task";

    await installHooksConfig(worktreeDir, sessionName, hiveHome);

    const configPath = join(worktreeDir, ".claude", "settings.local.json");
    const content = JSON.parse(await Deno.readTextFile(configPath));

    assert(content.hooks);
    assert(content.hooks.UserPromptSubmit);
    assert(content.hooks.PostToolUse);
    assert(content.hooks.Stop);
    assert(content.hooks.Notification);

    // Verify session name is in the command
    const cmd = content.hooks.UserPromptSubmit[0].command;
    assert(cmd.includes(sessionName), `Command should include session name: ${cmd}`);
    assert(cmd.includes("hive-signal"), `Command should reference hive-signal: ${cmd}`);
  },
});
