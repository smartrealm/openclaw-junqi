// ═══════════════════════════════════════════════════════════
// SetupPage — OpenClaw 首次启动向导
// 品牌偏好 → 运行时检测 → 安装/启动 → 就绪确认。
// ═══════════════════════════════════════════════════════════

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Container,
  Circle,
  Globe2,
  LoaderCircle,
  Monitor,
  Moon,
  Minus,
  Package,
  Palette,
  Power,
  RefreshCw,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import { combineUnlisteners, subscribeTauriEvent } from "@/utils/tauriEvents";
import type { SetupLog, SetupStep } from "@/stores/app-store";
import { classifySetupMessage, normalizeSetupProgressPayload } from "@/hooks/setupProgressEvents";
import { translateSetupProgressMessage } from "@/hooks/setupProgressParams";
import { useSettingsStore } from "@/stores/settingsStore";
import { changeLanguage } from "@/i18n";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/i18n/languages";
import { useSetupFlow } from "@/hooks/useSetupFlow";
import type { SetupFlow, StepState } from "@/hooks/useSetupFlow";
import type { DockerStatus, GatewayAutostartStatus } from "@/api/tauri-commands";
import {
  detectStateDirSplit,
  disableGatewayAutostart,
  enableGatewayAutostart,
  gatewayAutostartStatus,
  type StateDirSplit,
} from "@/api/tauri-commands";
import type { ThemeSetting } from "@/theme/types";
import { setThemeWithTransition } from "@/motion/themeTransition";
import {
  InstallationConsole,
  currentStepOf,
  installStepTitle,
  OpenClawRuntimeDetails,
  SetupShell,
  StatusPanel,
  STEP_META,
} from "@/components/setup/SetupFlowPanels";
import clsx from "clsx";
import { StorageSetupStep } from "@/components/setup/StorageSetupGate";
import { OpenClawUpdatePanel } from "@/components/shared/OpenClawUpdatePanel";
import { ChannelEnrollmentDialog } from "@/components/channels/ChannelEnrollmentDialog";
import {
  isFeishuQrSetupMethodStep,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { FeishuQrWizardBridge } from "@/services/feishuQrWizardBridge";
import {
  cancelChannelEnrollment,
  type ChannelEnrollmentCompletion,
} from "@/services/channelEnrollment";
import {
  setupStepMessageKey,
  setupStepProgress,
  type InstallMode,
  type SetupNavigationMode,
} from "@/stores/setup-navigation";

function useSetupNavigation() {
  const { t } = useTranslation();
  const navigateSetup = useAppStore((s) => s.navigateSetup);
  const setSetupStatus = useAppStore((s) => s.setSetupStatus);

  return (step: SetupStep, mode: SetupNavigationMode = "push") => {
    setSetupStatus(t(setupStepMessageKey(step)), setupStepProgress(step));
    navigateSetup(step, mode);
  };
}

function LanguageThemeControls() {
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
              onClick={(event) => setThemeWithTransition(item.value, event.currentTarget)}
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

function DetectingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  return (
    <SetupShell
      active={1}
      title={t("setup.runtimeTitle")}
      subtitle={t("setup.runtimeSubtitle")}
      logs={logs}
      previousAction={{ onClick: flow.goBack }}
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
      active={3}
      title={t("setup.openclawDetectedTitle")}
      subtitle={t("setup.gatewayNotRunning")}
      logs={logs}
      previousAction={{ onClick: flow.goBack }}
      nextAction={{ label: t("setup.startingGateway"), disabled: true, loading: true, icon: "none" }}
      wide
    >
      <div className="grid gap-4">
        <StatusPanel
          icon={<Monitor size={22} />}
          eyebrow={t("setup.steps.runtime.title")}
          title={t("setup.gatewayStoppedTitle")}
          message={flow.statusMessage || t("setup.startingGateway")}
          footer={
            <button onClick={flow.requestReinstall} className="text-xs font-medium text-aegis-text-dim hover:text-aegis-text">
              {t("setup.reinstallBtn")}
            </button>
          }
        />
        <OpenClawRuntimeDetails
          status={flow.openclawStatus}
          installTarget={flow.installTarget}
          gatewayState="stopped"
        />
        {flow.openclawStatus?.installed && (
          <OpenClawUpdatePanel
            currentVersion={flow.openclawStatus.version}
            onUpdated={async () => {
              const refreshed = await flow.refreshRuntime();
              if (refreshed.gatewayRunning) {
                navigateSetup(flow.needsOnboarding ? "configure-openclaw" : "ready");
              }
            }}
          />
        )}
      </div>
    </SetupShell>
  );
}

function ModeSelectScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const [selectedMode, setSelectedMode] = useState<InstallMode>(flow.installMode);
  const dockerAvailable = flow.dockerStatus?.available && flow.dockerStatus?.daemon_running;
  useEffect(() => {
    if (
      selectedMode === "docker"
      && flow.dockerStatus !== null
      && !flow.checkingDocker
      && !dockerAvailable
    ) {
      setSelectedMode("native");
    }
  }, [dockerAvailable, flow.checkingDocker, flow.dockerStatus, selectedMode]);

  const dockerStatusText = flow.checkingDocker
    ? t("setup.checkingDocker")
    : dockerAvailable
      ? t("setup.dockerDetected", { version: flow.dockerStatus?.version ?? "" })
      : flow.dockerStatus?.available
        ? t("setup.dockerDaemonStopped")
        : t("setup.dockerNotDetected");

  return (
    <SetupShell
      active={3}
      title={t("setup.runtimeTitle")}
      subtitle={t("setup.chooseMode")}
      logs={logs}
      previousAction={{ onClick: flow.goBack }}
      nextAction={{
        label: t("setup.nextStep", "下一步"),
        onClick: () => { void flow.selectMode(selectedMode); },
        disabled: selectedMode === "docker" && !dockerAvailable,
        icon: "next",
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          aria-pressed={selectedMode === "native"}
          onClick={() => setSelectedMode("native")}
          className={clsx(
            "group flex min-h-[168px] flex-col rounded-lg border p-5 text-left transition-colors",
            selectedMode === "native"
              ? "border-aegis-primary bg-aegis-primary/8 ring-1 ring-aegis-primary/25"
              : "border-aegis-border bg-aegis-surface/50 hover:border-aegis-primary hover:bg-aegis-primary/5",
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-aegis-primary/10 p-2 text-aegis-primary"><Monitor size={18} /></div>
              <h3 className="text-base font-semibold text-aegis-text">{t("setup.modeNative")}</h3>
            </div>
            {selectedMode === "native"
              ? <CheckCircle2 size={19} className="shrink-0 text-aegis-primary" />
              : <Circle size={19} className="shrink-0 text-aegis-text-dim" />}
          </div>
          <p className="text-sm leading-6 text-aegis-text-muted">{t("setup.modeNativeDesc")}</p>
        </button>

        <div
          className={clsx(
            "flex min-h-[168px] flex-col rounded-lg border p-5 text-left transition-colors",
            selectedMode === "docker"
              ? "border-aegis-primary bg-aegis-primary/8 ring-1 ring-aegis-primary/25"
              : "border-aegis-border bg-aegis-surface/50",
            dockerAvailable ? "hover:border-aegis-primary hover:bg-aegis-primary/5 focus-within:border-aegis-primary" : "opacity-80",
          )}
        >
          <button
            type="button"
            disabled={!dockerAvailable}
            aria-pressed={selectedMode === "docker"}
            onClick={() => setSelectedMode("docker")}
            className="flex flex-1 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 disabled:cursor-not-allowed"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={clsx("rounded-lg p-2", dockerAvailable ? "bg-aegis-success/10 text-aegis-success" : "bg-aegis-text-dim/10 text-aegis-text-dim")}>
                  <Container size={18} />
                </div>
                <h3 className="text-base font-semibold text-aegis-text">{t("setup.modeDocker")}</h3>
              </div>
              {selectedMode === "docker"
                ? <CheckCircle2 size={19} className="shrink-0 text-aegis-primary" />
                : <Circle size={19} className="shrink-0 text-aegis-text-dim" />}
            </div>
            <p className="text-sm leading-6 text-aegis-text-muted">{t("setup.modeDockerDesc")}</p>
            <div className={clsx("mt-auto flex items-center gap-2 pt-4 text-xs", dockerAvailable ? "text-aegis-success" : "text-aegis-danger")}>
              {flow.checkingDocker ? <RefreshCw size={13} className="animate-spin" /> : dockerAvailable ? <Check size={13} /> : <X size={13} />}
              <span>{dockerStatusText}</span>
            </div>
          </button>
          {!dockerAvailable && !flow.checkingDocker && (
            <button
              type="button"
              onClick={() => void flow.detectDocker()}
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

function ProgressScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const { setupStep } = useAppStore();
  const active = setupStep === "ready" ? 5 : 3;
  const isInstallComplete = setupStep === "install-complete";
  const currentInstallStep = currentStepOf(flow.steps);
  const canRepairGateway = setupStep === "error" && currentInstallStep?.id === "gateway";
  // BUG-CPI-07：自愈梯子（更新→重装）已确认这些插件不可自动修复，
  // 主操作降级为"临时禁用并启动"。
  const hasBrokenPlugins = setupStep === "error" && flow.brokenPlugins.length > 0;
  const currentInstallTitle = installStepTitle(currentInstallStep, t) ?? t("setup.settingUp");
  const runningStepLabel = t("setup.installPanel.runningStep", {
    step: currentInstallTitle,
    defaultValue: "正在执行：{{step}}",
  });

  return (
    <SetupShell
      active={active}
      title={setupStep === "ready" ? t("setup.ready") : isInstallComplete ? t("setup.gatewayReadyTitle", "运行时已就绪") : t("setup.settingUp")}
      subtitle={setupStep === "ready" ? t("setup.readySubtitle") : isInstallComplete ? t("setup.gatewayReadySubtitle", "OpenClaw Gateway 已启动。请点击下一步继续。") : t("setup.subtitle")}
      logs={logs}
      wide
      showLogToggle={false}
      previousAction={setupStep === "error" || isInstallComplete ? { onClick: () => flow.goBack(), disabled: flow.repairing } : undefined}
      secondaryAction={canRepairGateway ? {
        label: t("setup.retryDirectly", "直接重试"),
        onClick: () => { void flow.retryGateway(); },
        disabled: flow.repairing,
      } : undefined}
      nextAction={
        setupStep === "ready"
          ? { label: t("setup.enterWorkspace"), onClick: (event) => flow.enterWorkspace(event.currentTarget) }
          : isInstallComplete
            ? { label: t("setup.nextStep", "下一步"), onClick: () => { void flow.continueAfterGatewayReady(); } }
          : hasBrokenPlugins
            ? {
                label: flow.repairing
                  ? t("setup.pluginDisablingBtn", "正在禁用插件…")
                  : t("setup.disablePluginsAndStart", "临时禁用插件并启动"),
                onClick: () => { void flow.disablePluginsAndRetry(); },
                loading: flow.repairing,
                icon: "none",
              }
          : canRepairGateway
            ? {
                label: flow.repairing
                  ? t("setup.repairing", "正在修复…")
                  : t("setup.repairAndRetry", "自动修复并重试"),
                onClick: () => { void flow.repairAndRetry(); },
                loading: flow.repairing,
                icon: "none",
              }
          : setupStep === "error"
            ? { label: t("setup.retry"), onClick: () => { void flow.retrySetup(); }, icon: "none" }
            : { label: runningStepLabel, disabled: true, loading: true, icon: "none" }
      }
    >
      {hasBrokenPlugins && (
        <div className="mb-3 space-y-2">
          <StatusPanel
            icon={<Package size={22} />}
            tone="danger"
            eyebrow={t("setup.pluginRecovery.eyebrow", "插件问题")}
            title={t("setup.pluginRecovery.title", "插件阻止了 Gateway 启动")}
            message={t(
              "setup.pluginRecovery.desc",
              "以下插件无法自动修复（已尝试更新与重装）。临时禁用后即可继续启动，不影响其他功能；插件发布修复版本后可在设置中重新启用。",
            )}
          />
          <ul className="space-y-1 rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2 text-sm">
            {flow.brokenPlugins.map((plugin) => (
              <li key={plugin.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-aegis-text">{plugin.id}</span>
                {plugin.version && (
                  <span className="text-xs text-aegis-text-dim">v{plugin.version}</span>
                )}
                {plugin.detail && (
                  <span className="text-xs text-aegis-text-dim" dir="ltr">{plugin.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <InstallationConsole flow={flow} logs={logs} setupStep={setupStep} />
    </SetupShell>
  );
}

function wizardInitialValue(step: OpenClawWizardStep): unknown {
  if (step.type === "confirm") return Boolean(step.initialValue);
  if (step.type === "multiselect") return Array.isArray(step.initialValue) ? step.initialValue : [];
  if (step.type === "select") {
    const options = step.options ?? [];
    return options.some((option) => wizardValuesEqual(option.value, step.initialValue))
      ? step.initialValue
      : options[0]?.value;
  }
  if (step.type === "text") return typeof step.initialValue === "string" ? step.initialValue : "";
  if (step.type === "action") return true;
  return undefined;
}

function wizardValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function WizardScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const step = flow.wizardStep;
  const [value, setValue] = useState<unknown>(() => step ? wizardInitialValue(step) : undefined);
  const [feishuDomain, setFeishuDomain] = useState<"feishu" | "lark">("feishu");
  const [enrollmentDomain, setEnrollmentDomain] = useState<"feishu" | "lark" | null>(null);
  const [enrollmentFinalizing, setEnrollmentFinalizing] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const enrollmentFinalizingRef = useRef(enrollmentFinalizing);

  useEffect(() => {
    enrollmentFinalizingRef.current = enrollmentFinalizing;
  }, [enrollmentFinalizing]);

  useEffect(() => {
    setValue(step ? wizardInitialValue(step) : undefined);
    if (!enrollmentFinalizingRef.current) {
      setEnrollmentDomain(null);
      setEnrollmentError(null);
    }
  }, [step?.id]);

  if (!step) {
    return (
      <SetupShell
        active={4}
        title={t("setup.wizard.title", "配置 OpenClaw")}
        subtitle={t("setup.wizard.connecting", "正在连接 OpenClaw 官方配置向导…")}
        logs={logs}
        previousAction={{ onClick: flow.goBack, disabled: flow.wizardSubmitting }}
        nextAction={{
          label: flow.wizardError ? t("setup.wizard.retry", "重试") : t("setup.wizard.connectingAction", "正在连接"),
          onClick: () => void flow.retryWizard(),
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

  const feishuQrSetupMethod = isFeishuQrSetupMethodStep(step);
  const options = step.options ?? [];
  const selectedValues = Array.isArray(value) ? value : [];
  const toggleMulti = (optionValue: unknown) => {
    setValue((current: unknown) => {
      const values = Array.isArray(current) ? current : [];
      return values.some((item) => wizardValuesEqual(item, optionValue))
        ? values.filter((item) => !wizardValuesEqual(item, optionValue))
        : [...values, optionValue];
    });
  };
  const blocked = !feishuQrSetupMethod
    && (step.type === "select" || step.type === "multiselect")
    && options.length === 0;
  const messageRenderedInBody = step.type === "confirm"
    || step.type === "note"
    || step.type === "progress"
    || step.type === "action";
  const wizardTitle = feishuQrSetupMethod
    ? t("setup.wizard.channelEnrollment.title", "扫描二维码连接飞书")
    : step.title || t("setup.wizard.title", "配置 OpenClaw");
  const wizardSubtitle = feishuQrSetupMethod
    ? t("setup.wizard.channelEnrollment.subtitle", "使用手机扫码创建应用，JunQi 会继续完成 OpenClaw 官方配置。")
    : messageRenderedInBody
      ? t("setup.wizard.subtitle", "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。")
      : step.message || t("setup.wizard.subtitle", "按照 OpenClaw 官方流程完成模型、凭据、工作区和 Gateway 配置。");
  const handleEnrollmentConnected = async (completion: ChannelEnrollmentCompletion) => {
    setEnrollmentFinalizing(true);
    try {
      await new FeishuQrWizardBridge(completion).complete(step, flow.submitWizardStep);
      setEnrollmentDomain(null);
    } catch {
      await cancelChannelEnrollment(completion.sessionId);
      setEnrollmentDomain(null);
      setEnrollmentError(t("setup.wizard.channelEnrollment.handoffFailed", "扫码已验证，但 OpenClaw 配置未能继续。请重新生成二维码后重试。"));
    } finally {
      setEnrollmentFinalizing(false);
    }
  };

  return (
    <SetupShell
      active={4}
      title={wizardTitle}
      subtitle={wizardSubtitle}
      logs={logs}
      previousAction={{ onClick: flow.goBack, disabled: flow.wizardSubmitting }}
      nextAction={{
        label: feishuQrSetupMethod
          ? t("setup.wizard.channelEnrollment.start", "显示二维码")
          : step.type === "action" ? t("setup.wizard.run", "执行") : t("setup.nextStep", "下一步"),
        onClick: () => {
          if (feishuQrSetupMethod) {
            setEnrollmentError(null);
            setEnrollmentDomain(feishuDomain);
            return;
          }
          void flow.submitWizardStep(step.id, value);
        },
        disabled: flow.wizardSubmitting || blocked || enrollmentFinalizing,
        loading: flow.wizardSubmitting || enrollmentFinalizing,
        icon: "next",
      }}
    >
      <div className="space-y-4" dir="auto">
        {feishuQrSetupMethod && (
          <div className="space-y-4 rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">
            <p>{t("setup.wizard.channelEnrollment.description", "扫码会创建并验证飞书应用；凭据只会临时交给 OpenClaw 官方向导，不会显示在 JunQi 页面中。")}</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("setup.wizard.channelEnrollment.domain", "服务区域")}>
              {([
                ["feishu", t("setup.wizard.channelEnrollment.feishu", "飞书")],
                ["lark", t("setup.wizard.channelEnrollment.lark", "Lark")],
              ] as const).map(([domain, label]) => {
                const selected = feishuDomain === domain;
                return (
                  <button key={domain} type="button" role="radio" aria-checked={selected} onClick={() => setFeishuDomain(domain)} className={clsx("rounded-md border px-3 py-2 text-sm font-semibold transition", selected ? "border-aegis-primary bg-aegis-primary/10 text-aegis-text" : "border-aegis-border bg-aegis-surface text-aegis-text-secondary hover:border-aegis-primary/40")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {step.type === "text" && (
          <input
            type={step.sensitive ? "password" : "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValue(event.target.value)}
            placeholder={step.placeholder}
            aria-label={step.title || t("setup.wizard.textInput", "OpenClaw 配置值")}
            autoComplete={step.sensitive ? "new-password" : "off"}
            className="w-full rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2.5 text-sm text-aegis-text outline-none focus:border-aegis-primary"
          />
        )}
        {step.type === "confirm" && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-aegis-border bg-aegis-surface p-4 text-sm text-aegis-text">
            <input type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} className="h-4 w-4 accent-[rgb(var(--aegis-primary))]" />
            <span>{step.message || t("setup.wizard.confirm", "确认并继续")}</span>
          </label>
        )}
        {step.type === "select" && !feishuQrSetupMethod && (
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
        {step.type === "multiselect" && (
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
        {(step.type === "note" || step.type === "progress" || step.type === "action") && (
          <div className="rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">{step.message || t("setup.wizard.readyForStep", "此步骤由 OpenClaw 执行。")}</div>
        )}
        {enrollmentError && <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm leading-6 text-red-300">{enrollmentError}</div>}
        {flow.wizardError && <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm leading-6 text-red-300">{flow.wizardError}</div>}
      </div>
      {enrollmentDomain && (
        <ChannelEnrollmentDialog
          channel="feishu"
          domain={enrollmentDomain}
          finalizing={enrollmentFinalizing}
          onClose={() => setEnrollmentDomain(null)}
          onConnected={(completion) => { void handleEnrollmentConnected(completion); }}
        />
      )}
    </SetupShell>
  );
}

// ── 开机自启卡片(仅 Native 运行时) ──
// 通过官方 `openclaw gateway install/uninstall` 注册或移除系统服务;切换后
// 用现有 restart 流程把 Gateway 从"桌面托管"交接给系统服务(或反向),保证
// 结束时只有一个明确的托管方持有端口。Docker 运行时由容器重启策略负责。
function GatewayAutostartCard({ installMode }: { installMode: InstallMode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GatewayAutostartStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (installMode !== "native") return;
    let cancelled = false;
    void gatewayAutostartStatus()
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [installMode]);

  if (installMode !== "native" || !status?.supported) return null;
  const enabled = status.enabled;

  const toggleAutostart = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setPhase(enabled
        ? t("setup.autostart.disabling", "正在关闭开机自启…")
        : t("setup.autostart.enabling", "正在设置开机自启…"));
      const next = enabled ? await disableGatewayAutostart() : await enableGatewayAutostart();
      setStatus(next);
      // 交接托管方:开启后交给系统服务,关闭后回落到桌面托管。
      setPhase(t("setup.autostart.switching", "正在切换 OpenClaw 的运行方式,请稍候…"));
      await window.aegis.config.restart();
      setStatus(await gatewayAutostartStatus().catch(() => next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <div className="w-full rounded-xl border-2 border-aegis-primary/40 bg-aegis-primary/5 p-5 text-left">
      <div className="flex items-start gap-3">
        <span className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          enabled ? "bg-aegis-success/15 text-aegis-success" : "bg-aegis-primary/15 text-aegis-primary",
        )}>
          <Power size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-aegis-text">
              {t("setup.autostart.title", "要不要让 OpenClaw 开机自动运行?")}
            </span>
            {enabled && (
              <span className="inline-flex items-center gap-1 rounded-full border border-aegis-success/30 bg-aegis-success/10 px-2 py-0.5 text-[11px] font-medium text-aegis-success">
                <Check size={11} strokeWidth={3} />
                {t("setup.autostart.enabledBadge", "已开启")}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-aegis-text-secondary">
            {enabled
              ? t("setup.autostart.enabledHint", "已设置为开机自动运行:以后电脑一开机,OpenClaw 就会自动在后台工作,不需要打开本应用。随时可以在这里关闭。")
              : t("setup.autostart.hint", "开启后,电脑一开机 OpenClaw 就会自动在后台运行——不用打开本应用,你的消息渠道和定时任务也能照常工作。不开启也没关系:每次打开本应用时会自动启动它。")}
          </p>
          {busy && phase && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-aegis-text-muted">
              <LoaderCircle size={12} className="animate-spin" />
              {phase}
            </p>
          )}
          {error && <p className="mt-2 break-all text-xs text-aegis-danger">{error}</p>}
        </div>
        <button
          type="button"
          onClick={() => void toggleAutostart()}
          disabled={busy}
          className={clsx(
            "shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
            enabled
              ? "border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface"
              : "bg-aegis-primary text-white hover:opacity-90",
          )}
        >
          {enabled
            ? t("setup.autostart.disable", "关闭")
            : t("setup.autostart.enable", "开机自动运行")}
        </button>
      </div>
    </div>
  );
}

function ReadyScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const settledCount = flow.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const total = flow.steps.length || settledCount || 1;

  return (
    <SetupShell
      active={5}
      title={t("setup.ready")}
      subtitle={t("setup.readySubtitle")}
      logs={logs}
      previousAction={{ onClick: flow.goBack }}
      nextAction={{ label: t("setup.enterWorkspace"), onClick: (event) => flow.enterWorkspace(event.currentTarget) }}
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
              const skipped = s.status === "skipped";
              return (
                <span
                  key={s.id}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                    done
                      ? "border-aegis-success/30 bg-aegis-success/10 text-aegis-success"
                      : skipped
                        ? "border-aegis-border bg-aegis-surface text-aegis-text-muted"
                      : "border-aegis-border text-aegis-text-dim",
                  )}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : skipped ? <Minus size={13} /> : <Circle size={12} />}
                  {label}
                </span>
              );
            })}
          </div>
        )}
        <div className="text-xs text-aegis-text-dim">
          {settledCount}/{total} {t("setup.installPanel.stepsDone", "个步骤已处理")}
        </div>
        <GatewayAutostartCard installMode={flow.installMode} />
        {flow.openclawStatus?.installed && (
          <div className="w-full text-left">
            <OpenClawUpdatePanel
              currentVersion={flow.openclawStatus.version}
              onUpdated={async () => { await flow.refreshRuntime(); }}
            />
          </div>
        )}
      </div>
    </SetupShell>
  );
}

function GitMissingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const isMac = window.aegis?.platform === "darwin";
  const description = isMac
    ? t("setup.gitMacRequiredDesc", "Apple 命令行工具安装器已打开。完成系统安装后重新检测 Git。")
    : t("setup.gitRequiredDesc");
  return (
    <SetupShell
      active={3}
      title={t("setup.gitRequired")}
      subtitle={description}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.gitRetry"), onClick: () => flow.retryGit(), icon: "none" }}
    >
      <StatusPanel
        icon={<Package size={22} />}
        tone="danger"
        eyebrow={t("setup.steps.install.title")}
        title={t("setup.gitRequired")}
        message={description}
      />
    </SetupShell>
  );
}

function NodeMissingScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const requirement = flow.nodeRequirement ?? t("setup.nodeRequirementUnknown", "OpenClaw 所需版本");
  const message = t("setup.nodeRequiredDesc", { requirement });
  return (
    <SetupShell
      active={3}
      title={t("setup.nodeRequired")}
      subtitle={message}
      logs={logs}
      previousAction={{ onClick: () => flow.goBack() }}
      nextAction={{ label: t("setup.nodeRetry"), onClick: () => flow.retryNode(), icon: "none" }}
    >
      <div className="space-y-3">
        <StatusPanel
          icon={<Package size={22} />}
          tone="danger"
          eyebrow={t("setup.steps.install.title")}
          title={t("setup.nodeRequired")}
          message={message}
        />
        <p className="text-sm leading-6 text-aegis-text-secondary">
          {t("setup.nodeRequiredInstallHint")}
        </p>
        <a
          href="https://npmmirror.com/mirrors/node/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-sm font-medium text-aegis-primary hover:underline"
        >
          {t("setup.nodeDownload")}
        </a>
      </div>
    </SetupShell>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const setupStep = useAppStore((s) => s.setupStep);
  const logs = useAppStore((s) => s.setupLogs);
  const appendSetupLog = useAppStore((s) => s.appendSetupLog);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [checkingDocker, setCheckingDocker] = useState(false);
  const [needsGit, setNeedsGit] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);

  const flow = useSetupFlow(
    progress, setProgress, statusMessage, setStatusMessage,
    dockerStatus, setDockerStatus, checkingDocker, setCheckingDocker,
    needsGit, setNeedsGit,
    steps, setSteps,
  );

  useEffect(() => {
    const unlistenSetup = subscribeTauriEvent("setup-progress", (event) => {
      const detail = normalizeSetupProgressPayload(event.payload);
      if (!detail) return;
      const message = translateSetupProgressMessage(
        detail.key,
        detail.message,
        (key, options) => t(key, options),
        detail.params,
      );
      appendSetupLog({
        source: "setup",
        message,
        step: detail.step ?? undefined,
        level: classifySetupMessage(message, detail.error),
        progress: detail.progress ?? undefined,
      });
    });

    const unlistenGateway = subscribeTauriEvent<string>("gateway-log", (event) => {
      if (event.payload) appendSetupLog({
        source: "gateway",
        message: event.payload,
        level: classifySetupMessage(event.payload),
      });
    });

    return combineUnlisteners([unlistenSetup, unlistenGateway]);
  }, [appendSetupLog, t]);

  const sharedLogs = useMemo(() => logs, [logs]);
  switch (setupStep) {
    case "welcome": return <WelcomeScreen logs={sharedLogs} />;
    case "detecting": return <DetectingScreen flow={flow} logs={sharedLogs} />;
    case "storage": return <StorageSetupStep logs={sharedLogs} onReady={flow.completeStorageSetup} onBack={flow.goBack} forceConfigure={flow.forceStorageSelection} />;
    case "gateway-stopped": return <GatewayStoppedScreen flow={flow} logs={sharedLogs} />;
    case "choosing-mode": return <ModeSelectScreen flow={flow} logs={sharedLogs} />;
    case "ready": return <ReadyScreen flow={flow} logs={sharedLogs} />;
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "install-complete":
    case "error": return <ProgressScreen flow={flow} logs={sharedLogs} />;
    case "configure-openclaw": return <WizardScreen flow={flow} logs={sharedLogs} />;
    case "git-missing": return <GitMissingScreen flow={flow} logs={sharedLogs} />;
    case "node-missing": return <NodeMissingScreen flow={flow} logs={sharedLogs} />;
    default: return <DetectingScreen flow={flow} logs={sharedLogs} />;
  }
}
