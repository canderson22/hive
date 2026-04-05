// src/tmux.ts — thin wrapper around tmux commands

import { run, runOk, runStatus } from "./run.ts";
import { log } from "./log.ts";

export interface SessionOpts {
  mouse?: boolean;
  statusBar?: boolean;
  hiveHome?: string;
}

export async function createSession(
  name: string,
  cwd: string,
  program: string,
  opts: SessionOpts = {},
): Promise<void> {
  // Create detached session
  const env: Record<string, string> = {};
  if (opts.hiveHome) env["HIVE_HOME"] = opts.hiveHome;

  await runOk([
    "tmux", "new-session", "-d", "-s", name, "-c", cwd,
  ], { env: Object.keys(env).length > 0 ? env : undefined });

  // Set session options
  if (opts.mouse) {
    await runOk(["tmux", "set-option", "-t", name, "mouse", "on"]);
    await runOk(["tmux", "set-option", "-t", name, "-w", "mode-keys", "vi"]);
  }

  if (opts.statusBar) {
    // Custom status bar: back button | task name | copy mode indicator
    await runOk([
      "tmux", "set-option", "-t", name, "status-left",
      `#[bg=colour236,fg=colour248] [detach] #[default] ${name} `,
    ]);
    await runOk([
      "tmux", "set-option", "-t", name, "status-right",
      "#{?pane_in_mode, COPY ,}",
    ]);
    await runOk(["tmux", "set-option", "-t", name, "status-style", "bg=colour235,fg=colour248"]);
  }

  // Set HIVE_HOME env in the session
  if (opts.hiveHome) {
    await sendKeys(name, `export HIVE_HOME="${opts.hiveHome}"; clear`);
    await sendKeys(name, "Enter");
    // Brief pause for env to take effect
    await new Promise((r) => setTimeout(r, 100));
  }

  // Launch the program
  await sendKeys(name, program);
  await sendKeys(name, "Enter");

  await log.info("Created tmux session", { name, cwd, program });
}

export async function attachSession(name: string): Promise<void> {
  // This blocks until the user detaches
  const cmd = new Deno.Command("tmux", {
    args: ["attach-session", "-t", name],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const process = cmd.spawn();
  await process.status;
}

export async function detachFromSession(name: string): Promise<void> {
  await run(["tmux", "detach-client", "-s", name]);
}

export async function hasSession(name: string): Promise<boolean> {
  return await runStatus(["tmux", "has-session", "-t", name]);
}

export async function killSession(name: string): Promise<void> {
  await run(["tmux", "kill-session", "-t", name]);
  await log.info("Killed tmux session", { name });
}

export async function sendKeys(name: string, keys: string): Promise<void> {
  await runOk(["tmux", "send-keys", "-t", name, keys]);
}

export async function capturePane(name: string): Promise<string> {
  const result = await runOk(["tmux", "capture-pane", "-t", name, "-p"]);
  return result;
}
