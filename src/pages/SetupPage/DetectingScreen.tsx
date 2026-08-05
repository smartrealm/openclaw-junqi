// Step `detecting` — runtime and Gateway probe.
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";

export function DetectingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t("setup.runtimeTitle")}
      subtitle={t("setup.runtimeSubtitle")}
      logs={logs}
      previousAction={{ onClick: flow.goBack }}
      nextAction={{ label: flow.statusMessage || t("setup.detecting"), disabled: true, loading: true, icon: "none" }}
    >
      <StatusPanel
        icon={<RefreshCw size={22} className="animate-spin" />}
        eyebrow={t("setup.steps.runtime.title")}
        title={t("setup.detecting")}
        message={flow.statusMessage || t("setup.runtimeSubtitle")}
      />
    </SetupShell>
  );
}
