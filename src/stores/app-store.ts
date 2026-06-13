import { create } from "zustand";

type SetupStep =
  | "detecting"
  | "gateway-stopped"
  | "choosing-mode"
  | "checking"
  | "install-git"
  | "git-missing"
  | "install-node"
  | "install-openclaw"
  | "ready"
  | "error";

type InstallMode = "native" | "docker";

interface AppState {
  setupComplete: boolean | null; // null = detecting
  setupStep: SetupStep;
  setupError: string | null;
  installMode: InstallMode;
  gatewayRunning: boolean;

  setSetupComplete: (v: boolean | null) => void;
  setSetupStep: (step: SetupStep) => void;
  setSetupError: (err: string | null) => void;
  setInstallMode: (mode: InstallMode) => void;
  setGatewayRunning: (v: boolean) => void;
}

const savedMode = (localStorage.getItem("junqi-install-mode") as InstallMode) || "native";

export const useAppStore = create<AppState>((set) => ({
  // null = detecting, true = skip setup, false = need setup
  setupComplete: true,
  setupStep: "detecting" as SetupStep,
  setupError: null,
  installMode: savedMode,
  gatewayRunning: false,

  setSetupComplete: (v) => set({ setupComplete: v }),
  setSetupStep: (step) => set({ setupStep: step }),
  setSetupError: (err) => set({ setupError: err }),
  setInstallMode: (mode) => {
    localStorage.setItem("junqi-install-mode", mode);
    set({ installMode: mode });
  },
  setGatewayRunning: (v) => set({ gatewayRunning: v }),
}));
