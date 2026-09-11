import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusPanel } from '@/components/setup/SetupFlowPanels';

export function OpenClawUpdateContinuationFailure({ message }: { message: string | null }) {
  const { t } = useTranslation();
  return (
    <StatusPanel
      icon={<CircleAlert size={22} />}
      tone="danger"
      eyebrow={t('setup.gatewayReadyContinueFailedTitle', '配置核验未完成')}
      title={t('setup.openclawUpdate.continueFailedTitle', '未能进入 OpenClaw 配置')}
      message={message ?? t('setup.gatewayReadyContinueFailedTitle', '配置核验未完成')}
    />
  );
}
