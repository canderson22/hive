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

Deno.test("detectPrGuidelines returns empty for bare dir", async () => {
  const dir = await Deno.makeTempDir();
  const guidelines = await detectPrGuidelines(dir);
  assertEquals(guidelines.template, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("generatePrBody uses template when provided", () => {
  const template = "## What\n\n## Why\n\n## Testing\n";
  const body = generatePrBody(
    "- add auth\n- add tests",
    " src/auth.ts | 50 +++\n 1 file changed",
    { template },
  );
  assertEquals(body.includes("## What"), true);
  assertEquals(body.includes("add auth"), true);
  assertEquals(body.includes("## Summary"), false);
});

Deno.test("generatePrBody default format without template", () => {
  const body = generatePrBody(
    "- fix bug",
    " src/fix.ts | 5 +\n 1 file changed",
  );
  assertEquals(body.includes("## Summary"), true);
  assertEquals(body.includes("fix bug"), true);
  assertEquals(body.includes("## Files Changed"), true);
  assertEquals(body.includes("## Test Notes"), true);
});
