import type { ArtifactDownloadResult, ArtifactSummary } from '@/services/gateway/artifacts';
import type { ManagedFilePreview } from './filePreviewCapabilities';
import { decodeBase64Utf8 } from '@/services/chat/filePreview';
import { fileExtension } from '@/workspace-files/domain/fileKinds';

const MAX_INLINE_ARTIFACT_BYTES = 8 * 1024 * 1024;

function extension(title: string): string {
  const name = title.replace(/^.*[/\\]/, '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

function normalizedMime(artifact: ArtifactSummary): string {
  return artifact.mimeType?.trim().toLowerCase() || '';
}

function isTextArtifact(artifact: ArtifactSummary): boolean {
  const mime = normalizedMime(artifact);
  if (mime.startsWith('text/')) return true;
  if (['application/json', 'application/javascript', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/rtf', 'application/sql'].includes(mime)) return true;
  return [
    'md', 'mdx', 'markdown', 'txt', 'text', 'html', 'htm', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx',
    'json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'sql', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh',
  ].includes(extension(artifact.title));
}

function isMarkdownArtifact(artifact: ArtifactSummary): boolean {
  return ['md', 'mdx', 'markdown'].includes(extension(artifact.title))
    || normalizedMime(artifact) === 'text/markdown';
}

function isJsonArtifact(artifact: ArtifactSummary): boolean {
  return fileExtension(artifact.title) === 'json' || normalizedMime(artifact) === 'application/json';
}

function isHtmlArtifact(artifact: ArtifactSummary): boolean {
  return ['html', 'htm'].includes(extension(artifact.title))
    || normalizedMime(artifact) === 'text/html';
}

function mediaKind(artifact: ArtifactSummary): 'image' | 'audio' | 'video' | 'pdf' | null {
  const mime = normalizedMime(artifact);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || extension(artifact.title) === 'pdf') return 'pdf';
  return null;
}

function dataUrl(artifact: ArtifactSummary, data: string): string {
  return `data:${normalizedMime(artifact) || 'application/octet-stream'};base64,${data}`;
}

export function artifactDownloadToPreview(
  artifact: ArtifactSummary,
  download: ArtifactDownloadResult,
): ManagedFilePreview | null {
  if (download.artifact.id !== artifact.id) return null;
  if (download.artifact.sizeBytes !== undefined && download.artifact.sizeBytes > MAX_INLINE_ARTIFACT_BYTES) {
    return null;
  }
  if ('url' in download) {
    const kind = mediaKind(artifact);
    if (kind) return { kind, url: download.url };
    if (isHtmlArtifact(artifact)) return { kind: 'html', mode: 'interactive', url: download.url };
    return null;
  }

  const kind = mediaKind(artifact);
  if (kind) return { kind, url: dataUrl(artifact, download.data) };
  if (!isTextArtifact(artifact)) return null;
  const content = decodeBase64Utf8(download.data);
  if (isHtmlArtifact(artifact)) return { kind: 'html', mode: 'static', content, truncated: false };
  if (isMarkdownArtifact(artifact)) return { kind: 'markdown', content, truncated: false };
  if (isJsonArtifact(artifact)) return { kind: 'json', content, truncated: false };
  return { kind: 'text', content, truncated: false };
}

export function artifactDownloadUrl(artifact: ArtifactSummary, download: ArtifactDownloadResult): string | null {
  if (download.artifact.id !== artifact.id) return null;
  if ('url' in download) return download.url;
  return dataUrl(artifact, download.data);
}

export function artifactInlineLimitBytes(): number {
  return MAX_INLINE_ARTIFACT_BYTES;
}
