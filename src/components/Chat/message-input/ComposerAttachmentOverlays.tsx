import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageLightbox } from '../ChatImage';
import type { useComposerAttachments } from './useComposerAttachments';

const ScreenshotPicker = lazy(() => import('../ScreenshotPicker').then((module) => ({ default: module.ScreenshotPicker })));

interface ComposerAttachmentOverlaysProps {
  controller: ReturnType<typeof useComposerAttachments>;
}

export function ComposerAttachmentOverlays({ controller }: ComposerAttachmentOverlaysProps) {
  const { t } = useTranslation();

  return (
    <>
      {controller.screenshotSessionKey && (
        <Suspense fallback={null}>
          <ScreenshotPicker
            open
            onClose={() => controller.setScreenshotSessionKey(null)}
            onCapture={controller.captureScreenshot}
          />
        </Suspense>
      )}
      {controller.lightbox && (
        <ImageLightbox
          src={controller.lightbox}
          alt={t('media.attachment')}
          onClose={() => controller.setLightbox(null)}
        />
      )}
    </>
  );
}
