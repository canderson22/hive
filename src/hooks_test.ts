// src/hooks_test.ts
import { assert } from "@std/assert";
import { join } from "@std/path";
import { installHooksConfig, installSignalScript } from "./hooks.ts";

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

    // Verify new hook format with matcher + hooks array
    const entry = content.hooks.UserPromptSubmit[0];
    assert(entry.matcher === "", "Should have empty matcher");
    assert(Array.isArray(entry.hooks), "Should have hooks array");
    const cmd = entry.hooks[0].command;
    assert(entry.hooks[0].type === "command", "Hook type should be command");
    assert(cmd.includes(sessionName), `Command should include session name: ${cmd}`);
    assert(cmd.includes("hive-signal"), `Command should reference hive-signal: ${cmd}`);
  },
});
