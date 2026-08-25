export const OPENCLAW_QUEUE_MODES = ['steer', 'followup', 'collect', 'interrupt'] as const;

export type OpenClawQueueMode = typeof OPENCLAW_QUEUE_MODES[number];

/** 只接受 OpenClaw 正式协议定义的队列模式，未知值保持未知。 */
export function parseOpenClawQueueMode(value: unknown): OpenClawQueueMode | undefined {
  return typeof value === 'string' && OPENCLAW_QUEUE_MODES.includes(value as OpenClawQueueMode)
    ? value as OpenClawQueueMode
    : undefined;
}
