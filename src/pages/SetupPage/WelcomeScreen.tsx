// Step `welcome` — entry screen.
import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import { SetupShell } from "@/components/setup/SetupFlowPanels";
import { LanguageThemeControls, useSetupNavigation } from "./shared";

export function WelcomeScreen({ logs }: { logs: SetupLog[] }) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();

  return (
    <SetupShell
      active={0}
      title={t("setup.title")}
      subtitle={t("setup.welcomeSubtitle")}
      logs={logs}
      nextAction={{ label: t("setup.nextStep", "下一步"), onClick: () => navigateSetup("detecting") }}
    >
      <div className="mb-6 grid gap-4 border-b border-aegis-border pb-5 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-aegis-primary">JunQi Desktop</div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-aegis-text-dim">{t("setup.companyLabel")}</div>
          <div className="mt-0.5 text-base font-semibold text-aegis-text">{t("setup.companyName")}</div>
          <p className="mt-3 text-sm leading-6 text-aegis-text-muted min-[520px]:whitespace-nowrap" dir="auto">
            {t("setup.productIntro")}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-aegis-border bg-aegis-surface text-aegis-primary">
          <Monitor size={23} strokeWidth={1.7} />
        </div>
      </div>
      <LanguageThemeControls />
    </SetupShell>
  );
}

