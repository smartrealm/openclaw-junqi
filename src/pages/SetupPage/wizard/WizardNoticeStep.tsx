import { WizardAuthorizationHint } from "./WizardAuthorizationHint";
import type { WizardStepRendererProps } from "./WizardStepTypes";

export function WizardNoticeStep({
  step,
  t,
  completionVerification,
  nonBlockingProbeFailure,
}: WizardStepRendererProps) {
  return (
    <div className="rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">
      <pre className="whitespace-pre-wrap break-words font-[inherit]">
        {step.message || t("setup.wizard.readyForStep")}
      </pre>
      {nonBlockingProbeFailure && (
        <p className="mt-3 border-t border-aegis-border pt-3 text-xs leading-5 text-aegis-text-muted">
          {t("setup.wizard.nonBlockingProbeFailure")}
        </p>
      )}
      {completionVerification && (
        <p className="mt-3 border-t border-aegis-border pt-3 text-xs leading-5 text-aegis-text-muted">
          {completionVerification}
        </p>
      )}
      <WizardAuthorizationHint externalUrl={step.externalUrl} deviceCode={step.deviceCode} />
    </div>
  );
}
