// src/config.ts — config and state management

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { Config, State } from "./types.ts";

export const DEFAULT_CONFIG: Config = {
  repos: {},
  branchPrefix: "",
  editor: "code",
  openEditorOnCreate: false,
  agentStatusReporting: false,
  notifications: false,
  tmuxMouse: true,
  tmuxStatusBar: true,
  skipCloseConfirm: false,
  defaults: {
    program: "claude",
  },
  staleThresholdHours: 25,
};

const DEFAULT_STATE: State = {
  tasks: {},
};

export async function loadConfig(hiveHome?: string): Promise<Config> {
  const dir = hiveHome ?? (await defaultHiveHome());
  const path = join(dir, "config.json");
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      defaults: { ...DEFAULT_CONFIG.defaults, ...parsed?.defaults },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Config, hiveHome?: string): Promise<void> {
  const dir = hiveHome ?? (await defaultHiveHome());
  await ensureDir(dir);
  const path = join(dir, "config.json");
  await Deno.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
}

export async function loadState(hiveHome?: string): Promise<State> {
  const dir = hiveHome ?? (await defaultHiveHome());
  const path = join(dir, "state.json");
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state: State, hiveHome?: string): Promise<void> {
  const dir = hiveHome ?? (await defaultHiveHome());
  await ensureDir(dir);
  const path = join(dir, "state.json");
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2) + "\n");
}

async function defaultHiveHome(): Promise<string> {
  const home = Deno.env.get("HIVE_HOME") ?? join(Deno.env.get("HOME")!, ".hive");
  await ensureDir(home);
  return home;
}
