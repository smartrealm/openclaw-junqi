// Cross-step helpers: back navigation and the language/theme controls.
import { Check, Globe2, Monitor, Moon, Palette, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import type { SetupStep } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settingsStore";
import { changeLanguage } from "@/i18n";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/i18n/languages";
import type { ThemeSetting } from "@/theme/types";
import { setThemeWithTransition } from "@/motion/themeTransition";
import clsx from "clsx";
import { setupStepMessageKey, setupStepProgress, type SetupNavigationMode } from "@/stores/setup-navigation";

export function useSetupNavigation() {
  const { t } = useTranslation();
  const navigateSetup = useAppStore((s) => s.navigateSetup);
  const setSetupStatus = useAppStore((s) => s.setSetupStatus);

  return (step: SetupStep, mode: SetupNavigationMode = "push") => {
    setSetupStatus(t(setupStepMessageKey(step)), setupStepProgress(step));
    navigateSetup(step, mode);
  };
}

export function LanguageThemeControls() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);

  const setLang = (lang: AppLanguage) => {
    setLanguage(lang);
    changeLanguage(lang);
  };

  const languageOptions = APP_LANGUAGE_OPTIONS;
  const themeOptions: Array<{ value: ThemeSetting; label: string; icon: ReactNode; preview: string }> = [
    { value: "system", label: t("theme.followSystem", "跟随系统"), icon: <Monitor size={15} />, preview: "linear-gradient(135deg,#0f172a 0 49%,#f8fafc 50% 100%)" },
    { value: "aegis-dark", label: t("theme.dark", "深色"), icon: <Moon size={15} />, preview: "linear-gradient(135deg,#080c12,#182232)" },
    { value: "aegis-midnight", label: t("theme.midnight", "暗黑"), icon: <Moon size={15} />, preview: "linear-gradient(135deg,#040516,#0b1b32)" },
    { value: "aegis-light", label: t("theme.light", "浅色"), icon: <Sun size={15} />, preview: "linear-gradient(135deg,#f8fafc,#dbe5f0)" },
    { value: "aegis-eyecare", label: t("theme.eyecare", "护眼"), icon: <Palette size={15} />, preview: "linear-gradient(135deg,#f4f0e8,#d8ceb8)" },
  ];

  return (
    <div className="space-y-4" dir="ltr">
      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-aegis-text">
              <Globe2 size={16} />
              {t("setup.languageLabel")}
            </div>
            <p className="mt-1 text-xs text-aegis-text-dim">{t("setup.languageHint", "选择启动向导和后续界面的显示语言")}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {languageOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setLang(item.value)}
              className={clsx(
                "relative flex min-h-[52px] flex-col items-start justify-center rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45",
                language === item.value
                  ? "border-aegis-primary bg-aegis-primary/10 text-aegis-primary"
                  : "border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface",
              )}
            >
              <span className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">{item.value}</span>
              <span className="mt-1 text-sm font-semibold" dir="auto">{item.label}</span>
              {language === item.value && <Check size={15} className="absolute right-3 top-3" />}
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-aegis-text">
              <Palette size={16} />
              {t("setup.themeLabel")}
            </div>
            <p className="mt-1 text-xs text-aegis-text-dim">{t("setup.themeHint", "选择启动时的视觉偏好，可随系统自动切换")}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          {themeOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={(event) => setThemeWithTransition(item.value, event.currentTarget)}
              className={clsx(
                "group relative min-h-[78px] rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45",
                theme === item.value
                  ? "border-aegis-primary bg-aegis-primary/10 text-aegis-primary"
                  : "border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface",
              )}
            >
              <span className="block h-7 rounded-md border border-white/10" style={{ background: item.preview }} />
              <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold" dir="auto">
                {item.icon}
                {item.label}
              </span>
              {theme === item.value && (
                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-aegis-primary text-aegis-btn-primary-text">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
