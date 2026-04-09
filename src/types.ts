// src/types.ts — shared types for hive

export type Status = "working" | "waiting" | "blocked" | "done" | "idle" | "stopped";

export type CiStatus = "passed" | "failed" | "running" | null;

export interface Task {
  id: string;
  repo: string;
  branch: string;
  baseBranch: string;
  worktreePath: string;
  tmuxSession: string;
  program: string;
  createdAt: string;
  repoDisplayName?: string;
}

export interface PrInfo {
  number: number;
  state: string;
  url: string;
}

export interface RepoConfig {
  url: string;
  defaultBranch: string;
  localPath?: string;
  testCommand?: string;
}

export interface Config {
  repos: Record<string, RepoConfig>;
  branchPrefix: string;
  editor: string;
  openEditorOnCreate: boolean;
  agentStatusReporting: boolean;
  notifications: boolean;
  tmuxMouse: boolean;
  tmuxStatusBar: boolean;
  skipCloseConfirm: boolean;
  defaults: {
    program: string;
  };
  staleThresholdHours: number;
}

export interface State {
  tasks: Record<string, Task>;
  lastRepo?: string;
  waitingSince?: Record<string, string>;
  prCache?: Record<string, PrInfo>;
}

export interface TaskStatus {
  status: Status;
  snippet: string;
}

export interface Signal {
  event: string;
  json: Record<string, unknown>;
}

export interface KeyEvent {
  key: string;
  ctrl: boolean;
  raw: Uint8Array;
}
