// Step `node-missing` — Node.js prerequisite.
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
      active={3}
      title={t("setup.nodeRequired")}
      subtitle={message}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.nodeRetry"), onClick: () => flow.retryNode(), icon: "none" }}
    >
      <div className="space-y-3">
        <StatusPanel
          icon={<Package size={22} />}
          tone="danger"
          eyebrow={t("setup.steps.install.title")}
          title={t("setup.nodeRequired")}
          message={message}
        />
        <p className="text-sm leading-6 text-aegis-text-secondary">
          {t("setup.nodeRequiredInstallHint")}
        </p>
        <a
          href="https://npmmirror.com/mirrors/node/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-sm font-medium text-aegis-primary hover:underline"
        >
          {t("setup.nodeDownload")}
        </a>
      </div>
    </SetupShell>
  );
}

