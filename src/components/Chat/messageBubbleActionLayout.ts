export type MessageBubblePrimaryAction = 'editAndResend';
export type MessageBubbleDirectAction = 'preview' | 'copy';
export type MessageBubbleOverflowAction = 'fork';

interface MessageBubbleActionLayoutInput {
  canEditAndResend: boolean;
  canFork: boolean;
  previewable: boolean;
}

interface MessageBubbleActionLayout {
  primary: MessageBubblePrimaryAction | null;
  direct: MessageBubbleDirectAction[];
  overflow: MessageBubbleOverflowAction[];
}

export function resolveMessageBubbleActionLayout({
  canEditAndResend,
  canFork,
  previewable,
}: MessageBubbleActionLayoutInput): MessageBubbleActionLayout {
  return {
    primary: canEditAndResend ? 'editAndResend' : null,
    direct: previewable ? ['preview', 'copy'] : ['copy'],
    overflow: canFork ? ['fork'] : [],
  };
}
