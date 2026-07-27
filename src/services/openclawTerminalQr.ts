const ANSI_CONTROL_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const TERMINAL_QR_CHARACTERS = /^[ \u2580\u2584\u2588]+$/u;

export type OpenClawTerminalQrMatrix = boolean[][];

function terminalQrRows(line: string): [boolean[], boolean[]] | null {
  const clean = line.replace(ANSI_CONTROL_SEQUENCE, '');
  if (clean.length < 17 || !TERMINAL_QR_CHARACTERS.test(clean)) return null;
  if (!/[\u2580\u2584\u2588]/u.test(clean)) return null;

  const top: boolean[] = [];
  const bottom: boolean[] = [];
  for (const character of clean) {
    top.push(character === '\u2580' || character === '\u2588');
    bottom.push(character === '\u2584' || character === '\u2588');
  }
  return [top, bottom];
}

/**
 * Extract the newest compact terminal QR from Gateway stdout. Some official
 * and third-party channel plugins print a QR directly instead of returning its
 * payload through the Wizard protocol. This parser depends only on the common
 * terminal QR representation, never on a provider name or URL.
 */
export function extractOpenClawTerminalQr(
  lines: readonly string[],
): OpenClawTerminalQrMatrix | null {
  let current: OpenClawTerminalQrMatrix = [];
  let newest: OpenClawTerminalQrMatrix | null = null;

  const finishCandidate = () => {
    if (current.length >= 16 && current[0]?.length >= 17) newest = current;
    current = [];
  };

  for (const line of lines) {
    const rows = terminalQrRows(line);
    if (!rows) {
      finishCandidate();
      continue;
    }
    if (current.length > 0 && current[0].length !== rows[0].length) {
      finishCandidate();
    }
    current.push(...rows);
  }
  finishCandidate();
  return newest;
}
