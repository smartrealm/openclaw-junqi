/**
 * xterm's paste() emits input through bracketed-paste mode when the shell has
 * enabled it. Submit only after that event has entered the same microtask
 * queue, otherwise a multi-line composer command can execute before its text.
 */
export function pasteAndSubmit(
  paste: (text: string) => void,
  send: (text: string) => void,
  text: string,
): boolean {
  if (!text) return false;
  paste(text);
  queueMicrotask(() => send('\r'));
  return true;
}
