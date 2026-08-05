import {
  fileExtension,
  isMarkdownFile,
  type ManagedFilePreview,
  type WorkspaceFilePreview,
} from '@/utils/filePreviewCapabilities';

export type FilePreviewContent =
  | {
      readonly kind: 'html';
      readonly mode: 'interactive';
      readonly url: string;
    }
  | {
      readonly kind: 'html';
      readonly mode: 'static';
      readonly content: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'image';
      readonly url: string;
    }
  | {
      readonly kind: 'audio';
      readonly url: string;
    }
  | {
      readonly kind: 'video';
      readonly url: string;
    }
  | {
      readonly kind: 'pdf';
      readonly source:
        | { readonly kind: 'url'; readonly url: string }
        | { readonly kind: 'base64'; readonly base64: string };
    }
  | {
      readonly kind: 'json';
      readonly content: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'markdown';
      readonly content: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'text';
      readonly content: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'binary';
      readonly byteLength?: number;
    };

const GATEWAY_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function textFilePreviewContent(
  fileName: string,
  content: string,
  truncated = false,
): Extract<FilePreviewContent, { kind: 'json' | 'markdown' | 'text' }> {
  if (fileExtension(fileName) === 'json') {
    return { kind: 'json', content, truncated };
  }
  if (isMarkdownFile(fileName)) {
    return { kind: 'markdown', content, truncated };
  }
  return { kind: 'text', content, truncated };
}

export function managedFilePreviewContent(preview: ManagedFilePreview): FilePreviewContent {
  switch (preview.kind) {
    case 'html':
    case 'json':
    case 'markdown':
    case 'text':
      return preview;
    case 'image':
      return { kind: 'image', url: preview.url };
    case 'audio':
      return { kind: 'audio', url: preview.url };
    case 'video':
      return { kind: 'video', url: preview.url };
    case 'pdf':
      return { kind: 'pdf', source: { kind: 'url', url: preview.url } };
  }
}

export function workspaceFilePreviewContent(
  fileName: string,
  preview: WorkspaceFilePreview,
): FilePreviewContent {
  switch (preview.kind) {
    case 'text':
      return textFilePreviewContent(fileName, preview.text);
    case 'image':
      return {
        kind: 'image',
        url: `data:${preview.mimeType};base64,${preview.base64}`,
      };
    case 'pdf':
      return {
        kind: 'pdf',
        source: { kind: 'base64', base64: preview.base64 },
      };
    case 'binary':
      return { kind: 'binary', byteLength: preview.byteLength };
  }
}

export function gatewayImagePreviewContent(
  mimeType: string | undefined,
  base64: string | undefined,
): Extract<FilePreviewContent, { kind: 'image' }> | null {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  if (!normalizedMimeType || !base64 || !GATEWAY_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return null;
  }
  return {
    kind: 'image',
    url: `data:${normalizedMimeType};base64,${base64}`,
  };
}
