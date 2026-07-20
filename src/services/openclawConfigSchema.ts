export interface OpenClawFieldSchema {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: OpenClawFieldSchema[];
  oneOf?: OpenClawFieldSchema[];
  properties?: Record<string, OpenClawFieldSchema>;
  additionalProperties?: boolean | OpenClawFieldSchema;
  required?: string[];
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
}

export function providerFieldSchemas(schema: unknown): Record<string, OpenClawFieldSchema> {
  if (!schema || typeof schema !== 'object') return {};
  const root = schema as Record<string, any>;
  return root.properties?.models?.properties?.providers?.additionalProperties?.properties ?? {};
}

export function providerModelFieldSchemas(schema: unknown): Record<string, OpenClawFieldSchema> {
  if (!schema || typeof schema !== 'object') return {};
  const root = schema as Record<string, any>;
  return root.properties?.models?.properties?.providers?.additionalProperties
    ?.properties?.models?.items?.properties ?? {};
}

let configSchemaPromise: Promise<Record<string, unknown>> | undefined;

export function loadOpenClawConfigSchema(): Promise<Record<string, unknown>> {
  if (!configSchemaPromise) {
    configSchemaPromise = window.aegis.providerRuntime.schema().catch((error) => {
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
