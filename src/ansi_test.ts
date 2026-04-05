// src/ansi_test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bold,
  dim,
  green,
  yellow,
  red,
  cyan,
  magenta,
  stripAnsi,
  statusIcon,
  statusColor,
} from "./ansi.ts";
import type { Status } from "./types.ts";

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
