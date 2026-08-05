export interface WorkspaceFileQuickOpenShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  targetIsEditable: boolean;
}

export function shouldOpenWorkspaceFileQuickOpen(input: WorkspaceFileQuickOpenShortcutInput): boolean {
  return !input.targetIsEditable
    && !input.altKey
    && (input.ctrlKey || input.metaKey)
    && input.key.toLowerCase() === 'p';
}

export function nextWorkspaceFileQuickOpenIndex(
  currentIndex: number,
  entryCount: number,
  direction: 'next' | 'previous',
): number {
  if (entryCount <= 0) return -1;
  if (currentIndex < 0) return direction === 'next' ? 0 : entryCount - 1;
  const offset = direction === 'next' ? 1 : -1;
  return (currentIndex + offset + entryCount) % entryCount;
}
