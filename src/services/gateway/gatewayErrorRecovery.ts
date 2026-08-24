export interface GatewayErrorRecoveryResult {
  success: boolean;
  error?: string;
}

interface GatewayErrorRecoveryOptions {
  reconnect(): Promise<GatewayErrorRecoveryResult>;
  onRecovered(): void;
  onFailed(error: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runGatewayErrorScreenRecovery(
  options: GatewayErrorRecoveryOptions,
): Promise<GatewayErrorRecoveryResult> {
  let result: GatewayErrorRecoveryResult;
  try {
    result = await options.reconnect();
  } catch (error) {
    result = { success: false, error: errorMessage(error) };
  }

  if (result.success) {
    options.onRecovered();
    return result;
  }

  const diagnostic = result.error?.trim() || 'Gateway reconnect failed.';
  options.onFailed(diagnostic);
  return { ...result, success: false, error: diagnostic };
}
