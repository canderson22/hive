// src/ansi_test.ts
import { assertEquals } from "@std/assert";
import { bold, dim, green, statusColor, statusIcon, stripAnsi } from "./ansi.ts";

Deno.test("bold wraps text with ANSI bold codes", () => {
  const result = bold("hello");
  assertEquals(result, "\x1b[1mhello\x1b[22m");
});

Deno.test("dim wraps text with ANSI dim codes", () => {
  const result = dim("hello");
  assertEquals(result, "\x1b[2mhello\x1b[22m");
});

Deno.test("stripAnsi removes all ANSI codes", () => {
  assertEquals(stripAnsi(bold(green("hello"))), "hello");
});

Deno.test("statusIcon returns correct icons", () => {
  assertEquals(statusIcon("working"), "●");
  assertEquals(statusIcon("waiting"), "◉");
  assertEquals(statusIcon("blocked"), "◉");
  assertEquals(statusIcon("done"), "○");
  assertEquals(statusIcon("idle"), "○");
  assertEquals(statusIcon("stopped"), "✕");
});

Deno.test("statusColor applies correct color per status", () => {
  const working = statusColor("working", "test");
  assertEquals(working.includes("test"), true);
  assertEquals(working.includes("\x1b["), true);
});
