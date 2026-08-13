import { CircleDot, Info, LoaderCircle, Play } from "lucide-react";
import clsx from "clsx";
import type { WizardStepRendererProps } from "./WizardStepTypes";
import { resolveWizardAuthorizationUrl } from "./WizardAuthorizationHint";

function OfficialStepSummary({
  step,
  t,
}: Pick<WizardStepRendererProps, "step" | "t">) {
  const presentation = step.type === "progress"
    ? {
        icon: <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" />,
        eyebrow: t("setup.wizard.officialProgress", "OpenClaw 正在处理"),
        title: t("setup.wizard.officialProgressTitle", "正在执行官方步骤"),
        fallback: t("setup.wizard.officialProgressFallback", "OpenClaw 正在处理当前步骤，请稍候。"),
        tone: "text-aegis-primary border-aegis-primary/20 bg-aegis-primary/5",
      }
    : step.type === "action"
      ? {
          icon: <Play size={20} />,
          eyebrow: t("setup.wizard.officialAction", "等待执行"),
          title: t("setup.wizard.officialActionTitle", "官方操作已准备"),
          fallback: t("setup.wizard.officialActionFallback", "选择下方操作后，OpenClaw 将执行当前步骤。"),
          tone: "text-aegis-primary border-aegis-primary/20 bg-aegis-primary/5",
        }
      : {
          icon: <Info size={20} />,
          eyebrow: t("setup.wizard.officialNotice", "OpenClaw 提示"),
          title: t("setup.wizard.officialNoticeTitle", "请确认官方提示"),
          fallback: t("setup.wizard.officialNoticeFallback", "OpenClaw 已返回当前步骤，确认后可继续。"),
          tone: "text-aegis-text-secondary border-aegis-border bg-aegis-surface",
        };

  return (
    <section
      data-wizard-official-summary={step.type}
      className={clsx("rounded-xl border p-5", presentation.tone)}
      aria-labelledby={`wizard-summary-${step.id}`}
    >
      <div className="grid gap-4 sm:grid-cols-[44px_minmax(0,1fr)] sm:items-start">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-current/15 bg-current/5">
          {presentation.icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.12em] opacity-75" dir="auto">
            {presentation.eyebrow}
          </div>
          <h2 id={`wizard-summary-${step.id}`} className="mt-1 text-base font-semibold text-aegis-text" dir="auto">
            {presentation.title}
          </h2>
          <p className="mt-2 max-w-[68ch] whitespace-pre-wrap break-words text-sm leading-6 text-aegis-text-muted" dir="auto">
            {step.message || presentation.fallback}
          </p>
          <div className="mt-4 flex items-center gap-2 border-t border-aegis-border/70 pt-3 text-xs text-aegis-text-dim">
            <CircleDot size={13} aria-hidden="true" />
            <span>{t("setup.wizard.officialSource", "内容由当前 OpenClaw Runtime 返回")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WizardNoticeStep({
  step,
  t,
}: WizardStepRendererProps) {
  const authorizationUrl = resolveWizardAuthorizationUrl(step);
  if (authorizationUrl) {
    return (
      <details className="rounded-lg border border-aegis-border bg-aegis-surface p-4 text-sm text-aegis-text-secondary">
        <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35">
          {t("setup.wizard.pluginOutput", "显示插件原始输出")}
        </summary>
        <pre className="mt-3 whitespace-pre-wrap break-words border-t border-aegis-border pt-3 font-[inherit] leading-6">
          {step.message || t("setup.wizard.readyForStep")}
        </pre>
      </details>
    );
  }
  return <OfficialStepSummary step={step} t={t} />;
}
