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

export interface OpenClawWizardDeviceCode {
  code: string;
  expiresInMinutes?: number;
  message?: string;
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
  externalUrl?: string;
  deviceCode?: OpenClawWizardDeviceCode;
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

function isWizardDeviceCode(value: unknown): value is OpenClawWizardDeviceCode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const deviceCode = value as Record<string, unknown>;
  return typeof deviceCode.code === 'string'
    && Boolean(deviceCode.code.trim())
    && (deviceCode.message === undefined || typeof deviceCode.message === 'string')
    && (deviceCode.expiresInMinutes === undefined
      || (Number.isInteger(deviceCode.expiresInMinutes)
        && Number(deviceCode.expiresInMinutes) >= 1
        && Number(deviceCode.expiresInMinutes) <= 1440));
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
  if (raw.externalUrl !== undefined && typeof raw.externalUrl !== 'string') return null;
  if (raw.deviceCode !== undefined && !isWizardDeviceCode(raw.deviceCode)) return null;

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
  | 'cancelled'
  | 'cancellation_locked'
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
  if (result.status !== undefined
    && result.status !== 'running'
    && result.status !== 'done'
    && result.status !== 'cancelled'
    && result.status !== 'error') {
    throw new Error('OpenClaw wizard response has an invalid `status`.');
  }
  if (result.error !== undefined && typeof result.error !== 'string') {
    throw new Error('OpenClaw wizard response has an invalid `error`.');
  }
  if (result.sessionId !== undefined && typeof result.sessionId !== 'string') {
    throw new Error('OpenClaw wizard response has an invalid `sessionId`.');
  }
  // Terminal error/cancel responses intentionally do not carry a next step.
  // They are valid official Wizard outcomes and must reach the recovery
  // state machine instead of being misclassified as malformed Gateway data.
  if (!isTerminalWizardResult(value as OpenClawWizardResult)) {
    const step = normalizeWizardStep(result.step);
    if (!step) {
      throw new Error('OpenClaw wizard response is missing the next step.');
    }
    return { ...value as OpenClawWizardResult, step };
  }
  return value as OpenClawWizardResult;
}

function isTerminalWizardResult(result: OpenClawWizardResult): boolean {
  return result.done
    || result.status === 'done'
    || result.status === 'cancelled'
    || result.status === 'error';
}

export class OpenClawWizardCancelledError extends Error {
  constructor() {
    super('OpenClaw wizard was cancelled.');
    this.name = 'OpenClawWizardCancelledError';
  }
}

export class OpenClawWizardOperationSupersededError extends Error {
  constructor() {
    super('OpenClaw wizard operation was superseded.');
    this.name = 'OpenClawWizardOperationSupersededError';
  }
}

/**
 * OpenClaw may lock cancellation while a durable configuration write is in
 * progress. In that case `wizard.cancel` succeeds as an RPC but reports the
 * session as still running; callers must retain and resume that session.
 */
export class OpenClawWizardCancellationLockedError extends Error {
  constructor() {
    super('OpenClaw wizard is still running because cancellation is currently locked.');
    this.name = 'OpenClawWizardCancellationLockedError';
  }
}

function assertWizardCancelStatus(value: unknown): 'running' | 'done' | 'cancelled' | 'error' {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenClaw returned an invalid wizard cancellation response.');
  }
  const status = (value as Record<string, unknown>).status;
  if (status !== 'running' && status !== 'done' && status !== 'cancelled' && status !== 'error') {
    throw new Error('OpenClaw wizard cancellation response has an invalid `status`.');
  }
  return status;
}

export class OpenClawWizardClient {
  private operationEpoch = 0;
  private sessionId: string | null = null;
  private failedSessionId: string | null = null;
  private currentStep: OpenClawWizardStep | null = null;
  private failedStep: OpenClawWizardStep | null = null;
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

  /// Public read-only views used by upstream state machines (e.g. setup flow)
  /// to include the current wizard context in error diagnostics. They never
  /// mutate internal state and remain intentionally narrow so the protocol
  /// boundary stays at `start` / `next` / `resume` / `cancel`.
  get currentStepView(): OpenClawWizardStep | null {
    return this.currentStep;
  }

  get failedStepView(): OpenClawWizardStep | null {
    return this.failedStep;
  }

  get activeSessionId(): string | null {
    return this.sessionId;
  }

  get diagnosticSessionId(): string | null {
    return this.sessionId ?? this.failedSessionId;
  }

  get canGoBack(): boolean {
    return this.history.length > 0 && (this.sessionId !== null || this.failedStep !== null);
  }

  /** Fence responses belonging to a setup screen or Gateway lifecycle that is no longer active. */
  invalidatePendingOperations(): void {
    this.operationEpoch += 1;
  }

  private captureOperation(): number {
    return this.operationEpoch;
  }

  private assertOperationCurrent(operation: number): void {
    if (operation !== this.operationEpoch) throw new OpenClawWizardOperationSupersededError();
  }

  async start(workspace?: string): Promise<OpenClawWizardResult> {
    const operation = this.captureOperation();
    // A refresh/back navigation can leave the official server-side session
    // alive. Reconcile it before starting a new session so OpenClaw's
    // single-session guard cannot strand onboarding on "already running".
    if (this.sessionId) {
      await this.cancel();
    }
    this.workspace = workspace?.trim() || undefined;
    this.history = [];
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
    const result = assertWizardResult(await this.callGateway('wizard.start', {
      mode: 'local',
      ...(this.workspace ? { workspace: this.workspace } : {}),
    }));
    this.assertOperationCurrent(operation);
    const returnedSessionId = String(result.sessionId ?? '').trim() || null;
    const terminal = isTerminalWizardResult(result);
    const failed = result.status === 'error';
    const rejected = Boolean(result.error) && !terminal;
    this.setSession(terminal ? null : returnedSessionId);
    this.currentStep = failed || rejected || !terminal ? result.step ?? null : null;
    this.failedStep = failed || rejected ? result.step ?? null : null;
    this.failedSessionId = failed || rejected ? returnedSessionId : null;
    if (!terminal && !this.sessionId) {
      throw new Error('OpenClaw wizard did not return a session id.');
    }
    return result;
  }

  async next(stepId: string, value?: unknown): Promise<OpenClawWizardResult> {
    const operation = this.captureOperation();
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const submittedSessionId = this.sessionId;
    const submittedStep = this.currentStep;
    const result = assertWizardResult(await this.callGateway('wizard.next', {
      sessionId: this.sessionId,
      answer: {
        stepId,
        ...(value !== undefined ? { value } : {}),
      },
    }, { timeoutMs: null }));
    this.assertOperationCurrent(operation);
    if (isTerminalWizardResult(result)) {
      this.setSession(null);
      const failed = result.status === 'error';
      const failedStep = result.step ?? submittedStep;
      this.currentStep = failed ? failedStep : null;
      this.failedStep = failed ? failedStep : null;
      this.failedSessionId = failed ? submittedSessionId : null;
    } else if (result.error) {
      // Payload errors reject the answer but leave the official session active.
      this.currentStep = result.step ?? submittedStep;
      this.failedStep = submittedStep ?? result.step ?? null;
      this.failedSessionId = submittedSessionId;
    } else {
      if (submittedStep && submittedStep.id === stepId) this.history.push({ step: submittedStep, value });
      this.currentStep = result.step ?? null;
      this.failedStep = null;
      this.failedSessionId = null;
    }
    return result;
  }

  /**
   * Read the server's current step without resubmitting an answer. This is
   * safe after the client loses a response because the official session may
   * still be performing an external operation.
   */
  async resume(): Promise<OpenClawWizardResult> {
    const operation = this.captureOperation();
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const resumedSessionId = this.sessionId;
    const resumedStep = this.currentStep;
    const result = assertWizardResult(await this.callGateway('wizard.next', {
      sessionId: this.sessionId,
    }, { timeoutMs: null }));
    this.assertOperationCurrent(operation);
    if (isTerminalWizardResult(result)) {
      this.setSession(null);
      const failed = result.status === 'error';
      const failedStep = result.step ?? resumedStep;
      this.currentStep = failed ? failedStep : null;
      this.failedStep = failed ? failedStep : null;
      this.failedSessionId = failed ? resumedSessionId : null;
    } else if (result.error) {
      this.currentStep = result.step ?? resumedStep;
      this.failedStep = resumedStep ?? result.step ?? null;
      this.failedSessionId = resumedSessionId;
    } else {
      this.currentStep = result.step ?? null;
      this.failedStep = null;
      this.failedSessionId = null;
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

  /**
   * Rebuilds a terminally failed official session at the same step without
   * replaying its rejected answer. This keeps recovery deterministic while
   * leaving all configuration writes with the Gateway.
   */
  async retry(): Promise<OpenClawWizardResult> {
    if (this.sessionId) return await this.resume();
    const failedStep = this.failedStep;
    if (!failedStep) return await this.start(this.workspace);
    const replay = this.history.map((entry) => ({ ...entry }));
    let current = await this.start(this.workspace);
    for (const entry of replay) {
      if (current.done || !current.step || current.step.id !== entry.step.id) {
        throw new Error('OpenClaw wizard could not restore the failed step.');
      }
      current = await this.next(entry.step.id, entry.value);
    }
    if (current.done || !current.step || current.step.id !== failedStep.id) {
      throw new Error('OpenClaw wizard could not restore the failed step.');
    }
    return current;
  }

  forgetSession(): void {
    this.setSession(null);
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
    this.history = [];
  }

  async cancel(): Promise<void> {
    const operation = this.captureOperation();
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    try {
      const status = assertWizardCancelStatus(await this.callGateway('wizard.cancel', { sessionId }));
      this.assertOperationCurrent(operation);
      // The official Gateway can reject cancellation once a durable write has
      // started. Its RPC still succeeds but reports `running`; retain the
      // opaque id so callers resume instead of creating a conflicting session.
      if (status === 'running') throw new OpenClawWizardCancellationLockedError();
      this.setSession(null);
    } catch (error) {
      // A server-side expiry means the session is already gone. For transport
      // failures retain the id so a later start/back action can retry cleanup.
      // Re-check the epoch before mutating: a stale cancel must never clear a
      // newer setup operation's session, even when the old RPC says not-found.
      if (isOpenClawWizardSessionLost(error)) {
        this.assertOperationCurrent(operation);
        if (this.sessionId === sessionId) this.setSession(null);
      }
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
  if (error instanceof OpenClawWizardCancelledError) return 'cancelled';
  if (error instanceof OpenClawWizardCancellationLockedError) return 'cancellation_locked';
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const details = record?.details && typeof record.details === 'object'
    ? record.details as Record<string, unknown>
    : null;
  const code = String(details?.code ?? record?.code ?? '').toUpperCase();
  if (normalized.includes('wizard not found')
    || normalized.includes('wizard not running')
    || normalized.includes('wizard session is not running')
    || code === 'WIZARD_NOT_FOUND') {
    return 'session_lost';
  }
  if (normalized.includes('wizard: no pending step') || code === 'WIZARD_NO_PENDING_STEP') return 'step_desynchronized';
  if (normalized.includes('wizard already running') || code === 'WIZARD_ALREADY_RUNNING') return 'already_running';
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
  const model = cfg.agents?.defaults?.model;
  const primary = typeof model === 'string' ? model : model?.primary;
  return !(typeof primary === 'string' && primary.trim());
}
