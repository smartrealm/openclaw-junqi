// Step `configure-openclaw` — the official OpenClaw wizard.
import { CheckCircle2, Copy, Circle, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell } from "@/components/setup/SetupFlowPanels";
import clsx from "clsx";
import type { OpenClawWizardStep } from "@/services/openclawWizard";
import { renderLocalQrDataUrl } from "@/services/qrPresentation";
import {
  extractOpenClawWizardQrUrl,
  normalizeOpenClawWizardHttpUrl,
} from "@/services/openclawWizardQr";

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

// Channel setup wizards may embed an ASCII QR and authorization URL in a
// plain-text note. URL extraction and validation stay in openclawWizardQr;
// this presentation layer only renders a local QR image and delegates flow
// control to the Gateway-owned wizard.
async function openWizardExternalUrl(value?: string): Promise<void> {
  const url = normalizeOpenClawWizardHttpUrl(value);
  if (!url) return;
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function WizardStepQrHint({ url }: { url: string }) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    void renderLocalQrDataUrl(url).then((result) => {
      if (!cancelled) setDataUrl(result);
    });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-aegis-border pt-4">
      {dataUrl && (
        <div className="shrink-0 rounded-md bg-white p-2">
          <img src={dataUrl} alt={t('setup.wizard.qrAlt', 'Scan to authorize')} className="h-32 w-32" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs leading-5 text-aegis-text-muted">
          {t('setup.wizard.scanQrHint', '看不清终端里的字符画二维码？扫这张图，或者复制链接在浏览器里打开。')}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(url).catch(() => undefined)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
          >
            <Copy size={13} />{t('common.copy', 'Copy link')}
          </button>
          <button
            type="button"
            onClick={() => void openWizardExternalUrl(url)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
          >
            <ExternalLink size={13} />{t('setup.wizard.openInBrowser', '在浏览器中打开')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WizardScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const step = flow.wizardStep;
  const [value, setValue] = useState<unknown>(() => step ? wizardInitialValue(step) : undefined);
  const [deviceCodeCopied, setDeviceCodeCopied] = useState(false);

  useEffect(() => {
    setValue(step ? wizardInitialValue(step) : undefined);
    setDeviceCodeCopied(false);
  }, [step?.id]);

  if (!step) {
    return (
      <SetupShell
        active={5}
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
          {flow.wizardError || t("setup.wizard.connecting", "正在连接 OpenClaw 官方配置向导…")}
        </div>
      </SetupShell>
    );
  }

  // Gateway owns wizard presentation and language. Keep its rendered step
  // intact so local, remote, and externally managed Gateways behave alike.
  const presentedStep = step;
  const deviceCode = presentedStep.deviceCode;
  const wizardScanQrUrl = extractOpenClawWizardQrUrl(presentedStep.message);
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
  const messageRenderedInBody = presentedStep.type === "confirm"
    || presentedStep.type === "note"
    || presentedStep.type === "progress"
    || presentedStep.type === "action";
  const wizardTitle = presentedStep.title || t("setup.wizard.title", "配置 OpenClaw");
  const wizardSubtitle = messageRenderedInBody
    ? t("setup.wizard.subtitle", "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。")
    : presentedStep.message || t("setup.wizard.subtitle", "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。");
  const copyWizardDeviceCode = async () => {
    if (!deviceCode?.code) return;
    try {
      await navigator.clipboard.writeText(deviceCode.code);
      setDeviceCodeCopied(true);
    } catch {
      setDeviceCodeCopied(false);
    }
  };

  return (
    <SetupShell
      active={5}
      title={wizardTitle}
      subtitle={wizardSubtitle}
      logs={logs}
      previousAction={{
        label: t("setup.previousStep", "上一步"),
        onClick: flow.wizardCanGoBack ? flow.backWizard : flow.goBack,
        disabled: flow.wizardSubmitting,
      }}
      nextAction={{
        label: flow.wizardError
          ? t("setup.wizard.retry", "重试")
          : step.type === "action" ? t("setup.wizard.run", "执行") : t("setup.nextStep", "下一步"),
        onClick: () => {
          if (flow.wizardError) {
            void flow.retryWizard();
            return;
          }
          void flow.submitWizardStep(step.id, value);
        },
        disabled: flow.wizardSubmitting || (!flow.wizardError && blocked),
        loading: flow.wizardSubmitting,
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
        {(presentedStep.type === "note" || presentedStep.type === "progress" || presentedStep.type === "action") && (
          <div className="rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">
            <pre className="whitespace-pre-wrap break-words font-[inherit]">{presentedStep.message || t("setup.wizard.readyForStep", "此步骤由 OpenClaw 执行。")}</pre>
            {wizardScanQrUrl && <WizardStepQrHint url={wizardScanQrUrl} />}
          </div>
        )}
        {(presentedStep.externalUrl || deviceCode) && (
          <div className="space-y-3 border-t border-aegis-border pt-4">
            {deviceCode && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <code className="block break-all font-mono text-lg font-semibold text-aegis-text" dir="ltr">{deviceCode.code}</code>
                  {deviceCode.message && deviceCode.message !== presentedStep.message && (
                    <p className="mt-1 text-xs leading-5 text-aegis-text-muted">{deviceCode.message}</p>
                  )}
                  {deviceCode.expiresInMinutes && (
                    <p className="mt-1 text-xs text-aegis-text-dim">{t("setup.wizard.deviceCodeExpires", { count: deviceCode.expiresInMinutes, defaultValue: "Expires in {{count}} minutes" })}</p>
                  )}
                </div>
                <button type="button" onClick={() => void copyWizardDeviceCode()} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-aegis-border px-3 text-sm font-semibold text-aegis-text-secondary hover:border-aegis-primary/40 hover:text-aegis-text">
                  <Copy size={15} />
                  {deviceCodeCopied ? t("common.copied", "Copied") : t("common.copy", "Copy")}
                </button>
              </div>
            )}
            {presentedStep.externalUrl && (
              <button type="button" onClick={() => void openWizardExternalUrl(presentedStep.externalUrl)} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-aegis-primary px-3 text-sm font-semibold text-aegis-btn-primary-text hover:bg-[rgb(var(--aegis-primary-hover))]">
                <ExternalLink size={15} />
                {t("setup.wizard.openAuthorization", "Open authorization")}
              </button>
            )}
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
