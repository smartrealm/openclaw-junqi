import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { useTranslation } from "react-i18next";
import { WizardScreen } from "./WizardScreen";
import { GuidedSetupScreen } from "./GuidedSetupScreen";

type OpenClawConfigurationScreenProps = {
  flow: SetupFlow;
  logs: SetupLog[];
};

export function OpenClawConfigurationScreen({
  flow,
  logs,
}: OpenClawConfigurationScreenProps) {
  const { t } = useTranslation();
  return flow.configurationMode === "classic"
    ? (
      <WizardScreen
        flow={flow}
        logs={logs}
        secondaryAction={flow.wizardRecoveryMode === "protocol-incompatible" && flow.guidedSetupAvailable
          ? {
            label: t("setup.wizard.returnToGuided", "返回官方引导"),
            onClick: flow.returnToGuidedSetup,
            disabled: flow.wizardSubmitting,
          }
          : undefined}
      />
    )
    : <GuidedSetupScreen flow={flow} logs={logs} />;
}
