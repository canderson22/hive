// src/paths_test.ts
import { assertEquals, assertThrows } from "@std/assert";
import { repoNameFromUrl } from "./paths.ts";

Deno.test("repoNameFromUrl parses HTTPS URL", () => {
  assertEquals(
    repoNameFromUrl("https://github.com/anthropics/claude-code.git"),
    "anthropics-claude-code",
  );
});

Deno.test("repoNameFromUrl parses HTTPS URL without .git", () => {
  assertEquals(
    repoNameFromUrl("https://github.com/anthropics/claude-code"),
    "anthropics-claude-code",
  );
});

Deno.test("repoNameFromUrl parses SSH URL", () => {
  assertEquals(
    repoNameFromUrl("git@github.com:anthropics/claude-code.git"),
    "anthropics-claude-code",
  );
});

Deno.test("repoNameFromUrl throws on invalid URL", () => {
  assertThrows(() => repoNameFromUrl("not-a-url"));
});
