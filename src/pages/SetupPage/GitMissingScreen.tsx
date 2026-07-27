// Step `git-missing` — Git prerequisite.
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";

export function GitMissingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const isMac = window.aegis?.platform === "darwin";
  const description = isMac
    ? t("setup.gitMacRequiredDesc", "Apple 命令行工具安装器已打开。完成系统安装后重新检测 Git。")
    : t("setup.gitRequiredDesc");
  return (
    <SetupShell
      active={3}
      title={t("setup.gitRequired")}
      subtitle={description}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.gitRetry"), onClick: () => flow.retryGit(), icon: "none" }}
    >
      <StatusPanel
        icon={<Package size={22} />}
        tone="danger"
        eyebrow={t("setup.steps.install.title")}
        title={t("setup.gitRequired")}
        message={description}
      />
    </SetupShell>
  );
}

