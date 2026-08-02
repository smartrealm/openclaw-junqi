import {
  CheckSquare,
  Hash,
  MessageSquare,
  Network,
  Radio,
  Send,
  type LucideIcon,
} from 'lucide-react';

export type ChannelRuntimeIconKind = 'checklist' | 'hash' | 'message' | 'network' | 'radio' | 'send';

export function resolveChannelRuntimeIconKind(systemImage?: string | null): ChannelRuntimeIconKind {
  const symbol = systemImage?.trim().toLowerCase() ?? '';
  if (symbol.includes('paperplane')) return 'send';
  if (symbol.includes('network')) return 'network';
  if (symbol.includes('antenna') || symbol.includes('radio')) return 'radio';
  if (symbol.includes('checklist')) return 'checklist';
  if (symbol.includes('number')) return 'hash';
  return 'message';
}

const icons: Record<ChannelRuntimeIconKind, LucideIcon> = {
  checklist: CheckSquare,
  hash: Hash,
  message: MessageSquare,
  network: Network,
  radio: Radio,
  send: Send,
};

/** Uses OpenClaw channel metadata; unknown metadata receives a neutral message icon. */
export function ChannelRuntimeIcon({ systemImage, size = 15 }: { systemImage?: string | null; size?: number }) {
  const Icon = icons[resolveChannelRuntimeIconKind(systemImage)];
  return <Icon size={size} aria-hidden="true" />;
}
