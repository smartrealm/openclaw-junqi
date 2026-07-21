export type SetupProgressPhase =
  | "detecting"
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
  detecting: { start: 0, end: 5 },
  node: { start: 31, end: 52 },
  openclaw: { start: 53, end: 73 },
  gatewayPrepare: { start: 74, end: 79 },
  awaitingGatewayStart: { start: 80, end: 80 },
  gatewayConfig: { start: 81, end: 85 },
  gatewayProcess: { start: 86, end: 90 },
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
    // Git is not an OpenClaw npm prerequisite. If a future package explicitly
    // invokes it, the on-demand install remains part of the OpenClaw phase.
    case "git": return "openclaw";
    case "node": return "node";
    case "openclaw": return "openclaw";
    case "gateway": return "gatewayPrepare";
    default: return null;
  }
}

export function progressForSetupEvent(
  step: string,
  localPercent: number,
  mode: "native" | "docker",
): number | null {
  const local = Math.max(0, Math.min(100, localPercent));
  switch (`${mode}:${step}`) {
    case "docker:pull": return Math.round(31 + local * 0.34);
    case "docker:container": return Math.round(66 + local * 0.18);
    case "docker:gateway": return Math.round(85 + local * 0.14);
    default: {
      if (mode === "docker") return null;
      const phase = phaseForSetupEvent(step);
      return phase ? progressForPhase(phase, local) : null;
    }
  }
}
