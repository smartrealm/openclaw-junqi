// 引导 node-missing 状态的 Node.js 前置条件页面。
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";

export function NodeMissingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const requirement = flow.nodeRequirement ?? t("setup.nodeRequirementUnknown", "OpenClaw 所需版本");
  const message = t("setup.nodeRequiredDesc", { requirement });
  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t("setup.steps.runtime.title")}
      subtitle={t("setup.steps.runtime.description")}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.nodeRetry"), onClick: () => flow.retryNode(), icon: "none" }}
    >
      <div className="space-y-3">
        <StatusPanel
          icon={<Package size={22} />}
          tone="danger"
          eyebrow={t("setup.steps.runtime.title")}
          title={t("setup.nodeRequired")}
          message={message}
        />
        <p className="text-sm leading-6 text-aegis-text-secondary">
          {t("setup.nodeRequiredInstallHint")}
        </p>
      </div>
    </SetupShell>
  );
}
