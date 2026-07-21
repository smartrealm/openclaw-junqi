import { CollaborationError, assertCondition } from "./errors.js";
import type { CapabilityAgent, OriginRef } from "./types.js";
import { sha256, stableStringify } from "./util.js";

/**
 * Hard persistence limits are deliberately independent from configurable
 * workflow limits. They protect SQLite, snapshots, and exports from an
 * accidentally unbounded model/runtime response.
 */
export const PERSISTENCE_LIMITS = Object.freeze({
  goalBytes: 32 * 1024,
  revisionInstructionBytes: 32 * 1024,
  planBytes: 512 * 1024,
  workItemTitleBytes: 1024,
  workItemArrayItems: 64,
  inputScopeItemBytes: 4096,
  capabilityItemBytes: 512,
  acceptanceCriterionBytes: 8192,
  synthesisEvidenceItemBytes: 4096,
  finalAnswerContractBytes: 32 * 1024,
  workerResultBytes: 512 * 1024,
  workerSummaryBytes: 32 * 1024,
  evidencePerAttempt: 64,
  evidenceTypeBytes: 256,
  evidenceTitleBytes: 1024,
  evidenceReferenceBytes: 8192,
  evidenceVerificationBytes: 32 * 1024,
  evidenceWarningBytes: 8192,
  workerListItems: 64,
  artifactReferenceBytes: 8192,
  handoffNoteBytes: 8192,
  additionalInputBytes: 32 * 1024,
  additionalInputsPerWorkItem: 32,
  additionalInputsTotalBytes: 256 * 1024,
  finalArtifactBytes: 256 * 1024,
  originRuntimeIdBytes: 512,
  originAgentIdBytes: 512,
  originSessionKeyBytes: 2048,
  originSessionIdBytes: 512,
  originMessageIdBytes: 512,
  originChannelBytes: 256,
  originAccountIdBytes: 512,
  originTargetBytes: 2048,
  originThreadIdBytes: 512,
  configuredAgents: 128,
  agentNameBytes: 1024,
  agentDescriptionBytes: 8192,
  runtimeVersionBytes: 256,
  desktopFactBytes: 2048,
  capabilitySnapshotBytes: 128 * 1024,
  externalReferenceBytes: 1024,
  actorBytes: 512,
  maintenanceReasonBytes: 4096,
  flowAbandonReasonBytes: 4096,
  diagnosticBytes: 4096,
  eventPayloadBytes: 64 * 1024,
  commandPayloadBytes: 64 * 1024,
  commandResponseBytes: 128 * 1024,
  commandIdBytes: 512,
  commandReceiptsPerRun: 4_096,
  emergencyCommandReceiptsPerRun: 64,
  unscopedCommandReceipts: 10_000,
  interventionDiagnosticsBytes: 32 * 1024,
  attemptsPerEntityKind: 32,
  planRevisions: 32,
  eventsPerExport: 10_000,
  eventsPerPage: 500,
  exportBytes: 16 * 1024 * 1024,
  workflowTemplateNameBytes: 160,
  workflowTemplateDefinitionBytes: 128 * 1024,
  workflowTemplateParametersBytes: 16 * 1024,
  workflowTemplates: 200,
} as const);

const SENSITIVE_KEY = /^(?:authorization|proxyAuthorization|token|accessToken|refreshToken|idToken|apiKey|password|secret|prompt|systemPrompt|developerPrompt|chainOfThought|reasoning|thinking|toolOutput|rawOutput|rawTranscript|messages)$/i;

const SECRET_ASSIGNMENT = /\b(authorization|proxy[-_ ]?authorization|token|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|api[-_ ]?key|password|secret)\b\s*[:=]\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_VALUE = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const PRIVATE_REASONING = /\b(chain[-_ ]?of[-_ ]?thought|reasoning|thinking|system[-_ ]?prompt|developer[-_ ]?prompt|tool[-_ ]?output|raw[-_ ]?output)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n]*)/gi;
const CREDENTIAL_ASSIGNMENT = /\b(authorization|proxy[-_ ]?authorization|token|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|api[-_ ]?key|password|secret)\b\s*[:=]\s*(?:bearer\s+)?("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const CREDENTIAL_PREFIX = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-(?:proj-)?|gh[pousr]_|xox[baprs]-|AKIA)[a-z0-9_-]{12,})/i;
const SAFE_CREDENTIAL_PLACEHOLDER = /^(?:\[?redacted\]?|<redacted>|\*+|example|placeholder|none|null|\$\{[A-Z0-9_]+\})$/i;

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function assertBoundedText(value: string, field: string, maxBytes: number): string {
  const size = byteLength(value);
  if (size > maxBytes) {
    throw new CollaborationError("CAPACITY_EXCEEDED", `${field} exceeds the ${maxBytes}-byte persistence limit`, {
      field,
      maxBytes,
      actualBytes: size,
    });
  }
  return value;
}

export function assertPersistableText(value: string, field: string, maxBytes: number): string {
  assertBoundedText(value, field, maxBytes);
  assertNoCredentialMaterial(value, field);
  return value;
}

export function assertBoundedJson(value: unknown, field: string, maxBytes: number): void {
  assertNoSensitiveKeys(value, field);
  assertBoundedText(stableStringify(value), field, maxBytes);
}

export function assertNoSensitiveKeys(value: unknown, field: string): void {
  const seen = new Set<object>();
  const visit = (current: unknown, path: string, depth: number): void => {
    if (typeof current === "string") {
      assertNoCredentialMaterial(current, path);
      return;
    }
    if (current == null || typeof current !== "object") return;
    assertCondition(depth <= 12, "CAPACITY_EXCEEDED", `${field} exceeds the maximum persistence depth`);
    if (seen.has(current)) throw new CollaborationError("INVALID_REQUEST", `${path} contains a circular value`);
    seen.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) visit(current[index], `${path}[${index}]`, depth + 1);
    } else {
      for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
        if (SENSITIVE_KEY.test(key)) {
          throw new CollaborationError("INVALID_REQUEST", `${path}.${key} is not allowed in collaboration persistence`);
        }
        visit(nested, `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(current);
  };
  visit(value, field, 0);
}

export function assertBoundedStringArray(
  values: string[],
  field: string,
  options: { maxItems: number; maxItemBytes: number; maxTotalBytes?: number },
): void {
  assertCondition(values.length <= options.maxItems, "CAPACITY_EXCEEDED", `${field} exceeds the ${options.maxItems}-item limit`, {
    field,
    maxItems: options.maxItems,
    actualItems: values.length,
  });
  let totalBytes = 0;
  for (let index = 0; index < values.length; index += 1) {
    assertBoundedText(values[index]!, `${field}[${index}]`, options.maxItemBytes);
    totalBytes += byteLength(values[index]!);
  }
  if (options.maxTotalBytes != null && totalBytes > options.maxTotalBytes) {
    throw new CollaborationError("CAPACITY_EXCEEDED", `${field} exceeds the ${options.maxTotalBytes}-byte aggregate limit`, {
      field,
      maxBytes: options.maxTotalBytes,
      actualBytes: totalBytes,
    });
  }
}

export function assertOriginBounded(origin: OriginRef, field = "origin"): OriginRef {
  assertPersistableText(origin.runtimeId, `${field}.runtimeId`, PERSISTENCE_LIMITS.originRuntimeIdBytes);
  assertPersistableText(origin.agentId, `${field}.agentId`, PERSISTENCE_LIMITS.originAgentIdBytes);
  assertPersistableText(origin.sessionKey, `${field}.sessionKey`, PERSISTENCE_LIMITS.originSessionKeyBytes);
  assertPersistableText(origin.sessionId, `${field}.sessionId`, PERSISTENCE_LIMITS.originSessionIdBytes);
  assertPersistableText(origin.nativeMessageId, `${field}.nativeMessageId`, PERSISTENCE_LIMITS.originMessageIdBytes);
  if (origin.clientMessageId) {
    assertPersistableText(origin.clientMessageId, `${field}.clientMessageId`, PERSISTENCE_LIMITS.originMessageIdBytes);
  }
  if (origin.channel) assertPersistableText(origin.channel, `${field}.channel`, PERSISTENCE_LIMITS.originChannelBytes);
  if (origin.accountId) assertPersistableText(origin.accountId, `${field}.accountId`, PERSISTENCE_LIMITS.originAccountIdBytes);
  if (origin.target) assertPersistableText(origin.target, `${field}.target`, PERSISTENCE_LIMITS.originTargetBytes);
  if (origin.threadId != null) {
    assertPersistableText(String(origin.threadId), `${field}.threadId`, PERSISTENCE_LIMITS.originThreadIdBytes);
  }
  return origin;
}

export function sanitizeConfiguredAgents(agents: CapabilityAgent[]): CapabilityAgent[] {
  assertCondition(
    agents.length <= PERSISTENCE_LIMITS.configuredAgents,
    "CAPACITY_EXCEEDED",
    `configured agents exceed the ${PERSISTENCE_LIMITS.configuredAgents}-item limit`,
  );
  const result = agents.map((agent, index) => {
    assertBoundedText(agent.id, `configuredAgents[${index}].id`, PERSISTENCE_LIMITS.originAgentIdBytes);
    if (agent.name) assertBoundedText(agent.name, `configuredAgents[${index}].name`, PERSISTENCE_LIMITS.agentNameBytes);
    if (agent.description) {
      assertBoundedText(agent.description, `configuredAgents[${index}].description`, PERSISTENCE_LIMITS.agentDescriptionBytes);
    }
    assertCondition(agent.runtimeType === "native" || agent.runtimeType === "acp", "INVALID_REQUEST", "Agent runtime type is invalid");
    return {
      id: agent.id,
      ...(agent.name ? { name: agent.name } : {}),
      ...(agent.description ? { description: agent.description } : {}),
      runtimeType: agent.runtimeType,
      allowed: agent.allowed === true,
      coordinator: agent.coordinator === true,
    } satisfies CapabilityAgent;
  });
  assertCondition(new Set(result.map((agent) => agent.id)).size === result.length, "INVALID_REQUEST", "configuredAgents contains duplicate ids");
  return result;
}

export function sanitizeDesktopObservedFacts(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ["targetFingerprint", "deploymentKind", "persistence", "gatewayVersion"] as const) {
    const value = source[key];
    if (value == null) continue;
    assertCondition(typeof value === "string", "INVALID_REQUEST", `capabilitySnapshot.desktopObservedFacts.${key} must be a string`);
    const normalized = value.trim();
    assertCondition(Boolean(normalized), "INVALID_REQUEST", `capabilitySnapshot.desktopObservedFacts.${key} must not be empty`);
    result[key] = assertBoundedText(
      normalized,
      `capabilitySnapshot.desktopObservedFacts.${key}`,
      PERSISTENCE_LIMITS.desktopFactBytes,
    );
  }
  if (result.deploymentKind) {
    assertCondition(
      ["external", "system_service", "managed_child", "docker"].includes(result.deploymentKind),
      "INVALID_REQUEST",
      "capabilitySnapshot.desktopObservedFacts.deploymentKind is invalid",
    );
  }
  if (result.persistence) {
    assertCondition(
      ["desktop_independent", "desktop_bound", "unknown"].includes(result.persistence),
      "INVALID_REQUEST",
      "capabilitySnapshot.desktopObservedFacts.persistence is invalid",
    );
  }
  return result;
}

export function boundedDiagnostic(value: unknown): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? "Unknown error");
  if (CREDENTIAL_PREFIX.test(raw)) {
    return `Diagnostic redacted because it contained credential material (sha256:${sha256(raw)})`;
  }
  if (byteLength(raw) > PERSISTENCE_LIMITS.diagnosticBytes) {
    return `Diagnostic omitted because it exceeded ${PERSISTENCE_LIMITS.diagnosticBytes} bytes (sha256:${sha256(raw)})`;
  }
  const normalized = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  return normalized
    .replace(SECRET_ASSIGNMENT, "$1=[REDACTED]")
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(PRIVATE_REASONING, "$1=[REDACTED]");
}

function assertNoCredentialMaterial(value: string, field: string): void {
  if (CREDENTIAL_PREFIX.test(value)) {
    throw new CollaborationError("INVALID_REQUEST", `${field} contains credential material that cannot be persisted`);
  }
  CREDENTIAL_ASSIGNMENT.lastIndex = 0;
  for (const match of value.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const raw = (match[2] ?? "").replace(/^['"]|['"]$/g, "").trim();
    if (!SAFE_CREDENTIAL_PLACEHOLDER.test(raw)) {
      throw new CollaborationError("INVALID_REQUEST", `${field} contains credential material that cannot be persisted`);
    }
  }
}

export function assertAttemptNumber(attemptNo: number, field = "attemptNo"): void {
  assertCondition(
    attemptNo >= 1 && attemptNo <= PERSISTENCE_LIMITS.attemptsPerEntityKind,
    "CAPACITY_EXCEEDED",
    `${field} exceeds the ${PERSISTENCE_LIMITS.attemptsPerEntityKind}-attempt limit`,
  );
}

export function isSensitivePersistenceKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function sanitizeStoredJsonForOutput(value: unknown, field: string, maxBytes: number): unknown {
  const visit = (current: unknown, depth: number): unknown => {
    assertCondition(depth <= 12, "CAPACITY_EXCEEDED", `${field} exceeds the maximum export depth`);
    if (current == null || typeof current !== "object") return current;
    if (Array.isArray(current)) return current.map((entry) => visit(entry, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      output[key] = visit(nested, depth + 1);
    }
    return output;
  };
  const sanitized = visit(value, 0);
  assertBoundedJson(sanitized, field, maxBytes);
  return sanitized;
}
