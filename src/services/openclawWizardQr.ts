// A step that merely *names* QR login is not a scan step. OpenClaw's channel
// primer note lists every channel's capability blurb ("… via QR-code login")
// next to a plain docs link, so matching the bare noun reclassified that note
// as an authorization step and rendered its docs URL as a scannable code.
// Official scan prompts always tell the user to scan, so require that verb.
const WIZARD_QR_MESSAGE_HINT = /\bscan(?:s|ned|ning)?\b|扫描|掃描|扫码|掃碼/i;
const WIZARD_QR_URL_PATTERN = /https?:\/\/[^\s"'<>]+/;
const WIZARD_AUTHORIZATION_POLLING_HINT =
  /waiting for (?:the )?authorization (?:result|status)|(?:正在)?等待授权结果|(?:正在)?等待授權結果/i;
const WIZARD_AUTHORIZATION_CONTINUATION_HINT =
  /(?:(?:continue|proceed).*(?:url|link|browser|qr).*(?:authoriz|authentication)|(?:url|link|browser|qr).*(?:authoriz|authentication).*(?:continue|proceed)|(?:继续|繼續).*(?:链接|連結|网址|網址|浏览器|瀏覽器|二维码|二維碼).*(?:授权|授權|认证|認證)|(?:链接|連結|网址|網址|浏览器|瀏覽器|二维码|二維碼).*(?:授权|授權|认证|認證).*(?:继续|繼續))/i;

export interface OpenClawWizardQrContinuationStep {
  type?: string;
  message?: string;
  initialValue?: unknown;
}

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

export function isOpenClawWizardQrMessage(message?: string): message is string {
  return Boolean(message && WIZARD_QR_MESSAGE_HINT.test(message));
}

/**
 * The official wizard may include an ASCII QR and authorization URL inside a
 * plain note. Only extract a valid browser URL from an explicitly QR-related
 * message; its surrounding presentation remains Gateway-owned.
 */
export function extractOpenClawWizardQrUrl(message?: string): string | null {
  if (!isOpenClawWizardQrMessage(message)) return null;
  const candidate = message.match(WIZARD_QR_URL_PATTERN)?.[0]
    .replace(/[),.;，。；]+$/u, '');
  return normalizeOpenClawWizardHttpUrl(candidate);
}

/**
 * Resolve a QR destination from the installed Gateway's plain-text step
 * contract. Unknown structured fields are rejected by the Wizard decoder.
 */
export function resolveOpenClawWizardQrUrl(
  message?: string,
): string | null {
  return extractOpenClawWizardQrUrl(message);
}

/**
 * Channel wizards can emit a second QR note immediately before their own
 * polling loop. A Gateway client must acknowledge that note before polling can
 * start. Base this on protocol presentation, never a built-in channel list, so
 * official and third-party plugins retain the same behavior.
 */
export function shouldAutoAdvanceOpenClawWizardQr(
  message?: string,
  value?: string,
): boolean {
  const normalized = normalizeOpenClawWizardHttpUrl(value);
  if (!message || !normalized || !WIZARD_AUTHORIZATION_POLLING_HINT.test(message)) {
    return false;
  }
  return true;
}

/**
 * A plugin may need one protocol confirmation after its QR note before it can
 * start polling. Only continue a default-affirmative URL/QR authorization
 * prompt, and only when the caller has already recorded an explicit user start.
 */
export function isOpenClawWizardQrAuthorizationContinuation(
  step?: OpenClawWizardQrContinuationStep,
): boolean {
  return Boolean(
    step?.type === 'confirm'
    && step.initialValue === true
    && step.message
    && WIZARD_AUTHORIZATION_CONTINUATION_HINT.test(step.message),
  );
}

export async function continueOpenClawWizardQrAuthorization(
  step: OpenClawWizardQrContinuationStep & { id?: string } | undefined,
  submit: (stepId: string, value: true) => Promise<unknown>,
): Promise<boolean> {
  if (!step?.id || !isOpenClawWizardQrAuthorizationContinuation(step)) return false;
  await submit(step.id, true);
  return true;
}
