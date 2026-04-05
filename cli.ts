// cli.ts — hive entry point

async function main(): Promise<void> {
  const args = Deno.args;

  if (args.includes("--help") || args.includes("-h")) {
    console.log("hive — Multi-Session Claude Code Coordinator");
    console.log("");
    console.log("Usage: hive [options]");
    console.log("");
    console.log("Options:");
    console.log("  --help, -h     Show this help");
    console.log("  --version, -v  Show version");
    Deno.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log("hive 0.1.0");
    Deno.exit(0);
  }

  console.log("hive — starting dashboard (not yet implemented)");
}

main();
