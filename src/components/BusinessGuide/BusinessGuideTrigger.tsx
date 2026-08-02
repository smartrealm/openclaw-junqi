import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { useBusinessGuideStore } from '@/stores/businessGuideStore';
import { WorkspaceChromeIconButton } from '@/components/Layout/WorkspaceChrome';

export function BusinessGuideTrigger() {
  const { t } = useTranslation();
  const setupComplete = useAppStore((state) => state.setupComplete);
  const openTour = useBusinessGuideStore((state) => state.openTour);

  if (setupComplete !== true) return null;

  return (
    <WorkspaceChromeIconButton
      onClick={openTour}
      label={t('businessGuide.reopen', '显示开始使用引导')}
    >
      <Compass size={16} />
    </WorkspaceChromeIconButton>
  );
}
