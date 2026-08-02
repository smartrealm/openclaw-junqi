import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBusinessGuideActivation } from '@/hooks/useBusinessGuideActivation';
import { useBusinessGuideStore } from '@/stores/businessGuideStore';
import { WorkspaceChromeIconButton } from '@/components/Layout/WorkspaceChrome';

/** The global recovery entry sits immediately before the notification control. */
export function BusinessGuideTrigger() {
  const { t } = useTranslation();
  const active = useBusinessGuideActivation();
  const openTour = useBusinessGuideStore((state) => state.openTour);

  if (!active) return null;

  return (
    <WorkspaceChromeIconButton
      label={t('businessGuide.reopen')}
      onClick={() => openTour()}
    >
      <Compass size={16} />
    </WorkspaceChromeIconButton>
  );
}
