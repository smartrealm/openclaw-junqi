import type { OpenClawQueueMode } from '@/services/gateway/OpenClawQueueMode';

export type ComposerPrimaryActionLabel = 'send' | 'stop' | 'steer' | 'queue' | 'interrupt';

export type ComposerPrimaryAction =
  | { kind: 'send'; label: Exclude<ComposerPrimaryActionLabel, 'stop'>; disabled: boolean }
  | { kind: 'stop'; label: 'stop'; disabled: false };

/** 会话显式覆盖优先于 Gateway 的有效默认投影，与 OpenClaw Control UI 一致。 */
export function resolveComposerQueueMode(input: {
  queueMode?: OpenClawQueueMode;
  effectiveQueueMode?: OpenClawQueueMode;
}): OpenClawQueueMode | undefined {
  return input.queueMode ?? input.effectiveQueueMode;
}

interface ResolveComposerPrimaryActionInput {
  hasContent: boolean;
  responseActive: boolean;
  sendDisabled: boolean;
  effectiveQueueMode?: OpenClawQueueMode;
}

function activeSendLabel(mode: OpenClawQueueMode | undefined): Exclude<ComposerPrimaryActionLabel, 'stop'> {
  if (mode === 'steer') return 'steer';
  if (mode === 'followup' || mode === 'collect') return 'queue';
  if (mode === 'interrupt') return 'interrupt';
  return 'send';
}

/** 将输入内容和上游运行状态收敛为唯一主操作，避免并排竞争动作。 */
export function resolveComposerPrimaryAction({
  hasContent,
  responseActive,
  sendDisabled,
  effectiveQueueMode,
}: ResolveComposerPrimaryActionInput): ComposerPrimaryAction {
  if (responseActive && !hasContent) {
    return { kind: 'stop', label: 'stop', disabled: false };
  }
  return {
    kind: 'send',
    label: responseActive ? activeSendLabel(effectiveQueueMode) : 'send',
    disabled: !hasContent || sendDisabled,
  };
}

interface ResolveComposerEnterActionInput {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  composing?: boolean;
  responseActive?: boolean;
}

export type ComposerEnterAction = 'none' | 'send' | 'steer';

/** 修饰键转向只在活动运行中生效，空闲会话仍按普通发送处理。 */
export function resolveComposerEnterAction({
  key,
  shiftKey = false,
  metaKey = false,
  ctrlKey = false,
  composing = false,
  responseActive = false,
}: ResolveComposerEnterActionInput): ComposerEnterAction {
  if (key !== 'Enter' || shiftKey || composing) return 'none';
  return responseActive && (metaKey || ctrlKey) ? 'steer' : 'send';
}
