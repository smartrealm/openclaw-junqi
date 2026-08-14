import { debugWarn } from '@/utils/debugLog';
import { wizardRuntimeScopeKey } from '@/services/setup/wizardRuntimeScope';
import { isOpenClawSetupAdmissionBusy } from '@/services/setup/openClawSetupAdmission';
import { GatewayRpcError } from '@/services/gateway/Connection';

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

export interface OpenClawWizardStartOptions {
  workspace?: string;
  installDaemon?: boolean;
  flow?: 'setup' | 'channels';
  channel?: string;
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

export function parseOpenClawWizardStep(value: unknown): OpenClawWizardStep {
  const parsed = normalizeWizardStep(value);
  if (!parsed.ok) {
    throw new Error(parsed.reason === 'unsupported-type'
      ? `This JunQi build does not support the OpenClaw onboarding step \`${parsed.id}\` of type \`${parsed.type}\`. Update JunQi Desktop to continue setup.`
      : 'OpenClaw returned an invalid wizard step.');
  }
  return parsed.step;
}

export interface OpenClawWizardRequestOptions {
  timeoutMs?: number | null;
}

export const OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS = 30_000;
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
 * 官方 Gateway 持有 Wizard 状态，桌面端只持有视图。本地仅保存不透明会话号，
 * 以便渲染进程或应用重启后恢复同一官方步骤；会话号不包含凭据。
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

export const OPENCLAW_WIZARD_SESSION_STORAGE_KEYS = {
  setup: 'junqi.openclaw-wizard-session',
  channels: 'junqi.openclaw-channels-wizard-session',
} as const;

function wizardSessionScopeKey(scope: OpenClawWizardSessionScope): string | null {
  return wizardRuntimeScopeKey(scope.runtimeMode, scope.gatewayWsUrl);
}

/**
 * 会话号只对创建它的运行时和 Gateway 有效。范围变化时保留旧记录但绝不读取，
 * 因而 Native/Docker 切换或连接目标变更不会把旧会话提交给新的官方 Gateway。
 */
export function createScopedOpenClawWizardSessionStore(
  resolveScope: () => OpenClawWizardSessionScope | null,
  storageKey: string = OPENCLAW_WIZARD_SESSION_STORAGE_KEYS.setup,
): OpenClawWizardScopedSessionStore {
  return {
    scopeKey: () => {
      const scope = resolveScope();
      return scope ? wizardSessionScopeKey(scope) : null;
    },
    load: (scopeKey) => {
      try {
        return globalThis.localStorage?.getItem(`${storageKey}:${encodeURIComponent(scopeKey)}`) || null;
      } catch {
        return null;
      }
    },
    save: (scopeKey, sessionId) => {
      try {
        if (!scopeKey) return;
        globalThis.localStorage?.setItem(`${storageKey}:${encodeURIComponent(scopeKey)}`, sessionId);
      } catch {
        // 本地恢复记录不可阻止官方 Wizard 继续执行。
      }
    },
    clear: (scopeKey) => {
      try {
        if (!scopeKey) return;
        globalThis.localStorage?.removeItem(`${storageKey}:${encodeURIComponent(scopeKey)}`);
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
 * 协议新增字段不得中断首次启动。JunQi 只校验实际使用的字段，并记录尚未消费的字段，
 * 避免把上游的增量扩展错误识别为无效响应。
 */
function warnOnUnknownWizardKeys(
  result: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(result).filter((key) => !allowed.has(key));
  if (unknown.length === 0) return;
  // 仅用于诊断；新版 Gateway 可以携带当前客户端尚未读取的增量字段。
  debugWarn('gateway', `${context} carries fields this build ignores:`, unknown.join(', '));
}

function assertWizardResultFields(
  value: unknown,
  allowedKeys: readonly string[],
  context: string,
  allowRunningWithoutStep = false,
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
  // 官方错误或取消终态不会携带下一步，必须交给恢复状态机处理。
  if (!isOpenClawWizardTerminalResult(value as OpenClawWizardResult)) {
    if (allowRunningWithoutStep && result.status === 'running' && result.step === undefined) {
      return response;
    }
    const parsed = normalizeWizardStep(result.step);
    if (!parsed.ok) {
      // 区分不支持与缺失，避免把客户端能力不足误报为 Gateway 数据损坏。
      throw new Error(parsed.reason === 'unsupported-type'
        ? `This JunQi build does not support the OpenClaw onboarding step \`${parsed.id}\` of type \`${parsed.type}\`. Update JunQi Desktop to continue setup.`
        : 'OpenClaw wizard response is missing the next step.');
    }
    return { ...response, step: parsed.step };
  }
  return response;
}

export function parseOpenClawWizardStartResult(value: unknown): OpenClawWizardStartResult {
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

/** 供应商拥有授权与准备会话；首个结构化步骤发布前允许保持运行态。 */
export function parseOpenClawHostedWizardStartResult(value: unknown): OpenClawWizardStartResult {
  const result = assertWizardResultFields(
    value,
    ['sessionId', 'done', 'step', 'status', 'error', 'channels', 'accounts', 'preparedModelRef'],
    'hosted wizard start response',
    true,
  );
  const sessionId = (value as Record<string, unknown>).sessionId;
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('OpenClaw hosted wizard start response has an invalid `sessionId`.');
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

export function isOpenClawWizardTerminalResult(result: OpenClawWizardResult): boolean {
  return result.done
    && (result.status === 'done'
      || result.status === 'cancelled'
      || result.status === 'error');
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
  private startOptions: OpenClawWizardStartOptions = {};

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

  async start(options: OpenClawWizardStartOptions = {}): Promise<OpenClawWizardStartResult> {
    this.synchronizeStoredSession();
    const operation = this.captureOperation();
    // 刷新或返回可能留下仍在运行的官方会话；新建前必须先释放它，避免单会话约束阻塞后续配置。
    if (this.sessionId) {
      await this.cancel();
    }
    const workspace = options.workspace?.trim() || undefined;
    const channel = options.channel?.trim() || undefined;
    if (options.flow === 'channels' && !channel) {
      throw new Error('OpenClaw channels wizard requires a channel.');
    }
    if (options.flow !== 'channels' && channel) {
      throw new Error('OpenClaw wizard channel is only valid for the channels flow.');
    }
    this.startOptions = {
      ...(workspace ? { workspace } : {}),
      ...(typeof options.installDaemon === 'boolean'
        ? { installDaemon: options.installDaemon }
        : {}),
      ...(options.flow ? { flow: options.flow } : {}),
      ...(channel ? { channel } : {}),
    };
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
    // setup 与 channels 都使用 OpenClaw 正式 Wizard 协议。调用方必须使用不同的
    // 会话存储范围，避免主界面渠道配置接管首次启动中的官方会话。
    const startParams = this.startOptions.flow === 'channels'
      ? { flow: 'channels' as const, channel: this.startOptions.channel }
      : {
          mode: 'local' as const,
          ...(this.startOptions.workspace ? { workspace: this.startOptions.workspace } : {}),
          ...(typeof this.startOptions.installDaemon === 'boolean'
            ? { installDaemon: this.startOptions.installDaemon }
            : {}),
        };
    const requestOptions = { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS };
    let rawResult: unknown;
    try {
      rawResult = await this.callGateway('wizard.start', startParams, requestOptions);
    } catch (error) {
      if (
        this.startOptions.flow === 'channels'
        || typeof this.startOptions.installDaemon !== 'boolean'
        || !isInstallDaemonStartParamUnsupported(error)
      ) {
        throw error;
      }
      // stable 在创建会话前以封闭 schema 拒绝该主线新增字段，因此这里只重试
      // 公共参数。其他错误不能证明零副作用，必须原样失败。
      this.assertOperationCurrent(operation);
      debugWarn(
        'gateway',
        'OpenClaw stable wizard.start does not accept installDaemon; retrying the official common parameter set.',
      );
      rawResult = await this.callGateway('wizard.start', {
        mode: 'local' as const,
        ...(this.startOptions.workspace ? { workspace: this.startOptions.workspace } : {}),
      }, requestOptions);
    }
    const result = parseOpenClawWizardStartResult(rawResult);
    this.assertOperationCurrent(operation);
    const returnedSessionId = result.sessionId;
    const terminal = isOpenClawWizardTerminalResult(result);
    const failed = result.status === 'error';
    const rejected = Boolean(result.error) && !terminal;
    this.setSession(terminal ? null : returnedSessionId);
    this.currentStep = failed || rejected || !terminal ? result.step ?? null : null;
    this.failedStep = failed || rejected ? result.step ?? null : null;
    this.failedSessionId = failed || rejected ? returnedSessionId : null;
    return result;
  }

  adoptStartedSession(result: OpenClawWizardStartResult): OpenClawWizardStartResult {
    this.synchronizeStoredSession();
    if (this.sessionId) {
      throw new Error('OpenClaw wizard session is already running.');
    }
    this.startOptions = {};
    this.currentStep = null;
    this.failedStep = null;
    this.failedSessionId = null;
    const terminal = isOpenClawWizardTerminalResult(result);
    const failed = result.status === 'error';
    const rejected = Boolean(result.error) && !terminal;
    this.setSession(terminal ? null : result.sessionId);
    this.currentStep = failed || rejected || !terminal ? result.step ?? null : null;
    this.failedStep = failed || rejected ? result.step ?? null : null;
    this.failedSessionId = failed || rejected ? result.sessionId : null;
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
    // 渠道插件可能在该请求内等待官方扫码轮询结束。超时与终态由插件和
    // Wizard 会话拥有；客户端只允许用户显式暂停，不能用本地时限提前截断。
    }, { timeoutMs: null }));
    this.assertOperationCurrent(operation);
    if (isOpenClawWizardTerminalResult(result)) {
      this.setSession(null);
      const failed = result.status === 'error';
      const failedStep = result.step ?? submittedStep;
      this.currentStep = failed ? failedStep : null;
      this.failedStep = failed ? failedStep : null;
      this.failedSessionId = failed ? submittedSessionId : null;
    } else if (result.error) {
      // 答案校验失败不会结束官方会话，保留当前步骤供用户修正。
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
   * 无答案的 `wizard.next` 是官方会话恢复请求。`wizard.status` 读取后会清理会话，
   * 不能用于恢复，否则紧随其后的请求必然找不到原会话。
   */
  async resume(options: OpenClawWizardRequestOptions = {}): Promise<OpenClawWizardResult> {
    this.synchronizeStoredSession();
    const operation = this.captureOperation();
    if (!this.sessionId) throw new Error('OpenClaw wizard session is not running.');
    const resumedSessionId = this.sessionId;
    const resumedStep = this.currentStep;
    const result = assertWizardNextResult(await this.callGateway('wizard.next', {
      sessionId: resumedSessionId,
    }, {
      timeoutMs: options.timeoutMs === undefined
        ? OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS
        : options.timeoutMs,
    }));
    this.assertOperationCurrent(operation);
    if (isOpenClawWizardTerminalResult(result)) {
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
   * 恢复仍在运行的官方会话。终态失败才重新启动对应 flow；桌面端不保存或重放已提交答案。
   */
  async retry(): Promise<OpenClawWizardResult> {
    this.synchronizeStoredSession();
    if (this.sessionId) return await this.resume();
    return await this.start(this.startOptions);
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
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : String(error);
  const normalized = message.toLowerCase();
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
  if (isOpenClawSetupAdmissionBusy(error)) return 'already_running';
  if (normalized.includes('request timeout')) return 'request_timeout';
  return 'unknown';
}

function isInstallDaemonStartParamUnsupported(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && error.code === 'INVALID_REQUEST'
    && error.message === "invalid wizard.start params: at root: unexpected property 'installDaemon'";
}

export function isOpenClawWizardSessionLost(error: unknown): boolean {
  return classifyOpenClawWizardFailure(error) === 'session_lost';
}

export function isOpenClawWizardStepDesynchronized(error: unknown): boolean {
  return classifyOpenClawWizardFailure(error) === 'step_desynchronized';
}
