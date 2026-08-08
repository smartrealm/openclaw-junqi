// Steps `checking`/`install-*`/`gateway-ready`/`error` — install progress.
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import { setupBackPolicy } from "@/hooks/useSetupFlow/helpers";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { InstallationConsole, currentStepOf, installStepTitle, type InstallationConsoleSummary, SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { GatewayAiDiagnosticDisclosure } from "@/components/GatewayAiDiagnosticDisclosure";

export function ProgressScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const { setupStep, setupError } = useAppStore();
  const isGatewayReady = setupStep === "gateway-ready";
  const gatewayReadyChecking = isGatewayReady && flow.gatewayReadyContinuation.status === "checking";
  const gatewayReadyError = isGatewayReady && flow.gatewayReadyContinuation.status === "failed"
    ? flow.gatewayReadyContinuation.error
    : null;
  const installationSummary: InstallationConsoleSummary = gatewayReadyChecking
    ? { kind: "model-checking" }
    : gatewayReadyError
      ? { kind: "model-check-failed", message: gatewayReadyError }
      : isGatewayReady
        ? { kind: "gateway-ready" }
        : { kind: "installation" };
  const isInstalling = setupBackPolicy(setupStep) === "cancel-install";
  const currentInstallStep = currentStepOf(flow.steps);
  const diagnosticLogs = logs
    .slice(-500)
    .map((log) => `[${log.source}] ${log.message}`)
    .join("\n");
  const canRepairGateway = setupStep === "error" && currentInstallStep?.id === "gateway";
  // BUG-CPI-07：自愈梯子（更新→重装）已确认这些插件不可自动修复，
  // 主操作降级为"临时禁用并启动"。
  const hasBrokenPlugins = setupStep === "error" && flow.brokenPlugins.length > 0;
  const currentInstallTitle = installStepTitle(currentInstallStep, t) ?? t("setup.settingUp");
  const runningStepLabel = t("setup.installPanel.runningStep", {
    step: currentInstallTitle,
    defaultValue: "正在执行：{{step}}",
  });
  const gatewayCheckpointTitle = gatewayReadyChecking
    ? t("setup.gatewayReadyCheckingTitle", "正在检查 OpenClaw 配置")
    : gatewayReadyError
      ? t("setup.gatewayReadyContinueFailedTitle", "无法进入下一步")
      : t("setup.gatewayConnected", "Gateway 已就绪");
  const gatewayCheckpointSubtitle = gatewayReadyChecking
    ? t(
        "setup.gatewayReadyCheckingDescription",
        "正在验证当前模型是否可用；完成后将进入官方配置向导或完成页。",
      )
    : gatewayReadyError ?? t("setup.gatewayReadySubtitle", "运行时检查已完成，下一步将核验 OpenClaw 配置。");

  return (
    <SetupShell
      active={flow.presentation.stage}
      activeComplete={isGatewayReady}
      eyebrow={isGatewayReady
        ? t("setup.stageEyebrow", {
            step: flow.presentation.stage + 1,
            title: t("setup.steps.runtime.title"),
          })
        : undefined}
      title={setupStep === "ready" ? t("setup.ready") : isGatewayReady ? gatewayCheckpointTitle : t("setup.settingUp")}
      subtitle={setupStep === "ready" ? t("setup.readySubtitle") : isGatewayReady ? gatewayCheckpointSubtitle : t("setup.subtitle")}
      logs={logs}
      wide
      showLogToggle={false}
      previousAction={setupStep === "error" || isGatewayReady ? {
        onClick: () => flow.goBack(),
        disabled: flow.repairing || gatewayReadyChecking,
      } : isInstalling ? {
        label: t("setup.cancelInstall", "取消安装"),
        onClick: () => { void flow.cancelSetupRun(); },
      } : undefined}
      secondaryAction={canRepairGateway ? {
        label: t("setup.retryDirectly", "直接重试"),
        onClick: () => { void flow.retryGateway(); },
        disabled: flow.repairing,
      } : undefined}
      nextAction={
        setupStep === "ready"
          ? { label: t("setup.enterDashboard"), onClick: (event) => flow.enterDashboard(event.currentTarget) }
          : isGatewayReady
            ? {
                label: gatewayReadyChecking
                  ? t("setup.gatewayReadyCheckingAction", "正在检查配置…")
                  : t("setup.nextStep", "下一步"),
                onClick: () => { void flow.continueAfterGatewayReady(); },
                disabled: gatewayReadyChecking,
                loading: gatewayReadyChecking,
                icon: gatewayReadyChecking ? "none" : "next",
              }
          : hasBrokenPlugins
            ? {
                label: flow.repairing
                  ? t("setup.pluginDisablingBtn", "正在禁用插件…")
                  : t("setup.disablePluginsAndStart", "临时禁用插件并启动"),
                onClick: () => { void flow.disablePluginsAndRetry(); },
                loading: flow.repairing,
                icon: "none",
              }
          : canRepairGateway
            ? {
                label: flow.repairing
                  ? t("setup.repairing", "正在修复…")
                  : t("setup.repairAndRetry", "自动修复并重试"),
                onClick: () => { void flow.repairAndRetry(); },
                loading: flow.repairing,
                icon: "none",
              }
          : setupStep === "error"
            ? { label: t("setup.retry"), onClick: () => { void flow.retrySetup(); }, icon: "none" }
            : { label: runningStepLabel, disabled: true, loading: true, icon: "none" }
      }
    >
      {hasBrokenPlugins && (
        <div className="mb-3 space-y-2">
          <StatusPanel
            icon={<Package size={22} />}
            tone="danger"
            eyebrow={t("setup.pluginRecovery.eyebrow", "插件问题")}
            title={t("setup.pluginRecovery.title", "插件阻止了 Gateway 启动")}
            message={t(
              "setup.pluginRecovery.desc",
              "以下插件无法自动修复（已尝试更新与重装）。临时禁用后即可继续启动，不影响其他功能；插件发布修复版本后可在设置中重新启用。",
            )}
          />
          <ul className="space-y-1 rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2 text-sm">
            {flow.brokenPlugins.map((plugin) => (
              <li key={plugin.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-aegis-text">{plugin.id}</span>
                {plugin.version && (
                  <span className="text-xs text-aegis-text-dim">v{plugin.version}</span>
                )}
                {plugin.detail && (
                  <span className="text-xs text-aegis-text-dim" dir="ltr">{plugin.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <InstallationConsole
        flow={flow}
        logs={logs}
        setupStep={setupStep}
        summary={installationSummary}
      />
      {setupStep === "error" && (
        <GatewayAiDiagnosticDisclosure
          className="mt-3"
          error={setupError || currentInstallStep?.detail || t("setup.installPanel.errorHint")}
          logs={diagnosticLogs}
        />
      )}
    </SetupShell>
  );
}
