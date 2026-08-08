import { CheckCircle2, MessageSquare, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { WizardScreen, type WizardScreenCopy } from "./WizardScreen";

const CHANNEL_WIZARD_COPY: WizardScreenCopy = {
  titleKey: "setup.channelWizard.title",
  titleFallback: "配置消息渠道",
  subtitleKey: "setup.channelWizard.subtitle",
  subtitleFallback: "OpenClaw 将展示当前运行时支持的渠道、授权和账号路由。渠道可稍后配置，但不会被自动跳过。",
  connectingKey: "setup.channelWizard.starting",
  connectingFallback: "正在启动 OpenClaw 官方渠道配置…",
  completionVerificationKey: "setup.channelWizard.completionVerification",
  completionVerificationFallback: "OpenClaw 已结束本次渠道配置。进入工作台后可在“通道”页面查看 Gateway 返回的真实状态。",
};

export function ChannelWizardScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const deferAction = {
    label: t("setup.channelWizard.defer", "稍后配置"),
    onClick: () => { void flow.deferChannelConfiguration(); },
    disabled: flow.channelWizardSubmitting,
  };

  if (flow.channelWizardPhase === "active") {
    return (
      <WizardScreen
        flow={flow}
        logs={logs}
        wizard={{
          wizardStep: flow.channelWizardStep,
          wizardSubmitting: flow.channelWizardSubmitting,
          wizardActivity: flow.channelWizardActivity,
          wizardError: flow.channelWizardError,
          wizardRecoveryRequired: false,
          submitWizardStep: flow.submitChannelWizardStep,
          pollWizard: flow.pollChannelWizard,
          retryWizard: flow.retryChannelWizard,
          reclaimWizard: flow.retryChannelWizard,
        }}
        copy={CHANNEL_WIZARD_COPY}
        secondaryAction={deferAction}
      />
    );
  }

  if (flow.channelWizardPhase === "completed") {
    const configuredCount = flow.channelWizardConfiguredAccounts.length;
    return (
      <SetupShell
        active={flow.presentation.stage}
        title={t("setup.channelWizard.completedTitle", "渠道配置已完成")}
        subtitle={t("setup.channelWizard.completedDescription", "OpenClaw 已完成本次渠道配置。进入工作台后可在“通道”中查看真实运行状态。")}
        logs={logs}
        previousAction={{ onClick: flow.goBack }}
        nextAction={{
          label: t("setup.channelWizard.continue", "继续完成引导"),
          onClick: flow.completeChannelConfiguration,
        }}
      >
        <StatusPanel
          icon={<CheckCircle2 size={24} />}
          tone="success"
          title={configuredCount > 0
            ? t("setup.channelWizard.completedAccounts", { count: configuredCount, defaultValue: "已配置 {{count}} 个渠道账号" })
            : t("setup.channelWizard.completedNoChanges", "本次未修改渠道配置")}
          message={t("setup.channelWizard.completedStatusHint", "该结果仅来自 OpenClaw 官方渠道向导，不代表所有渠道已经连接或可用。")}
        />
      </SetupShell>
    );
  }

  const hasError = flow.channelWizardPhase === "error";
  return (
    <SetupShell
      active={flow.presentation.stage}
      title={t("setup.channelWizard.title", "配置消息渠道")}
      subtitle={t("setup.channelWizard.subtitle", "OpenClaw 将展示当前运行时支持的渠道、授权和账号路由。渠道可稍后配置，但不会被自动跳过。")}
      logs={logs}
      previousAction={{ onClick: flow.goBack, disabled: flow.channelWizardSubmitting }}
      secondaryAction={deferAction}
      nextAction={{
        label: hasError
          ? t("setup.channelWizard.retry", "重新开始")
          : t("setup.channelWizard.configure", "配置渠道"),
        onClick: () => { void (hasError ? flow.retryChannelWizard() : flow.startChannelWizard()); },
        loading: flow.channelWizardSubmitting,
      }}
    >
      <div className="space-y-4">
        <StatusPanel
          icon={hasError ? <ShieldAlert size={24} /> : <MessageSquare size={24} />}
          tone={hasError ? "danger" : "primary"}
          title={hasError
            ? t("setup.channelWizard.failed", "OpenClaw 官方渠道配置失败。")
            : t("setup.channelWizard.decisionTitle", "要连接消息渠道吗？")}
          message={hasError
            ? flow.channelWizardError || t("setup.channelWizard.failed", "OpenClaw 官方渠道配置失败。")
            : t("setup.channelWizard.decisionDescription", "此步骤使用 OpenClaw 官方渠道配置向导。可以现在配置，也可以明确选择稍后在“通道”页面配置。")}
          footer={!hasError ? (
            <p className="text-xs leading-5 text-aegis-text-muted">
              {t("setup.channelWizard.laterHint", "稍后配置不会创建渠道、账号或路由；仅结束本次引导。")}
            </p>
          ) : undefined}
        />
      </div>
    </SetupShell>
  );
}
