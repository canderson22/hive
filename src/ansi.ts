// src/ansi.ts — ANSI escape code helpers for terminal rendering

import type { Status } from "./types.ts";

export function bold(s: string): string {
  return `\x1b[1m${s}\x1b[22m`;
}

export function dim(s: string): string {
  return `\x1b[2m${s}\x1b[22m`;
}

export function green(s: string): string {
  return `\x1b[32m${s}\x1b[39m`;
}

export function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[39m`;
}

export function red(s: string): string {
  return `\x1b[31m${s}\x1b[39m`;
}

export function cyan(s: string): string {
  return `\x1b[36m${s}\x1b[39m`;
}

export function magenta(s: string): string {
  return `\x1b[35m${s}\x1b[39m`;
}

export function gray(s: string): string {
  return `\x1b[90m${s}\x1b[39m`;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const STATUS_ICONS: Record<Status, string> = {
  working: "●",
  waiting: "◉",
  blocked: "◉",
  done: "○",
  idle: "○",
  stopped: "✕",
};

const STATUS_COLOR_FN: Record<Status, (s: string) => string> = {
  working: green,
  waiting: yellow,
  blocked: magenta,
  done: cyan,
  idle: dim,
  stopped: red,
};

export function statusIcon(status: Status): string {
  return STATUS_ICONS[status];
}

export function statusColor(status: Status, text: string): string {
  return STATUS_COLOR_FN[status](text);
}

export function clearScreen(): string {
  return "\x1b[2J\x1b[H";
}

export function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

export function hideCursor(): string {
  return "\x1b[?25l";
}

export function showCursor(): string {
  return "\x1b[?25h";
}

export function setTitle(title: string): string {
  return `\x1b]0;${title}\x07`;
}

export function clearLine(): string {
  return "\x1b[2K";
}
