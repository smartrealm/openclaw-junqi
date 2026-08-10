import { useCallback, useEffect, useState, type ClipboardEvent, type DragEvent, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/components/shared/AlertDialog';
import {
  assertAttachmentSize,
  createPreparedAttachment,
  validatePreparedAttachments,
} from '@/services/chat/attachments';
import type { PreparedAttachment } from '@/services/chat/types';
import { useChatStore } from '@/stores/chatStore';
import { debugError } from '@/utils/debugLog';
import { desktopFileRuntime } from '@/runtime/desktopFileRuntime';
import { gateway } from '@/services/gateway';
import { useAttachmentErrorMessage } from './useAttachmentErrorMessage';

const EMPTY_PATHS: string[] = [];
const EMPTY_ATTACHMENTS: PreparedAttachment[] = [];

export function useComposerAttachments(
  activeSessionKey: string,
  textareaRef: RefObject<HTMLTextAreaElement>,
) {
  const { t } = useTranslation();
  const attachmentErrorMessage = useAttachmentErrorMessage();
  const files = useChatStore(
    (state) => state.preparedAttachments[activeSessionKey] ?? EMPTY_ATTACHMENTS,
  );
  const draftPaths = useChatStore(
    (state) => state.draftAttachments[activeSessionKey] ?? EMPTY_PATHS,
  );
  const [screenshotSessionKey, setScreenshotSessionKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const updateSessionFiles = useCallback((
    sessionKey: string,
    next: SetStateAction<PreparedAttachment[]>,
  ) => {
    const state = useChatStore.getState();
    const current = state.preparedAttachments[sessionKey] ?? [];
    const resolved = typeof next === 'function' ? next(current) : next;
    validatePreparedAttachments(resolved, gateway.getAttachmentPolicy());
    state.setPreparedAttachments(sessionKey, resolved);
  }, []);

  const setFiles = useCallback((next: SetStateAction<PreparedAttachment[]>) => {
    updateSessionFiles(activeSessionKey, next);
  }, [activeSessionKey, updateSessionFiles]);

  const reportError = useCallback((error: unknown) => {
    debugError('media', '[Attachments] Unable to prepare attachment:', error);
    showAlert(
      t('input.attachmentErrorTitle'),
      attachmentErrorMessage(error),
      'error',
    );
  }, [attachmentErrorMessage, t]);

  useEffect(() => {
    if (draftPaths.length === 0) return;
    const sessionKey = activeSessionKey;
    const paths = [...draftPaths];
    useChatStore.getState().setDraftAttachments(sessionKey, []);
    void Promise.all(paths.map(async (path) => {
      const file = await desktopFileRuntime.readAttachment(path, gateway.getAttachmentPolicy());
      return createPreparedAttachment({
        fileName: file.name,
        mimeType: file.mimeType,
        base64: file.base64,
        size: file.size,
        preview: file.isImage ? `data:${file.mimeType};base64,${file.base64}` : undefined,
        sourcePath: path,
      });
    })).then((additions) => {
      updateSessionFiles(sessionKey, (current) => {
        const seen = new Set(current.map((file) => file.sourcePath || file.id));
        return [...current, ...additions.filter((file) => !seen.has(file.sourcePath || file.id))];
      });
    }).catch(reportError);
  }, [activeSessionKey, draftPaths, reportError, t, updateSessionFiles]);

  const selectFiles = useCallback(async () => {
    const sessionKey = activeSessionKey;
    try {
      const paths = await desktopFileRuntime.selectFiles();
      if (!paths.length) return;
      const additions = await Promise.all(paths.map(async (filePath) => {
        const file = await desktopFileRuntime.readAttachment(filePath, gateway.getAttachmentPolicy());
        return createPreparedAttachment({
          fileName: file.name,
          mimeType: file.mimeType,
          base64: file.base64,
          size: file.size,
          preview: file.isImage ? `data:${file.mimeType};base64,${file.base64}` : undefined,
          sourcePath: filePath,
        });
      }));
      updateSessionFiles(sessionKey, (current) => [...current, ...additions]);
    } catch (error) {
      reportError(error);
    }
  }, [activeSessionKey, reportError, t, updateSessionFiles]);

  const captureScreenshot = useCallback((dataUrl: string) => {
    const sessionKey = screenshotSessionKey;
    if (!sessionKey) return;
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    try {
      updateSessionFiles(sessionKey, (current) => [...current, createPreparedAttachment({
        fileName: `screenshot-${Date.now()}.png`,
        base64,
        mimeType: 'image/png',
        size: Math.floor(base64.length * 0.75),
        preview: dataUrl,
      })]);
      textareaRef.current?.focus();
    } catch (error) {
      reportError(error);
    }
  }, [reportError, screenshotSessionKey, textareaRef, updateSessionFiles]);

  const paste = useCallback((event: ClipboardEvent) => {
    const item = Array.from(event.clipboardData?.items ?? [])
      .find((candidate) => candidate.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    const blob = item.getAsFile();
    if (!blob) return;
    const sessionKey = activeSessionKey;
    try {
      assertAttachmentSize({
        size: blob.size,
        isImage: true,
        fileName: blob.name || t('input.clipboardImageName'),
      }, gateway.getAttachmentPolicy());
    } catch (error) {
      reportError(error);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof reader.result !== 'string') throw new Error(t('input.clipboardImageReadFailed'));
        const dataUrl = reader.result;
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        updateSessionFiles(sessionKey, (current) => [...current, createPreparedAttachment({
          fileName: t('input.clipboardImageName'),
          base64,
          mimeType: blob.type || 'image/png',
          size: blob.size,
          preview: dataUrl,
        })]);
      } catch (error) {
        reportError(error);
      }
    };
    reader.onerror = () => reportError(reader.error ?? new Error(t('input.clipboardImageReadFailed')));
    reader.readAsDataURL(blob);
  }, [activeSessionKey, reportError, t, updateSessionFiles]);

  const drop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const sessionKey = activeSessionKey;
    for (const file of Array.from(event.dataTransfer.files)) {
      const sourcePath = (file as File & { path?: string }).path;
      try {
        assertAttachmentSize({
          size: file.size,
          isImage: file.type.startsWith('image/'),
          fileName: file.name,
        }, gateway.getAttachmentPolicy());
      } catch (error) {
        reportError(error);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (typeof reader.result !== 'string') throw new Error(t('input.attachmentReadFailed', { path: file.name }));
          const dataUrl = reader.result;
          const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
          updateSessionFiles(sessionKey, (current) => [...current, createPreparedAttachment({
            fileName: file.name,
            base64,
            mimeType: file.type || undefined,
            size: file.size,
            preview: file.type.startsWith('image/') ? dataUrl : undefined,
            sourcePath,
          })]);
        } catch (error) {
          reportError(error);
        }
      };
      reader.onerror = () => reportError(reader.error ?? new Error(t('input.attachmentReadFailed', { path: file.name })));
      reader.readAsDataURL(file);
    }
  }, [activeSessionKey, reportError, t, updateSessionFiles]);

  return {
    files,
    setFiles,
    reportError,
    screenshotSessionKey,
    setScreenshotSessionKey,
    captureScreenshot,
    lightbox,
    setLightbox,
    selectFiles,
    paste,
    drop,
    removeFile: (index: number) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index)),
  };
}
