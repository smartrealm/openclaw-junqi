import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
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
  return flow.configurationMode === "classic"
    ? <WizardScreen flow={flow} logs={logs} />
    : <GuidedSetupScreen flow={flow} logs={logs} />;
}
