import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, MessageSquareText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { GuidedInferenceSelectionPanel } from "./GuidedInferenceSelectionPanel";
import { WizardStepRenderer } from "./wizard/WizardStepRenderer";
import { wizardInitialValue } from "./wizard/WizardStepValue";
import {
  resolveWizardAuthorizationUrl,
  WizardAuthorizationHint,
} from "./wizard/WizardAuthorizationHint";

export function GuidedSetupScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const controller = flow.guidedSetup;
  const step = controller.wizardStep ?? controller.chat?.step ?? null;
  const [stepValue, setStepValue] = useState<unknown>(() => step ? wizardInitialValue(step) : undefined);
  const [manualProvider, setManualProvider] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [chatInput, setChatInput] = useState("");
  const authorizationStep = Boolean(
    step?.deviceCode || (step && resolveWizardAuthorizationUrl(step)),
  );

  useEffect(() => {
    setStepValue(step ? wizardInitialValue(step) : undefined);
  }, [step?.id]);

  const contentIdentity = `${controller.phase}:${step?.id ?? controller.chat?.question?.id ?? "default"}`;
  const waiting = controller.phase === "detecting"
    || controller.phase === "activating"
    || controller.phase === "completing"
    || (controller.phase === "provider-wizard" && (!step || (controller.busy && authorizationStep)));
  const submitStep = () => {
    if (!step) return;
    if (controller.phase === "provider-wizard") {
      void controller.submitProviderWizard(step.id, stepValue);
      return;
    }
    void controller.submitChat(undefined, { stepId: step.id, value: stepValue });
  };
  const cancelStep = () => {
    if (!step) return;
    if (controller.phase === "provider-wizard") {
      void controller.cancelProviderWizard();
      return;
    }
    void controller.cancelChatWizard(step.id);
  };

  return (
    <SetupShell
      active={flow.presentation.stage}
      contentIdentity={contentIdentity}
      contentMotion={step || controller.phase === "chat" ? "forward" : "ambient"}
      title={t("setup.guided.title")}
      subtitle={t("setup.guided.subtitle")}
      logs={logs}
      previousAction={{ onClick: flow.goBack, disabled: controller.busy }}
      secondaryAction={{
        label: t("setup.guided.classicAction"),
        onClick: flow.openClassicSetup,
        disabled: controller.busy || flow.wizardSubmitting,
      }}
      nextAction={step ? {
        label: authorizationStep
          ? t("setup.wizard.authorizationComplete")
          : t("setup.nextStep"),
        onClick: submitStep,
        disabled: controller.busy,
        loading: controller.busy,
      } : controller.phase === "error" ? {
        label: t("setup.guided.retry"),
        onClick: () => { void controller.retry(); },
        disabled: controller.busy,
        loading: controller.busy,
        icon: "none",
      } : undefined}
    >
      {waiting ? (
        <div className="flex min-h-[260px] flex-col justify-center gap-4" aria-live="polite" aria-busy="true">
          <StatusPanel
            icon={<LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" />}
            tone="primary"
            eyebrow={t("setup.guided.progressEyebrow")}
            title={controller.phase === "detecting"
              ? t("setup.guided.detecting")
              : controller.phase === "activating"
                ? t("setup.guided.activating")
                : controller.phase === "completing"
                  ? t("setup.guided.verifying")
                  : t("setup.guided.waitingForProvider")}
            message={t("setup.guided.progressDescription")}
          />
          {controller.phase === "provider-wizard" ? (
            <button
              type="button"
              onClick={() => { void controller.cancelProviderWizard(); }}
              className="self-start text-sm text-aegis-text-secondary underline-offset-4 hover:text-aegis-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary"
            >
              {t("setup.guided.cancelStep")}
            </button>
          ) : null}
        </div>
      ) : controller.phase === "error" ? (
        <StatusPanel
          icon={<CircleAlert size={22} />}
          tone="danger"
          eyebrow={t("setup.guided.errorEyebrow")}
          title={t("setup.guided.errorTitle")}
          message={controller.error ?? t("setup.guided.errorFallback")}
        />
      ) : step ? (
        <fieldset disabled={controller.busy} className="min-w-0 border-0 p-0 disabled:opacity-70">
          <div className="space-y-4">
            <WizardStepRenderer step={step} value={stepValue} setValue={setStepValue} t={t} />
            <WizardAuthorizationHint key={step.id} step={step} />
            <button
              type="button"
              onClick={cancelStep}
              className="text-sm text-aegis-text-secondary underline-offset-4 hover:text-aegis-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary"
            >
              {t("setup.guided.cancelStep")}
            </button>
          </div>
        </fieldset>
      ) : controller.phase === "chat" && controller.chat ? (
        <GuidedChatPanel
          controller={controller}
          input={chatInput}
          setInput={setChatInput}
        />
      ) : (
        <GuidedInferenceSelectionPanel
          controller={controller}
          manualProvider={manualProvider}
          setManualProvider={setManualProvider}
          manualKey={manualKey}
          setManualKey={setManualKey}
        />
      )}
    </SetupShell>
  );
}

function GuidedChatPanel({
  controller,
  input,
  setInput,
}: {
  controller: SetupFlow["guidedSetup"];
  input: string;
  setInput: (value: string) => void;
}) {
  const { t } = useTranslation();
  const question = controller.chat?.question;
  const submit = () => {
    const message = input.trim();
    if (!message) return;
    setInput("");
    void controller.submitChat(message);
  };
  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-lg border border-aegis-border bg-aegis-surface p-4">
        <MessageSquareText size={20} className="mt-0.5 shrink-0 text-aegis-primary" />
        <p className="whitespace-pre-wrap text-sm leading-6 text-aegis-text">{controller.chat?.reply}</p>
      </div>
      {question ? (
        <section aria-labelledby={`guided-question-${question.id}`}>
          <h2 id={`guided-question-${question.id}`} className="text-sm font-bold text-aegis-text">
            {question.header}
          </h2>
          <p className="mt-1 text-sm text-aegis-text-secondary">{question.question}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {question.options.map((option) => (
              <button
                key={`${question.id}:${option.label}`}
                type="button"
                onClick={() => { void controller.submitChat(option.reply || option.label); }}
                disabled={controller.busy}
                className={clsx(
                  "rounded-lg border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:opacity-60",
                  option.recommended
                    ? "border-aegis-primary/45 bg-aegis-primary/5"
                    : "border-aegis-border bg-aegis-surface hover:border-aegis-primary/35",
                )}
              >
                <span className="text-sm font-semibold text-aegis-text">{option.label}</span>
                {option.description ? (
                  <span className="mt-1 block text-xs leading-5 text-aegis-text-secondary">{option.description}</span>
                ) : null}
              </button>
            ))}
          </div>
          {question.skipAction === "exit" ? (
            <button
              type="button"
              onClick={() => { void controller.finishChat(); }}
              disabled={controller.busy}
              className="mt-3 text-sm text-aegis-text-secondary underline-offset-4 hover:text-aegis-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:opacity-60"
            >
              {t("setup.guided.finishLater")}
            </button>
          ) : null}
        </section>
      ) : null}
      {question?.isOther !== false ? (
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            aria-label={t("setup.guided.chatInputLabel")}
            placeholder={t("setup.guided.chatInputPlaceholder")}
            className="h-10 min-w-0 flex-1 rounded-lg border border-aegis-border bg-aegis-surface px-3 text-sm text-aegis-text placeholder:text-aegis-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary"
          />
          <button
            type="button"
            onClick={submit}
            disabled={controller.busy || !input.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-aegis-primary px-4 text-sm font-semibold text-[rgb(var(--aegis-on-primary))] hover:bg-aegis-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:opacity-50"
          >
            <ShieldCheck size={16} />
            {t("setup.guided.send")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
