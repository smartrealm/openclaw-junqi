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

/**
 * The official Feishu branch renders its QR directly to a terminal. JunQi
 * recognizes this protocol step and routes it through its desktop QR session
 * instead of letting the terminal-only branch consume the wizard request.
 */
export function isFeishuQrSetupMethodStep(step: OpenClawWizardStep): boolean {
  if (step.type !== 'select' || !step.options) return false;
  const values = step.options.map((option) => option.value);
  return values.length === 2 && values.includes('manual') && values.includes('scan');
}

export function isFeishuDomainSelectionStep(step: OpenClawWizardStep): boolean {
  if (step.type !== 'select' || !step.options) return false;
  const values = step.options.map((option) => option.value);
  return values.length === 2 && values.includes('feishu') && values.includes('lark');
}

export function isPlaintextSecretModeStep(step: OpenClawWizardStep): boolean {
  if (step.type !== 'select' || !step.options) return false;
  const values = step.options.map((option) => option.value);
  return values.length === 2 && values.includes('plaintext') && values.includes('ref');
}

/** @deprecated Use `isFeishuQrSetupMethodStep` for QR routing. */
export function isTerminalRenderedQrChoice(step: OpenClawWizardStep): boolean {
  return isFeishuQrSetupMethodStep(step);
}

export function supportedWizardOptions(step: OpenClawWizardStep): OpenClawWizardOption[] {
  if (!isTerminalRenderedQrChoice(step)) return step.options ?? [];
  return (step.options ?? []).filter((option) => option.value !== 'scan');
}

export interface OpenClawWizardRequestOptions {
  timeoutMs?: number | null;
}

export type OpenClawWizardFailureKind =
  | 'session_lost'
  | 'step_desynchronized'
  | 'already_running'
  | 'request_timeout'
  | 'unknown';

type GatewayCaller = (
  method: string,
  params: Record<string, unknown>,
  options?: OpenClawWizardRequestOptions,
) => Promise<unknown>;

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

  get hasActiveSession(): boolean {
    return this.sessionId !== null;
  }

  async start(workspace?: string): Promise<OpenClawWizardResult> {
    // A refresh/back navigation can leave the official server-side session
    // alive. Reconcile it before starting a new session so OpenClaw's
    // single-session guard cannot strand onboarding on "already running".
    if (this.sessionId) {
      await this.cancel();
    }
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
    }, { timeoutMs: null }));
    if (result.done || result.status === 'done' || result.status === 'cancelled' || result.status === 'error') {
      this.sessionId = null;
    }
    return result;
  }

  /**
   * Read the server's current step without resubmitting an answer. This is
   * safe after the client loses a response because the official session may
   * still be performing an external operation.
   */
  async resume(): Promise<OpenClawWizardResult> {
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const result = assertWizardResult(await this.callGateway('wizard.next', {
      sessionId: this.sessionId,
    }, { timeoutMs: null }));
    if (result.done || result.status === 'done' || result.status === 'cancelled' || result.status === 'error') {
      this.sessionId = null;
    }
    return result;
  }

  forgetSession(): void {
    this.sessionId = null;
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    try {
      await this.callGateway('wizard.cancel', { sessionId });
      this.sessionId = null;
    } catch (error) {
      // A server-side expiry means the session is already gone. For transport
      // failures retain the id so a later start/back action can retry cleanup.
      if (isOpenClawWizardSessionLost(error)) this.sessionId = null;
      throw error;
    }
  }
}

export function classifyOpenClawWizardFailure(error: unknown): OpenClawWizardFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('wizard not found')
    || normalized.includes('wizard not running')
    || normalized.includes('wizard session is not running')) {
    return 'session_lost';
  }
  if (normalized.includes('wizard: no pending step')) return 'step_desynchronized';
  if (normalized.includes('wizard already running')) return 'already_running';
  if (normalized.includes('request timeout')) return 'request_timeout';
  return 'unknown';
}

export function isOpenClawWizardSessionLost(error: unknown): boolean {
  return classifyOpenClawWizardFailure(error) === 'session_lost';
}

export function isOpenClawWizardStepDesynchronized(error: unknown): boolean {
  return classifyOpenClawWizardFailure(error) === 'step_desynchronized';
}

export function requiresOpenClawOnboarding(configExists: boolean, config: unknown): boolean {
  if (!configExists || !config || typeof config !== 'object') return true;
  const cfg = config as Record<string, any>;
  if (typeof cfg.wizard?.lastRunAt === 'string' && cfg.wizard.lastRunAt.trim()) return false;
  const primary = cfg.agents?.defaults?.model?.primary;
  return !(typeof primary === 'string' && primary.trim());
}
