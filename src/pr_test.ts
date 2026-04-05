// src/pr_test.ts
import { assertEquals } from "@std/assert";
import { generatePrBody, generatePrTitle } from "./pr.ts";

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
