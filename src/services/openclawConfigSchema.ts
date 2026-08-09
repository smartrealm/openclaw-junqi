import { gateway } from '@/services/gateway';

export interface OpenClawFieldSchema {
  $ref?: string;
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: OpenClawFieldSchema[];
  oneOf?: OpenClawFieldSchema[];
  properties?: Record<string, OpenClawFieldSchema>;
  additionalProperties?: boolean | OpenClawFieldSchema;
  items?: OpenClawFieldSchema;
  required?: string[];
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
}

function asSchema(value: unknown): OpenClawFieldSchema | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as OpenClawFieldSchema
    : undefined;
}

function decodeJsonPointerSegment(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveReference(
  root: OpenClawFieldSchema,
  schema: OpenClawFieldSchema,
  seen = new Set<string>(),
): OpenClawFieldSchema | undefined {
  if (!schema.$ref) return schema;
  if (!schema.$ref.startsWith('#/') || seen.has(schema.$ref)) return undefined;
  seen.add(schema.$ref);
  let current: unknown = root;
  for (const segment of schema.$ref.slice(2).split('/').map(decodeJsonPointerSegment)) {
    current = current !== null && typeof current === 'object'
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }
  const resolved = asSchema(current);
  return resolved ? resolveReference(root, resolved, seen) : undefined;
}

/** 从当前 Runtime 的 JSON schema 解析字段，`*` 表示遍历 additionalProperties。 */
export function configFieldSchema(
  schema: unknown,
  path: string | readonly string[],
): OpenClawFieldSchema | undefined {
  const root = asSchema(schema);
  if (!root) return undefined;
  const segments = typeof path === 'string' ? path.split('.').filter(Boolean) : path;
  let current: OpenClawFieldSchema | undefined = root;
  for (const segment of segments) {
    current = current ? resolveReference(root, current) : undefined;
    if (!current) return undefined;
    if (segment === '*') {
      current = typeof current.additionalProperties === 'object'
        ? current.additionalProperties
        : undefined;
    } else if (segment === '[]') {
      current = current.items;
    } else {
      current = current.properties?.[segment];
    }
  }
  return current ? resolveReference(root, current) : undefined;
}

export function configObjectFieldSchemas(schema: unknown, path: string): Record<string, OpenClawFieldSchema> {
  return configFieldSchema(schema, path)?.properties ?? {};
}

export function providerFieldSchemas(schema: unknown): Record<string, OpenClawFieldSchema> {
  return configObjectFieldSchemas(schema, 'models.providers.*');
}

export function providerModelFieldSchemas(schema: unknown): Record<string, OpenClawFieldSchema> {
  return configObjectFieldSchemas(schema, 'models.providers.*.models.[]');
}

export interface OpenClawConfigSchemaClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  callPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

export interface LoadOpenClawConfigSchemaOptions {
  force?: boolean;
}

interface OpenClawConfigSchemaResponse {
  schema: Record<string, unknown>;
  uiHints: Record<string, unknown>;
  version: string;
  generatedAt: string;
}

interface ConfigSchemaCacheEntry {
  connectionId: string;
  promise: Promise<Record<string, unknown>>;
}

export class OpenClawConfigSchemaUnavailableError extends Error {
  readonly code = 'OPENCLAW_CONFIG_SCHEMA_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawConfigSchemaUnavailableError';
  }
}

export class OpenClawConfigSchemaResponseError extends Error {
  readonly code = 'OPENCLAW_CONFIG_SCHEMA_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid config.schema response');
    this.name = 'OpenClawConfigSchemaResponseError';
  }
}

function schemaResponseRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredSchemaResponseText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseOpenClawConfigSchemaResponse(value: unknown): OpenClawConfigSchemaResponse {
  const response = schemaResponseRecord(value);
  const schema = schemaResponseRecord(response?.schema);
  const uiHints = schemaResponseRecord(response?.uiHints);
  const version = requiredSchemaResponseText(response?.version);
  const generatedAt = requiredSchemaResponseText(response?.generatedAt);
  if (!response || !schema || !uiHints || !version || !generatedAt) {
    throw new OpenClawConfigSchemaResponseError();
  }
  return { schema, uiHints, version, generatedAt };
}

export class OpenClawConfigSchemaClient {
  private cache: ConfigSchemaCacheEntry | null = null;

  constructor(private readonly dependencies: OpenClawConfigSchemaClientDependencies) {}

  load(options: LoadOpenClawConfigSchemaOptions = {}): Promise<Record<string, unknown>> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !this.dependencies.isConnectionCurrent(connectionId)) {
      return Promise.reject(new OpenClawConfigSchemaUnavailableError(
        'No attested Gateway connection is available for config.schema',
      ));
    }
    if (!options.force && this.cache?.connectionId === connectionId) {
      return this.cache.promise;
    }

    const promise = this.request(connectionId);
    const entry = { connectionId, promise };
    this.cache = entry;
    void promise.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return promise;
  }

  private async request(connectionId: string): Promise<Record<string, unknown>> {
    const response = await this.dependencies.callPrivileged('config.schema', {});
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new OpenClawConfigSchemaUnavailableError(
        'Gateway connection changed while reading config.schema',
      );
    }
    return parseOpenClawConfigSchemaResponse(response).schema;
  }
}

const configSchemaClient = new OpenClawConfigSchemaClient({
  captureConnectionId: () => gateway.captureConnectionId(),
  isConnectionCurrent: (connectionId) => gateway.isConnectionCurrent(connectionId),
  callPrivileged: (method, params) => gateway.callPrivileged(method, params),
});

export function loadOpenClawConfigSchema(
  options: LoadOpenClawConfigSchemaOptions = {},
): Promise<Record<string, unknown>> {
  return configSchemaClient.load(options);
}

export function schemaStringOptions(schema: OpenClawFieldSchema): string[] {
  if (Array.isArray(schema.enum)) {
    return schema.enum.filter((value): value is string => typeof value === 'string');
  }
  const variants = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  return variants
    .map((variant) => variant.const)
    .filter((value): value is string => typeof value === 'string');
}

export function schemaValueKind(schema: OpenClawFieldSchema): string {
  if (schema.type) return schema.type;
  const variants = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  const types = Array.from(new Set(variants.map((variant) => variant.type).filter(Boolean)));
  if (types.length === 1) return types[0] as string;
  if (schemaStringOptions(schema).length > 0) return 'string';
  return 'object';
}
