import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { WizardScreen } from "./WizardScreen";
import { GuidedSetupScreen } from "./GuidedSetupScreen";

type VerificationFlow = Pick<
  SetupFlow,
  | "presentation"
  | "gatewayReadyContinuation"
  | "goBack"
  | "continueAfterGatewayReady"
>;
type OpenClawConfigurationScreenProps =
  | { flow: VerificationFlow; logs: SetupLog[]; phase: "verification" }
  | { flow: SetupFlow; logs: SetupLog[]; phase: "wizard" };

export function OpenClawConfigurationScreen({
  flow,
  logs,
  phase,
}: OpenClawConfigurationScreenProps) {
  if (phase === "wizard") {
    return flow.configurationMode === "classic"
      ? <WizardScreen flow={flow} logs={logs} />
      : <GuidedSetupScreen flow={flow} logs={logs} />;
  }

  return <ConfigurationVerificationScreen flow={flow} logs={logs} />;
}

function ConfigurationVerificationScreen({ flow, logs }: { flow: VerificationFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const continuation = flow.gatewayReadyContinuation;
  const checking = continuation.status === "checking";
  const checkpoint = checking
    ? {
        icon: <LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" />,
        tone: "primary" as const,
        title: t("setup.gatewayReadyCheckingTitle"),
        message: t("setup.gatewayReadyCheckingDescription"),
      }
    : continuation.status === "failed"
      ? {
          icon: <CircleAlert size={22} />,
          tone: "danger" as const,
          title: t("setup.gatewayReadyContinueFailedTitle"),
          message: continuation.error,
        }
      : {
          icon: <CheckCircle2 size={22} />,
          tone: "success" as const,
          title: t("setup.gatewayConnected"),
          message: t("setup.gatewayReadySubtitle"),
        };

  return (
    <SetupShell
      active={flow.presentation.stage}
      contentIdentity={`verification:${continuation.status}`}
      title={t("setup.wizard.title")}
      subtitle={t("setup.wizard.subtitle")}
      logs={logs}
      previousAction={{
        onClick: () => { void flow.goBack(); },
        disabled: checking,
      }}
      nextAction={{
        label: checking
          ? t("setup.gatewayReadyCheckingAction")
          : continuation.status === "failed"
            ? t("setup.gatewayReadyRetryAction")
            : t("setup.gatewayReadyCheckAction"),
        onClick: () => { void flow.continueAfterGatewayReady(); },
        disabled: checking,
        loading: checking,
        icon: checking ? "none" : "next",
      }}
    >
      <StatusPanel
        icon={checkpoint.icon}
        tone={checkpoint.tone}
        eyebrow={t("setup.gatewayReadyTitle", "运行时已就绪")}
        title={checkpoint.title}
        message={checkpoint.message}
      />
    </SetupShell>
  );
}
