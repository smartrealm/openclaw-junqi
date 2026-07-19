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
/** Editable, uncommitted choices for the current setup session only. */
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
};

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
  clearSetupLogs: () => void;
  setPostStorageStep: (step: PostStorageStep) => void;
  setStorageDraft: (draft: StorageSetupDraft | null) => void;
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
  appendSetupLog: (log) => set((s) => ({
    setupLogs: [...s.setupLogs.slice(-219), { ...log, ts: log.ts ?? Date.now() }],
  })),
  clearSetupLogs: () => set({ setupLogs: [] }),
  setPostStorageStep: (step) => set({ postStorageStep: step }),
  setStorageDraft: (draft) => set({ storageDraft: draft }),
}));
