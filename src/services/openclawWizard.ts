export type OpenClawWizardStepType =
  | 'note'
  | 'select'
  | 'text'
  | 'confirm'
  | 'multiselect'
  | 'progress'
  | 'action';

export interface OpenClawWizardOption {
  value: unknown;
  label: string;
  hint?: string;
}

export interface OpenClawWizardStep {
  id: string;
  type: OpenClawWizardStepType;
  title?: string;
  message?: string;
  options?: OpenClawWizardOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: 'gateway' | 'client';
}

export interface OpenClawWizardResult {
  sessionId?: string;
  done: boolean;
  status?: 'running' | 'done' | 'cancelled' | 'error';
  step?: OpenClawWizardStep;
  error?: string;
}

type GatewayCaller = (method: string, params: Record<string, unknown>) => Promise<unknown>;

function assertWizardResult(value: unknown): OpenClawWizardResult {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenClaw returned an invalid wizard response.');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.done !== 'boolean') {
    throw new Error('OpenClaw wizard response is missing `done`.');
  }
  if (!result.done) {
    const step = result.step as Record<string, unknown> | undefined;
    if (!step || typeof step.id !== 'string' || typeof step.type !== 'string') {
      throw new Error('OpenClaw wizard response is missing the next step.');
    }
  }
  return value as OpenClawWizardResult;
}

export class OpenClawWizardClient {
  private sessionId: string | null = null;

  constructor(private readonly callGateway: GatewayCaller) {}

  async start(workspace?: string): Promise<OpenClawWizardResult> {
    const result = assertWizardResult(await this.callGateway('wizard.start', {
      mode: 'local',
      ...(workspace?.trim() ? { workspace: workspace.trim() } : {}),
    }));
    this.sessionId = result.done ? null : String(result.sessionId ?? '');
    if (!result.done && !this.sessionId) {
      throw new Error('OpenClaw wizard did not return a session id.');
    }
    return result;
  }

  async next(stepId: string, value?: unknown): Promise<OpenClawWizardResult> {
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const result = assertWizardResult(await this.callGateway('wizard.next', {
      sessionId: this.sessionId,
      answer: {
        stepId,
        ...(value !== undefined ? { value } : {}),
      },
    }));
    if (result.done || result.status === 'done' || result.status === 'cancelled' || result.status === 'error') {
      this.sessionId = null;
    }
    return result;
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.callGateway('wizard.cancel', { sessionId });
  }
}

export function isOpenClawWizardSessionLost(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('wizard not found') || normalized.includes('wizard not running');
}

export function requiresOpenClawOnboarding(configExists: boolean, config: unknown): boolean {
  if (!configExists || !config || typeof config !== 'object') return true;
  const cfg = config as Record<string, any>;
  if (typeof cfg.wizard?.lastRunAt === 'string' && cfg.wizard.lastRunAt.trim()) return false;
  const primary = cfg.agents?.defaults?.model?.primary;
  return !(typeof primary === 'string' && primary.trim());
}
