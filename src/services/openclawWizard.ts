import { debugWarn } from '@/utils/debugLog';

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

export interface OpenClawWizardConfiguredAccount {
  channel: string;
  accountId: string;
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
}

export interface OpenClawWizardResult {
  done: boolean;
  status?: 'running' | 'done' | 'cancelled' | 'error';
  step?: OpenClawWizardStep;
  error?: string;
  channels?: string[];
  accounts?: OpenClawWizardConfiguredAccount[];
  preparedModelRef?: string;
}

export interface OpenClawWizardStartResult extends OpenClawWizardResult {
  sessionId: string;
}

const WIZARD_PROBE_TITLE = /(?:connection|connectivity|channel).{0,20}(?:test|check|probe|verification)|(?:连接|連線|渠道|通道).{0,20}(?:测试|測試|检查|檢查|验证|驗證)/i;
const WIZARD_PROBE_FAILURE = /(?:connection|probe|verification|check).{0,20}(?:failed|error)|(?:failed|error).{0,20}(?:connection|probe|verification|check)|(?:连接|連線|探测|探測|验证|驗證|检查|檢查).{0,20}(?:失败|失敗|错误|錯誤)|(?:失败|失敗|错误|錯誤).{0,20}(?:连接|連線|探测|探測|验证|驗證|检查|檢查)|status code\s+[45]\d\d|http\s+[45]\d\d/i;

/**
 * OpenClaw's WizardSessionPrompter.outro() emits exactly a client note titled
 * "Done". Provider notes use note(), so checking this protocol-owned title
 * avoids interpreting channel success prose as terminal state.
 */
export function isOpenClawWizardCompletionStep(step?: OpenClawWizardStep | null): boolean {
  return Boolean(step?.type === 'note' && step.title === 'Done');
}

/** A channel-owned probe failure is informative and does not terminate the wizard protocol. */
export function isOpenClawWizardNonBlockingProbeFailure(step?: OpenClawWizardStep | null): boolean {
  if (!step || step.type !== 'note') return false;
  return WIZARD_PROBE_TITLE.test(step.title ?? '') && WIZARD_PROBE_FAILURE.test(step.message ?? '');
}

function isWizardOption(value: unknown): value is OpenClawWizardOption {
  if (!value || typeof value !== 'object') return false;
  const option = value as Record<string, unknown>;
  const allowedKeys = new Set(['value', 'label', 'hint']);
  if (Object.keys(option).some((key) => !allowedKeys.has(key))) return false;
  return Object.prototype.hasOwnProperty.call(option, 'value')
    && typeof option.label === 'string'
    && Boolean(option.label.trim())
    && (option.hint === undefined || typeof option.hint === 'string');
}

function isWizardDeviceCode(value: unknown): value is OpenClawWizardDeviceCode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const code = value as Record<string, unknown>;
  return typeof code.code === 'string'
    && Boolean(code.code.trim())
    && (code.expiresInMinutes === undefined
      || (typeof code.expiresInMinutes === 'number'
        && Number.isInteger(code.expiresInMinutes)
        && code.expiresInMinutes >= 1
        && code.expiresInMinutes <= 1440))
    && (code.message === undefined || typeof code.message === 'string');
}

function isWizardConfiguredAccount(value: unknown): value is OpenClawWizardConfiguredAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return typeof account.channel === 'string'
    && Boolean(account.channel.trim())
    && typeof account.accountId === 'string'
    && Boolean(account.accountId.trim());
}

const WIZARD_STEP_TYPES = [
  'note', 'select', 'text', 'confirm', 'multiselect', 'progress', 'action',
] as const;

const WIZARD_STEP_KEYS = [
  'id', 'type', 'title', 'message', 'format', 'options', 'initialValue',
  'placeholder', 'sensitive', 'executor', 'externalUrl', 'deviceCode',
] as const;

/**
 * Why the step could not be used, so the caller can say something true.
 *
 * `unsupported-type` is deliberately separate from `invalid`: an onboarding
 * step this JunQi build has never heard of means the desktop app is behind the
 * gateway, which is a different user action than a malformed payload.
 */
type WizardStepRejection =
  | { reason: 'invalid' }
  | { reason: 'unsupported-type'; id: string; type: string };

type WizardStepParse =
  | { ok: true; step: OpenClawWizardStep }
  | ({ ok: false } & WizardStepRejection);

/**
 * 上游可新增字段，但 JunQi 只投影已知字段。已使用的字段必须严格校验，避免
 * 协议漂移被静默误解为可用能力。
 */
function normalizeWizardStep(value: unknown): WizardStepParse {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'invalid' };
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return { ok: false, reason: 'invalid' };
  if (typeof raw.type !== 'string') return { ok: false, reason: 'invalid' };
  if (!(WIZARD_STEP_TYPES as readonly string[]).includes(raw.type)) {
    return { ok: false, reason: 'unsupported-type', id: raw.id, type: raw.type };
  }
  if (raw.title !== undefined && typeof raw.title !== 'string') return { ok: false, reason: 'invalid' };
  if (raw.message !== undefined && typeof raw.message !== 'string') return { ok: false, reason: 'invalid' };
  if (raw.format !== undefined && raw.format !== 'plain') return { ok: false, reason: 'invalid' };
  if (raw.options !== undefined && (!Array.isArray(raw.options) || !raw.options.every(isWizardOption))) {
    return { ok: false, reason: 'invalid' };
  }
  if (raw.placeholder !== undefined && typeof raw.placeholder !== 'string') return { ok: false, reason: 'invalid' };
  if (raw.sensitive !== undefined && typeof raw.sensitive !== 'boolean') return { ok: false, reason: 'invalid' };
  if (raw.executor !== undefined && raw.executor !== 'gateway' && raw.executor !== 'client') {
    return { ok: false, reason: 'invalid' };
  }
  if (raw.externalUrl !== undefined && (typeof raw.externalUrl !== 'string' || !raw.externalUrl.trim())) {
    return { ok: false, reason: 'invalid' };
  }
  if (raw.deviceCode !== undefined && !isWizardDeviceCode(raw.deviceCode)) {
    return { ok: false, reason: 'invalid' };
  }
  // Project to the known shape: unknown fields are ignored, never forwarded to
  // the UI where they could be mistaken for contract we support.
  const step: Record<string, unknown> = {};
  for (const key of WIZARD_STEP_KEYS) {
    if (raw[key] !== undefined) step[key] = raw[key];
  }
  return { ok: true, step: step as unknown as OpenClawWizardStep };
}

export interface OpenClawWizardRequestOptions {
  timeoutMs?: number | null;
}

export const OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS = 30_000;
export const OPENCLAW_WIZARD_INTERACTIVE_TIMEOUT_MS = 10 * 60_000;

export type OpenClawWizardFailureKind =
  | 'session_lost'
  | 'step_desynchronized'
  | 'already_running'
  | 'request_timeout'
  | 'cancelled'
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
export interface OpenClawWizardLegacySessionStore {
  load(): string | null;
  save(sessionId: string): void;
  clear(): void;
}

export interface OpenClawWizardScopedSessionStore {
  scopeKey(): string | null;
  load(scopeKey: string): string | null;
  save(scopeKey: string, sessionId: string): void;
  clear(scopeKey: string): void;
}

export type OpenClawWizardSessionStore = OpenClawWizardLegacySessionStore | OpenClawWizardScopedSessionStore;

export interface OpenClawWizardSessionScope {
  runtimeMode: 'native' | 'docker';
  gatewayWsUrl: string;
}

const WIZARD_SESSION_STORAGE_KEY = 'junqi.openclaw-wizard-session';

function wizardSessionScopeKey(scope: OpenClawWizardSessionScope): string | null {
  try {
    const url = new URL(scope.gatewayWsUrl.trim());
    if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.hostname || url.username || url.password) {
      return null;
    }
    return `${scope.runtimeMode}:${url.toString()}`;
  } catch {
    return null;
  }
}

/**
 * 会话号只对创建它的运行时和 Gateway 有效。范围变化时保留旧记录但绝不读取，
 * 因而 Native/Docker 切换或连接目标变更不会把旧会话提交给新的官方 Gateway。
 */
export function createScopedOpenClawWizardSessionStore(
  resolveScope: () => OpenClawWizardSessionScope | null,
): OpenClawWizardScopedSessionStore {
  return {
    scopeKey: () => {
      const scope = resolveScope();
      return scope ? wizardSessionScopeKey(scope) : null;
    },
    load: (scopeKey) => {
      try {
        return globalThis.localStorage?.getItem(`${WIZARD_SESSION_STORAGE_KEY}:${encodeURIComponent(scopeKey)}`) || null;
      } catch {
        return null;
      }
    },
    save: (scopeKey, sessionId) => {
      try {
        if (!scopeKey) return;
        globalThis.localStorage?.setItem(`${WIZARD_SESSION_STORAGE_KEY}:${encodeURIComponent(scopeKey)}`, sessionId);
      } catch {
        // 本地恢复记录不可阻止官方 Wizard 继续执行。
      }
    },
    clear: (scopeKey) => {
      try {
        if (!scopeKey) return;
        globalThis.localStorage?.removeItem(`${WIZARD_SESSION_STORAGE_KEY}:${encodeURIComponent(scopeKey)}`);
      } catch {
        // 本地恢复记录不可阻止官方 Wizard 继续执行。
      }
    },
  };
}

function isScopedWizardSessionStore(
  store: OpenClawWizardSessionStore,
): store is OpenClawWizardScopedSessionStore {
  return 'scopeKey' in store;
}

/**
 * Additive protocol changes must not break onboarding.
 *
 * This used to throw on any field outside the allowlist, so a single new key in
 * a gateway response made first-run setup impossible. Unknown keys are now
 * ignored - every field JunQi acts on is still validated individually below,
 * which is where misinterpretation could actually occur.
 */
function warnOnUnknownWizardKeys(
  result: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(result).filter((key) => !allowed.has(key));
  if (unknown.length === 0) return;
  // Surfaced for diagnosis only: a newer gateway is expected to carry fields
  // this build does not read yet.
  debugWarn('gateway', `${context} carries fields this build ignores:`, unknown.join(', '));
}

function assertWizardResultFields(
  value: unknown,
  allowedKeys: readonly string[],
  context: string,
): OpenClawWizardResult {
  if (!value || typeof value !== 'object') {
    throw new Error(`OpenClaw returned an invalid ${context}.`);
  }
  const result = value as Record<string, unknown>;
  warnOnUnknownWizardKeys(result, allowedKeys, `OpenClaw ${context}`);
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
  if (result.channels !== undefined
    && (!Array.isArray(result.channels)
      || !result.channels.every((channel) => typeof channel === 'string' && Boolean(channel.trim())))) {
    throw new Error('OpenClaw wizard response has invalid `channels`.');
  }
  if (result.accounts !== undefined
    && (!Array.isArray(result.accounts) || !result.accounts.every(isWizardConfiguredAccount))) {
    throw new Error('OpenClaw wizard response has invalid `accounts`.');
  }
  if (result.preparedModelRef !== undefined
    && (typeof result.preparedModelRef !== 'string' || !result.preparedModelRef.trim())) {
    throw new Error('OpenClaw wizard response has an invalid `preparedModelRef`.');
  }
  const response: OpenClawWizardResult = {
    done: result.done,
    ...(result.status ? { status: result.status } : {}),
    ...(typeof result.error === 'string' ? { error: result.error } : {}),
    ...(Array.isArray(result.channels) ? { channels: result.channels.filter(
      (channel): channel is string => typeof channel === 'string',
    ) } : {}),
    ...(Array.isArray(result.accounts) ? { accounts: result.accounts.filter(isWizardConfiguredAccount) } : {}),
    ...(typeof result.preparedModelRef === 'string' ? { preparedModelRef: result.preparedModelRef } : {}),
  };
  // Terminal error/cancel responses intentionally do not carry a next step.
  // They are valid official Wizard outcomes and must reach the recovery
  // state machine instead of being misclassified as malformed Gateway data.
  if (!isTerminalWizardResult(value as OpenClawWizardResult)) {
    const parsed = normalizeWizardStep(result.step);
    if (!parsed.ok) {
      // Naming the cause matters: reporting an unsupported step as "missing"
      // sends the user after the Gateway when the fix is upgrading JunQi.
      throw new Error(parsed.reason === 'unsupported-type'
        ? `This JunQi build does not support the OpenClaw onboarding step \`${parsed.id}\` of type \`${parsed.type}\`. Update JunQi Desktop to continue setup.`
        : 'OpenClaw wizard response is missing the next step.');
    }
    return { ...response, step: parsed.step };
  }
  return response;
}

function assertWizardStartResult(value: unknown): OpenClawWizardStartResult {
  const result = assertWizardResultFields(
    value,
    ['sessionId', 'done', 'step', 'status', 'error', 'channels', 'accounts', 'preparedModelRef'],
    'wizard start response',
  );
  const sessionId = (value as Record<string, unknown>).sessionId;
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('OpenClaw wizard start response has an invalid `sessionId`.');
  }
  return { ...result, sessionId: sessionId.trim() };
}

function assertWizardNextResult(value: unknown): OpenClawWizardResult {
  return assertWizardResultFields(
    value,
    ['done', 'step', 'status', 'error', 'channels', 'accounts', 'preparedModelRef'],
    'wizard next response',
  );
}

function assertWizardStatusResult(value: unknown): Pick<OpenClawWizardResult, 'status' | 'error'> {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenClaw returned an invalid wizard status response.');
  }
  const result = value as Record<string, unknown>;
  warnOnUnknownWizardKeys(result, ['status', 'error'], 'OpenClaw wizard status response');
  if (result.status !== 'running'
    && result.status !== 'done'
    && result.status !== 'cancelled'
    && result.status !== 'error') {
    throw new Error('OpenClaw wizard status response has an invalid `status`.');
  }
  if (result.error !== undefined && typeof result.error !== 'string') {
    throw new Error('OpenClaw wizard status response has an invalid `error`.');
  }
  return {
    status: result.status,
    ...(typeof result.error === 'string' ? { error: result.error } : {}),
  };
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

function assertWizardCancelStatus(value: unknown): 'cancelled' {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenClaw returned an invalid wizard cancellation response.');
  }
  const result = value as Record<string, unknown>;
  warnOnUnknownWizardKeys(result, ['status', 'error'], 'OpenClaw wizard cancellation response');
  if (result.error !== undefined && typeof result.error !== 'string') {
    throw new Error('OpenClaw wizard cancellation response has an invalid `error`.');
  }
  if (result.status !== 'running'
    && result.status !== 'done'
    && result.status !== 'cancelled'
    && result.status !== 'error') {
    throw new Error('OpenClaw wizard cancellation response has an invalid `status`.');
  }
  if (result.status !== 'cancelled') {
    throw new Error('OpenClaw wizard cancellation response status must be `cancelled`.');
  }
  return result.status;
}

export class OpenClawWizardClient {
  private operationEpoch = 0;
  private sessionId: string | null = null;
  private sessionScopeKey: string | null | undefined;
  private failedSessionId: string | null = null;
  private currentStep: OpenClawWizardStep | null = null;
  private failedStep: OpenClawWizardStep | null = null;
  private workspace: string | undefined;

  constructor(
    private readonly callGateway: GatewayCaller,
    private readonly sessionStore?: OpenClawWizardSessionStore,
  ) {
    this.synchronizeStoredSession();
  }

  get hasActiveSession(): boolean {
    this.synchronizeStoredSession();
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

  /**
   * 每次使用前重新核对范围。目标变更意味着旧 Gateway 的会话不再可恢复，
   * 因此清空内存中的步骤和诊断，并只尝试读取新范围自己的持久化会话。
   */
  private synchronizeStoredSession(): void {
    if (!this.sessionStore) return;
    if (!isScopedWizardSessionStore(this.sessionStore)) {
      if (this.sessionScopeKey !== undefined) return;
      this.sessionScopeKey = null;
      this.sessionId = this.sessionStore.load();
      return;
    }
    const nextScopeKey = this.sessionStore.scopeKey();
    if (this.sessionScopeKey !== undefined && this.sessionScopeKey === nextScopeKey) return;
    this.sessionScopeKey = nextScopeKey;
    this.sessionId = nextScopeKey === null ? null : this.sessionStore.load(nextScopeKey);
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
  }

  async start(workspace?: string): Promise<OpenClawWizardStartResult> {
    this.synchronizeStoredSession();
    const operation = this.captureOperation();
    // A refresh/back navigation can leave the official server-side session
    // alive. Reconcile it before starting a new session so OpenClaw's
    // single-session guard cannot strand onboarding on "already running".
    if (this.sessionId) {
      await this.cancel();
    }
    this.workspace = workspace?.trim() || undefined;
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
    const result = assertWizardStartResult(await this.callGateway('wizard.start', {
      mode: 'local',
      ...(this.workspace ? { workspace: this.workspace } : {}),
    }, { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS }));
    this.assertOperationCurrent(operation);
    const returnedSessionId = result.sessionId;
    const terminal = isTerminalWizardResult(result);
    const failed = result.status === 'error';
    const rejected = Boolean(result.error) && !terminal;
    this.setSession(terminal ? null : returnedSessionId);
    this.currentStep = failed || rejected || !terminal ? result.step ?? null : null;
    this.failedStep = failed || rejected ? result.step ?? null : null;
    this.failedSessionId = failed || rejected ? returnedSessionId : null;
    return result;
  }

  async next(stepId: string, value?: unknown): Promise<OpenClawWizardResult> {
    this.synchronizeStoredSession();
    const operation = this.captureOperation();
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const submittedSessionId = this.sessionId;
    const submittedStep = this.currentStep;
    const result = assertWizardNextResult(await this.callGateway('wizard.next', {
      sessionId: this.sessionId,
      answer: {
        stepId,
        ...(value !== undefined ? { value } : {}),
      },
    }, { timeoutMs: OPENCLAW_WIZARD_INTERACTIVE_TIMEOUT_MS }));
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
    this.synchronizeStoredSession();
    const operation = this.captureOperation();
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const resumedSessionId = this.sessionId;
    const resumedStep = this.currentStep;
    const status = assertWizardStatusResult(await this.callGateway('wizard.status', {
      sessionId: resumedSessionId,
    }, { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS }));
    this.assertOperationCurrent(operation);
    if (status.status !== 'running') {
      const failed = status.status === 'error';
      this.setSession(null);
      this.currentStep = failed ? resumedStep : null;
      this.failedStep = failed ? resumedStep : null;
      this.failedSessionId = failed ? resumedSessionId : null;
      return {
        done: true,
        status: status.status,
        ...(status.error ? { error: status.error } : {}),
      };
    }
    const result = assertWizardNextResult(await this.callGateway('wizard.next', {
      sessionId: resumedSessionId,
    }, { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS }));
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
   * Resume a live official session. A terminal failure starts a fresh official
   * session and lets OpenClaw read any state it durably committed; accepted
   * answers are never retained or replayed by the desktop.
   */
  async retry(): Promise<OpenClawWizardResult> {
    this.synchronizeStoredSession();
    if (this.sessionId) return await this.resume();
    return await this.start(this.workspace);
  }

  forgetSession(): void {
    this.setSession(null);
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
  }

  async cancel(): Promise<void> {
    this.synchronizeStoredSession();
    const operation = this.captureOperation();
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    try {
      assertWizardCancelStatus(await this.callGateway(
        'wizard.cancel',
        { sessionId },
        { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
      ));
      this.assertOperationCurrent(operation);
      this.setSession(null);
    } catch (error) {
      // A server-side expiry means the session is already gone. For transport
      // failures retain the id so a later start action can retry cleanup.
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
    if (!this.sessionStore) return;
    if (isScopedWizardSessionStore(this.sessionStore)) {
      if (this.sessionScopeKey === null || this.sessionScopeKey === undefined) return;
      if (sessionId) this.sessionStore.save(this.sessionScopeKey, sessionId);
      else this.sessionStore.clear(this.sessionScopeKey);
      return;
    }
    if (sessionId) this.sessionStore.save(sessionId);
    else this.sessionStore.clear();
  }
}

export function classifyOpenClawWizardFailure(error: unknown): OpenClawWizardFailureKind {
  if (error instanceof OpenClawWizardCancelledError) return 'cancelled';
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
  const cfg = config as Record<string, unknown>;
  const agents = cfg.agents;
  const defaults = agents && typeof agents === 'object'
    ? (agents as Record<string, unknown>).defaults
    : null;
  const model = defaults && typeof defaults === 'object'
    ? (defaults as Record<string, unknown>).model
    : null;
  const primary = typeof model === 'string'
    ? model
    : model && typeof model === 'object'
      ? (model as Record<string, unknown>).primary
      : null;
  return !(typeof primary === 'string' && primary.trim());
}
