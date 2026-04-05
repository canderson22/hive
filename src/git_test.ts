// src/git_test.ts
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  consumeReadyWorktree,
  createWorktree,
  ensureBareClone,
  ensureReadyWorktree,
  ensureRefspec,
  hasReadyWorktree,
  removeWorktree,
  resolveHead,
} from "./git.ts";
import { runOk } from "./run.ts";

async function createTestRepo(dir: string): Promise<string> {
  const repoDir = join(dir, "origin.git");
  await runOk(["git", "init", "--bare", "--initial-branch=main", repoDir]);
  // Create a working clone to make commits
  const workDir = join(dir, "work");
  await runOk(["git", "clone", repoDir, workDir]);
  // Configure git identity for the temp repo
  await runOk(["git", "config", "user.email", "test@test.com"], { cwd: workDir });
  await runOk(["git", "config", "user.name", "Test"], { cwd: workDir });
  await Deno.writeTextFile(join(workDir, "README.md"), "# test");
  await runOk(["git", "add", "."], { cwd: workDir });
  await runOk(["git", "commit", "-m", "init"], { cwd: workDir });
  await runOk(["git", "push"], { cwd: workDir });
  return repoDir;
}

Deno.test({
  name: "ensureBareClone creates a bare clone",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");

    await ensureBareClone(originUrl, bareDir);

    // Verify it's a bare repo
    const result = await runOk(["git", "rev-parse", "--is-bare-repository"], { cwd: bareDir });
    assertEquals(result, "true");
  },
});

Deno.test({
  name: "ensureBareClone fetches when clone already exists",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");

    await ensureBareClone(originUrl, bareDir);
    // Second call should fetch, not fail
    await ensureBareClone(originUrl, bareDir);

    const result = await runOk(["git", "rev-parse", "--is-bare-repository"], { cwd: bareDir });
    assertEquals(result, "true");
  },
});

Deno.test({
  name: "ensureRefspec fixes bare clone refspec",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);

    await ensureRefspec(bareDir);

    const refspec = await runOk(["git", "config", "--get", "remote.origin.fetch"], {
      cwd: bareDir,
    });
    assertEquals(refspec, "+refs/heads/*:refs/remotes/origin/*");
  },
});

Deno.test({
  name: "createWorktree creates a worktree with new branch",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);
    await ensureRefspec(bareDir);
    await runOk(["git", "fetch", "origin"], { cwd: bareDir });

    const wtPath = join(dir, "worktrees", "test-branch");
    await createWorktree(bareDir, wtPath, "test-branch", "origin/main");

    // Verify worktree exists and has the file
    const readme = await Deno.readTextFile(join(wtPath, "README.md"));
    assertEquals(readme, "# test");

    // Verify branch name
    const branch = await runOk(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: wtPath });
    assertEquals(branch, "test-branch");
  },
});

Deno.test({
  name: "resolveHead returns commit SHA",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);
    await ensureRefspec(bareDir);
    await runOk(["git", "fetch", "origin"], { cwd: bareDir });

    const wtPath = join(dir, "worktrees", "test-branch");
    await createWorktree(bareDir, wtPath, "test-branch", "origin/main");

    const sha = await resolveHead(wtPath);
    assert(sha.match(/^[0-9a-f]{40}$/), `Expected SHA, got: ${sha}`);
  },
});

Deno.test({
  name: "removeWorktree cleans up",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);
    await ensureRefspec(bareDir);
    await runOk(["git", "fetch", "origin"], { cwd: bareDir });

    const wtPath = join(dir, "worktrees", "test-branch");
    await createWorktree(bareDir, wtPath, "test-branch", "origin/main");
    await removeWorktree(bareDir, wtPath);

    try {
      await Deno.stat(wtPath);
      assert(false, "Worktree directory should have been removed");
    } catch (e) {
      assert(e instanceof Deno.errors.NotFound);
    }
  },
});

Deno.test({
  name: "ensureReadyWorktree provisions a _ready worktree",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);
    await runOk(["git", "fetch", "origin"], { cwd: bareDir });

    const readyPath = join(dir, "worktrees", "test-repo", "_ready");
    assertEquals(await hasReadyWorktree(readyPath), false);

    await ensureReadyWorktree(bareDir, readyPath, "main");
    assertEquals(await hasReadyWorktree(readyPath), true);

    // Verify it's a detached HEAD
    const result = await runOk(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: readyPath });
    assertEquals(result, "HEAD");
  },
});

Deno.test({
  name: "consumeReadyWorktree moves ready to branch worktree",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);
    await runOk(["git", "fetch", "origin"], { cwd: bareDir });

    const readyPath = join(dir, "worktrees", "test-repo", "_ready");
    await ensureReadyWorktree(bareDir, readyPath, "main");

    const targetPath = join(dir, "worktrees", "test-repo", "my-feature");
    await consumeReadyWorktree(bareDir, readyPath, targetPath, "my-feature", "origin/main");

    // Ready should be gone
    assertEquals(await hasReadyWorktree(readyPath), false);

    // Target should exist with correct branch
    const branch = await runOk(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: targetPath });
    assertEquals(branch, "my-feature");

    // File should be present
    const readme = await Deno.readTextFile(join(targetPath, "README.md"));
    assertEquals(readme, "# test");
  },
});

Deno.test({
  name: "ensureReadyWorktree deduplicates concurrent calls",
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "hive-git-test-" });
    const originUrl = await createTestRepo(dir);
    const bareDir = join(dir, "bare-clone.git");
    await ensureBareClone(originUrl, bareDir);
    await runOk(["git", "fetch", "origin"], { cwd: bareDir });

    const readyPath = join(dir, "worktrees", "test-repo", "_ready");

    // Fire two concurrent provisions — should not error
    await Promise.all([
      ensureReadyWorktree(bareDir, readyPath, "main"),
      ensureReadyWorktree(bareDir, readyPath, "main"),
    ]);

    assertEquals(await hasReadyWorktree(readyPath), true);
  },
});
