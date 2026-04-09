// src/pr_test.ts
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { detectPrGuidelines, generatePrBody, generatePrTitle } from "./pr.ts";

Deno.test("generatePrTitle strips prefix and formats branch name", () => {
  assertEquals(generatePrTitle("charles-feature-auth", "charles-"), "Feature auth");
  assertEquals(generatePrTitle("charles-fix-timezone-bug", "charles-"), "Fix timezone bug");
  assertEquals(generatePrTitle("add-logging", ""), "Add logging");
});

Deno.test("generatePrBody includes summary and files", () => {
  const body = generatePrBody(
    "- init commit\n- add auth middleware",
    " src/auth.ts | 50 +++\n src/index.ts | 2 +\n 2 files changed",
  );
  assertEquals(body.includes("## Summary"), true);
  assertEquals(body.includes("init commit"), true);
  assertEquals(body.includes("## Files Changed"), true);
  assertEquals(body.includes("src/auth.ts"), true);
});

Deno.test("detectPrGuidelines finds PR template", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, ".github"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".github", "pull_request_template.md"),
    "## What\n\n## Why\n\n## Testing\n",
  );
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.template !== undefined, true);
  assertEquals(guidelines.template!.includes("## What"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines finds CONTRIBUTING.md", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "CONTRIBUTING.md"), "# Contributing\nPlease include tests.");
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.guidelines !== undefined, true);
  assertEquals(guidelines.guidelines!.includes("include tests"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines finds CLAUDE.md", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "CLAUDE.md"), "PR titles must be lowercase.");
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.guidelines !== undefined, true);
  assertEquals(guidelines.guidelines!.includes("lowercase"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines returns empty for bare dir", async () => {
  const dir = await Deno.makeTempDir();
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.template, undefined);
  assertEquals(guidelines.guidelines, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("detectPrGuidelines finds rules with PR mention", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, ".claude", "rules"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".claude", "rules", "pr-process.md"),
    "When creating a PR, always include a test plan.",
  );
  await Deno.writeTextFile(
    join(dir, ".claude", "rules", "coding-style.md"),
    "Use 2-space indentation.",
  );
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.guidelines !== undefined, true);
  assertEquals(guidelines.guidelines!.includes("test plan"), true);
  assertEquals(guidelines.guidelines!.includes("indentation"), false);
  await Deno.remove(dir, { recursive: true });
});
