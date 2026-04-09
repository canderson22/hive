// src/ci_test.ts
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { detectTestCommand } from "./ci.ts";

Deno.test("detectTestCommand finds deno.json", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "deno.json"), "{}");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "deno test");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds package.json with test script", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "jest" } }),
  );
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "npm test");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand skips package.json without test script", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { build: "tsc" } }),
  );
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds Makefile with test target", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "Makefile"), "test:\n\tpytest\n");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "make test");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds pytest.ini", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "pytest.ini"), "[pytest]\n");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "pytest");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand finds pyproject.toml", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "pyproject.toml"), "[tool.pytest]\n");
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "pytest");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand returns null for empty dir", async () => {
  const dir = await Deno.makeTempDir();
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectTestCommand prefers deno.json over package.json", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "deno.json"), "{}");
  await Deno.writeTextFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "jest" } }),
  );
  const cmd = await detectTestCommand(dir);
  assertEquals(cmd, "deno test");
  await Deno.remove(dir, { recursive: true });
});

import { runTests } from "./ci.ts";

Deno.test("runTests returns passed for exit code 0", async () => {
  const dir = await Deno.makeTempDir();
  const result = await runTests("true", dir);
  assertEquals(result, "passed");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("runTests returns failed for non-zero exit code", async () => {
  const dir = await Deno.makeTempDir();
  const result = await runTests("false", dir);
  assertEquals(result, "failed");
  await Deno.remove(dir, { recursive: true });
});

import { CiManager } from "./ci.ts";

Deno.test("CiManager.getStatus returns null initially", () => {
  const mgr = new CiManager();
  assertEquals(mgr.getStatus("task-1"), null);
});

Deno.test("CiManager.trigger runs tests and stores result", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new CiManager();
  await mgr.trigger("task-1", "true", dir);
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(mgr.getStatus("task-1"), "passed");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("CiManager.trigger stores failed result", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new CiManager();
  await mgr.trigger("task-2", "false", dir);
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(mgr.getStatus("task-2"), "failed");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("CiManager.trigger sets running while in progress", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new CiManager();
  const promise = mgr.trigger("task-3", "sleep 1", dir);
  assertEquals(mgr.getStatus("task-3"), "running");
  await promise;
  await Deno.remove(dir, { recursive: true });
});
