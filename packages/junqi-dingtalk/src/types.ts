export type DwsEffect = "read" | "write" | "destructive";
export type DwsRisk = "low" | "medium" | "high";
export type DwsConfirmation = "not_required" | "user_required";
export type DwsIdempotency = "idempotent" | "unknown" | "non_idempotent";
export type DwsAvailability = "available" | "unavailable";

export type DingTalkDomain =
  | "contact"
  | "approval"
  | "attendance"
  | "calendar"
  | "todo"
  | "minutes"
  | "doc"
  | "wiki"
  | "report"
  | "mail"
  | "chat"
  | "aitable"
  | "contract"
  | "recruit"
  | "goal";

export interface DingTalkToolSpec {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly domain: DingTalkDomain;
  readonly canonicalPath: string;
  readonly cliPath: string;
  readonly effect: DwsEffect;
  readonly risk: DwsRisk;
  readonly confirmation: DwsConfirmation;
  readonly idempotency: DwsIdempotency;
}

export interface DwsParameterSchema {
  readonly description?: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly cli_required?: boolean;
  readonly required_when?: string;
  readonly property?: string;
  readonly interface_type?: string;
  readonly interface_default?: unknown;
  readonly default?: unknown;
  readonly example?: unknown;
  readonly enum?: readonly string[];
  readonly format?: string;
  readonly anyOf?: readonly DwsFormatAlternative[];
}

export interface DwsFormatAlternative {
  readonly format: string;
}

export interface DwsConstraintSchema {
  readonly mutually_exclusive?: readonly (readonly string[])[];
  readonly require_one_of?: readonly (readonly string[])[];
  readonly require_together?: readonly (readonly string[])[];
}

export interface DwsLeafSchema {
  readonly availability?: DwsAvailability;
  readonly canonical_path: string;
  readonly cli_path: string;
  readonly effect: DwsEffect;
  readonly risk: DwsRisk;
  readonly confirmation: DwsConfirmation;
  readonly idempotency: DwsIdempotency;
  readonly parameters?: Record<string, DwsParameterSchema>;
  readonly constraints?: DwsConstraintSchema;
  readonly result?: DwsResultSchema;
}

export interface DwsResultSchema {
  readonly outcomes: readonly string[];
  readonly data_schema: Record<string, unknown>;
  readonly sensitive_paths?: readonly string[];
}

export interface DwsRunnerConfig {
  readonly dwsPath?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface DwsCommandResult {
  readonly data: unknown;
  readonly recoveryEventId?: string;
}

export type DingTalkWriteVerificationStatus = "verified" | "succeeded_unverified" | "unknown";

export interface DingTalkWriteVerification {
  readonly status: DingTalkWriteVerificationStatus;
  readonly resourceId?: string;
  readonly verifierToolName?: string;
  readonly verifierCanonicalPath?: string;
  readonly verifierSchemaDigest?: string;
  readonly reasonCode?: string;
  readonly observedAt: string;
}
