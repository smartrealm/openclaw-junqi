import type { DwsOperationOutput } from '@/api/tauri-commands';

export type DwsAuthorizationFailureDiagnosis = {
  readonly kind: 'migration-required' | 'reset-required';
  readonly category: 'auth';
  readonly code: number | null;
  readonly stage: 'local-credential-save' | 'unknown';
};

type DwsStructuredError = {
  readonly category: string;
  readonly code: number | null;
  readonly message: string;
};

function readStructuredError(value: unknown): DwsStructuredError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = Reflect.get(value, 'error');
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const category = Reflect.get(error, 'category');
  const code = Reflect.get(error, 'code');
  const message = Reflect.get(error, 'message');
  if (typeof category !== 'string' || typeof message !== 'string') return null;
  return {
    category,
    code: typeof code === 'number' && Number.isFinite(code) ? code : null,
    message,
  };
}

function structuredErrors(events: readonly DwsOperationOutput[]): DwsStructuredError[] {
  const lines = events
    .filter((event) => event.stream === 'stdout' || event.stream === 'stderr')
    .map((event) => event.line);
  const errors: DwsStructuredError[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (!lines[start]?.trimStart().startsWith('{')) continue;
    let candidate = '';
    for (let end = start; end < lines.length; end += 1) {
      candidate += `${candidate ? '\n' : ''}${lines[end]}`;
      try {
        const error = readStructuredError(JSON.parse(candidate) as unknown);
        if (error) errors.push(error);
        break;
      } catch {
        // DWS 会逐行输出格式化 JSON，继续等待当前对象闭合。
      }
    }
  }
  return errors;
}

export function diagnoseDwsAuthorizationFailure(
  events: readonly DwsOperationOutput[],
): DwsAuthorizationFailureDiagnosis | null {
  for (const error of structuredErrors(events)) {
    const message = error.message.toLowerCase();
    const unreadableLegacySlot = error.category === 'auth'
      && message.includes('legacy token slot')
      && message.includes('auth-token')
      && message.includes('unreadable');
    if (!unreadableLegacySlot) continue;
    return {
      kind: message.includes('dek missing') ? 'reset-required' : 'migration-required',
      category: 'auth',
      code: error.code,
      stage: message.includes('failed to save token') ? 'local-credential-save' : 'unknown',
    };
  }
  return null;
}
