import { create } from "zustand";
import {
  backSetupNavigation,
  normalizeInstallMode,
  transitionSetupNavigation,
  type InstallMode,
  type SetupNavigationMode,
  type SetupStep,
} from "./setup-navigation";

export type { InstallMode, SetupStep } from "./setup-navigation";

export type PostStorageStep = "choosing-mode" | "gateway-stopped" | "configure-openclaw" | "ready";
/**
 * Runtime-only context for entering the workbench. It intentionally is not
 * persisted: a new application launch is a cold start, while setup can hand
 * off an already authenticated Gateway connection without replaying boot UI.
 */
export type WorkspaceStartupMode = "cold" | "verified-gateway-handoff";
/**
 * Editable storage choices belong to the in-progress JunQi setup session.
 * They intentionally do not survive an app restart: a directory selection is
 * not configuration until the user confirms it through `configure_storage`.
 */
export type StorageSetupDraft = {
  targetDir: string;
  workspaceDir: string;
  runtimeDir: string;
  npmCacheDir: string;
  customNpmCache: boolean;
  npmPrefix: string;
  customNpmPrefix: boolean;
  nodeRuntimeDir: string;
  customNodeRuntime: boolean;
  gitRuntimeDir: string;
  customGitRuntime: boolean;
  terminalIntegration: boolean;
  migrateExisting: boolean;
  showLocations: boolean;
};
export type SetupLogLevel = "info" | "success" | "warn" | "error";
export type SetupLog = {
  source: "setup" | "gateway";
  message: string;
  ts: number;
  step?: string;
  level?: SetupLogLevel;
  progress?: number;
  diagnostic?: boolean;
  /** Renderer-only slot for replacing high-frequency progress rows. */
  coalesceKey?: string;
};

// Setup can stream verbose npm and Gateway output for several minutes. Keep a
// bounded, session-local history large enough for an entire onboarding run.
const SETUP_LOG_LIMIT = 10_000;

interface AppState {
  setupComplete: boolean | null; // null = 尚未完成首次向导判定
  setupStep: SetupStep;
  setupHistory: SetupStep[];
  setupError: string | null;
  setupStatusMessage: string;
  setupProgress: number;
  installMode: InstallMode;
  gatewayRunning: boolean;
  setupLogs: SetupLog[];
  postStorageStep: PostStorageStep;
  storageDraft: StorageSetupDraft | null;
  workspaceStartupMode: WorkspaceStartupMode;

  setSetupComplete: (v: boolean | null) => void;
  /** Replace an internal execution phase without adding browser-like history. */
  replaceSetupStep: (step: SetupStep) => void;
  navigateSetup: (step: SetupStep, mode?: SetupNavigationMode) => void;
  goBackSetup: (fallback?: SetupStep) => SetupStep;
  setSetupError: (err: string | null) => void;
  setSetupStatus: (message: string, progress?: number) => void;
  setInstallMode: (mode: InstallMode) => void;
  setGatewayRunning: (v: boolean) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  setPostStorageStep: (step: PostStorageStep) => void;
  setStorageDraft: (draft: StorageSetupDraft | null) => void;
  setWorkspaceStartupMode: (mode: WorkspaceStartupMode) => void;
}

const savedMode = normalizeInstallMode(localStorage.getItem("junqi-install-mode"));
const SETUP_DONE_MARKER = "3";
const setupPreviouslyDone = localStorage.getItem("junqi-setup-done") === SETUP_DONE_MARKER;

export const useAppStore = create<AppState>((set) => ({
  // 首次安装从品牌/语言/主题选择开始；只有用户明确进入工作台后，
  // 后续启动才跳过向导，运行时健康检查交给工作台 Gateway 管理。
  setupComplete: setupPreviouslyDone ? true : null,
  setupStep: (setupPreviouslyDone ? "ready" : "welcome") as SetupStep,
  setupHistory: [],
  setupError: null,
  setupStatusMessage: "",
  setupProgress: 0,
  installMode: savedMode,
  gatewayRunning: false,
  setupLogs: [],
  postStorageStep: "choosing-mode",
  storageDraft: null,
  workspaceStartupMode: "cold",

  setSetupComplete: (v) => {
    if (v === true) {
      localStorage.setItem("junqi-setup-done", SETUP_DONE_MARKER);
    } else if (v === false) {
      localStorage.removeItem("junqi-setup-done");
    }
    set({ setupComplete: v });
  },
  replaceSetupStep: (step) => set({ setupStep: step }),
  navigateSetup: (step, mode = "push") => set((state) => (
    transitionSetupNavigation(state, step, mode)
  )),
  goBackSetup: (fallback = "welcome") => {
    let destination = fallback;
    set((state) => {
      const next = backSetupNavigation(state, fallback);
      destination = next.setupStep;
      return next;
    });
    return destination;
  },
  setSetupError: (err) => set({ setupError: err }),
  setSetupStatus: (message, progress) => set((s) => ({
    setupStatusMessage: message,
    setupProgress: progress ?? s.setupProgress,
  })),
  setInstallMode: (mode) => {
    localStorage.setItem("junqi-install-mode", mode);
    set({ installMode: mode });
  },
  setGatewayRunning: (v) => set({ gatewayRunning: v }),
  appendSetupLog: (log) => set((s) => {
    const nextLog = { ...log, ts: log.ts ?? Date.now() };
    if (nextLog.coalesceKey) {
      let matchIndex = -1;
      for (let index = s.setupLogs.length - 1; index >= 0; index -= 1) {
        const existing = s.setupLogs[index];
        if (
          existing.source === nextLog.source
          && existing.step === nextLog.step
          && existing.coalesceKey === nextLog.coalesceKey
        ) {
          matchIndex = index;
          break;
        }
      }
      if (matchIndex >= 0) {
        const setupLogs = [...s.setupLogs];
        setupLogs[matchIndex] = nextLog;
        return { setupLogs };
      }
    }
    const previous = s.setupLogs.at(-1);
    const isDuplicate = previous
      && previous.source === nextLog.source
      && previous.step === nextLog.step
      && previous.message === nextLog.message
      && previous.level === nextLog.level
      && previous.diagnostic === nextLog.diagnostic
      && previous.coalesceKey === nextLog.coalesceKey;
    if (isDuplicate) return s;
    return {
      setupLogs: [
        ...s.setupLogs.slice(-(SETUP_LOG_LIMIT - 1)),
        nextLog,
      ],
    };
  }),
  setPostStorageStep: (step) => set({ postStorageStep: step }),
  setStorageDraft: (draft) => set({ storageDraft: draft }),
  setWorkspaceStartupMode: (mode) => set({ workspaceStartupMode: mode }),
}));
