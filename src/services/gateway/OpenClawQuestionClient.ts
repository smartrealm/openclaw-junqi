export const OPENCLAW_QUESTION_LIST_METHOD = 'question.list' as const;
export const OPENCLAW_QUESTION_GET_METHOD = 'question.get' as const;
export const OPENCLAW_QUESTION_RESOLVE_METHOD = 'question.resolve' as const;
export const OPENCLAW_QUESTION_OPERATOR_SCOPES = ['operator.questions'] as const;

const OPENCLAW_QUESTION_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const OPENCLAW_SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const OPENCLAW_QUESTION_HEADER_MAX_LENGTH = 12;
const OPENCLAW_QUESTION_OPTIONS_MAX = 4;
const OPENCLAW_QUESTIONS_PER_REQUEST_MAX = 3;
const OPENCLAW_SECRET_ALLOWED_HOSTS_MAX = 128;
const OPENCLAW_SECRET_ALLOWED_HOST_LENGTH_MAX = 253;
const OPENCLAW_SECRET_REASON_LENGTH_MAX = 200;

export interface OpenClawQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface OpenClawQuestionSecretStoreBinding {
  readonly name: string;
  readonly kind: 'secret';
  readonly allowedHosts?: readonly string[];
  readonly reason?: string;
}

export interface OpenClawQuestionSecretStoreExisting {
  readonly updatedAtMs: number;
  readonly updatedBy?: string;
}

export interface OpenClawQuestion {
  readonly questionId: string;
  readonly header: string;
  readonly question: string;
  readonly options: readonly OpenClawQuestionOption[];
  readonly multiSelect: boolean;
  readonly isOther: boolean;
  readonly isSecret: boolean;
  readonly secretStore?: OpenClawQuestionSecretStoreBinding;
  readonly secretStoreExisting?: OpenClawQuestionSecretStoreExisting;
}

export interface OpenClawPendingQuestion {
  readonly id: string;
  readonly questions: readonly OpenClawQuestion[];
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly status: 'pending';
}

export type OpenClawQuestionAnswers = Readonly<Record<string, readonly string[]>>;

export type OpenClawQuestionResolution =
  | { readonly status: 'answered'; readonly answers: OpenClawQuestionAnswers }
  | { readonly status: 'cancelled' };

export type OpenClawQuestionResolvedStatus = 'answered' | 'cancelled' | 'expired';

export class OpenClawQuestionResponseError extends Error {
  readonly code = 'OPENCLAW_QUESTION_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid question response');
    this.name = 'OpenClawQuestionResponseError';
  }
}

export type OpenClawQuestionRequester = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

interface OpenClawQuestionClientDependencies {
  readonly request: OpenClawQuestionRequester;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new OpenClawQuestionResponseError();
  }
  return value;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value);
}

function safeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OpenClawQuestionResponseError();
  }
  return value;
}

function optionalBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new OpenClawQuestionResponseError();
  return value;
}

function parseAllowedHosts(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > OPENCLAW_SECRET_ALLOWED_HOSTS_MAX) {
    throw new OpenClawQuestionResponseError();
  }
  const hosts = value.map((host) => {
    const text = requiredString(host);
    if (text.length > OPENCLAW_SECRET_ALLOWED_HOST_LENGTH_MAX) {
      throw new OpenClawQuestionResponseError();
    }
    return text;
  });
  if (new Set(hosts).size !== hosts.length) throw new OpenClawQuestionResponseError();
  return hosts;
}

function parseSecretStore(value: unknown): OpenClawQuestionSecretStoreBinding | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const name = requiredString(source?.name);
  if (!OPENCLAW_SECRET_NAME_PATTERN.test(name) || source?.kind !== 'secret') {
    throw new OpenClawQuestionResponseError();
  }
  const allowedHosts = parseAllowedHosts(source.allowedHosts);
  const reason = source.reason === undefined ? undefined : requiredString(source.reason, true);
  if (reason !== undefined && reason.length > OPENCLAW_SECRET_REASON_LENGTH_MAX) {
    throw new OpenClawQuestionResponseError();
  }
  return {
    name,
    kind: 'secret',
    ...(allowedHosts ? { allowedHosts } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function parseSecretStoreExisting(value: unknown): OpenClawQuestionSecretStoreExisting | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) throw new OpenClawQuestionResponseError();
  const updatedBy = optionalNonEmptyString(source.updatedBy);
  return {
    updatedAtMs: safeTimestamp(source.updatedAtMs),
    ...(updatedBy ? { updatedBy } : {}),
  };
}

function parseQuestion(value: unknown): OpenClawQuestion {
  const source = record(value);
  if (!source) throw new OpenClawQuestionResponseError();
  const questionId = requiredString(source.questionId);
  const header = requiredString(source.header, true);
  if (!OPENCLAW_QUESTION_ID_PATTERN.test(questionId)
    || header.length > OPENCLAW_QUESTION_HEADER_MAX_LENGTH) {
    throw new OpenClawQuestionResponseError();
  }
  if (!Array.isArray(source.options)
    || source.options.length === 1
    || source.options.length > OPENCLAW_QUESTION_OPTIONS_MAX) {
    throw new OpenClawQuestionResponseError();
  }
  const options = source.options.map((value) => {
    const option = record(value);
    if (!option) throw new OpenClawQuestionResponseError();
    const description = option.description === undefined
      ? undefined
      : requiredString(option.description, true);
    return {
      label: requiredString(option.label),
      ...(description !== undefined ? { description } : {}),
    };
  });
  const normalizedLabels = options.map((option) => option.label.trim().toLowerCase());
  if (new Set(normalizedLabels).size !== normalizedLabels.length) {
    throw new OpenClawQuestionResponseError();
  }
  const multiSelect = optionalBoolean(source.multiSelect);
  const isOther = optionalBoolean(source.isOther);
  const isSecret = optionalBoolean(source.isSecret);
  const secretStore = parseSecretStore(source.secretStore);
  const secretStoreExisting = parseSecretStoreExisting(source.secretStoreExisting);
  if (isSecret !== Boolean(secretStore) || (secretStore && (options.length > 0 || multiSelect))) {
    throw new OpenClawQuestionResponseError();
  }
  return {
    questionId,
    header,
    question: requiredString(source.question),
    options,
    multiSelect,
    isOther,
    isSecret,
    ...(secretStore ? { secretStore } : {}),
    ...(secretStoreExisting ? { secretStoreExisting } : {}),
  };
}

export function parseOpenClawPendingQuestion(value: unknown): OpenClawPendingQuestion | null {
  try {
    const source = record(value);
    if (!source || source.status !== 'pending' || !Array.isArray(source.questions)) return null;
    if (source.questions.length < 1
      || source.questions.length > OPENCLAW_QUESTIONS_PER_REQUEST_MAX) return null;
    const questions = source.questions.map(parseQuestion);
    if (new Set(questions.map((question) => question.questionId)).size !== questions.length) return null;
    if (questions.some((question) => question.secretStore) && questions.length !== 1) return null;
    const agentId = optionalNonEmptyString(source.agentId);
    const sessionKey = optionalNonEmptyString(source.sessionKey);
    const runId = optionalNonEmptyString(source.runId);
    return {
      id: requiredString(source.id),
      questions,
      ...(agentId ? { agentId } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(runId ? { runId } : {}),
      createdAtMs: safeTimestamp(source.createdAtMs),
      expiresAtMs: safeTimestamp(source.expiresAtMs),
      status: 'pending',
    };
  } catch {
    return null;
  }
}

function parseAnswers(value: unknown): OpenClawQuestionAnswers | null {
  const source = record(value);
  if (!source) return null;
  const answers: Record<string, readonly string[]> = {};
  for (const [questionId, values] of Object.entries(source)) {
    if (!OPENCLAW_QUESTION_ID_PATTERN.test(questionId) || !Array.isArray(values)) return null;
    if (!values.every((entry) => typeof entry === 'string')) return null;
    answers[questionId] = [...values];
  }
  return answers;
}

function parseResolution(value: unknown): OpenClawQuestionResolution | null {
  const source = record(value);
  if (!source) return null;
  if (source.status === 'cancelled') return { status: 'cancelled' };
  if (source.status !== 'answered') return null;
  const envelope = record(source.answers);
  const answers = parseAnswers(envelope?.answers);
  return answers ? { status: 'answered', answers } : null;
}

function validateAnswers(answers: OpenClawQuestionAnswers): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [questionId, values] of Object.entries(answers)) {
    if (!OPENCLAW_QUESTION_ID_PATTERN.test(questionId) || !Array.isArray(values)) {
      throw new OpenClawQuestionResponseError();
    }
    normalized[questionId] = values.map((value) => requiredString(value, true));
  }
  return normalized;
}

export class OpenClawQuestionClient {
  constructor(private readonly dependencies: OpenClawQuestionClientDependencies) {}

  async list(): Promise<readonly OpenClawPendingQuestion[]> {
    const response = record(await this.dependencies.request(OPENCLAW_QUESTION_LIST_METHOD, {}));
    if (!response || !Array.isArray(response.questions)) throw new OpenClawQuestionResponseError();
    const pending: OpenClawPendingQuestion[] = [];
    for (const candidate of response.questions) {
      const source = record(candidate);
      if (source?.status !== 'pending') continue;
      const question = parseOpenClawPendingQuestion(candidate);
      if (!question) throw new OpenClawQuestionResponseError();
      pending.push(question);
    }
    return pending;
  }

  async get(id: string): Promise<OpenClawPendingQuestion | null> {
    const response = record(await this.dependencies.request(
      OPENCLAW_QUESTION_GET_METHOD,
      { id: requiredString(id) },
    ));
    if (!response) throw new OpenClawQuestionResponseError();
    const question = record(response.question);
    if (question?.status !== 'pending') return null;
    const pending = parseOpenClawPendingQuestion(question);
    if (!pending) throw new OpenClawQuestionResponseError();
    return pending;
  }

  async resolve(
    id: string,
    answers: OpenClawQuestionAnswers,
    secretStoreAllowedHosts?: readonly string[],
  ): Promise<OpenClawQuestionResolution> {
    const params: Record<string, unknown> = {
      id: requiredString(id),
      answers: { answers: validateAnswers(answers) },
      ...(secretStoreAllowedHosts !== undefined
        ? { secretStoreAllowedHosts: parseAllowedHosts(secretStoreAllowedHosts) }
        : {}),
    };
    const resolution = parseResolution(await this.dependencies.request(
      OPENCLAW_QUESTION_RESOLVE_METHOD,
      params,
    ));
    if (!resolution) throw new OpenClawQuestionResponseError();
    return resolution;
  }

  async cancel(id: string): Promise<OpenClawQuestionResolution> {
    const resolution = parseResolution(await this.dependencies.request(OPENCLAW_QUESTION_RESOLVE_METHOD, {
      id: requiredString(id),
      cancel: true,
    }));
    if (!resolution || resolution.status !== 'cancelled') throw new OpenClawQuestionResponseError();
    return resolution;
  }
}
