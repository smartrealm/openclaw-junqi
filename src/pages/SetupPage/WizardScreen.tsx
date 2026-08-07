// Step `configure-openclaw` — the official OpenClaw wizard.
import { CheckCircle2, Copy, Circle, ExternalLink } from "lucide-react";
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

export function wizardValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

async function openWizardExternalUrl(value?: string): Promise<void> {
  if (!value) return;
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(value);
  } catch {
    // 外部授权地址由 Gateway 明确提供；桌面 Shell 不可用时不以浏览器回退伪造成功。
  }
}

export function WizardAuthorizationHint({
  externalUrl,
  deviceCode,
}: Pick<OpenClawWizardStep, 'externalUrl' | 'deviceCode'>) {
  const { t } = useTranslation();
  if (!externalUrl && !deviceCode) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-aegis-border pt-4">
      <div className="min-w-0 flex-1 space-y-2">
        {deviceCode && <div className="rounded-md border border-aegis-border bg-aegis-surface px-3 py-2">
          <p className="text-xs text-aegis-text-muted">{deviceCode.message || t('setup.wizard.deviceCodeHint', '请在授权页面输入一次性代码。')}</p>
          <code className="mt-1 block break-all text-sm font-semibold text-aegis-text">{deviceCode.code}</code>
        </div>}
        {externalUrl && <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(externalUrl).catch(() => undefined)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
          >
            <Copy size={13} />{t('common.copy', 'Copy link')}
          </button>
          <button
            type="button"
            onClick={() => void openWizardExternalUrl(externalUrl)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
          >
            <ExternalLink size={13} />{t('setup.wizard.openInBrowser', '在浏览器中打开')}
          </button>
        </div>}
      </div>
    </div>
  );
}

export function WizardScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const step = flow.wizardStep;
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
      || flow.wizardSubmitting
      || flow.wizardError
      || autoPolledProgressStepRef.current === step.id
    ) return;
    autoPolledProgressStepRef.current = step.id;
    void flow.pollWizard();
  }, [autoPollProgress, flow, step]);

  if (!step) {
    return (
      <SetupShell
        active={flow.presentation.stage}
        title={t("setup.wizard.title", "配置 OpenClaw")}
        subtitle={t("setup.wizard.connecting", "正在连接 OpenClaw 官方配置向导…")}
        logs={logs}
        previousAction={{ onClick: flow.goBack, disabled: flow.wizardSubmitting }}
        nextAction={{
          label: flow.wizardRecoveryRequired
            ? t("setup.wizard.reclaim", "重新接管向导")
            : flow.wizardError ? t("setup.wizard.retry", "重试") : t("setup.wizard.connectingAction", "正在连接"),
          onClick: () => void (flow.wizardRecoveryRequired ? flow.reclaimWizard() : flow.retryWizard()),
          disabled: flow.wizardSubmitting && !flow.wizardError,
          loading: flow.wizardSubmitting,
          icon: "none",
        }}
      >
        <div className={clsx("rounded-lg border p-4 text-sm leading-6", flow.wizardError ? "border-red-500/25 bg-red-500/5 text-red-300" : "border-aegis-primary/25 bg-aegis-primary/5 text-aegis-text-secondary")}>
          {flow.wizardError || flow.wizardActivity || t("setup.wizard.connecting", "正在连接 OpenClaw 官方配置向导…")}
        </div>
      </SetupShell>
    );
  }

  // 向导展示与语言由 Gateway 定义，桌面端只呈现其返回的结构化步骤。
  const presentedStep = step;
  const options = Array.isArray(presentedStep.options) ? presentedStep.options : [];
  const selectedValues = Array.isArray(value) ? value : [];
  const toggleMulti = (optionValue: unknown) => {
    setValue((current: unknown) => {
      const values = Array.isArray(current) ? current : [];
      return values.some((item) => wizardValuesEqual(item, optionValue))
        ? values.filter((item) => !wizardValuesEqual(item, optionValue))
        : [...values, optionValue];
    });
  };
  const blocked = (step.type === "select" || step.type === "multiselect")
    && options.length === 0;
  const messageRenderedInBody = presentedStep.type !== "text"
    && presentedStep.type !== "select"
    && presentedStep.type !== "multiselect"
    && presentedStep.type !== "confirm";
  const wizardTitle = presentedStep.title || t("setup.wizard.title", "配置 OpenClaw");
  const wizardSubtitle = messageRenderedInBody
    ? t("setup.wizard.subtitle", "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。")
    : presentedStep.message || t("setup.wizard.subtitle", "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。");
  const completionStep = isOpenClawWizardCompletionStep(presentedStep);
  const nonBlockingProbeFailure = isOpenClawWizardNonBlockingProbeFailure(presentedStep);
  const submitCurrentStep = async () => {
    await flow.submitWizardStep(step.id, value);
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
        disabled: flow.wizardSubmitting,
      }}
      nextAction={{
        label: flow.wizardError
          ? t("setup.wizard.retry", "重试")
          : completionStep
            ? t("setup.wizard.finish", "完成")
          : autoPollProgress
            ? t("setup.wizard.processing", "正在处理…")
            : step.type === "action" ? t("setup.wizard.run", "执行") : t("setup.nextStep", "下一步"),
        onClick: () => {
          if (flow.wizardError) {
            void flow.retryWizard();
            return;
          }
          void submitCurrentStep();
        },
        disabled: flow.wizardSubmitting || autoPollProgress || (!flow.wizardError && blocked),
        loading: flow.wizardSubmitting || autoPollProgress,
        icon: flow.wizardError ? "none" : "next",
      }}
    >
      <div className="space-y-4" dir="auto">
        {flow.wizardError && <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm leading-6 text-red-300">{flow.wizardError}</div>}
        {presentedStep.type === "text" && (
          <input
            type={presentedStep.sensitive ? "password" : "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValue(event.target.value)}
            placeholder={presentedStep.placeholder}
            aria-label={presentedStep.title || t("setup.wizard.textInput", "OpenClaw 配置值")}
            autoComplete={presentedStep.sensitive ? "new-password" : "off"}
            className="w-full rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2.5 text-sm text-aegis-text outline-none focus:border-aegis-primary"
          />
        )}
        {presentedStep.type === "confirm" && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-aegis-border bg-aegis-surface p-4 text-sm text-aegis-text">
            <input type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} className="h-4 w-4 accent-[rgb(var(--aegis-primary))]" />
            <span>{presentedStep.message || t("setup.wizard.confirm", "确认并继续")}</span>
          </label>
        )}
        {presentedStep.type === "select" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option, index) => {
              const selected = wizardValuesEqual(value, option.value);
              return (
                <button key={`${step.id}-${index}`} type="button" onClick={() => setValue(option.value)} className={clsx("flex min-h-[64px] items-start gap-3 rounded-lg border p-3 text-start transition", selected ? "border-aegis-primary bg-aegis-primary/8" : "border-aegis-border bg-aegis-surface hover:border-aegis-primary/40")}>
                  {selected ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-aegis-primary" /> : <Circle size={17} className="mt-0.5 shrink-0 text-aegis-text-dim" />}
                  <span>
                    <span className="block text-sm font-semibold text-aegis-text">{option.label}</span>
                    {option.hint && <span className="mt-1 block text-xs leading-5 text-aegis-text-muted">{option.hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {presentedStep.type === "multiselect" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option, index) => {
              const selected = selectedValues.some((item) => wizardValuesEqual(item, option.value));
              return (
                <label key={`${step.id}-${index}`} className={clsx("flex cursor-pointer items-start gap-3 rounded-lg border p-3", selected ? "border-aegis-primary bg-aegis-primary/8" : "border-aegis-border bg-aegis-surface")}>
                  <input type="checkbox" checked={selected} onChange={() => toggleMulti(option.value)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--aegis-primary))]" />
                  <span><span className="block text-sm font-semibold text-aegis-text">{option.label}</span>{option.hint && <span className="mt-1 block text-xs leading-5 text-aegis-text-muted">{option.hint}</span>}</span>
                </label>
              );
            })}
          </div>
        )}
        {messageRenderedInBody && (
          <div className="rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">
            <pre className="whitespace-pre-wrap break-words font-[inherit]">{presentedStep.message || t("setup.wizard.readyForStep", "此步骤由 OpenClaw 执行。")}</pre>
            {nonBlockingProbeFailure && (
              <p className="mt-3 border-t border-aegis-border pt-3 text-xs leading-5 text-aegis-text-muted">
                {t(
                  "setup.wizard.nonBlockingProbeFailure",
                  "这是渠道插件返回的非阻断检查结果，不代表 OpenClaw 或 Gateway 安装失败。可以继续完成向导，启动后再以渠道实际运行状态为准。",
                )}
              </p>
            )}
            {completionStep && (
              <p className="mt-3 border-t border-aegis-border pt-3 text-xs leading-5 text-aegis-text-muted">
                {t(
                  "setup.wizard.completionVerification",
                  "OpenClaw 向导已结束。点击完成后，JunQi 仍会验证当前 Gateway 连接和所选模型；验证未通过时不会进入工作台。",
                )}
              </p>
            )}
            <WizardAuthorizationHint externalUrl={presentedStep.externalUrl} deviceCode={presentedStep.deviceCode} />
          </div>
        )}
      </div>
    </SetupShell>
  );
}

// ── 开机自启偏好(仅 Native 运行时) ──
// 通过官方 `openclaw gateway install/uninstall` 注册或移除系统服务;切换后
// 用现有 restart 流程把 Gateway 从"桌面托管"交接给系统服务(或反向),保证
// 结束时只有一个明确的托管方持有端口。Docker 运行时由容器重启策略负责。
