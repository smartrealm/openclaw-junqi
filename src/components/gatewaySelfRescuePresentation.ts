export interface GatewaySelfRescuePresentationInput {
  connected: boolean;
  busy: boolean;
  error?: string | null;
}

export interface GatewaySelfRescuePresentation {
  readonly mode: 'healthy' | 'recovering' | 'recovery';
  readonly showProgress: boolean;
  readonly showRecoveryActions: boolean;
}

export function projectGatewaySelfRescuePresentation({
  connected,
  busy,
  error,
}: GatewaySelfRescuePresentationInput): GatewaySelfRescuePresentation {
  if (busy) {
    return { mode: 'recovering', showProgress: true, showRecoveryActions: false };
  }
  if (connected && !error?.trim()) {
    return { mode: 'healthy', showProgress: false, showRecoveryActions: false };
  }
  return { mode: 'recovery', showProgress: false, showRecoveryActions: true };
}
