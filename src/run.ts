// src/run.ts — Deno.Command helper for shelling out to git, tmux, etc.

export interface RunResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export async function run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }): Promise<RunResult> {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts?.cwd,
    env: opts?.env ? { ...Deno.env.toObject(), ...opts.env } : undefined,
    stdout: "piped",
    stderr: "piped",
    stdin: opts?.stdin ? "piped" : "null",
  });

  const process = command.spawn();

  if (opts?.stdin) {
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  }

  const output = await process.output();
  const decoder = new TextDecoder();

  return {
    success: output.success,
    code: output.code,
    stdout: decoder.decode(output.stdout).trimEnd(),
    stderr: decoder.decode(output.stderr).trimEnd(),
  };
}

export async function runOk(cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }): Promise<string> {
  const result = await run(cmd, opts);
  if (!result.success) {
    throw new Error(`Command failed: ${cmd.join(" ")}\n${result.stderr}`);
  }
  return result.stdout;
}

export async function runStatus(cmd: string[], opts?: { cwd?: string }): Promise<boolean> {
  const result = await run(cmd, opts);
  return result.success;
}
