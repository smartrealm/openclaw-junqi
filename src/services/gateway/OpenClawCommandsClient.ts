import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_COMMANDS_LIST_METHOD = 'commands.list' as const;

const COMMAND_SOURCES = ['native', 'skill', 'plugin'] as const;
const COMMAND_SCOPES = ['text', 'native', 'both'] as const;
const COMMAND_CATEGORIES = ['session', 'options', 'status', 'management', 'media', 'tools', 'docks'] as const;
const COMMAND_ARGUMENT_TYPES = ['string', 'number', 'boolean'] as const;

const MAX_COMMANDS = 500;
const MAX_COMMAND_NAME_LENGTH = 200;
const MAX_COMMAND_DESCRIPTION_LENGTH = 2_000;
const MAX_COMMAND_ALIASES = 20;
const MAX_COMMAND_ARGUMENTS = 20;
const MAX_COMMAND_ARGUMENT_CHOICES = 50;
const MAX_COMMAND_ARGUMENT_DESCRIPTION_LENGTH = 500;

export type OpenClawCommandSource = typeof COMMAND_SOURCES[number];
export type OpenClawCommandScope = typeof COMMAND_SCOPES[number];
export type OpenClawCommandCategory = typeof COMMAND_CATEGORIES[number];
export type OpenClawCommandArgumentType = typeof COMMAND_ARGUMENT_TYPES[number];

export interface OpenClawCommandArgumentChoice {
  readonly value: string;
  readonly label: string;
}

export interface OpenClawCommandArgument {
  readonly name: string;
  readonly description: string;
  readonly type: OpenClawCommandArgumentType;
  readonly required?: boolean;
  readonly choices?: readonly OpenClawCommandArgumentChoice[];
  readonly dynamic?: boolean;
}

export interface OpenClawCommandEntry {
  readonly name: string;
  readonly nativeName?: string;
  readonly textAliases?: readonly string[];
  readonly description: string;
  readonly category?: OpenClawCommandCategory;
  readonly source: OpenClawCommandSource;
  readonly skillModelVisible?: boolean;
  readonly scope: OpenClawCommandScope;
  readonly acceptsArgs: boolean;
  readonly args?: readonly OpenClawCommandArgument[];
}

export interface OpenClawCommandsListInput {
  readonly agentId?: string;
  readonly provider?: string;
  readonly scope?: OpenClawCommandScope;
  readonly includeArgs?: boolean;
}

export interface OpenClawCommandsClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawCommandsUnavailableError extends Error {
  readonly code = 'OPENCLAW_COMMANDS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawCommandsUnavailableError';
  }
}

export class OpenClawCommandsResponseError extends Error {
  readonly code = 'OPENCLAW_COMMANDS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid commands.list response');
    this.name = 'OpenClawCommandsResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown, maxLength = MAX_COMMAND_NAME_LENGTH): string | null {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value : null;
}

function optionalNonEmptyString(value: unknown, maxLength = MAX_COMMAND_NAME_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  const normalized = nonEmptyString(value, maxLength);
  if (!normalized) throw new OpenClawCommandsResponseError();
  return normalized;
}

function string(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? value as T : null;
}

function parseAliases(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_COMMAND_ALIASES) {
    throw new OpenClawCommandsResponseError();
  }
  return value.map((entry) => {
    const alias = nonEmptyString(entry);
    if (!alias) throw new OpenClawCommandsResponseError();
    return alias;
  });
}

function parseChoices(value: unknown): readonly OpenClawCommandArgumentChoice[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_COMMAND_ARGUMENT_CHOICES) {
    throw new OpenClawCommandsResponseError();
  }
  return value.map((entry) => {
    const source = record(entry);
    const choiceValue = string(source?.value, MAX_COMMAND_NAME_LENGTH);
    const label = string(source?.label, MAX_COMMAND_NAME_LENGTH);
    if (!source || choiceValue === null || label === null) {
      throw new OpenClawCommandsResponseError();
    }
    return { value: choiceValue, label };
  });
}

function parseArgument(value: unknown): OpenClawCommandArgument {
  const source = record(value);
  const name = nonEmptyString(source?.name);
  const description = string(source?.description, MAX_COMMAND_ARGUMENT_DESCRIPTION_LENGTH);
  const type = oneOf(source?.type, COMMAND_ARGUMENT_TYPES);
  if (!source || !name || description === null || !type) {
    throw new OpenClawCommandsResponseError();
  }
  if (source.required !== undefined && typeof source.required !== 'boolean') {
    throw new OpenClawCommandsResponseError();
  }
  if (source.dynamic !== undefined && typeof source.dynamic !== 'boolean') {
    throw new OpenClawCommandsResponseError();
  }
  const choices = parseChoices(source.choices);
  return {
    name,
    description,
    type,
    ...(source.required === true ? { required: true } : {}),
    ...(choices ? { choices } : {}),
    ...(source.dynamic === true ? { dynamic: true } : {}),
  };
}

function parseArguments(value: unknown): readonly OpenClawCommandArgument[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_COMMAND_ARGUMENTS) {
    throw new OpenClawCommandsResponseError();
  }
  return value.map(parseArgument);
}

function parseEntry(value: unknown): OpenClawCommandEntry {
  const source = record(value);
  const name = nonEmptyString(source?.name);
  const description = string(source?.description, MAX_COMMAND_DESCRIPTION_LENGTH);
  const commandSource = oneOf(source?.source, COMMAND_SOURCES);
  const scope = oneOf(source?.scope, COMMAND_SCOPES);
  if (
    !source
    || !name
    || description === null
    || !commandSource
    || !scope
    || typeof source.acceptsArgs !== 'boolean'
  ) {
    throw new OpenClawCommandsResponseError();
  }
  if (source.skillModelVisible !== undefined && typeof source.skillModelVisible !== 'boolean') {
    throw new OpenClawCommandsResponseError();
  }
  const category = source.category === undefined ? undefined : oneOf(source.category, COMMAND_CATEGORIES);
  if (source.category !== undefined && !category) throw new OpenClawCommandsResponseError();
  const nativeName = optionalNonEmptyString(source.nativeName);
  const textAliases = parseAliases(source.textAliases);
  const args = parseArguments(source.args);
  return {
    name,
    ...(nativeName ? { nativeName } : {}),
    ...(textAliases ? { textAliases } : {}),
    description,
    ...(category ? { category } : {}),
    source: commandSource,
    ...(source.skillModelVisible === true ? { skillModelVisible: true } : {}),
    scope,
    acceptsArgs: source.acceptsArgs,
    ...(args ? { args } : {}),
  };
}

/** Strictly decode the bounded command catalog specified by the Gateway protocol. */
export function parseOpenClawCommandsList(value: unknown): readonly OpenClawCommandEntry[] {
  const source = record(value);
  if (!source || !Array.isArray(source.commands) || source.commands.length > MAX_COMMANDS) {
    throw new OpenClawCommandsResponseError();
  }
  return source.commands.map(parseEntry);
}

function normalizedRequestText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new Error(`Invalid OpenClaw commands.list ${field}`);
  return normalized;
}

function buildParams(input: OpenClawCommandsListInput): Record<string, unknown> {
  const agentId = normalizedRequestText(input.agentId, 'agentId');
  const provider = normalizedRequestText(input.provider, 'provider');
  if (input.scope !== undefined && !COMMAND_SCOPES.includes(input.scope)) {
    throw new Error('Invalid OpenClaw commands.list scope');
  }
  if (input.includeArgs !== undefined && typeof input.includeArgs !== 'boolean') {
    throw new Error('Invalid OpenClaw commands.list includeArgs');
  }
  return {
    ...(agentId ? { agentId } : {}),
    ...(provider ? { provider } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.includeArgs !== undefined ? { includeArgs: input.includeArgs } : {}),
  };
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

/** Reads the current Gateway command directory without assuming a local command registry. */
export class OpenClawCommandsClient {
  constructor(private readonly dependencies: OpenClawCommandsClientDependencies) {}

  async list(input: OpenClawCommandsListInput = {}): Promise<readonly OpenClawCommandEntry[]> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawCommandsUnavailableError('No attested Gateway connection is available for commands.list');
    }
    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_COMMANDS_LIST_METHOD,
        buildParams(input),
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawCommandsUnavailableError('Gateway connection changed while reading commands.list');
      }
      return parseOpenClawCommandsList(response);
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_COMMANDS_LIST_METHOD)) {
        throw new OpenClawCommandsUnavailableError('The connected OpenClaw Gateway does not support commands.list');
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawCommandsUnavailableError('No attested Gateway connection is available for commands.list');
      }
      throw error;
    }
  }
}
