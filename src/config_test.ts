// src/config_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadConfig, saveConfig, loadState, saveState, DEFAULT_CONFIG } from "./config.ts";

const TEST_DIR = await Deno.makeTempDir({ prefix: "hive-test-" });

Deno.test({
  name: "loadConfig returns defaults when no file exists",
  async fn() {
    const config = await loadConfig(TEST_DIR);
    assertEquals(config.branchPrefix, "");
    assertEquals(config.editor, "code");
    assertEquals(config.defaults.program, "claude");
    assertEquals(config.staleThresholdHours, 25);
    assertEquals(Object.keys(config.repos).length, 0);
  },
});

Deno.test({
  name: "saveConfig then loadConfig round-trips",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-test-" });
    const config = { ...DEFAULT_CONFIG, branchPrefix: "test-" };
    await saveConfig(config, dir);
    const loaded = await loadConfig(dir);
    assertEquals(loaded.branchPrefix, "test-");
  },
});

Deno.test({
  name: "loadState returns empty state when no file exists",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-test-" });
    const state = await loadState(dir);
    assertEquals(Object.keys(state.tasks).length, 0);
    assertEquals(state.lastRepo, undefined);
  },
});

Deno.test({
  name: "saveState then loadState round-trips",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-test-" });
    const state = {
      tasks: {
        "test-task": {
          id: "test-task",
          repo: "org-repo",
          branch: "test-branch",
          baseBranch: "main",
          worktreePath: "/tmp/wt",
          tmuxSession: "hive-test-task",
          program: "claude",
          createdAt: "2026-04-05T00:00:00Z",
        },
      },
      lastRepo: "org-repo",
    };
    await saveState(state, dir);
    const loaded = await loadState(dir);
    assertEquals(loaded.tasks["test-task"].repo, "org-repo");
    assertEquals(loaded.lastRepo, "org-repo");
  },
});
