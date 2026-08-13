export const OPENCLAW_SETUP_ADMISSION_BUSY_MESSAGE = 'OpenClaw setup is already in progress; try again when it finishes.';

export function isOpenClawSetupAdmissionBusy(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const details = record?.details && typeof record.details === 'object'
    ? record.details as Record<string, unknown>
    : null;
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : '';
  return String(record?.code ?? '').toUpperCase() === 'UNAVAILABLE'
    && message === OPENCLAW_SETUP_ADMISSION_BUSY_MESSAGE
    && details?.retryable === true;
}
