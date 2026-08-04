import type { OpenClawSessionFile } from '@/services/gateway';

export interface SessionFileDraftScope {
  readonly connectionId: string;
  readonly sessionKey: string;
  readonly agentId: string;
  readonly root?: string;
  readonly path: string;
}

export interface SessionFileDraft {
  readonly content: string;
  readonly expectedHash: string;
}

const SESSION_FILE_HASH_PATTERN = /^[a-f0-9]{64}$/;

/** OpenClaw 仅允许换行符一致的文件进入可写编辑器。 */
export function hasUniformSessionFileLineEndings(content: string): boolean {
  const crlf = content.split('\r\n').length - 1;
  const bareCr = (content.match(/\r(?!\n)/g) ?? []).length;
  const bareLf = (content.match(/(?<!\r)\n/g) ?? []).length;
  return [crlf, bareCr, bareLf].filter((count) => count > 0).length <= 1;
}

/** CodeMirror 以此分隔符序列化，避免 CRLF/CR 文件在保存时被归一化为 LF。 */
export function sessionFileLineSeparator(content: string): string | undefined {
  const separator = content.match(/\r\n|\r|\n/)?.[0];
  return separator && separator !== '\n' ? separator : undefined;
}

export function canEditSessionFile(file: OpenClawSessionFile): file is OpenClawSessionFile & {
  readonly content: string;
  readonly hash: string;
  readonly contentEncoding: 'utf8';
  readonly previewKind: 'text';
} {
  return file.previewKind === 'text'
    && file.contentEncoding === 'utf8'
    && typeof file.content === 'string'
    && typeof file.hash === 'string'
    && SESSION_FILE_HASH_PATTERN.test(file.hash)
    && hasUniformSessionFileLineEndings(file.content);
}

/** 草稿仅在同一认证 Gateway、会话、agent、根目录和请求路径内重用。 */
export function sessionFileDraftKey(scope: SessionFileDraftScope): string {
  return [
    scope.connectionId,
    scope.sessionKey,
    scope.agentId,
    scope.root ?? '',
    scope.path,
  ].join('\0');
}
