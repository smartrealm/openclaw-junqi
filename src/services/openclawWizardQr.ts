const WIZARD_QR_MESSAGE_HINT = /scan|扫码|二维码|qr\b/i;
const WIZARD_QR_URL_PATTERN = /https?:\/\/[^\s"'<>]+/;

export function normalizeOpenClawWizardHttpUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || !url.hostname
      || url.username
      || url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The official wizard may include an ASCII QR and authorization URL inside a
 * plain note. Only extract a valid browser URL from an explicitly QR-related
 * message; its surrounding presentation remains Gateway-owned.
 */
export function extractOpenClawWizardQrUrl(message?: string): string | null {
  if (!message || !WIZARD_QR_MESSAGE_HINT.test(message)) return null;
  const candidate = message.match(WIZARD_QR_URL_PATTERN)?.[0]
    .replace(/[),.;，。；]+$/u, '');
  return normalizeOpenClawWizardHttpUrl(candidate);
}
