import { Eye, Trash2 } from 'lucide-react';
import { Icon } from '@/components/shared/icons';
import type { PreparedAttachment } from '@/services/chat/types';
import { formatBytes } from '@/utils/format';

function attachmentIcon(mimeType: string): React.ReactNode {
  if (mimeType.startsWith('image/')) return Icon.chat.attachment.image;
  if (mimeType === 'application/pdf') return Icon.chat.attachment.pdf;
  if (mimeType.startsWith('text/csv') || mimeType.includes('spreadsheet')) return Icon.chat.attachment.sheet;
  if (mimeType.includes('wordprocessing') || mimeType.includes('msword')) return Icon.chat.attachment.document;
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return Icon.chat.attachment.document;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return Icon.chat.attachment.archive;
  if (mimeType.startsWith('audio/')) return Icon.chat.attachment.audio;
  if (mimeType.startsWith('video/')) return Icon.chat.attachment.video;
  if (mimeType.startsWith('text/')) return Icon.chat.attachment.document;
  return Icon.chat.attachment.generic;
}

interface ComposerAttachmentTrayProps {
  files: PreparedAttachment[];
  onPreview: (url: string) => void;
  onRemove: (index: number) => void;
}

export function ComposerAttachmentTray({ files, onPreview, onRemove }: ComposerAttachmentTrayProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pt-3 scrollbar-hidden">
      {files.map((file, index) => (
        <div
          key={file.id}
          className="group relative size-[72px] shrink-0 overflow-hidden rounded-lg border border-aegis-border/40 bg-aegis-surface"
        >
          {file.isImage && file.preview ? (
            <>
              <img src={file.preview} alt={file.fileName} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => onPreview(file.preview as string)}
                className="absolute inset-0 z-[5] flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20"
              >
                <Eye size={16} className="text-white opacity-0 drop-shadow-lg transition-opacity group-hover:opacity-90" />
              </button>
            </>
          ) : (
            <div className="flex size-full flex-col items-center justify-center p-1">
              <span className="text-xl">{attachmentIcon(file.mimeType)}</span>
              <span className="mt-0.5 w-full truncate text-center text-[8px] text-aegis-text-dim">{file.fileName}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="absolute right-0.5 top-0.5 z-10 grid size-5 place-items-center rounded-full bg-aegis-danger/85 opacity-0 transition-opacity hover:bg-aegis-danger group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 size={10} className="text-white" />
          </button>
          <div className="absolute inset-x-0 bottom-0 bg-aegis-bg-solid/80 py-0.5 text-center text-[7px] text-aegis-text">
            {formatBytes(file.size)}
          </div>
        </div>
      ))}
    </div>
  );
}
