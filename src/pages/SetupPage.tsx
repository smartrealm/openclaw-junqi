// ═══════════════════════════════════════════════════════════
// SetupPage — guided OpenClaw startup flow
// Brand/preferences → runtime check → install/start → ready.
// ═══════════════════════════════════════════════════════════

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Container,
  Copy,
  Circle,
  CircleDot,
  Eye,
  EyeOff,
  Globe2,
  Monitor,
  Moon,
  Package,
  Palette,
  RefreshCw,
  TerminalSquare,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/stores/app-store";
import type { SetupStep } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settingsStore";
import { changeLanguage } from "@/i18n";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/i18n/languages";
import { GatewayLifecyclePanel } from "@/components/settings/GatewayLifecyclePanel";
import { useSetupFlow } from "@/hooks/useSetupFlow";
import type { SetupFlow, StepState } from "@/hooks/useSetupFlow";
import type { DockerStatus } from "@/api/tauri-commands";
import type { ThemeSetting } from "@/theme";
import clsx from "clsx";

type SetupStepId = "identity" | "runtime" | "install" | "ready";
type SetupLog = { source: "setup" | "gateway"; message: string };

const SETUP_STEPS: SetupStepId[] = ["identity", "runtime", "install", "ready"];

function setupStepMessageKey(step: SetupStep): string {
  switch (step) {
    case "welcome":
      return "setup.petWelcome";
    case "detecting":
      return "setup.detecting";
    case "gateway-stopped":
      return "setup.gatewayNotRunning";
    case "choosing-mode":
      return "setup.chooseMode";
    case "git-missing":
      return "setup.gitRequired";
    case "ready":
      return "setup.ready";
    case "error":
      return "pet.status.error";
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "install-complete":
      return "setup.installComplete";
    default:
      return "setup.settingUp";
  }
}

function setupStepProgress(step: SetupStep): number {
  switch (step) {
    case "welcome":
      return 0;
    case "detecting":
    case "gateway-stopped":
    case "choosing-mode":
      return 18;
    case "git-missing":
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "error":
      return 52;
    case "install-complete":
      return 68;
    case "ready":
      return 100;
    default:
      return 0;
  }
}

function useSetupNavigation() {
  const { t } = useTranslation();
  const setSetupStep = useAppStore((s) => s.setSetupStep);
  const setSetupStatus = useAppStore((s) => s.setSetupStatus);

  return (step: SetupStep) => {
    setSetupStatus(t(setupStepMessageKey(step)), setupStepProgress(step));
    setSetupStep(step);
  };
}

function payloadMessage(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

function Stepper({ active }: { active: number }) {
  const { t } = useTranslation();
  return (
    <div className="px-6 pt-6" dir="ltr">
      <div className="mx-auto flex w-fit max-w-full items-start justify-center gap-2 overflow-x-auto rounded-xl border border-aegis-border bg-aegis-elevated px-3 py-3 shadow-sm">
        {SETUP_STEPS.map((id, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <div key={id} className="flex items-start">
              <div className="flex min-w-[94px] flex-col items-center gap-2 text-center">
                <div
                  className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-black transition-colors",
                    done && "border-aegis-primary/45 bg-aegis-primary/10 text-aegis-primary",
                    current && "border-aegis-primary bg-aegis-bg text-aegis-primary shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.12)]",
                    !done && !current && "border-aegis-border bg-aegis-surface text-aegis-text-dim",
                  )}
                >
                  {done ? <Check size={15} strokeWidth={3} /> : i + 1}
                </div>
                <div>
                  <div
                    className={clsx(
                      "text-xs font-bold",
                      current && "text-aegis-text",
                      done && !current && "text-aegis-text-secondary",
                      !done && !current && "text-aegis-text-dim",
                    )}
                    dir="auto"
                  >
                    {t(`setup.steps.${id}.title`)}
                  </div>
                  <div
                    className={clsx("mt-0.5 hidden text-[11px] font-medium sm:block", current ? "text-aegis-text-secondary" : "text-aegis-text-dim")}
                    dir="auto"
                  >
                    {t(`setup.steps.${id}.description`)}
                  </div>
                </div>
              </div>
              {i < SETUP_STEPS.length - 1 && (
                <div
                  className={clsx("mt-4 h-[2px] w-10 rounded-full transition-colors", i < active ? "bg-aegis-primary/35" : "bg-aegis-border")}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LogPanel({ logs }: { logs: SetupLog[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const logText = logs
    .slice(-160)
    .map((log) => `[${log.source}] ${log.message}`)
    .join("\n");
  const copyLogs = () => {
    if (!logText) return;
    void navigator.clipboard?.writeText(logText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-aegis-border bg-black/20">
      <div className="flex items-center justify-between border-b border-aegis-border px-3 py-2">
        <span className="text-xs font-medium text-aegis-text-secondary">{t("setup.debugLog")}</span>
        <button
          type="button"
          onClick={copyLogs}
          disabled={!logText}
          className="inline-flex items-center gap-1.5 rounded-md border border-aegis-border px-2.5 py-1.5 text-[11px] text-aegis-text-secondary hover:bg-aegis-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy size={12} />
          {copied ? t("setup.copiedLogs") : t("setup.copyLogs")}
        </button>
      </div>
      <div className="max-h-[220px] overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <div className="text-aegis-text-dim">{t("setup.logsEmpty")}</div>
        ) : (
          logs.slice(-160).map((log, i) => (
            <div
              key={`${log.source}-${i}`}
              className={clsx(log.message.toLowerCase().includes("error") ? "text-red-300" : "text-aegis-text-secondary")}
            >
              <span className="text-aegis-text-dim">[{log.source}]</span> {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SetupShell({
  active,
  title,
  subtitle,
  children,
  logs,
  previousAction,
  nextAction,
  wide = false,
}: {
  active: number;
  title: string;
  subtitle: string;
  children: ReactNode;
  logs: SetupLog[];
  previousAction?: { label?: string; onClick?: () => void; disabled?: boolean };
  nextAction?: { label: string; onClick?: () => void; disabled?: boolean; loading?: boolean; icon?: "next" | "none" };
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const [showLogs, setShowLogs] = useState(false);
  const isRuntime = active > 0 && active < 3;
  const showActions = previousAction || nextAction;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-aegis-bg text-aegis-text" dir="ltr">
      <div
        data-tauri-drag-region
        className="h-[32px] shrink-0 chrome-bg border-b border-aegis-border/30"
      />
      <Stepper active={active} />
      <main className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-6 py-8">
        <section className={clsx("my-auto w-full", wide ? "max-w-5xl" : "max-w-3xl")}>
          <div className="mb-6 text-center">
            <h1 className="text-[30px] font-semibold tracking-normal text-aegis-text" dir="auto">{title}</h1>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-aegis-text-muted" dir="auto">{subtitle}</p>
          </div>
          <div className={clsx(wide ? "" : "rounded-xl border border-aegis-border bg-aegis-elevated p-6 shadow-sm")}>
            {children}
            {isRuntime && (
              <div className="mt-5 border-t border-aegis-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowLogs((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg border border-aegis-border px-3 py-2 text-xs font-medium text-aegis-text-secondary hover:bg-aegis-surface"
                >
                  {showLogs ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showLogs ? t("setup.hideLogs") : t("setup.viewLogs")}
                </button>
                {showLogs && <LogPanel logs={logs} />}
              </div>
            )}
          </div>
        </section>
      </main>
      {showActions && (
        <footer className="shrink-0 border-t border-aegis-border/60 bg-aegis-bg/95 px-6 py-3 backdrop-blur">
          <div className={clsx("mx-auto flex w-full items-center justify-between gap-3", wide ? "max-w-5xl" : "max-w-3xl")}>
            <div className="flex min-w-[112px] justify-start">
              {previousAction && (
              <button
                type="button"
                onClick={previousAction.onClick}
                disabled={previousAction.disabled}
                className="inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: "#ffffff",
                  borderColor: "#94a3b8",
                  color: "#0f172a",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.12)",
                }}
              >
                <ChevronLeft size={15} />
                {previousAction.label ?? t("setup.previousStep")}
              </button>
              )}
            </div>
            <div className="flex min-w-[122px] justify-end">
              {nextAction ? (
              <button
                type="button"
                onClick={nextAction.onClick}
                disabled={nextAction.disabled || nextAction.loading}
                className="inline-flex min-w-[122px] items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-55"
                style={{
                  background: "#0f172a",
                  borderColor: "#0f172a",
                  color: "#ffffff",
                  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.28)",
                }}
              >
                {nextAction.loading && <RefreshCw size={15} className="animate-spin" />}
                {nextAction.label}
                {!nextAction.loading && nextAction.icon !== "none" && <ChevronRight size={15} />}
              </button>
              ) : null}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function StatusPanel({
  icon,
  tone = "primary",
  eyebrow,
  title,
  message,
  footer,
}: {
  icon: ReactNode;
  tone?: "primary" | "success" | "warning" | "danger";
  eyebrow?: string;
  title: string;
  message: string;
  footer?: ReactNode;
}) {
  const toneClass = {
    primary: "border-aegis-primary/25 bg-aegis-primary/5 text-aegis-primary",
    success: "border-aegis-success/25 bg-aegis-success/5 text-aegis-success",
    warning: "border-yellow-500/25 bg-yellow-500/5 text-yellow-300",
    danger: "border-red-500/25 bg-red-500/5 text-red-300",
  }[tone];

  return (
    <div className={clsx("rounded-xl border p-5", toneClass)}>
      <div className="grid gap-4 sm:grid-cols-[48px_1fr] sm:items-start">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-current/20 bg-current/10">
          {icon}
        </div>
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80" dir="auto">
              {eyebrow}
            </div>
          )}
          <div className="text-base font-semibold text-aegis-text" dir="auto">{title}</div>
          <p className="mt-2 max-w-[68ch] break-words text-sm leading-6 text-aegis-text-muted" dir="auto">{message}</p>
          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

function LanguageThemeControls() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

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
    <div className="space-y-6" dir="ltr">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
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
                "relative flex min-h-[58px] flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-colors",
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
        <div className="mb-3 flex items-end justify-between gap-3">
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
              onClick={() => setTheme(item.value)}
              className={clsx(
                "group relative min-h-[92px] rounded-lg border p-2 text-left transition-colors",
                theme === item.value
                  ? "border-aegis-primary bg-aegis-primary/10 text-aegis-primary"
                  : "border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface",
              )}
            >
              <span className="block h-9 rounded-md border border-white/10" style={{ background: item.preview }} />
              <span className="mt-2 flex items-center gap-1.5 text-xs font-semibold" dir="auto">
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

function WelcomeScreen({ logs }: { logs: SetupLog[] }) {
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
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-aegis-primary">JunQi Desktop</div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-aegis-text-dim">{t("setup.companyLabel")}</div>
          <div className="mt-0.5 text-base font-semibold text-aegis-text">{t("setup.companyName")}</div>
          <p className="mt-3 max-w-[42ch] text-sm leading-6 text-aegis-text-muted" dir="auto">
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

function DetectingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();
  return (
    <SetupShell
      active={1}
      title={t("setup.runtimeTitle")}
      subtitle={t("setup.runtimeSubtitle")}
      logs={logs}
      previousAction={{ onClick: () => navigateSetup("welcome") }}
      nextAction={{ label: flow.statusMessage || t("setup.detecting"), disabled: true, loading: true, icon: "none" }}
    >
      <StatusPanel
        icon={<RefreshCw size={22} className="animate-spin" />}
        eyebrow={t("setup.steps.runtime.title")}
        title={t("setup.detecting")}
        message={flow.statusMessage || t("setup.runtimeSubtitle")}
      />
    </SetupShell>
  );
}

function GatewayStoppedScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();
  return (
    <SetupShell
      active={1}
      title={t("setup.foundOclaw")}
      subtitle={t("setup.gatewayNotRunning")}
      logs={logs}
      previousAction={{ onClick: () => navigateSetup("welcome") }}
      nextAction={{ label: t("setup.startGatewayBtn"), onClick: () => flow.startGateway(), icon: "none" }}
    >
      <StatusPanel
        icon={<Monitor size={22} />}
        eyebrow={t("setup.steps.runtime.title")}
        title={t("setup.gatewayStoppedTitle")}
        message={flow.statusMessage || t("setup.gatewayNotRunning")}
        footer={
          <button onClick={() => navigateSetup("choosing-mode")} className="text-xs font-medium text-aegis-text-dim hover:text-aegis-text">
            {t("setup.reinstallBtn")}
          </button>
        }
      />
    </SetupShell>
  );
}

function ModeSelectScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();
  const dockerAvailable = flow.dockerStatus?.available && flow.dockerStatus?.daemon_running;
  const dockerStatusText = flow.checkingDocker
    ? t("setup.checkingDocker")
    : dockerAvailable
      ? t("setup.dockerDetected", { version: flow.dockerStatus?.version ?? "" })
      : flow.dockerStatus?.available
        ? t("setup.dockerDaemonStopped")
        : t("setup.dockerNotDetected");

  return (
    <SetupShell
      active={1}
      title={t("setup.runtimeTitle")}
      subtitle={t("setup.chooseMode")}
      logs={logs}
      previousAction={{ onClick: () => navigateSetup("welcome") }}
      nextAction={{ label: t("setup.modeNative"), onClick: () => flow.selectMode("native"), icon: "next" }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <button onClick={() => flow.selectMode("native")} className="group flex min-h-[168px] flex-col rounded-lg border border-aegis-border bg-aegis-surface/50 p-5 text-left transition-colors hover:border-aegis-primary hover:bg-aegis-primary/5">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-aegis-primary/10 p-2 text-aegis-primary"><Monitor size={18} /></div>
            <h3 className="text-base font-semibold text-aegis-text">{t("setup.modeNative")}</h3>
          </div>
          <p className="text-sm leading-6 text-aegis-text-muted">{t("setup.modeNativeDesc")}</p>
          <span className="mt-auto inline-flex items-center gap-1 pt-4 text-xs font-medium text-aegis-primary">
            {t("setup.selectAndContinue")} <ChevronRight size={14} />
          </span>
        </button>

        <div
          className={clsx(
            "flex min-h-[168px] flex-col rounded-lg border border-aegis-border bg-aegis-surface/50 p-5 text-left transition-colors",
            dockerAvailable ? "cursor-pointer hover:border-aegis-primary hover:bg-aegis-primary/5" : "opacity-80",
          )}
          onClick={() => dockerAvailable && flow.selectMode("docker")}
        >
          <div className="mb-4 flex items-center gap-3">
            <div className={clsx("rounded-lg p-2", dockerAvailable ? "bg-aegis-success/10 text-aegis-success" : "bg-aegis-text-dim/10 text-aegis-text-dim")}>
              <Container size={18} />
            </div>
            <h3 className="text-base font-semibold text-aegis-text">{t("setup.modeDocker")}</h3>
          </div>
          <p className="text-sm leading-6 text-aegis-text-muted">{t("setup.modeDockerDesc")}</p>
          <div className={clsx("mt-auto flex items-center gap-2 pt-4 text-xs", dockerAvailable ? "text-aegis-success" : "text-aegis-danger")}>
            {flow.checkingDocker ? <RefreshCw size={13} className="animate-spin" /> : dockerAvailable ? <Check size={13} /> : <X size={13} />}
            <span>{dockerStatusText}</span>
          </div>
          {!dockerAvailable && !flow.checkingDocker && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void flow.detectDocker(); }}
              className="mt-3 inline-flex items-center gap-1.5 self-start rounded-md border border-aegis-border px-2.5 py-1.5 text-[11px] text-aegis-text-secondary hover:bg-aegis-surface"
            >
              <RefreshCw size={12} />
              {t("setup.recheckDocker")}
            </button>
          )}
        </div>
      </div>
    </SetupShell>
  );
}

const STEP_META: Record<string, { titleKey: string; titleFallback: string; descriptionKey: string; descriptionFallback: string }> = {
  git: {
    titleKey: "setup.installSteps.git.title",
    titleFallback: "Git",
    descriptionKey: "setup.installSteps.git.description",
    descriptionFallback: "验证源码与包管理所需的基础工具",
  },
  node: {
    titleKey: "setup.installSteps.node.title",
    titleFallback: "Node.js",
    descriptionKey: "setup.installSteps.node.description",
    descriptionFallback: "确认本地运行时版本，缺失时安装内置版本",
  },
  openclaw: {
    titleKey: "setup.installSteps.openclaw.title",
    titleFallback: "OpenClaw",
    descriptionKey: "setup.installSteps.openclaw.description",
    descriptionFallback: "检查 CLI 包与 Gateway 能力，必要时执行安装",
  },
  gateway: {
    titleKey: "setup.installSteps.gateway.title",
    titleFallback: "Gateway",
    descriptionKey: "setup.installSteps.gateway.description",
    descriptionFallback: "写入本地配置并启动控制通道",
  },
  pull: {
    titleKey: "setup.installSteps.pull.title",
    titleFallback: "Docker 镜像",
    descriptionKey: "setup.installSteps.pull.description",
    descriptionFallback: "拉取 OpenClaw 容器运行镜像",
  },
  container: {
    titleKey: "setup.installSteps.container.title",
    titleFallback: "容器运行",
    descriptionKey: "setup.installSteps.container.description",
    descriptionFallback: "创建容器并暴露本地 Gateway 端口",
  },
};

function stepStatusText(status: StepState["status"], t: ReturnType<typeof useTranslation>["t"]) {
  switch (status) {
    case "done": return t("setup.stepStatus.done", "完成");
    case "running": return t("setup.stepStatus.running", "进行中");
    case "error": return t("setup.stepStatus.error", "需要处理");
    case "skipped": return t("setup.stepStatus.skipped", "已跳过");
    default: return t("setup.stepStatus.pending", "等待中");
  }
}

function stepStatusIcon(status: StepState["status"]) {
  if (status === "done") return <CheckCircle2 size={16} strokeWidth={2.4} />;
  if (status === "running") return <RefreshCw size={15} className="animate-spin" />;
  if (status === "error") return <X size={15} strokeWidth={2.5} />;
  return <Circle size={14} />;
}

function currentStepOf(steps: StepState[]): StepState | null {
  return steps.find((s) => s.status === "running")
    ?? steps.find((s) => s.status === "error")
    ?? steps.find((s) => s.status === "pending")
    ?? steps[steps.length - 1]
    ?? null;
}

function InstallationTimeline({ steps }: { steps: StepState[] }) {
  const { t } = useTranslation();
  const visibleSteps = steps.length > 0 ? steps : [{ id: "gateway", label: "Gateway", status: "pending" as const }];
  return (
    <div className="min-h-[260px] rounded-xl border border-aegis-border bg-aegis-elevated">
      <div className="border-b border-aegis-border px-4 py-3">
        <div className="text-sm font-semibold text-aegis-text">{t("setup.installPanel.timeline", "执行步骤")}</div>
      </div>
      <div className="px-4 py-2">
      {visibleSteps.map((s, index) => (
        <div
          key={s.id}
          className={clsx(
            "relative grid grid-cols-[34px_1fr] gap-3 py-3",
            index < visibleSteps.length - 1 && "after:absolute after:left-[16px] after:top-11 after:h-[calc(100%-34px)] after:w-px after:bg-aegis-border",
          )}
        >
          <div className={clsx(
            "relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border bg-aegis-elevated",
            s.status === "done" && "border-aegis-success bg-aegis-success/15 text-aegis-success",
            s.status === "running" && "border-aegis-primary bg-aegis-primary/15 text-aegis-primary",
            s.status === "error" && "border-red-500 bg-red-500/15 text-red-400",
            (s.status === "pending" || s.status === "skipped") && "border-aegis-border text-aegis-text-dim",
          )}>
            {stepStatusIcon(s.status)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
              <div className={clsx("text-sm font-semibold", s.status === "running" ? "text-aegis-primary" : "text-aegis-text")} dir="auto">
                {STEP_META[s.id] ? t(STEP_META[s.id].titleKey, STEP_META[s.id].titleFallback) : s.label}
              </div>
              {STEP_META[s.id] && s.status === "running" && (
                <div className="mt-1 text-xs leading-5 text-aegis-text-dim" dir="auto">
                  {t(STEP_META[s.id].descriptionKey, STEP_META[s.id].descriptionFallback)}
                </div>
              )}
              </div>
              <span className={clsx(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                s.status === "done" && "bg-aegis-success/10 text-aegis-success",
                s.status === "running" && "bg-aegis-primary/10 text-aegis-primary",
                s.status === "error" && "bg-red-500/10 text-red-300",
                (s.status === "pending" || s.status === "skipped") && "bg-aegis-surface text-aegis-text-dim",
              )}>
                {stepStatusText(s.status, t)}
              </span>
            </div>
            {s.detail && <div className="mt-2 break-words rounded-lg bg-aegis-surface/55 px-3 py-2 font-mono text-xs leading-5 text-aegis-text-secondary">{s.detail}</div>}
            {s.status === "running" && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-aegis-surface">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-aegis-primary" />
              </div>
            )}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function InstallationConsole({ flow, logs, setupStep }: { flow: SetupFlow; logs: SetupLog[]; setupStep: string }) {
  const { t } = useTranslation();
  const current = currentStepOf(flow.steps);
  const completed = flow.steps.filter((s) => s.status === "done").length;
  const total = flow.steps.length || 1;
  const percent = Math.max(0, Math.min(100, Math.round(flow.progress)));
  const recentLogs = logs.slice(-3);
  const isReady = setupStep === "ready";
  const isError = setupStep === "error";
  const isAwaitingGatewayStart = setupStep === "install-complete";
  const currentMeta = current ? STEP_META[current.id] : null;
  const currentTitle = current
    ? currentMeta ? t(currentMeta.titleKey, currentMeta.titleFallback) : current.label
    : t("setup.preparingGateway", "正在准备 Gateway...");
  const currentDescription = currentMeta ? t(currentMeta.descriptionKey, currentMeta.descriptionFallback) : t("setup.subtitle");

  return (
    <div className="space-y-4">
      <div className={clsx(
        "grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_168px]",
        isError ? "border-red-500/35 bg-red-500/5" : isReady ? "border-aegis-success/35 bg-aegis-success/5" : "border-aegis-primary/30 bg-aegis-primary/5",
      )}>
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-aegis-text-muted">
            {isReady || isAwaitingGatewayStart ? <CheckCircle2 size={15} className="text-aegis-success" /> : isError ? <X size={15} className="text-red-300" /> : <CircleDot size={15} className="text-aegis-primary" />}
            {isReady
              ? t("setup.ready", "就绪")
              : isAwaitingGatewayStart
                ? t("setup.installComplete", "必需组件已安装完成")
                : isError
                  ? t("setup.error", "安装遇到问题")
                  : t("setup.installPanel.current", "当前执行")}
          </div>
          <div className="text-lg font-semibold text-aegis-text" dir="auto">{currentTitle}</div>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-aegis-text-muted">{currentDescription}</p>
          {flow.statusMessage && (
            <div className="mt-3 rounded-md border border-aegis-border bg-aegis-bg/55 px-3 py-2 font-mono text-xs leading-5 text-aegis-text-secondary">
              {flow.statusMessage}
            </div>
          )}
          {current?.id === "gateway" && !isReady && !isAwaitingGatewayStart && (
            <GatewayLifecyclePanel variant="compact" className="mt-3" />
          )}
        </div>
        <div className="flex flex-col justify-center rounded-xl border border-aegis-border/70 bg-aegis-bg/55 px-4 py-3">
          <div className="text-[11px] font-semibold text-aegis-text-dim">{t("setup.installPanel.progress", "总进度")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-aegis-text">{percent}%</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-aegis-surface">
            <div className="h-full rounded-full bg-aegis-primary transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 text-[11px] text-aegis-text-dim">{completed}/{total} {t("setup.installPanel.stepsDone", "个步骤完成")}</div>
        </div>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <InstallationTimeline steps={flow.steps} />
        <aside className="min-h-[260px] rounded-xl border border-aegis-border bg-aegis-elevated p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-aegis-text">
            <TerminalSquare size={16} />
            {t("setup.installPanel.activity", "执行记录")}
          </div>
          <div className="space-y-2">
            {recentLogs.length === 0 ? (
              <div className="rounded-md border border-dashed border-aegis-border px-3 py-4 text-center text-xs text-aegis-text-dim">
                {t("setup.logsEmpty")}
              </div>
            ) : recentLogs.map((log, index) => (
              <div key={`${log.source}-${index}-${log.message}`} className="rounded-md bg-aegis-bg/55 px-3 py-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-aegis-text-dim">{log.source}</div>
                <div className="break-words text-xs leading-5 text-aegis-text-secondary">{log.message}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-aegis-border pt-3 text-[11px] leading-5 text-aegis-text-dim">
            {isError
              ? t("setup.installPanel.errorHint", "请复制错误信息或返回上一步重新选择安装方式。")
              : isReady
                ? t("setup.installPanel.readyHint", "Gateway 已就绪。点击进入工作台继续。")
                : isAwaitingGatewayStart
                  ? t("setup.installPanel.gatewayPendingHint", "必需组件已完成。点击启动 Gateway 进入下一步。")
                  : t("setup.installPanel.keepOpen", "安装过程中请保持窗口打开。完成后点击进入工作台。")}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ProgressScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const { setupStep, setupError } = useAppStore();
  const active = setupStep === "ready" ? 3 : 2;
  const isInstallComplete = setupStep === "install-complete";

  return (
    <SetupShell
      active={active}
      title={setupStep === "ready" ? t("setup.ready") : isInstallComplete ? t("setup.installComplete", "必需组件已安装完成") : t("setup.settingUp")}
      subtitle={setupStep === "ready" ? t("setup.readySubtitle") : isInstallComplete ? t("setup.installCompleteSubtitle", "安装与配置已完成。请确认后手动启动 Gateway。") : t("setup.subtitle")}
      logs={logs}
      wide
      previousAction={setupStep === "ready" ? undefined : { onClick: () => flow.goBack() }}
      nextAction={
        setupStep === "ready"
          ? { label: t("setup.enterWorkspace"), onClick: () => flow.enterWorkspace() }
          : isInstallComplete
            ? { label: t("setup.startGatewayBtn"), onClick: () => flow.startGateway(), icon: "none" }
          : setupStep === "error"
            ? { label: t("setup.retry"), onClick: () => { void flow.retrySetup(); }, icon: "none" }
            : { label: flow.statusMessage || t("setup.settingUp"), disabled: true, loading: true, icon: "none" }
      }
    >
      <InstallationConsole flow={flow} logs={logs} setupStep={setupStep} />
      {setupStep === "error" && setupError && (
        <div className="mt-5 rounded-lg border border-red-500/25 bg-red-500/5 p-4">
          <p className="break-all font-mono text-sm text-red-300">{setupError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void navigator.clipboard?.writeText(setupError)}
              className="inline-flex items-center gap-1 rounded-lg border border-aegis-border px-3 py-1.5 text-xs text-aegis-text-secondary hover:bg-aegis-surface"
            >
              <Copy size={11} />
              {t("setup.copyError")}
            </button>
          </div>
        </div>
      )}
    </SetupShell>
  );
}

function ReadyScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const doneCount = flow.steps.filter((s) => s.status === "done").length;
  const total = flow.steps.length || doneCount || 1;

  return (
    <SetupShell
      active={3}
      title={t("setup.ready")}
      subtitle={t("setup.readySubtitle")}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.enterWorkspace"), onClick: () => flow.enterWorkspace() }}
    >
      <div className="flex flex-col items-center gap-6 py-5 text-center">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-aegis-success/10 text-aegis-success ring-4 ring-aegis-success/10">
          <CheckCircle2 size={40} strokeWidth={2} />
        </div>
        {flow.steps.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {flow.steps.map((s) => {
              const meta = STEP_META[s.id];
              const label = meta ? t(meta.titleKey, meta.titleFallback) : s.label;
              const done = s.status === "done";
              return (
                <span
                  key={s.id}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                    done
                      ? "border-aegis-success/30 bg-aegis-success/10 text-aegis-success"
                      : "border-aegis-border text-aegis-text-dim",
                  )}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : <Circle size={12} />}
                  {label}
                </span>
              );
            })}
          </div>
        )}
        <div className="text-xs text-aegis-text-dim">
          {doneCount}/{total} {t("setup.installPanel.stepsDone", "个步骤完成")}
        </div>
      </div>
    </SetupShell>
  );
}

function GitMissingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  return (
    <SetupShell
      active={2}
      title={t("setup.gitRequired")}
      subtitle={t("setup.gitRequiredDesc")}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.gitRetry"), onClick: () => flow.retryGit(), icon: "none" }}
    >
      <StatusPanel
        icon={<Package size={22} />}
        tone="danger"
        eyebrow={t("setup.steps.install.title")}
        title={t("setup.gitRequired")}
        message={t("setup.gitRequiredDesc")}
      />
    </SetupShell>
  );
}

export function SetupPage() {
  const { setupStep } = useAppStore();
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [checkingDocker, setCheckingDocker] = useState(false);
  const [needsGit, setNeedsGit] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [logs, setLogs] = useState<SetupLog[]>([]);

  const flow = useSetupFlow(
    progress, setProgress, statusMessage, setStatusMessage,
    dockerStatus, setDockerStatus, checkingDocker, setCheckingDocker,
    needsGit, setNeedsGit,
    steps, setSteps,
  );

  useEffect(() => {
    let unlistenSetup: (() => void) | null = null;
    let unlistenGateway: (() => void) | null = null;

    listen("setup-progress", (event) => {
      const message = payloadMessage(event.payload);
      if (message) setLogs((prev) => [...prev.slice(-220), { source: "setup", message }]);
    }).then((fn) => { unlistenSetup = fn; }).catch(() => {});

    listen<string>("gateway-log", (event) => {
      if (event.payload) setLogs((prev) => [...prev.slice(-220), { source: "gateway", message: event.payload }]);
    }).then((fn) => { unlistenGateway = fn; }).catch(() => {});

    return () => {
      unlistenSetup?.();
      unlistenGateway?.();
    };
  }, []);

  const sharedLogs = useMemo(() => logs, [logs]);

  switch (setupStep) {
    case "welcome": return <WelcomeScreen logs={sharedLogs} />;
    case "detecting": return <DetectingScreen flow={flow} logs={sharedLogs} />;
    case "gateway-stopped": return <GatewayStoppedScreen flow={flow} logs={sharedLogs} />;
    case "choosing-mode": return <ModeSelectScreen flow={flow} logs={sharedLogs} />;
    case "ready": return <ReadyScreen flow={flow} logs={sharedLogs} />;
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "install-complete":
    case "error": return <ProgressScreen flow={flow} logs={sharedLogs} />;
    case "git-missing": return <GitMissingScreen flow={flow} logs={sharedLogs} />;
    default: return <DetectingScreen flow={flow} logs={sharedLogs} />;
  }
}
