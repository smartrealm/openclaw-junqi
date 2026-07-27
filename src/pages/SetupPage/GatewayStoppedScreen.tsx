// Step `gateway-stopped` — installed but Gateway not listening.
import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { OpenClawRuntimeDetails, SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { OpenClawUpdatePanel } from "@/components/shared/OpenClawUpdatePanel";
import { useSetupNavigation } from "./shared";

export function GatewayStoppedScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();
  return (
    <SetupShell
      active={3}
      title={t("setup.openclawDetectedTitle")}
      subtitle={t("setup.gatewayNotRunning")}
      logs={logs}
      previousAction={{ onClick: flow.goBack }}
      nextAction={{ label: t("setup.startingGateway"), disabled: true, loading: true, icon: "none" }}
      wide
    >
      <div className="grid gap-4">
        <StatusPanel
          icon={<Monitor size={22} />}
          eyebrow={t("setup.steps.runtime.title")}
          title={t("setup.gatewayStoppedTitle")}
          message={flow.statusMessage || t("setup.startingGateway")}
          footer={
            <button onClick={flow.requestReinstall} className="text-xs font-medium text-aegis-text-dim hover:text-aegis-text">
              {t("setup.reinstallBtn")}
            </button>
          }
        />
        <OpenClawRuntimeDetails
          status={flow.openclawStatus}
          installTarget={flow.installTarget}
          gatewayState="stopped"
        />
        {flow.openclawStatus?.installed && (
          <OpenClawUpdatePanel
            currentVersion={flow.openclawStatus.version}
            onUpdated={async () => {
              const refreshed = await flow.refreshRuntime();
              if (refreshed.gatewayRunning) {
                navigateSetup(flow.needsOnboarding ? "configure-openclaw" : "ready");
              }
            }}
          />
        )}
      </div>
    </SetupShell>
  );
}

