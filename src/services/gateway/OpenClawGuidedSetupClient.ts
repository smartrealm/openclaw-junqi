import { GatewayDisconnectedError } from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import {
  parseOpenClawHostedWizardStartResult,
  parseOpenClawWizardStep,
  type OpenClawWizardStartResult,
  type OpenClawWizardStep,
} from '@/services/openclawWizard';

export const OPENCLAW_GUIDED_SETUP_METHODS = {
  detect: 'openclaw.setup.detect',
  activate: 'openclaw.setup.activate',
  verify: 'openclaw.setup.verify',
  authStart: 'openclaw.setup.auth.start',
  prepareStart: 'openclaw.setup.prepare.start',
  chat: 'openclaw.chat',
} as const;

export const OPENCLAW_CRESTODIAN_GUIDED_SETUP_METHODS = {
  detect: 'crestodian.setup.detect',
  activate: 'crestodian.setup.activate',
  chat: 'crestodian.chat',
} as const;

export type GuidedSetupMethodFamily = 'openclaw' | 'crestodian';

const SETUP_KINDS = [
  'existing-model',
  'openai-api-key',
  'anthropic-api-key',
  'claude-cli',
  'codex-cli',
  'gemini-cli',
  'api-key',
] as const;

const SETUP_STATUSES = [
  'ok',
  'auth',
  'rate_limit',
  'billing',
  'timeout',
  'format',
  'unavailable',
  'unknown',
] as const;

export type GuidedSetupKind = typeof SETUP_KINDS[number] | `provider-auto:${string}`;
export type GuidedSetupStatus = typeof SETUP_STATUSES[number];

export interface GuidedSetupCandidate {
  kind: Exclude<GuidedSetupKind, 'api-key'>;
  brandId?: string;
  label: string;
  detail: string;
  modelRef: string;
  recommended: boolean;
  credentials?: boolean;
  icon?: string;
  website?: string;
}

export interface GuidedSetupUnavailableCandidate {
  id: string;
  brandId?: string;
  label: string;
  detail: string;
  reason: string;
  authOptionId?: string;
  manualProviderId?: string;
  icon?: string;
  website?: string;
}

export interface GuidedSetupManualProvider {
  id: string;
  brandId?: string;
  groupLabel?: string;
  label: string;
  hint?: string;
  icon?: string;
  website?: string;
}

export interface GuidedSetupAuthOption {
  id: string;
  brandId?: string;
  label: string;
  hint?: string;
  groupLabel?: string;
  icon?: string;
  website?: string;
  kind: 'oauth' | 'device-code';
  featured: boolean;
}

export interface GuidedSetupPrepareOption {
  id: string;
  brandId?: string;
  label: string;
  hint?: string;
  actionLabel?: string;
  icon?: string;
  website?: string;
}

export interface GuidedSetupRecommendedInstall {
  id: string;
  brandId?: string;
  label: string;
  hint: string;
  website: string;
  icon: string;
}

export interface GuidedSetupDetection {
  methodFamily: GuidedSetupMethodFamily;
  candidates: GuidedSetupCandidate[];
  unavailableCandidates: GuidedSetupUnavailableCandidate[];
  manualProviders: GuidedSetupManualProvider[];
  authOptions: GuidedSetupAuthOption[];
  prepareOptions?: GuidedSetupPrepareOption[];
  recommendedInstalls: GuidedSetupRecommendedInstall[];
  workspace: string;
  configuredModel?: string;
  setupComplete: boolean;
}

export interface GuidedSetupActivateParams {
  kind: GuidedSetupKind;
  modelRef?: string;
  authChoice?: string;
  apiKey?: string;
  workspace?: string;
}

export type GuidedSetupActivation =
  | { ok: true; modelRef: string; latencyMs?: number; lines?: string[] }
  | { ok: false; status: GuidedSetupStatus; error: string; lines?: string[] };

export type GuidedSetupVerification =
  | { ok: true; modelRef: string; latencyMs: number }
  | { ok: false; status: Exclude<GuidedSetupStatus, 'ok'>; error: string };

export interface GuidedSetupWizardStartParams {
  sessionId: string;
  authChoice: string;
  workspace?: string;
}

export interface GuidedSetupChatParams {
  sessionId: string;
  message?: string;
  wizardAnswer?: { stepId: string; value?: unknown };
  wizardCancel?: { stepId: string };
  welcomeVariant?: 'onboarding' | 'new-agent';
  reset?: boolean;
}

export interface GuidedSetupChatQuestion {
  id: string;
  header: string;
  question: string;
  options: Array<{
    label: string;
    description?: string;
    recommended?: boolean;
    reply?: string;
  }>;
  isOther?: boolean;
  skipAction?: 'exit';
}

export interface GuidedSetupChatResult {
  sessionId: string;
  reply: string;
  sensitive?: boolean;
  wizardInputPending?: boolean;
  action: 'none' | 'open-agent' | 'exit';
  agentDraft?: 'hatch';
  agentId?: string;
  needsApproval?: boolean;
  proposalId?: string;
  question?: GuidedSetupChatQuestion;
  step?: OpenClawWizardStep;
}

export class OpenClawGuidedSetupMethodUnavailableError extends Error {
  readonly code = 'OPENCLAW_GUIDED_SETUP_METHOD_UNAVAILABLE';

  constructor(readonly method: string, readonly availability: 'unsupported' | 'connection-unavailable') {
    super(`OpenClaw guided setup method ${method} is unavailable: ${availability}`);
    this.name = 'OpenClawGuidedSetupMethodUnavailableError';
  }
}

export class OpenClawGuidedSetupResponseError extends Error {
  readonly code = 'OPENCLAW_GUIDED_SETUP_RESPONSE_INVALID';

  constructor(method: string) {
    super(`The OpenClaw Gateway returned an invalid ${method} response`);
    this.name = 'OpenClawGuidedSetupResponseError';
  }
}

interface OpenClawGuidedSetupClientDependencies {
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return text(value);
}

function httpsUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  const source = text(value);
  if (!source) return null;
  try {
    return new URL(source).protocol === 'https:' ? source : null;
  } catch {
    return null;
  }
}

function isSetupKind(value: unknown): value is GuidedSetupKind {
  return typeof value === 'string' && (
    (SETUP_KINDS as readonly string[]).includes(value)
    || /^provider-auto:.+$/u.test(value)
  );
}

function setupStatus(value: unknown): GuidedSetupStatus | null {
  return typeof value === 'string' && (SETUP_STATUSES as readonly string[]).includes(value)
    ? value as GuidedSetupStatus
    : null;
}

function parseBrandedEntry(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | null {
  const source = record(value);
  if (!source) return null;
  const parsed: Record<string, unknown> = {};
  for (const field of fields) {
    const parsedText = optionalText(source[field]);
    if (parsedText === null) return null;
    if (parsedText !== undefined) parsed[field] = parsedText;
  }
  for (const field of ['icon', 'website'] as const) {
    const parsedUrl = httpsUrl(source[field]);
    if (parsedUrl === null) return null;
    if (parsedUrl !== undefined) parsed[field] = parsedUrl;
  }
  return { ...source, ...parsed };
}

function parseCandidate(value: unknown): GuidedSetupCandidate | null {
  const source = parseBrandedEntry(value, ['brandId', 'label', 'detail', 'modelRef']);
  if (!source || !isSetupKind(source.kind) || source.kind === 'api-key') return null;
  if (!text(source.label) || typeof source.detail !== 'string' || !text(source.modelRef)) return null;
  if (typeof source.recommended !== 'boolean') return null;
  if (source.credentials !== undefined && typeof source.credentials !== 'boolean') return null;
  return {
    kind: source.kind,
    ...(text(source.brandId) ? { brandId: text(source.brandId)! } : {}),
    label: text(source.label)!,
    detail: source.detail,
    modelRef: text(source.modelRef)!,
    recommended: source.recommended,
    ...(typeof source.credentials === 'boolean' ? { credentials: source.credentials } : {}),
    ...(text(source.icon) ? { icon: text(source.icon)! } : {}),
    ...(text(source.website) ? { website: text(source.website)! } : {}),
  };
}

function parseUnavailableCandidate(value: unknown): GuidedSetupUnavailableCandidate | null {
  const source = parseBrandedEntry(value, [
    'id', 'brandId', 'label', 'detail', 'reason', 'authOptionId', 'manualProviderId',
  ]);
  if (!source || !text(source.id) || !text(source.label) || typeof source.detail !== 'string' || !text(source.reason)) {
    return null;
  }
  return source as unknown as GuidedSetupUnavailableCandidate;
}

function parseManualProvider(value: unknown): GuidedSetupManualProvider | null {
  const source = parseBrandedEntry(value, ['id', 'brandId', 'groupLabel', 'label', 'hint']);
  if (!source || !text(source.id) || !text(source.label)) return null;
  return source as unknown as GuidedSetupManualProvider;
}

function parseAuthOption(value: unknown): GuidedSetupAuthOption | null {
  const source = parseBrandedEntry(value, ['id', 'brandId', 'label', 'hint', 'groupLabel']);
  if (!source || !text(source.id) || !text(source.label)) return null;
  if (source.kind !== 'oauth' && source.kind !== 'device-code') return null;
  if (typeof source.featured !== 'boolean') return null;
  return source as unknown as GuidedSetupAuthOption;
}

function parsePrepareOption(value: unknown): GuidedSetupPrepareOption | null {
  const source = parseBrandedEntry(value, ['id', 'brandId', 'label', 'hint', 'actionLabel']);
  if (!source || !text(source.id) || !text(source.label)) return null;
  return source as unknown as GuidedSetupPrepareOption;
}

function parseRecommendedInstall(value: unknown): GuidedSetupRecommendedInstall | null {
  const source = parseBrandedEntry(value, ['id', 'brandId', 'label', 'hint']);
  if (!source || !text(source.id) || !text(source.label) || !text(source.hint)) return null;
  if (!text(source.icon) || !text(source.website)) return null;
  return source as unknown as GuidedSetupRecommendedInstall;
}

function parseArray<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
  optional = false,
): T[] | undefined | null {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value)) return null;
  const result = value.map(parse);
  return result.every((item): item is T => item !== null) ? result : null;
}

export function parseGuidedSetupDetection(
  value: unknown,
  methodFamily: GuidedSetupMethodFamily = 'openclaw',
): GuidedSetupDetection {
  const source = record(value);
  if (!source || typeof source.setupComplete !== 'boolean') {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.detect);
  }
  const candidates = parseArray(source.candidates, parseCandidate);
  const unavailableCandidates = methodFamily === 'crestodian'
    ? []
    : parseArray(source.unavailableCandidates, parseUnavailableCandidate);
  const manualProviders = parseArray(source.manualProviders, parseManualProvider);
  const authOptions = methodFamily === 'crestodian'
    ? []
    : parseArray(source.authOptions, parseAuthOption);
  const prepareOptions = methodFamily === 'crestodian'
    ? undefined
    : parseArray(source.prepareOptions, parsePrepareOption, true);
  const recommendedInstalls = methodFamily === 'crestodian'
    ? []
    : parseArray(source.recommendedInstalls, parseRecommendedInstall);
  const workspace = text(source.workspace);
  const configuredModel = optionalText(source.configuredModel);
  if (!candidates || !unavailableCandidates || !manualProviders || !authOptions
    || prepareOptions === null || !recommendedInstalls || !workspace
    || configuredModel === null) {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.detect);
  }
  return {
    methodFamily,
    candidates,
    unavailableCandidates,
    manualProviders,
    authOptions,
    ...(prepareOptions !== undefined ? { prepareOptions } : {}),
    recommendedInstalls,
    workspace,
    ...(configuredModel !== undefined ? { configuredModel } : {}),
    setupComplete: source.setupComplete,
  };
}

function parseActivation(value: unknown): GuidedSetupActivation {
  const source = record(value);
  if (!source || typeof source.ok !== 'boolean') {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.activate);
  }
  const lines = source.lines === undefined
    ? undefined
    : Array.isArray(source.lines) && source.lines.every((line) => typeof line === 'string')
      ? source.lines
      : null;
  if (lines === null) throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.activate);
  if (source.ok) {
    const modelRef = text(source.modelRef);
    if (!modelRef || (source.latencyMs !== undefined
      && (typeof source.latencyMs !== 'number' || !Number.isFinite(source.latencyMs) || source.latencyMs < 0))) {
      throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.activate);
    }
    return {
      ok: true,
      modelRef,
      ...(typeof source.latencyMs === 'number' ? { latencyMs: source.latencyMs } : {}),
      ...(lines ? { lines } : {}),
    };
  }
  const status = setupStatus(source.status);
  const error = text(source.error);
  if (!status || !error) throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.activate);
  return { ok: false, status, error, ...(lines ? { lines } : {}) };
}

function parseVerification(value: unknown): GuidedSetupVerification {
  const source = record(value);
  if (!source || typeof source.ok !== 'boolean') {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.verify);
  }
  if (source.ok) {
    const modelRef = text(source.modelRef);
    if (!modelRef || typeof source.latencyMs !== 'number' || !Number.isFinite(source.latencyMs) || source.latencyMs < 0) {
      throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.verify);
    }
    return { ok: true, modelRef, latencyMs: source.latencyMs };
  }
  const status = setupStatus(source.status);
  const error = text(source.error);
  if (!status || status === 'ok' || !error) {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.verify);
  }
  return { ok: false, status, error };
}

function parseChat(value: unknown): GuidedSetupChatResult {
  const source = record(value);
  const sessionId = text(source?.sessionId);
  const reply = text(source?.reply);
  if (!source || !sessionId || !reply
    || (source.action !== 'none' && source.action !== 'open-agent' && source.action !== 'exit')
    || (source.sensitive !== undefined && typeof source.sensitive !== 'boolean')
    || (source.wizardInputPending !== undefined && typeof source.wizardInputPending !== 'boolean')
    || (source.needsApproval !== undefined && typeof source.needsApproval !== 'boolean')) {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.chat);
  }
  const question = source.question === undefined ? undefined : parseChatQuestion(source.question);
  if (source.question !== undefined && !question) {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.chat);
  }
  let step: OpenClawWizardStep | undefined;
  if (source.step !== undefined) {
    try {
      step = parseOpenClawWizardStep(source.step);
    } catch {
      throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.chat);
    }
  }
  const optionalFields = ['agentId', 'proposalId'] as const;
  for (const field of optionalFields) {
    if (source[field] !== undefined && !text(source[field])) {
      throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.chat);
    }
  }
  if (source.agentDraft !== undefined && source.agentDraft !== 'hatch') {
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.chat);
  }
  return {
    sessionId,
    reply,
    action: source.action,
    ...(typeof source.sensitive === 'boolean' ? { sensitive: source.sensitive } : {}),
    ...(typeof source.wizardInputPending === 'boolean'
      ? { wizardInputPending: source.wizardInputPending }
      : {}),
    ...(source.agentDraft === 'hatch' ? { agentDraft: source.agentDraft } : {}),
    ...(text(source.agentId) ? { agentId: text(source.agentId)! } : {}),
    ...(typeof source.needsApproval === 'boolean' ? { needsApproval: source.needsApproval } : {}),
    ...(text(source.proposalId) ? { proposalId: text(source.proposalId)! } : {}),
    ...(question ? { question } : {}),
    ...(step ? { step } : {}),
  };
}

function parseChatQuestion(value: unknown): GuidedSetupChatQuestion | null {
  const source = record(value);
  const id = text(source?.id);
  const header = text(source?.header);
  const question = text(source?.question);
  if (!source || !id || !header || !question || !Array.isArray(source.options)
    || source.options.length < 2 || source.options.length > 4
    || (source.isOther !== undefined && typeof source.isOther !== 'boolean')
    || (source.skipAction !== undefined && source.skipAction !== 'exit')) {
    return null;
  }
  const options = source.options.map((value) => {
    const option = record(value);
    const label = text(option?.label);
    const description = optionalText(option?.description);
    const reply = optionalText(option?.reply);
    if (!option || !label || description === null || reply === null
      || (option.recommended !== undefined && typeof option.recommended !== 'boolean')) {
      return null;
    }
    return {
      label,
      ...(description !== undefined ? { description } : {}),
      ...(typeof option.recommended === 'boolean' ? { recommended: option.recommended } : {}),
      ...(reply !== undefined ? { reply } : {}),
    };
  });
  if (!options.every((option): option is NonNullable<typeof option> => option !== null)) return null;
  return {
    id,
    header,
    question,
    options,
    ...(typeof source.isOther === 'boolean' ? { isOther: source.isOther } : {}),
    ...(source.skipAction === 'exit' ? { skipAction: source.skipAction } : {}),
  };
}

export class OpenClawGuidedSetupClient {
  private methodFamily: GuidedSetupMethodFamily | null = null;

  constructor(private readonly dependencies: OpenClawGuidedSetupClientDependencies) {}

  async detect(): Promise<GuidedSetupDetection> {
    if (this.methodFamily === 'crestodian') {
      return this.request(
        OPENCLAW_CRESTODIAN_GUIDED_SETUP_METHODS.detect,
        {},
        (value) => parseGuidedSetupDetection(value, 'crestodian'),
      );
    }
    try {
      const result = await this.request(
        OPENCLAW_GUIDED_SETUP_METHODS.detect,
        {},
        (value) => parseGuidedSetupDetection(value, 'openclaw'),
      );
      this.methodFamily = 'openclaw';
      return result;
    } catch (error) {
      if (!(error instanceof OpenClawGuidedSetupMethodUnavailableError)
        || error.availability !== 'unsupported') {
        throw error;
      }
    }
    const result = await this.request(
      OPENCLAW_CRESTODIAN_GUIDED_SETUP_METHODS.detect,
      {},
      (value) => parseGuidedSetupDetection(value, 'crestodian'),
    );
    this.methodFamily = 'crestodian';
    return result;
  }

  useMethodFamily(methodFamily: GuidedSetupMethodFamily): void {
    this.methodFamily = methodFamily;
  }

  activate(params: GuidedSetupActivateParams): Promise<GuidedSetupActivation> {
    const methodFamily = this.requireMethodFamily();
    const method = methodFamily === 'crestodian'
      ? OPENCLAW_CRESTODIAN_GUIDED_SETUP_METHODS.activate
      : OPENCLAW_GUIDED_SETUP_METHODS.activate;
    const requestParams = methodFamily === 'crestodian'
      ? {
          kind: params.kind,
          ...(params.authChoice !== undefined ? { authChoice: params.authChoice } : {}),
          ...(params.apiKey !== undefined ? { apiKey: params.apiKey } : {}),
          ...(params.workspace !== undefined ? { workspace: params.workspace } : {}),
        }
      : params;
    return this.request(method, requestParams, parseActivation);
  }

  verify(): Promise<GuidedSetupVerification> {
    this.assertCurrentMethods('verify');
    return this.request(OPENCLAW_GUIDED_SETUP_METHODS.verify, {}, parseVerification);
  }

  startAuth(params: GuidedSetupWizardStartParams): Promise<OpenClawWizardStartResult> {
    this.assertCurrentMethods('authStart');
    return this.request(OPENCLAW_GUIDED_SETUP_METHODS.authStart, params, parseOpenClawHostedWizardStartResult);
  }

  startPrepare(params: GuidedSetupWizardStartParams): Promise<OpenClawWizardStartResult> {
    this.assertCurrentMethods('prepareStart');
    return this.request(OPENCLAW_GUIDED_SETUP_METHODS.prepareStart, params, parseOpenClawHostedWizardStartResult);
  }

  chat(params: GuidedSetupChatParams): Promise<GuidedSetupChatResult> {
    const methodFamily = this.requireMethodFamily();
    const method = methodFamily === 'crestodian'
      ? OPENCLAW_CRESTODIAN_GUIDED_SETUP_METHODS.chat
      : OPENCLAW_GUIDED_SETUP_METHODS.chat;
    if (methodFamily === 'crestodian' && (params.wizardAnswer || params.wizardCancel)) {
      throw new OpenClawGuidedSetupMethodUnavailableError(method, 'unsupported');
    }
    return this.request(method, params, parseChat);
  }

  private requireMethodFamily(): GuidedSetupMethodFamily {
    if (this.methodFamily) return this.methodFamily;
    throw new OpenClawGuidedSetupResponseError(OPENCLAW_GUIDED_SETUP_METHODS.detect);
  }

  private assertCurrentMethods(method: keyof typeof OPENCLAW_GUIDED_SETUP_METHODS): void {
    if (this.requireMethodFamily() === 'openclaw') return;
    throw new OpenClawGuidedSetupMethodUnavailableError(
      OPENCLAW_GUIDED_SETUP_METHODS[method],
      'unsupported',
    );
  }

  private async request<T, P extends object>(
    method: string,
    params: P,
    parse: (value: unknown) => T,
  ): Promise<T> {
    try {
      return parse(await this.dependencies.requestPrivileged(
        method,
        { ...params } as Record<string, unknown>,
      ));
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, method)) {
        throw new OpenClawGuidedSetupMethodUnavailableError(method, 'unsupported');
      }
      if (error instanceof GatewayDisconnectedError) {
        throw new OpenClawGuidedSetupMethodUnavailableError(method, 'connection-unavailable');
      }
      throw error;
    }
  }
}
