import type { WizardStepRendererProps } from "./WizardStepTypes";
import { resolveWizardAuthorizationUrl } from "./WizardAuthorizationHint";

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
  return (
    <div className="rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">
      <pre className="whitespace-pre-wrap break-words font-[inherit]">
        {step.message || t("setup.wizard.readyForStep")}
      </pre>
    </div>
  );
}
