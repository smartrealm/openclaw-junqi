import { create } from "zustand";

export type SetupStep =
  | "welcome"
  | "detecting"
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

interface AppState {
  setupComplete: boolean | null; // null = detecting
  setupStep: SetupStep;
  setupError: string | null;
  setupStatusMessage: string;
  setupProgress: number;
  installMode: InstallMode;
  gatewayRunning: boolean;

  setSetupComplete: (v: boolean | null) => void;
  setSetupStep: (step: SetupStep) => void;
  setSetupError: (err: string | null) => void;
  setSetupStatus: (message: string, progress?: number) => void;
  setInstallMode: (mode: InstallMode) => void;
  setGatewayRunning: (v: boolean) => void;
}

const savedMode = (localStorage.getItem("junqi-install-mode") as InstallMode) || "native";
const setupPreviouslyDone = localStorage.getItem("junqi-setup-done") === "1";

export const useAppStore = create<AppState>((set) => ({
  // First install starts with brand/language/theme selection. Once the guided
  // setup has completed, future launches enter the workspace directly; the
  // workspace Gateway manager owns runtime health checks from that point on.
  setupComplete: setupPreviouslyDone ? true : null,
  setupStep: (setupPreviouslyDone ? "ready" : "welcome") as SetupStep,
  setupError: null,
  setupStatusMessage: "",
  setupProgress: 0,
  installMode: savedMode,
  gatewayRunning: false,

  setSetupComplete: (v) => {
    if (v === true) {
      localStorage.setItem("junqi-setup-done", "1");
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
}));
