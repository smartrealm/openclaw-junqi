import type { OpenClawSessionFile } from '@/services/gateway';
import { gatewayImagePreviewContent } from '@/file-preview/content';

export type SessionFilePreviewFailure = 'missing' | 'unsupported' | 'contentUnavailable';

export function sessionFilePreviewFailure(file: OpenClawSessionFile): SessionFilePreviewFailure | null {
  if (file.missing) return 'missing';
  if (file.previewKind === 'unsupported') return 'unsupported';
  if (file.previewKind === 'text' && file.contentEncoding === 'utf8' && typeof file.content === 'string') return null;
  if (file.previewKind === 'image' && file.contentEncoding === 'base64' && typeof file.content === 'string') {
    return gatewayImagePreviewContent(file.mimeType, file.content) ? null : 'unsupported';
  }
  return 'contentUnavailable';
}
