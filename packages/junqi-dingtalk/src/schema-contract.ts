import { createHash } from "node:crypto";
import { DingTalkRuntimeError } from "./errors.js";
import type { DwsRunner } from "./dws-runner.js";
import type {
  DingTalkToolSpec,
  DwsConstraintSchema,
  DwsLeafSchema,
  DwsParameterSchema,
  DwsResultSchema,
} from "./types.js";

interface VerifiedLeafContract {
  readonly schema: DwsLeafSchema;
  readonly digest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const PARAMETER_TYPES = new Set(["array", "boolean", "integer", "number", "object", "string"]);
const CONSTRAINT_FIELDS = ["mutually_exclusive", "require_one_of", "require_together"] as const;

function invalidSchema(message: string): never {
  throw new DingTalkRuntimeError("DWS_SCHEMA_INVALID", message);
}

function parseParameterSchema(name: string, value: unknown): DwsParameterSchema {
  if (!isRecord(value)) invalidSchema(`DWS parameter schema is invalid: ${name}`);
  if (value.type !== undefined && (typeof value.type !== "string" || !PARAMETER_TYPES.has(value.type))) {
    invalidSchema(`DWS parameter type is invalid: ${name}`);
  }
  if (value.required !== undefined && typeof value.required !== "boolean") {
    invalidSchema(`DWS parameter required flag is invalid: ${name}`);
  }
  if (value.cli_required !== undefined && typeof value.cli_required !== "boolean") {
    invalidSchema(`DWS parameter cli_required flag is invalid: ${name}`);
  }
  for (const field of ["description", "property", "required_when", "format"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      invalidSchema(`DWS parameter ${field} is invalid: ${name}`);
    }
  }
  if (value.interface_type !== undefined
    && (typeof value.interface_type !== "string" || !PARAMETER_TYPES.has(value.interface_type))) {
    invalidSchema(`DWS parameter interface_type is invalid: ${name}`);
  }
  if (value.enum !== undefined
    && (!Array.isArray(value.enum) || !value.enum.every((item) => typeof item === "string"))) {
    invalidSchema(`DWS parameter enum is invalid: ${name}`);
  }
  let anyOf: DwsParameterSchema["anyOf"];
  if (value.anyOf !== undefined) {
    if (value.type !== "string" || value.format !== undefined || !Array.isArray(value.anyOf) || value.anyOf.length < 2) {
      invalidSchema(`DWS parameter anyOf is invalid: ${name}`);
    }
    const formats = new Set<string>();
    const alternatives: { format: string }[] = [];
    for (const alternative of value.anyOf) {
      if (!isRecord(alternative)
        || Object.keys(alternative).length !== 1
        || typeof alternative.format !== "string"
        || alternative.format.trim() !== alternative.format
        || alternative.format.length === 0
        || formats.has(alternative.format)) {
        invalidSchema(`DWS parameter anyOf branch is invalid: ${name}`);
      }
      formats.add(alternative.format);
      alternatives.push({ format: alternative.format });
    }
    anyOf = alternatives;
  }
  return {
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.type === "string" ? { type: value.type } : {}),
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
    ...(typeof value.cli_required === "boolean" ? { cli_required: value.cli_required } : {}),
    ...(typeof value.required_when === "string" ? { required_when: value.required_when } : {}),
    ...(typeof value.property === "string" ? { property: value.property } : {}),
    ...(typeof value.interface_type === "string" ? { interface_type: value.interface_type } : {}),
    ...(value.interface_default !== undefined ? { interface_default: value.interface_default } : {}),
    ...(value.default !== undefined ? { default: value.default } : {}),
    ...(value.example !== undefined ? { example: value.example } : {}),
    ...(Array.isArray(value.enum) ? { enum: value.enum as string[] } : {}),
    ...(typeof value.format === "string" ? { format: value.format } : {}),
    ...(anyOf ? { anyOf } : {}),
  };
}

function parseConstraintGroups(
  field: typeof CONSTRAINT_FIELDS[number],
  value: unknown,
  parameterNames: ReadonlySet<string>,
): readonly (readonly string[])[] {
  if (!Array.isArray(value)) invalidSchema(`DWS constraint is invalid: ${field}`);
  const minimum = field === "require_one_of" ? 1 : 2;
  const groups: string[][] = [];
  const seenGroups = new Set<string>();
  for (const group of value) {
    if (!Array.isArray(group)
      || group.length < minimum
      || !group.every((name) => typeof name === "string" && name.trim() === name && name.length > 0)
      || new Set(group).size !== group.length) {
      invalidSchema(`DWS constraint group is invalid: ${field}`);
    }
    const callableGroup = group.filter((name) => parameterNames.has(name));
    if (field === "require_together" && callableGroup.length !== group.length) {
      invalidSchema(`DWS require_together references an unavailable parameter: ${field}`);
    }
    if (field === "require_one_of" && callableGroup.length === 0) {
      invalidSchema(`DWS require_one_of has no callable parameter: ${field}`);
    }
    if (callableGroup.length < minimum) continue;
    const groupKey = callableGroup.join("\u0000");
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    groups.push(callableGroup);
  }
  return groups;
}

function parseConstraints(
  value: unknown,
  parameterNames: ReadonlySet<string>,
): DwsConstraintSchema | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || Object.keys(value).some((field) => !CONSTRAINT_FIELDS.includes(field as typeof CONSTRAINT_FIELDS[number]))) {
    invalidSchema("DWS constraints contract is invalid");
  }
  return Object.fromEntries(
    CONSTRAINT_FIELDS
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, parseConstraintGroups(field, value[field], parameterNames)]),
  );
}

function parseLeafSchema(value: unknown): DwsLeafSchema {
  if (!isRecord(value)) {
    throw new DingTalkRuntimeError("DWS_SCHEMA_INVALID", "DWS leaf schema is not an object");
  }
  if (value.availability !== "available" && value.availability !== "unavailable") {
    throw new DingTalkRuntimeError("DWS_SCHEMA_INVALID", "DWS leaf availability is invalid");
  }
  if (value.parameters !== undefined && !isRecord(value.parameters)) {
    invalidSchema("DWS leaf parameters contract is invalid");
  }
  const parameters = Object.fromEntries(
    Object.entries(value.parameters ?? {}).map(([key, parameter]) => [
      key,
      parseParameterSchema(key, parameter),
    ]),
  );
  const constraints = parseConstraints(value.constraints, new Set(Object.keys(parameters)));
  let result: DwsResultSchema | undefined;
  if (value.result !== undefined) {
    if (!isRecord(value.result)
      || !Array.isArray(value.result.outcomes)
      || !value.result.outcomes.every((outcome) => typeof outcome === "string")
      || !isRecord(value.result.data_schema)) {
      throw new DingTalkRuntimeError("DWS_SCHEMA_INVALID", "DWS leaf result contract is invalid");
    }
    result = {
      outcomes: value.result.outcomes,
      data_schema: value.result.data_schema,
      ...(Array.isArray(value.result.sensitive_paths)
        && value.result.sensitive_paths.every((item) => typeof item === "string")
        ? { sensitive_paths: value.result.sensitive_paths }
        : {}),
    };
  }
  const schema: DwsLeafSchema = {
    availability: value.availability,
    canonical_path: typeof value.canonical_path === "string" ? value.canonical_path : "",
    cli_path: typeof value.cli_path === "string" ? value.cli_path : "",
    effect: value.effect as DwsLeafSchema["effect"],
    risk: value.risk as DwsLeafSchema["risk"],
    confirmation: value.confirmation as DwsLeafSchema["confirmation"],
    idempotency: value.idempotency as DwsLeafSchema["idempotency"],
    parameters,
    ...(constraints ? { constraints } : {}),
    ...(result ? { result } : {}),
  };
  return schema;
}

function schemaContractVector(schema: DwsLeafSchema): Record<string, unknown> {
  return {
    availability: schema.availability ?? null,
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
        cliRequired: parameter.cli_required === true,
        requiredWhen: parameter.required_when ?? null,
        property: parameter.property ?? null,
        interfaceType: parameter.interface_type ?? null,
        interfaceDefault: parameter.interface_default ?? null,
        default: parameter.default ?? null,
        enum: parameter.enum ?? null,
        format: parameter.format ?? null,
        anyOf: parameter.anyOf ?? null,
      })),
    constraints: schema.constraints ?? null,
    result: schema.result ?? null,
  };
}

export function validateLeafContract(spec: DingTalkToolSpec, value: unknown): VerifiedLeafContract {
  const schema = parseLeafSchema(value);
  const mismatches = [
    ["availability", "available", schema.availability],
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
      .run(["schema", spec.canonicalPath])
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

function serializeCsvField(value: string): string {
  if (!/[",\r\n]/u.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function isProvidedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some((item) => typeof item !== "string" || item.trim().length > 0);
  }
  return true;
}

function validateConstraintGroups(
  constraints: DwsConstraintSchema | undefined,
  providedFlags: ReadonlySet<string>,
): void {
  for (const group of constraints?.mutually_exclusive ?? []) {
    const selected = group.filter((flag) => providedFlags.has(flag));
    if (selected.length > 1) {
      throw new DingTalkRuntimeError(
        "DWS_ARGUMENT_CONSTRAINT",
        "DWS mutually exclusive arguments were provided together",
        { fields: selected },
      );
    }
  }
  for (const group of constraints?.require_one_of ?? []) {
    if (!group.some((flag) => providedFlags.has(flag))) {
      throw new DingTalkRuntimeError(
        "DWS_ARGUMENT_CONSTRAINT",
        "DWS arguments require at least one field",
        { fields: [...group] },
      );
    }
  }
  for (const group of constraints?.require_together ?? []) {
    const selected = group.filter((flag) => providedFlags.has(flag));
    if (selected.length > 0 && selected.length < group.length) {
      throw new DingTalkRuntimeError(
        "DWS_ARGUMENT_CONSTRAINT",
        "DWS arguments must be provided together",
        { fields: [...group] },
      );
    }
  }
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function validDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match || !validCalendarDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;
}

function matchesKnownFormat(format: string, value: string): boolean | undefined {
  if (format === "date") return validCalendarDate(value);
  if (format === "date-time") return validDateTime(value);
  if (format === "json") {
    if (value === "-") return true;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  return undefined;
}

function validateParameterFormat(inputName: string, value: unknown, parameter: DwsParameterSchema): void {
  if (typeof value !== "string") return;
  const formats = parameter.anyOf?.map((alternative) => alternative.format)
    ?? (parameter.format ? [parameter.format] : []);
  if (formats.length === 0) return;
  const results = formats.map((format) => matchesKnownFormat(format, value));
  if (results.some((result) => result === true) || results.some((result) => result === undefined)) return;
  throw new DingTalkRuntimeError(
    "DWS_ARGUMENT_FORMAT",
    `${inputName} has an invalid format`,
    { fields: [inputName] },
  );
}

function validateParameterEnum(inputName: string, value: unknown, parameter: DwsParameterSchema): void {
  if (!parameter.enum || parameter.enum.length === 0) return;
  const values = Array.isArray(value)
    ? value
    : parameter.interface_type === "array" && typeof value === "string"
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : [value];
  if (values.every((item) => parameter.enum?.includes(String(item)))) return;
  throw new DingTalkRuntimeError(
    "DWS_ARGUMENT_ENUM",
    `${inputName} is outside the allowed values`,
    { fields: [inputName] },
  );
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
    parameterByInputName.set(flag, [flag, parameter]);
  }
  const unknownKeys = Object.keys(input).filter((key) => !parameterByInputName.has(key));
  if (unknownKeys.length > 0) {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_UNKNOWN", "arguments contains unsupported fields", {
      fields: unknownKeys.sort(),
    });
  }
  const missing = [...parameterByInputName.entries()]
    .filter(([, [, parameter]]) => parameter.required === true || parameter.cli_required === true)
    .filter(([inputName]) => !isProvidedValue(input[inputName]))
    .map(([inputName]) => inputName);
  if (missing.length > 0) {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_REQUIRED", "arguments is missing required fields", {
      fields: missing.sort(),
    });
  }
  const providedFlags = new Set<string>();
  for (const [inputName, [flag]] of parameterByInputName) {
    if (isProvidedValue(input[inputName])) providedFlags.add(flag);
  }
  validateConstraintGroups(schema.constraints, providedFlags);
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
      validateParameterEnum(inputName, value, parameter);
      result.push(value ? `--${flag}` : `--${flag}=false`);
      continue;
    }
    if (parameter.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) {
      throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be an integer`);
    }
    if (parameter.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be a number`);
    }
    if (parameter.type === "string" && typeof value !== "string") {
      throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be a string`);
    }
    if (parameter.type === "object" && !isRecord(value)) {
      throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be an object`);
    }
    if (parameter.type === "array") {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", `${inputName} must be an array of strings`);
      }
      if (value.length > 0) {
        validateParameterEnum(inputName, value, parameter);
        result.push(`--${flag}`, value.map(serializeCsvField).join(","));
      }
      continue;
    }
    validateParameterEnum(inputName, value, parameter);
    validateParameterFormat(inputName, value, parameter);
    result.push(`--${flag}`, serializeArgumentValue(value));
  }
  return result;
}
