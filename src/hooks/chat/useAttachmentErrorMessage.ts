import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AttachmentValidationError } from '@/services/chat/attachments';
import { DesktopAttachmentReadError } from '@/runtime/desktopFileRuntime';
import { formatBytes } from '@/utils/format';

export function useAttachmentErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback((error: unknown) => {
    if (error instanceof AttachmentValidationError) {
      if (error.code === 'POLICY_UNAVAILABLE') return t('input.attachmentPolicyUnavailable');
      if (error.code === 'EMPTY_CONTENT') {
        return t('input.attachmentEmpty', {
          name: error.details.fileName ?? t('input.attachmentUnknownName'),
        });
      }
      return t('input.attachmentTooLarge', {
        name: error.details.fileName ?? t('input.attachmentUnknownName'),
        limit: formatBytes(error.details.maxBytes ?? 0),
      });
    }
    if (error instanceof DesktopAttachmentReadError) {
      return t('input.attachmentReadFailed', { path: error.path });
    }
    return error instanceof Error ? error.message : String(error);
  }, [t]);
}
