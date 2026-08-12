import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SetupLog } from '@/stores/app-store';
import type { SetupFlow } from '@/hooks/useSetupFlow';
import { OpenClawRuntimeDetails, SetupShell, StatusPanel } from '@/components/setup/SetupFlowPanels';
import { OpenClawUpdatePanel } from '@/components/shared/OpenClawUpdatePanel';
import { useSetupNavigation } from './shared';

/** Gateway 启动属于可取消执行，不把未完成的启动描述为已停止状态。 */
export function GatewayStartingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();
  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t('setup.steps.runtime.title')}
      subtitle={t('setup.steps.runtime.description')}
      logs={logs}
      previousAction={{
        label: t('setup.cancelInstall'),
        onClick: () => { void flow.goBack(); },
      }}
      wide
    >
      <div className="grid gap-4">
        <StatusPanel
          icon={<LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" />}
          eyebrow={t('setup.steps.runtime.title')}
          title={t('setup.startingGateway')}
          message={flow.statusMessage || t('setup.gatewayStartingHint')}
          footer={(
            <button
              type="button"
              onClick={flow.requestReinstall}
              className="text-xs font-medium text-aegis-text-dim hover:text-aegis-text"
            >
              {t('setup.reinstallBtn')}
            </button>
          )}
        />
        <OpenClawRuntimeDetails
          status={flow.openclawStatus}
          installTarget={flow.installTarget}
          gatewayState="starting"
        />
        {flow.openclawStatus?.installed && (
          <OpenClawUpdatePanel
            currentVersion={flow.openclawStatus.version}
            onUpdated={async () => {
              const refreshed = await flow.refreshRuntime();
              if (refreshed.gatewayRunning) {
                navigateSetup(refreshed.needsOnboarding ? 'configure-openclaw' : 'ready');
              }
            }}
          />
        )}
      </div>
    </SetupShell>
  );
}
