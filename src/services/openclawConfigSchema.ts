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

/** Resolve a field from the current Runtime's JSON schema. `*` traverses additionalProperties. */
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

let configSchemaPromise: Promise<Record<string, unknown>> | undefined;

export function loadOpenClawConfigSchema(): Promise<Record<string, unknown>> {
  if (!configSchemaPromise) {
    configSchemaPromise = (getOpenclawConfigSchema() as Promise<Record<string, unknown>>).catch((error) => {
      configSchemaPromise = undefined;
      throw error;
    });
  }
  return configSchemaPromise;
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
import { getOpenclawConfigSchema } from '@/api/tauri-commands';
