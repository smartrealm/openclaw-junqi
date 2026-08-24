// checking、install-* 与 error 状态呈现安装进度和失败诊断。
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import { setupBackPolicy } from "@/hooks/useSetupFlow/helpers";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { gatewayReadyPrimaryActionKind } from "@/hooks/useSetupFlow/setupPreflight";
import { InstallationConsole, currentStepOf, installStepTitle, SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { GatewayAiDiagnosticDisclosure } from "@/components/GatewayAiDiagnosticDisclosure";

export function ProgressScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const { setupStep, setupError } = useAppStore();
  const isInstalling = setupBackPolicy(setupStep) === "cancel-install";
  const isGatewayReady = setupStep === "gateway-ready";
  const gatewayContinuation = flow.gatewayReadyContinuation;
  const gatewayReadyActionKind = gatewayReadyPrimaryActionKind(
    flow.installMode,
    flow.installTarget?.tier ?? null,
  );
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
  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t("setup.settingUp")}
      subtitle={t("setup.subtitle")}
      logs={logs}
      wide
      showLogToggle={false}
      previousAction={setupStep === "error" ? {
        onClick: () => flow.goBack(),
        disabled: flow.repairing,
      } : isInstalling ? {
        label: t("setup.cancelInstall", "取消安装"),
        onClick: () => { void flow.cancelSetupRun(); },
      } : isGatewayReady ? {
        onClick: () => { void flow.goBack(); },
        disabled: gatewayContinuation.status === "checking",
      } : undefined}
      secondaryAction={canRepairGateway ? {
        label: t("setup.retryDirectly", "直接重试"),
        onClick: () => { void flow.retryGateway(); },
        disabled: flow.repairing,
      } : undefined}
      nextAction={
        hasBrokenPlugins
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
            : isGatewayReady
              ? {
                  label: gatewayContinuation.status === "checking"
                    ? t("setup.gatewayReadyCheckingAction", "正在核验配置…")
                    : gatewayContinuation.status === "failed"
                      ? t("setup.gatewayReadyRetryAction", "重新核验")
                      : gatewayReadyActionKind === "next"
                        ? t("common.next", "下一步")
                        : t("setup.gatewayReadyCheckAction", "核验配置"),
                  onClick: () => { void flow.continueAfterGatewayReady(); },
                  disabled: gatewayContinuation.status === "checking",
                  loading: gatewayContinuation.status === "checking",
                  icon: gatewayReadyActionKind === "next" ? "next" : "none",
                }
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
