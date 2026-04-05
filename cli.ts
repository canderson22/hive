// cli.ts — hive entry point

import { runDashboard } from "./src/tui.ts";
import { loadConfig } from "./src/config.ts";
import { hiveHome } from "./src/paths.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { log } from "./src/log.ts";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const args = Deno.args;

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`hive ${VERSION}`);
    return;
  }

  // Ensure ~/.hive/ directory structure exists
  const home = hiveHome();
  await ensureDir(home);

  // Check tmux is available
  try {
    const cmd = new Deno.Command("tmux", { args: ["-V"], stdout: "piped", stderr: "piped" });
    const output = await cmd.output();
    if (!output.success) throw new Error("tmux not available");
    await log.info("hive starting", {
      version: VERSION,
      tmux: new TextDecoder().decode(output.stdout).trim(),
      home,
    });
  } catch {
    console.error("Error: tmux is required but not found. Install it with: brew install tmux");
    Deno.exit(1);
  }

  // Check git is available
  try {
    const cmd = new Deno.Command("git", { args: ["--version"], stdout: "piped", stderr: "piped" });
    const output = await cmd.output();
    if (!output.success) throw new Error("git not available");
  } catch {
    console.error("Error: git is required but not found.");
    Deno.exit(1);
  }

  await runDashboard();
}

function printHelp(): void {
  console.log(`hive ${VERSION} — Multi-Session Claude Code Coordinator`);
  console.log("");
  console.log("Usage: hive [options]");
  console.log("");
  console.log("Options:");
  console.log("  --help, -h     Show this help");
  console.log("  --version, -v  Show version");
  console.log("");
  console.log("Dashboard shortcuts:");
  console.log("  n              New task");
  console.log("  Enter          Attach to session");
  console.log("  j/k            Navigate tasks");
  console.log("  d              Close task");
  console.log("  r              Restart task");
  console.log("  e              Open editor");
  console.log("  c              Config");
  console.log("  q              Quit");
}

main();
