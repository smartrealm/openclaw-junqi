// Stable result page for step 2. Returning here never replays detection.
import { CheckCircle2, Container, Monitor, RefreshCw, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";

export function EnvironmentReviewScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const nativeReady = flow.openclawStatus?.installed === true && !flow.openclawStatus.relocation_required;
  const dockerInstalled = flow.dockerStatus?.available === true;
  const dockerReady = dockerInstalled && flow.dockerStatus?.daemon_running === true;
  const selectedRuntimeReady = flow.installMode === "docker" ? dockerReady : nativeReady;

  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t("setup.runtimeTitle")}
      subtitle={t("setup.runtimeSubtitle")}
      logs={logs}
      previousAction={{ onClick: flow.goBack, disabled: flow.checkingDocker }}
      secondaryAction={{
        label: flow.checkingDocker
          ? t("setup.recheckingEnvironment", "正在重新检测…")
          : t("setup.recheckEnvironment", "重新检测"),
        onClick: flow.redetectEnvironment,
        loading: flow.checkingDocker,
      }}
      nextAction={{
        label: t("setup.nextStep", "下一步"),
        onClick: flow.continueAfterEnvironmentReview,
        disabled: flow.checkingDocker,
      }}
    >
      <div className="grid gap-4">
        <StatusPanel
          icon={flow.checkingDocker
            ? <RefreshCw size={22} className="animate-spin" />
            : <CheckCircle2 size={22} />}
          tone={flow.checkingDocker ? undefined : "success"}
          eyebrow={t("setup.steps.environment.title", "环境")}
          title={flow.checkingDocker
            ? t("setup.recheckingEnvironment", "正在重新检测…")
            : t("setup.environmentReviewReady", "环境检测完成")}
          message={flow.checkingDocker
            ? t("setup.recheckingEnvironmentHint", "正在刷新 OpenClaw、Gateway 和 Docker 状态，请稍候。")
            : t("setup.environmentReviewHint", "请确认检测结果。下一步将选择 OpenClaw 数据位置；返回此页面不会重新执行检测。")}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <EnvironmentItem
            icon={<Server size={18} />}
            label={t("setup.selectedRuntime", "当前运行方式")}
            value={flow.installMode === "docker" ? t("setup.modeDocker") : t("setup.modeNative")}
            ready={selectedRuntimeReady}
          />
          <EnvironmentItem
            icon={<Monitor size={18} />}
            label={t("setup.modeNative")}
            value={nativeReady
              ? t("setup.environmentAvailable", "可用")
              : t("setup.environmentNeedsPreparation", "需要准备")}
            ready={nativeReady}
          />
          <EnvironmentItem
            icon={flow.checkingDocker ? <RefreshCw size={18} className="animate-spin" /> : <Container size={18} />}
            label={t("setup.dockerDesktop", "Docker Desktop")}
            value={flow.checkingDocker
              ? t("setup.checkingDocker")
              : dockerReady
                ? t("setup.dockerRunning", "运行中，可使用")
                : dockerInstalled
                  ? t("setup.dockerInstalledStopped", "已安装，尚未运行")
                  : t("setup.dockerNotDetected", "未检测到 Docker")}
            ready={dockerReady}
          />
        </div>
      </div>
    </SetupShell>
  );
}

function EnvironmentItem({
  icon,
  label,
  value,
  ready,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-lg border border-aegis-border bg-aegis-surface/45 p-4">
      <div className="flex items-center gap-2 text-aegis-primary">{icon}<span className="text-sm font-semibold text-aegis-text">{label}</span></div>
      <div className={ready ? "mt-3 text-sm font-medium text-aegis-success" : "mt-3 text-sm font-medium text-aegis-text-muted"}>{value}</div>
    </div>
  );
}
