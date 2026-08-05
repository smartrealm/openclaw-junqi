import { FilePreviewSurface } from './FilePreviewSurface';
import { managedFilePreviewContent } from '@/file-preview/content';
import type { ManagedFilePreview as ManagedFilePreviewValue } from '@/utils/filePreviewCapabilities';

export interface ManagedFilePreviewProps {
  preview: ManagedFilePreviewValue;
  fileName: string;
  compact?: boolean;
  onOpenExternal?: () => void;
  onOpenLocalLink?: (href: string) => void | Promise<void>;
  resolveMarkdownImage?: (source: string) => Promise<string | null>;
}

export function ManagedFilePreview({
  preview,
  fileName,
  compact = false,
  onOpenExternal,
  onOpenLocalLink,
  resolveMarkdownImage,
}: ManagedFilePreviewProps) {
  return (
    <FilePreviewSurface
      content={managedFilePreviewContent(preview)}
      fileName={fileName}
      compact={compact}
      onOpenExternal={onOpenExternal}
      onOpenLocalLink={onOpenLocalLink}
      resolveMarkdownImage={resolveMarkdownImage}
    />
  );
}
