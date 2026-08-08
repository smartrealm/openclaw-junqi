import { createHash } from "node:crypto";
import { DingTalkRuntimeError } from "./errors.js";
import type { DwsRunner } from "./dws-runner.js";
import type { DingTalkToolSpec, DwsLeafSchema, DwsParameterSchema } from "./types.js";

interface VerifiedLeafContract {
  readonly schema: DwsLeafSchema;
  readonly digest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLeafSchema(value: unknown): DwsLeafSchema {
  if (!isRecord(value)) {
    throw new DingTalkRuntimeError("DWS_SCHEMA_INVALID", "DWS leaf schema is not an object");
  }
  const parameters = isRecord(value.parameters)
    ? Object.fromEntries(
        Object.entries(value.parameters).map(([key, parameter]) => [
          key,
          isRecord(parameter) ? parameter as DwsParameterSchema : {},
        ]),
      )
    : {};
  const schema: DwsLeafSchema = {
    canonical_path: typeof value.canonical_path === "string" ? value.canonical_path : "",
    cli_path: typeof value.cli_path === "string" ? value.cli_path : "",
    effect: value.effect as DwsLeafSchema["effect"],
    risk: value.risk as DwsLeafSchema["risk"],
    confirmation: value.confirmation as DwsLeafSchema["confirmation"],
    idempotency: value.idempotency as DwsLeafSchema["idempotency"],
    parameters,
  };
  return schema;
}

function schemaContractVector(schema: DwsLeafSchema): Record<string, unknown> {
  return {
    canonicalPath: schema.canonical_path,
    cliPath: schema.cli_path,
    effect: schema.effect,
    risk: schema.risk,
    confirmation: schema.confirmation,
    idempotency: schema.idempotency,
    parameters: Object.entries(schema.parameters ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([flag, parameter]) => ({
        flag,
        type: parameter.type ?? null,
        required: parameter.required === true,
        property: parameter.property ?? null,
      })),
  };
}

export function validateLeafContract(spec: DingTalkToolSpec, value: unknown): VerifiedLeafContract {
  const schema = parseLeafSchema(value);
  const mismatches = [
    ["canonical_path", spec.canonicalPath, schema.canonical_path],
    ["cli_path", spec.cliPath, schema.cli_path],
    ["effect", spec.effect, schema.effect],
    ["risk", spec.risk, schema.risk],
    ["confirmation", spec.confirmation, schema.confirmation],
    ["idempotency", spec.idempotency, schema.idempotency],
  ].filter(([, expected, actual]) => expected !== actual);
  if (mismatches.length > 0) {
    throw new DingTalkRuntimeError(
      "DWS_SCHEMA_DRIFT",
      `DWS schema differs from the reviewed contract for ${spec.name}`,
      { fields: mismatches.map(([field]) => field) },
    );
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(schemaContractVector(schema)))
    .digest("hex");
  return { schema, digest };
}

export class DwsSchemaRegistry {
  private readonly runner: DwsRunner;
  private readonly cache = new Map<string, Promise<VerifiedLeafContract>>();

  constructor(runner: DwsRunner) {
    this.runner = runner;
  }

  verify(spec: DingTalkToolSpec): Promise<VerifiedLeafContract> {
    const existing = this.cache.get(spec.canonicalPath);
    if (existing) return existing;
    const pending = this.runner
      .run(["schema", spec.canonicalPath, "--compact"])
      .then((result) => validateLeafContract(spec, result.data))
      .catch((error: unknown) => {
        this.cache.delete(spec.canonicalPath);
        throw error;
      });
    this.cache.set(spec.canonicalPath, pending);
    return pending;
  }
}

function serializeArgumentValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  throw new DingTalkRuntimeError("DWS_ARGUMENT_INVALID", "DWS arguments must be JSON values");
}

export function buildSchemaValidatedArguments(
  schema: DwsLeafSchema,
  input: unknown,
): string[] {
  if (!isRecord(input)) {
    throw new DingTalkRuntimeError("DWS_ARGUMENTS_REQUIRED", "arguments must be a JSON object");
  }
  const parameterEntries = Object.entries(schema.parameters ?? {});
  const parameterByInputName = new Map<string, [string, DwsParameterSchema]>();
  for (const [flag, parameter] of parameterEntries) {
    parameterByInputName.set(parameter.property ?? flag, [flag, parameter]);
  }
  const unknownKeys = Object.keys(input).filter((key) => !parameterByInputName.has(key));
  if (unknownKeys.length > 0) {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_UNKNOWN", "arguments contains unsupported fields", {
      fields: unknownKeys.sort(),
    });
  }
  const missing = [...parameterByInputName.entries()]
    .filter(([, [, parameter]]) => parameter.required === true)
    .filter(([inputName]) => input[inputName] === undefined || input[inputName] === null || input[inputName] === "")
    .map(([inputName]) => inputName);
  if (missing.length > 0) {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_REQUIRED", "arguments is missing required fields", {
      fields: missing.sort(),
    });
  }
  const result: string[] = [];
  for (const [inputName, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const entry = parameterByInputName.get(inputName);
    if (!entry) continue;
    const [flag, parameter] = entry;
    if (parameter.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be a boolean`);
      }
      result.push(value ? `--${flag}` : `--${flag}=false`);
      continue;
    }
    if (parameter.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) {
      throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be an integer`);
    }
    result.push(`--${flag}`, serializeArgumentValue(value));
  }
  return result;
}
