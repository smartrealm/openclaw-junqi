// ---------------------------------------------------------------------------
// Terminal "insert newline" shortcut
//
// Inside the embedded xterm, plain Enter is always forwarded to the agent
// (Claude Code / Codex) as a submit. A second combo lets the user insert a
// newline without submitting.
//
// Option/Alt + Enter is ALWAYS treated as "insert newline" — it is the
// universal combo agents already understand, so there is nothing to configure.
// Shift + Enter is the only configurable part: a single on/off toggle (default
// on) for users who prefer that ergonomics.
// ---------------------------------------------------------------------------

export const DEFAULT_SHIFT_ENTER_NEWLINE = true;

/**
 * Esc + CR. Both Claude Code and Codex interpret this as "insert newline" — it
 * is exactly the byte sequence Option/Alt + Enter emits in the JetBrains
 * terminal fallback. We emit it ourselves so the embedded xterm (which does not
 * negotiate the kitty / CSI-u keyboard protocol with the agent) behaves
 * consistently across platforms. Sending raw "\n" instead is avoided on
 * purpose: it can disrupt programs that rely on the kitty protocol.
 */
export const TERMINAL_NEWLINE_SEQUENCE = "\x1b\r";

interface TerminalKeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True while an IME composition is in progress (real KeyboardEvent field). */
  isComposing?: boolean;
  /** 229 while an IME composition is in progress (legacy field, kept for Safari). */
  keyCode?: number;
}

export function normalizeShiftEnterNewline(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SHIFT_ENTER_NEWLINE;
}

/**
 * Whether a terminal key event should insert a newline instead of submitting.
 * Option/Alt + Enter always qualifies; Shift + Enter only when the user has the
 * toggle enabled. Enter on its own (and Cmd/Ctrl + Enter) is never matched — it
 * stays a submit.
 */
export function matchesTerminalNewline(
  event: TerminalKeyEventLike,
  shiftEnterEnabled: boolean,
): boolean {
  // Never hijack a key that is committing an IME composition (e.g. a CJK user
  // pressing Shift+Enter to accept a candidate) — that must reach the IME, not
  // become a newline.
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }
  if (event.key !== "Enter" || event.metaKey || event.ctrlKey) {
    return false;
  }
  // Alt+Enter: always a newline. Shift+Enter: only when enabled.
  if (event.altKey && !event.shiftKey) {
    return true;
  }
  return shiftEnterEnabled && event.shiftKey && !event.altKey;
}
