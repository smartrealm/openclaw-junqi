export type SetupProgressPhase =
  | "detecting"
  | "git"
  | "node"
  | "openclaw"
  | "gatewayPrepare"
  | "awaitingGatewayStart"
  | "gatewayConfig"
  | "gatewayProcess"
  | "gatewayPort"
  | "ready";

type PhaseRange = Readonly<{ start: number; end: number }>;

export const SETUP_PROGRESS_RANGES: Readonly<Record<SetupProgressPhase, PhaseRange>> = {
  detecting: { start: 0, end: 4 },
  git: { start: 5, end: 14 },
  node: { start: 15, end: 39 },
  openclaw: { start: 40, end: 68 },
  gatewayPrepare: { start: 69, end: 74 },
  awaitingGatewayStart: { start: 75, end: 75 },
  gatewayConfig: { start: 76, end: 81 },
  gatewayProcess: { start: 82, end: 89 },
  gatewayPort: { start: 90, end: 99 },
  ready: { start: 100, end: 100 },
};

export function progressForPhase(phase: SetupProgressPhase, localPercent = 0): number {
  const range = SETUP_PROGRESS_RANGES[phase];
  const local = Math.max(0, Math.min(100, localPercent));
  return Math.round(range.start + ((range.end - range.start) * local) / 100);
}

export function advanceSetupProgress(
  current: number,
  phase: SetupProgressPhase,
  localPercent = 0,
): number {
  return Math.max(current, progressForPhase(phase, localPercent));
}

export function phaseForSetupEvent(step: string): SetupProgressPhase | null {
  switch (step) {
    case "git": return "git";
    case "node": return "node";
    case "openclaw": return "openclaw";
    case "gateway": return "gatewayPrepare";
    default: return null;
  }
}
