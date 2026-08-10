export interface GatewayAttachmentPolicy {
  readonly maxPayload: number;
  readonly maxBytes?: number;
  readonly maxImageBytes?: number;
}

export type GatewayOperatorScope =
  | 'operator.read'
  | 'operator.write'
  | 'operator.admin'
  | 'operator.approvals'
  | 'operator.questions'
  | 'operator.pairing'
  | 'operator.talk'
  | 'operator.talk.secrets';

export const DAILY_OPERATOR_SCOPES: readonly GatewayOperatorScope[] = Object.freeze([
  'operator.read',
  'operator.write',
  'operator.talk',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 当前已认证 Gateway socket 返回的不可变连接策略。 */
export class GatewayConnectionPolicy {
  private constructor(
    readonly maxPayload: number,
    readonly maxBufferedBytes: number,
    readonly tickIntervalMs: number,
    readonly attachments: Readonly<{ maxBytes: number; maxImageBytes: number }> | null,
  ) {}

  static parse(value: unknown): GatewayConnectionPolicy | null {
    if (!isRecord(value)) return null;
    if (
      !isPositiveSafeInteger(value.maxPayload)
      || !isPositiveSafeInteger(value.maxBufferedBytes)
      || !isPositiveSafeInteger(value.tickIntervalMs)
    ) return null;

    let attachments: Readonly<{ maxBytes: number; maxImageBytes: number }> | null = null;
    if (value.attachments !== undefined) {
      if (
        !isRecord(value.attachments)
        || !isPositiveSafeInteger(value.attachments.maxBytes)
        || !isPositiveSafeInteger(value.attachments.maxImageBytes)
      ) return null;
      attachments = Object.freeze({
        maxBytes: value.attachments.maxBytes,
        maxImageBytes: value.attachments.maxImageBytes,
      });
    }

    return Object.freeze(new GatewayConnectionPolicy(
      value.maxPayload,
      value.maxBufferedBytes,
      value.tickIntervalMs,
      attachments,
    ));
  }

  attachmentPolicy(): GatewayAttachmentPolicy {
    return Object.freeze({
      maxPayload: this.maxPayload,
      ...(this.attachments ?? {}),
    });
  }
}
