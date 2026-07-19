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
  format?: 'plain';
  options?: OpenClawWizardOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: 'gateway' | 'client';
  [key: string]: unknown;
}

export interface OpenClawWizardResult {
  sessionId?: string;
  done: boolean;
  status?: 'running' | 'done' | 'cancelled' | 'error';
  step?: OpenClawWizardStep;
  error?: string;
}

const WIZARD_STEP_TYPES = new Set<OpenClawWizardStepType>([
  'note',
  'select',
  'text',
  'confirm',
  'multiselect',
  'progress',
  'action',
]);

function isWizardOption(value: unknown): value is OpenClawWizardOption {
  if (!value || typeof value !== 'object') return false;
  const option = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(option, 'value')
    && typeof option.label === 'string'
    && (option.hint === undefined || typeof option.hint === 'string');
}

function normalizeWizardStep(value: unknown): OpenClawWizardStep | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !WIZARD_STEP_TYPES.has(raw.type as OpenClawWizardStepType)) return null;
  if (raw.title !== undefined && typeof raw.title !== 'string') return null;
  if (raw.message !== undefined && typeof raw.message !== 'string') return null;
  if (raw.format !== undefined && raw.format !== 'plain') return null;
  if (raw.options !== undefined && (!Array.isArray(raw.options) || !raw.options.every(isWizardOption))) return null;
  if (raw.placeholder !== undefined && typeof raw.placeholder !== 'string') return null;
  if (raw.sensitive !== undefined && typeof raw.sensitive !== 'boolean') return null;
  if (raw.executor !== undefined && raw.executor !== 'gateway' && raw.executor !== 'client') return null;

  // The Gateway is the source of truth for presentation and option identity.
  // Keep the complete object so newer protocol metadata survives unchanged.
  return value as OpenClawWizardStep;
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

/**
 * The official Gateway owns wizard state, while the desktop owns the view.
 * Keep only the opaque session id locally so a renderer or application restart
 * can resume the same official step. The id contains no credentials.
 */
export interface OpenClawWizardSessionStore {
  load(): string | null;
  save(sessionId: string): void;
  clear(): void;
}

const WIZARD_SESSION_STORAGE_KEY = 'junqi.openclaw-wizard-session-id';

export function createBrowserOpenClawWizardSessionStore(): OpenClawWizardSessionStore {
  return {
    load: () => {
      try {
        return globalThis.localStorage?.getItem(WIZARD_SESSION_STORAGE_KEY) || null;
      } catch {
        return null;
      }
    },
    save: (sessionId) => {
      try {
        globalThis.localStorage?.setItem(WIZARD_SESSION_STORAGE_KEY, sessionId);
      } catch {
        // Storage must not prevent the official wizard from operating.
      }
    },
    clear: () => {
      try {
        globalThis.localStorage?.removeItem(WIZARD_SESSION_STORAGE_KEY);
      } catch {
        // Storage must not prevent the official wizard from operating.
      }
    },
  };
}

function assertWizardResult(value: unknown): OpenClawWizardResult {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenClaw returned an invalid wizard response.');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.done !== 'boolean') {
    throw new Error('OpenClaw wizard response is missing `done`.');
  }
  if (!result.done) {
    const step = normalizeWizardStep(result.step);
    if (!step) {
      throw new Error('OpenClaw wizard response is missing the next step.');
    }
    return { ...value as OpenClawWizardResult, step };
  }
  return value as OpenClawWizardResult;
}

export class OpenClawWizardClient {
  private sessionId: string | null = null;
  private currentStep: OpenClawWizardStep | null = null;
  private workspace: string | undefined;
  private history: Array<{ step: OpenClawWizardStep; value: unknown }> = [];

  constructor(
    private readonly callGateway: GatewayCaller,
    private readonly sessionStore?: OpenClawWizardSessionStore,
  ) {
    this.sessionId = sessionStore?.load() ?? null;
  }

  get hasActiveSession(): boolean {
    return this.sessionId !== null;
  }

  get canGoBack(): boolean {
    return this.sessionId !== null && this.history.length > 0;
  }

  async start(workspace?: string): Promise<OpenClawWizardResult> {
    // A refresh/back navigation can leave the official server-side session
    // alive. Reconcile it before starting a new session so OpenClaw's
    // single-session guard cannot strand onboarding on "already running".
    if (this.sessionId) {
      await this.cancel();
    }
    this.workspace = workspace?.trim() || undefined;
    this.history = [];
    this.currentStep = null;
    const result = assertWizardResult(await this.callGateway('wizard.start', {
      mode: 'local',
      ...(this.workspace ? { workspace: this.workspace } : {}),
    }));
    this.setSession(result.done ? null : String(result.sessionId ?? ''));
    this.currentStep = result.step ?? null;
    if (!result.done && !this.sessionId) {
      throw new Error('OpenClaw wizard did not return a session id.');
    }
    return result;
  }

  async next(stepId: string, value?: unknown): Promise<OpenClawWizardResult> {
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const submittedStep = this.currentStep;
    const result = assertWizardResult(await this.callGateway('wizard.next', {
      sessionId: this.sessionId,
      answer: {
        stepId,
        ...(value !== undefined ? { value } : {}),
      },
    }, { timeoutMs: null }));
    if (result.done || result.status === 'done' || result.status === 'cancelled' || result.status === 'error') {
      this.setSession(null);
      this.currentStep = null;
    } else {
      if (submittedStep && submittedStep.id === stepId) this.history.push({ step: submittedStep, value });
      this.currentStep = result.step ?? null;
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
      this.setSession(null);
      this.currentStep = null;
    } else {
      this.currentStep = result.step ?? null;
    }
    return result;
  }

  /**
   * Gateway exposes no wizard.back RPC. Recreate the official session and
   * replay only answers that were already accepted, stopping at the prior
   * step. Values remain memory-only and are never written to localStorage.
   */
  async back(): Promise<OpenClawWizardResult | null> {
    if (!this.canGoBack) return null;
    const replay = this.history.slice(0, -1).map((entry) => ({ ...entry }));
    await this.cancel();
    const result = await this.start(this.workspace);
    let current = result;
    for (const entry of replay) {
      if (current.done || !current.step || current.step.id !== entry.step.id) {
        throw new Error('OpenClaw wizard could not restore the previous step.');
      }
      current = await this.next(entry.step.id, entry.value);
    }
    return current;
  }

  forgetSession(): void {
    this.setSession(null);
    this.currentStep = null;
    this.history = [];
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    try {
      await this.callGateway('wizard.cancel', { sessionId });
      this.setSession(null);
    } catch (error) {
      // A server-side expiry means the session is already gone. For transport
      // failures retain the id so a later start/back action can retry cleanup.
      if (isOpenClawWizardSessionLost(error)) this.setSession(null);
      throw error;
    }
  }

  private setSession(sessionId: string | null): void {
    this.sessionId = sessionId;
    if (sessionId) this.sessionStore?.save(sessionId);
    else this.sessionStore?.clear();
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
