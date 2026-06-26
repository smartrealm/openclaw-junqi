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
  // Always start with null (detecting) so the setup wizard runs a quick
  // check on every launch. useSetupFlow will call setSetupComplete(true)
  // immediately if openclaw is installed and the gateway responds.
  setupComplete: null,
  setupStep: "detecting" as SetupStep,
  setupError: null,
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
  setInstallMode: (mode) => {
    localStorage.setItem("junqi-install-mode", mode);
    set({ installMode: mode });
  },
  setGatewayRunning: (v) => set({ gatewayRunning: v }),
}));
