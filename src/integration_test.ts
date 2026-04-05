// src/integration_test.ts — end-to-end integration test
//
// Requires: git, tmux
// Creates a local git repo, registers it, creates a task, checks status, then cleans up.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DEFAULT_CONFIG, saveConfig } from "./config.ts";
import { closeTask, createTask } from "./tasks.ts";
import { hasSession } from "./tmux.ts";
import { runOk } from "./run.ts";
import { ensureBareClone } from "./git.ts";
import { repoNameFromUrl, repoPath } from "./paths.ts";
import type { Config, State } from "./types.ts";

Deno.test({
  name: "integration: create and close a task",
  sanitizeResources: false,
  sanitizeOps: false,
  ignore: Deno.env.get("CI") === "true",
  async fn() {
    const testDir = await Deno.makeTempDir({ prefix: "hive-integration-" });
    const hiveHome = join(testDir, ".hive");
    const origHiveHome = Deno.env.get("HIVE_HOME");
    Deno.env.set("HIVE_HOME", hiveHome);

    try {
      // Create a local git repo to use as "remote"
      // Use org/repo structure so repoNameFromUrl can parse the path
      const remoteDir = join(testDir, "test-org", "test-repo.git");
      await Deno.mkdir(join(testDir, "test-org"), { recursive: true });
      await runOk(["git", "init", "--bare", "--initial-branch=main", remoteDir]);
      const workDir = join(testDir, "work");
      await runOk(["git", "clone", remoteDir, workDir]);
      await Deno.writeTextFile(join(workDir, "README.md"), "# test");
      await runOk(["git", "-c", "user.name=Test", "-c", "user.email=test@test.com", "add", "."], {
        cwd: workDir,
      });
      await runOk([
        "git",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@test.com",
        "commit",
        "-m",
        "init",
      ], { cwd: workDir });
      await runOk(["git", "push"], { cwd: workDir });

      // Set up config
      const config: Config = {
        ...DEFAULT_CONFIG,
        branchPrefix: "test-",
        repos: {
          "test-repo": {
            url: remoteDir,
            defaultBranch: "main",
          },
        },
        defaults: { program: "echo 'hello from hive test'" },
      };
      await saveConfig(config, hiveHome);

      // Pre-create the bare clone and fetch so origin/main refs exist
      const repoName = repoNameFromUrl(remoteDir);
      const bare = repoPath(repoName);
      await ensureBareClone(remoteDir, bare);
      // ensureBareClone sets refspec but doesn't fetch on first clone — do it now
      await runOk(["git", "fetch", "origin"], { cwd: bare });

      // Create task
      const state: State = { tasks: {} };
      const task = await createTask({
        name: "my-task",
        repo: "test-repo",
        repoConfig: config.repos["test-repo"],
        program: config.defaults.program,
        branchPrefix: config.branchPrefix,
        config,
      }, state);

      assertEquals(task.id, "my-task");
      assertEquals(task.branch, "test-my-task");
      assert(task.worktreePath.includes("my-task"));

      // tmux session should exist
      const alive = await hasSession(task.tmuxSession);
      assertEquals(alive, true);

      // Close task
      await closeTask(task, state, config);

      // tmux session should be gone
      const aliveAfter = await hasSession(task.tmuxSession);
      assertEquals(aliveAfter, false);

      // State should be empty
      assertEquals(Object.keys(state.tasks).length, 0);
    } finally {
      // Restore HIVE_HOME
      if (origHiveHome) {
        Deno.env.set("HIVE_HOME", origHiveHome);
      } else {
        Deno.env.delete("HIVE_HOME");
      }
      // Clean up any lingering tmux sessions
      try {
        await runOk(["tmux", "kill-session", "-t", "hive-my-task"]);
      } catch { /* ok */ }
    }
  },
});
