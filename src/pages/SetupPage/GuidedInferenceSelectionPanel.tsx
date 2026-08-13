import { useRef, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-shell";
import { ProviderIcon } from "@/components/shared/provider-identity";
import type { GuidedSetupCandidate } from "@/services/gateway/OpenClawGuidedSetupClient";
import type { GuidedSetupController } from "@/hooks/useSetupFlow/useGuidedSetupSession";

interface GuidedInferenceSelectionPanelProps {
  controller: GuidedSetupController;
  manualProvider: string;
  setManualProvider: (value: string) => void;
  manualKey: string;
  setManualKey: (value: string) => void;
}

function GuidedProviderIcon({
  providerId,
  icon,
}: {
  providerId: string;
  icon?: string;
}) {
  return icon
    ? <img src={icon} alt="" className="size-5 shrink-0 object-contain" />
    : <ProviderIcon providerId={providerId} size={20} />;
}

const secondaryButtonClass = "rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2 text-sm text-aegis-text transition-colors hover:border-aegis-primary/45 hover:bg-aegis-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:opacity-60";

export function GuidedInferenceSelectionPanel(props: GuidedInferenceSelectionPanelProps) {
  const { controller } = props;
  if (!controller.detection) return null;
  if (controller.phase === "confirming") {
    return <DetectedRouteConfirmation controller={controller} />;
  }
  return <InferenceOptions {...props} />;
}

function DetectedRouteConfirmation({ controller }: { controller: GuidedSetupController }) {
  const { t } = useTranslation();
  const candidate = controller.activeCandidate;
  if (!candidate || !controller.activation?.ok) return null;
  return (
    <section aria-labelledby="guided-route-confirmation" className="space-y-4">
      <div className="flex min-w-0 gap-3 rounded-lg border border-aegis-primary/30 bg-aegis-primary/5 p-4">
        <GuidedProviderIcon
          providerId={candidate.brandId || candidate.modelRef.split("/")[0] || candidate.kind}
          icon={candidate.icon}
        />
        <div className="min-w-0">
          <h2 id="guided-route-confirmation" className="text-sm font-bold text-aegis-text">
            {t("setup.guided.routeConfirm", { label: candidate.label })}
          </h2>
          <p className="mt-1 text-xs leading-5 text-aegis-text-secondary">{candidate.detail}</p>
          <code className="mt-2 block break-all text-xs text-aegis-text-muted">{controller.activation.modelRef}</code>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { void controller.confirmDetectedRoute(); }}
          disabled={controller.busy}
          className="rounded-lg bg-aegis-primary px-4 py-2 text-sm font-semibold text-[rgb(var(--aegis-on-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:opacity-60"
        >
          {t("setup.guided.useDetectedRoute", { label: candidate.label })}
        </button>
        <button
          type="button"
          onClick={controller.chooseOtherRoute}
          disabled={controller.busy}
          className={secondaryButtonClass}
        >
          {t("setup.guided.chooseOtherRoute")}
        </button>
      </div>
    </section>
  );
}

function InferenceOptions({
  controller,
  manualProvider,
  setManualProvider,
  manualKey,
  setManualKey,
}: GuidedInferenceSelectionPanelProps) {
  const { t } = useTranslation();
  const credentialRef = useRef<HTMLInputElement>(null);
  const manualSectionRef = useRef<HTMLElement>(null);
  const [externalError, setExternalError] = useState("");
  const detection = controller.detection!;
  const provider = manualProvider || detection.manualProviders[0]?.id || "";
  const chooseCandidate = (candidate: GuidedSetupCandidate) => {
    void controller.activateCandidate(candidate);
  };
  const chooseManualProvider = (providerId: string) => {
    setManualProvider(providerId);
    requestAnimationFrame(() => {
      manualSectionRef.current?.scrollIntoView({ block: "nearest" });
      credentialRef.current?.focus();
    });
  };

  return (
    <div className="space-y-5">
      {controller.activeCandidate && controller.activation?.ok ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 px-4 py-3">
          <p className="text-sm text-aegis-text">
            {t("setup.guided.activeRoute", { label: controller.activeCandidate.label })}
          </p>
          <button
            type="button"
            onClick={() => { void controller.confirmDetectedRoute(); }}
            disabled={controller.busy}
            className={secondaryButtonClass}
          >
            {t("setup.guided.useCurrentRoute")}
          </button>
        </div>
      ) : null}

      {detection.candidates.length ? (
        <section aria-labelledby="guided-detected-models">
          <h2 id="guided-detected-models" className="text-sm font-bold text-aegis-text">
            {t("setup.guided.detectedOptions")}
          </h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {detection.candidates.map((candidate) => (
              <button
                key={`${candidate.kind}:${candidate.modelRef}`}
                type="button"
                onClick={() => chooseCandidate(candidate)}
                disabled={controller.busy}
                className="flex min-w-0 items-start gap-3 rounded-lg border border-aegis-border bg-aegis-surface px-4 py-3 text-left transition-colors hover:border-aegis-primary/45 hover:bg-aegis-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:opacity-60"
              >
                <GuidedProviderIcon
                  providerId={candidate.brandId || candidate.modelRef.split("/")[0] || candidate.kind}
                  icon={candidate.icon}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-aegis-text">
                    {candidate.label}
                    {candidate.recommended ? (
                      <span className="rounded-full bg-aegis-primary/10 px-2 py-0.5 text-[10px] text-aegis-primary">
                        {t("setup.guided.recommended")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-aegis-text-secondary">{candidate.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {detection.unavailableCandidates.length ? (
        <section aria-labelledby="guided-unavailable-options">
          <h2 id="guided-unavailable-options" className="text-sm font-bold text-aegis-text">
            {t("setup.guided.unavailableOptions")}
          </h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {detection.unavailableCandidates.map((candidate) => {
              const authOption = detection.authOptions.find((option) => option.id === candidate.authOptionId);
              const manualOption = detection.manualProviders.find((option) => option.id === candidate.manualProviderId);
              return (
                <div key={candidate.id} className="rounded-lg border border-aegis-border bg-aegis-surface px-4 py-3">
                  <div className="flex gap-3">
                    <GuidedProviderIcon providerId={candidate.brandId || candidate.id} icon={candidate.icon} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-aegis-text">{candidate.label}</p>
                      <p className="mt-1 text-xs leading-5 text-aegis-text-secondary">{candidate.detail}</p>
                      <p className="mt-1 text-xs leading-5 text-aegis-warning">{candidate.reason}</p>
                    </div>
                  </div>
                  {authOption || manualOption ? (
                    <button
                      type="button"
                      disabled={controller.busy}
                      onClick={() => {
                        if (authOption) void controller.startProviderAuth(authOption.id);
                        else if (manualOption) chooseManualProvider(manualOption.id);
                      }}
                      className={`${secondaryButtonClass} mt-3`}
                    >
                      {authOption?.label || manualOption?.label}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {detection.recommendedInstalls.length && !detection.candidates.length ? (
        <section aria-labelledby="guided-recommended-installs">
          <h2 id="guided-recommended-installs" className="text-sm font-bold text-aegis-text">
            {t("setup.guided.recommendedInstalls")}
          </h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {detection.recommendedInstalls.map((install) => (
              <button
                key={install.id}
                type="button"
                onClick={() => {
                  setExternalError("");
                  void open(install.website).catch((reason: unknown) => {
                    setExternalError(reason instanceof Error ? reason.message : String(reason));
                  });
                }}
                className="flex min-w-0 items-start gap-3 rounded-lg border border-aegis-border bg-aegis-surface px-4 py-3 text-left hover:border-aegis-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary"
              >
                <GuidedProviderIcon providerId={install.brandId || install.id} icon={install.icon} />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-aegis-text">{install.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-aegis-text-secondary">{install.hint}</span>
                </span>
                <ExternalLink size={15} className="mt-0.5 shrink-0 text-aegis-text-muted" />
              </button>
            ))}
          </div>
          {externalError ? <p role="alert" className="mt-2 text-sm text-aegis-danger">{externalError}</p> : null}
        </section>
      ) : null}

      {(detection.authOptions.length || detection.prepareOptions?.length) ? (
        <section aria-labelledby="guided-provider-options">
          <h2 id="guided-provider-options" className="text-sm font-bold text-aegis-text">
            {t("setup.guided.providerOptions")}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {detection.authOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => { void controller.startProviderAuth(option.id); }} disabled={controller.busy} className={secondaryButtonClass}>
                {option.label}
              </button>
            ))}
            {detection.prepareOptions?.map((option) => (
              <button key={option.id} type="button" onClick={() => { void controller.startProviderPrepare(option.id); }} disabled={controller.busy} className={secondaryButtonClass}>
                {option.actionLabel || option.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {detection.manualProviders.length ? (
        <section ref={manualSectionRef} aria-labelledby="guided-manual-provider" className="border-t border-aegis-border pt-5">
          <h2 id="guided-manual-provider" className="text-sm font-bold text-aegis-text">
            {t("setup.guided.manualProvider")}
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
            <select aria-label={t("setup.guided.providerLabel")} value={provider} onChange={(event) => setManualProvider(event.target.value)} className="h-10 rounded-lg border border-aegis-border bg-aegis-surface px-3 text-sm text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary">
              {detection.manualProviders.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <input ref={credentialRef} type="password" aria-label={t("setup.guided.credentialLabel")} value={manualKey} onChange={(event) => setManualKey(event.target.value)} placeholder={t("setup.guided.credentialPlaceholder")} className="h-10 rounded-lg border border-aegis-border bg-aegis-surface px-3 text-sm text-aegis-text placeholder:text-aegis-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary" />
            <button
              type="button"
              onClick={() => {
                const credential = manualKey;
                setManualKey("");
                void controller.activateManual(provider, credential);
              }}
              disabled={controller.busy || !provider || !manualKey.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-aegis-primary px-4 text-sm font-semibold text-[rgb(var(--aegis-on-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck size={16} />
              {t("setup.guided.verifyCredential")}
            </button>
          </div>
        </section>
      ) : null}
      {controller.error ? <p role="alert" className="text-sm text-aegis-danger">{controller.error}</p> : null}
    </div>
  );
}
