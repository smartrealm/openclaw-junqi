import { create } from "zustand";

export type SetupStep =
  | "welcome"
  | "detecting"
  | "storage"
  | "gateway-stopped"
  | "choosing-mode"
  | "checking"
  | "install-git"
  | "git-missing"
  | "install-node"
  | "install-openclaw"
  | "install-complete"
  | "ready"
  | "error";

type InstallMode = "native" | "docker";
export type PostStorageStep = "choosing-mode" | "gateway-stopped" | "ready";
export type SetupLog = { source: "setup" | "gateway"; message: string; ts: number };

interface AppState {
  setupComplete: boolean | null; // null = 尚未完成首次向导判定
  setupStep: SetupStep;
  setupError: string | null;
  setupStatusMessage: string;
  setupProgress: number;
  installMode: InstallMode;
  gatewayRunning: boolean;
  setupLogs: SetupLog[];
  postStorageStep: PostStorageStep;

  setSetupComplete: (v: boolean | null) => void;
  setSetupStep: (step: SetupStep) => void;
  setSetupError: (err: string | null) => void;
  setSetupStatus: (message: string, progress?: number) => void;
  setInstallMode: (mode: InstallMode) => void;
  setGatewayRunning: (v: boolean) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  clearSetupLogs: () => void;
  setPostStorageStep: (step: PostStorageStep) => void;
}

const savedMode = (localStorage.getItem("junqi-install-mode") as InstallMode) || "native";
const SETUP_DONE_MARKER = "3";
const setupPreviouslyDone = localStorage.getItem("junqi-setup-done") === SETUP_DONE_MARKER;

export const useAppStore = create<AppState>((set) => ({
  // 首次安装从品牌/语言/主题选择开始；只有用户明确进入工作台后，
  // 后续启动才跳过向导，运行时健康检查交给工作台 Gateway 管理。
  setupComplete: setupPreviouslyDone ? true : null,
  setupStep: (setupPreviouslyDone ? "ready" : "welcome") as SetupStep,
  setupError: null,
  setupStatusMessage: "",
  setupProgress: 0,
  installMode: savedMode,
  gatewayRunning: false,
  setupLogs: [],
  postStorageStep: "choosing-mode",

  setSetupComplete: (v) => {
    if (v === true) {
      localStorage.setItem("junqi-setup-done", SETUP_DONE_MARKER);
    } else if (v === false) {
      localStorage.removeItem("junqi-setup-done");
    }
    set({ setupComplete: v });
  },
  setSetupStep: (step) => set({ setupStep: step }),
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
}));
