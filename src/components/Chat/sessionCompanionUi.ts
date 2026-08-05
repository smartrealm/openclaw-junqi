const OPEN_EVENT = 'junqi:open-session-companion';

/** 聊天工具栏只发出本地 UI 打开意图，Companion 数据仍由 Gateway RPC 提供。 */
export function requestSessionCompanionOpen(question?: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: question }));
}

export function readSessionCompanionCommand(text: string): string | null {
  const match = /^\/(?:btw|side)(?::|\s|$)\s*(.*)$/i.exec(text.trim());
  return match ? match[1]?.trim() ?? '' : null;
}

export function subscribeSessionCompanionOpen(listener: (question: string) => void): () => void {
  const handle = (event: Event) => listener(event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '');
  window.addEventListener(OPEN_EVENT, handle);
  return () => window.removeEventListener(OPEN_EVENT, handle);
}
