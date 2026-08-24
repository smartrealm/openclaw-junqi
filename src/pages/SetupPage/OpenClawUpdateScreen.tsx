import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SetupFlow } from '@/hooks/useSetupFlow';
import type { SetupLog } from '@/stores/app-store';
import { SetupShell } from '@/components/setup/SetupFlowPanels';
import { OpenClawUpdatePanel } from '@/components/shared/OpenClawUpdatePanel';
import {
  isOpenClawUpdateContinuationDisabled,
  type SetupUpdateCheckResult,
} from '@/hooks/useSetupFlow/setupPreflight';

const INITIAL_CHECK_RESULT: SetupUpdateCheckResult = {
  state: 'pending',
  available: null,
  managedChannelPolicy: null,
};

export function OpenClawUpdateScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const [checkResult, setCheckResult] = useState<SetupUpdateCheckResult>(INITIAL_CHECK_RESULT);
  const continuing = flow.gatewayReadyContinuation.status === 'checking';

  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t('setup.openclawUpdate.stepTitle', '检查 OpenClaw 更新')}
      subtitle={t(
        'setup.openclawUpdate.stepSubtitle',
        '已检测到本机现有 OpenClaw。完成更新检查后，再进入官方配置。',
      )}
      logs={logs}
      previousAction={{
        onClick: () => { void flow.goBack(); },
        disabled: continuing,
      }}
      nextAction={{
        label: continuing
          ? t('setup.gatewayReadyCheckingAction', '正在核验配置…')
          : t('common.next', '下一步'),
        onClick: () => { void flow.continueAfterOpenClawUpdate(); },
        disabled: continuing || isOpenClawUpdateContinuationDisabled({
          checkResult,
        }),
        loading: continuing,
        icon: 'next',
      }}
    >
      <div className="space-y-4">
        <OpenClawUpdatePanel
          autoCheck
          currentVersion={flow.openclawStatus?.version}
          onCheckResultChange={setCheckResult}
          onUpdated={async () => {
            await flow.refreshRuntime();
          }}
        />
      </div>
    </SetupShell>
  );
}
