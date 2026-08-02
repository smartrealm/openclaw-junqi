import {
  captureFullscreenScreenshot,
  captureInteractiveScreenshot,
  captureScreenshotWindow,
  listScreenshotWindows,
  type ScreenshotCapturePayload,
  type ScreenshotWindowSource,
} from '@/api/tauri-commands';

export type { ScreenshotWindowSource } from '@/api/tauri-commands';

export interface ScreenshotCaptureResult {
  success: boolean;
  data?: string;
  cancelled?: boolean;
  tccDenied?: boolean;
  error?: string;
}

function normalizeScreenshotFailure(error: unknown): ScreenshotCaptureResult {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('PERMISSION_DENIED')) {
    return { success: false, tccDenied: true, error: message.replace('PERMISSION_DENIED:', '').trim() };
  }
  if (message.includes('CANCELLED')) return { success: false, cancelled: true };
  return { success: false, error: message || undefined };
}

async function capture(operation: () => Promise<ScreenshotCapturePayload>): Promise<ScreenshotCaptureResult> {
  try {
    const result = await operation();
    return result.success && typeof result.data === 'string'
      ? { success: true, data: result.data }
      : { success: false };
  } catch (error) {
    return normalizeScreenshotFailure(error);
  }
}

export const screenshotRuntime = {
  captureInteractive: () => capture(captureInteractiveScreenshot),
  captureFullscreen: () => capture(captureFullscreenScreenshot),
  captureWindow: (id: string) => capture(() => captureScreenshotWindow(id)),
  async listWindows(): Promise<ScreenshotWindowSource[]> {
    try {
      const windows = await listScreenshotWindows();
      return Array.isArray(windows) ? windows.filter((source) => source.name.trim().length > 0) : [];
    } catch {
      return [];
    }
  },
};
