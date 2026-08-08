export type DwsEffect = "read" | "write" | "destructive";
export type DwsRisk = "low" | "medium" | "high";
export type DwsConfirmation = "not_required" | "user_required";
export type DwsIdempotency = "idempotent" | "unknown" | "non_idempotent";

export type DingTalkDomain = "contact" | "approval" | "attendance" | "calendar" | "todo";

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
  readonly type?: string;
  readonly required?: boolean;
  readonly property?: string;
}

export interface DwsLeafSchema {
  readonly canonical_path: string;
  readonly cli_path: string;
  readonly effect: DwsEffect;
  readonly risk: DwsRisk;
  readonly confirmation: DwsConfirmation;
  readonly idempotency: DwsIdempotency;
  readonly parameters?: Record<string, DwsParameterSchema>;
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
