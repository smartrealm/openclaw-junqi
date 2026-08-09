// OpenClaw 官方向导步骤的容器层。
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell } from "@/components/setup/SetupFlowPanels";
import clsx from "clsx";
import {
  isOpenClawWizardCompletionStep,
  isOpenClawWizardNonBlockingProbeFailure,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { isWizardBodyMessageStep, WizardStepRenderer } from "./wizard/WizardStepRenderer";
import { wizardValuesEqual } from "./wizard/WizardStepValue";

export { WizardAuthorizationHint } from "./wizard/WizardAuthorizationHint";

export function wizardInitialValue(step: OpenClawWizardStep): unknown {
  if (step.type === "confirm") return Boolean(step.initialValue);
  if (step.type === "multiselect") return Array.isArray(step.initialValue) ? step.initialValue : [];
  if (step.type === "select") {
    const options = Array.isArray(step.options) ? step.options : [];
    return options.some((option) => wizardValuesEqual(option.value, step.initialValue))
      ? step.initialValue
      : options[0]?.value;
  }
  if (step.type === "text") return typeof step.initialValue === "string" ? step.initialValue : "";
  if (step.type === "action") return true;
  return undefined;
}

type WizardController = Pick<SetupFlow,
  | "wizardStep"
  | "wizardSubmitting"
  | "wizardActivity"
  | "wizardError"
  | "wizardRecoveryRequired"
  | "submitWizardStep"
  | "pollWizard"
  | "retryWizard"
  | "reclaimWizard"
>;

export type WizardScreenCopy = {
  titleKey: string;
  titleFallback: string;
  subtitleKey: string;
  subtitleFallback: string;
  connectingKey: string;
  connectingFallback: string;
  completionVerificationKey: string;
  completionVerificationFallback: string;
};

const DEFAULT_WIZARD_COPY: WizardScreenCopy = {
  titleKey: "setup.wizard.title",
  titleFallback: "配置 OpenClaw",
  subtitleKey: "setup.wizard.subtitle",
  subtitleFallback: "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。",
  connectingKey: "setup.wizard.connecting",
  connectingFallback: "正在连接 OpenClaw 官方配置向导…",
  completionVerificationKey: "setup.wizard.completionVerification",
  completionVerificationFallback: "OpenClaw 向导已结束。点击完成后，JunQi 仍会验证当前 Gateway 连接和所选模型；验证未通过时不会进入工作台。",
};

export function WizardScreen({
  flow,
  logs,
  wizard = flow,
  copy = DEFAULT_WIZARD_COPY,
  secondaryAction,
}: {
  flow: SetupFlow;
  logs: SetupLog[];
  wizard?: WizardController;
  copy?: WizardScreenCopy;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const { t } = useTranslation();
  const step = wizard.wizardStep;
  const [value, setValue] = useState<unknown>(() => step ? wizardInitialValue(step) : undefined);
  const autoPolledProgressStepRef = useRef<string | null>(null);
  const autoPollProgress = step?.type === "progress" && step.executor === "gateway";

  useEffect(() => {
    setValue(step ? wizardInitialValue(step) : undefined);
  }, [step?.id]);

  useEffect(() => {
    if (
      !step
      || !autoPollProgress
      || wizard.wizardSubmitting
      || wizard.wizardError
      || autoPolledProgressStepRef.current === step.id
    ) return;
    autoPolledProgressStepRef.current = step.id;
    void wizard.pollWizard();
  }, [autoPollProgress, step, wizard]);

  if (!step) {
    return (
      <SetupShell
        active={flow.presentation.stage}
        title={t(copy.titleKey, copy.titleFallback)}
        subtitle={t(copy.connectingKey, copy.connectingFallback)}
        logs={logs}
        previousAction={{ onClick: flow.goBack, disabled: wizard.wizardSubmitting }}
        secondaryAction={secondaryAction}
        nextAction={{
          label: wizard.wizardRecoveryRequired
            ? t("setup.wizard.reclaim", "重新接管向导")
            : wizard.wizardError ? t("setup.wizard.retry", "重试") : t("setup.wizard.connectingAction", "正在连接"),
          onClick: () => void (wizard.wizardRecoveryRequired ? wizard.reclaimWizard() : wizard.retryWizard()),
          disabled: wizard.wizardSubmitting && !wizard.wizardError,
          loading: wizard.wizardSubmitting,
          icon: "none",
        }}
      >
        <div className={clsx("rounded-lg border p-4 text-sm leading-6", wizard.wizardError ? "border-red-500/25 bg-red-500/5 text-red-300" : "border-aegis-primary/25 bg-aegis-primary/5 text-aegis-text-secondary")}>
          {wizard.wizardError || wizard.wizardActivity || t(copy.connectingKey, copy.connectingFallback)}
        </div>
      </SetupShell>
    );
  }

  // 向导内容与分支均由 Gateway 定义，容器仅选择已支持的协议类型渲染器。
  const presentedStep = step;
  const options = Array.isArray(presentedStep.options) ? presentedStep.options : [];
  const blocked = (step.type === "select" || step.type === "multiselect")
    && options.length === 0;
  const messageRenderedInBody = isWizardBodyMessageStep(presentedStep.type);
  const wizardTitle = presentedStep.title || t(copy.titleKey, copy.titleFallback);
  const wizardSubtitle = messageRenderedInBody
    ? t(copy.subtitleKey, copy.subtitleFallback)
    : presentedStep.message || t(copy.subtitleKey, copy.subtitleFallback);
  const completionStep = isOpenClawWizardCompletionStep(presentedStep);
  const nonBlockingProbeFailure = isOpenClawWizardNonBlockingProbeFailure(presentedStep);
  const submitCurrentStep = async () => {
    await wizard.submitWizardStep(step.id, value);
  };

  return (
    <SetupShell
      active={flow.presentation.stage}
      title={wizardTitle}
      subtitle={wizardSubtitle}
      logs={logs}
      previousAction={{
        label: t("setup.wizard.pauseAndReturn", "暂停并返回"),
        onClick: flow.goBack,
        disabled: wizard.wizardSubmitting,
      }}
      secondaryAction={secondaryAction}
      nextAction={{
        label: wizard.wizardError
          ? t("setup.wizard.retry", "重试")
          : completionStep
            ? t("setup.wizard.finish", "完成")
          : autoPollProgress
            ? t("setup.wizard.processing", "正在处理…")
            : step.type === "action" ? t("setup.wizard.run", "执行") : t("setup.nextStep", "下一步"),
        onClick: () => {
          if (wizard.wizardError) {
            void wizard.retryWizard();
            return;
          }
          void submitCurrentStep();
        },
        disabled: wizard.wizardSubmitting || autoPollProgress || (!wizard.wizardError && blocked),
        loading: wizard.wizardSubmitting || autoPollProgress,
        icon: wizard.wizardError ? "none" : "next",
      }}
    >
      <div className="space-y-4" dir="auto">
        {wizard.wizardError && <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm leading-6 text-red-300">{wizard.wizardError}</div>}
        <WizardStepRenderer
          step={presentedStep}
          value={value}
          setValue={setValue}
          t={t}
          nonBlockingProbeFailure={nonBlockingProbeFailure}
          completionVerification={completionStep
            ? t(copy.completionVerificationKey, copy.completionVerificationFallback)
            : undefined}
        />
      </div>
    </SetupShell>
  );
}

// ── 开机自启偏好(仅 Native 运行时) ──
// 通过官方 `openclaw gateway install/uninstall` 注册或移除系统服务;切换后
// 用现有 restart 流程把 Gateway 从"桌面托管"交接给系统服务(或反向),保证
// 结束时只有一个明确的托管方持有端口。Docker 运行时由容器重启策略负责。
