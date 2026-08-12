// 首次进入阶段共用一个常驻页面壳，只替换欢迎内容和环境状态数据。
import { CheckCircle2, Container, Monitor, RefreshCw, Server } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { LanguageThemeControls, useSetupNavigation } from "./shared";

export type EnvironmentEntryPhase = "welcome" | "detecting" | "review";

const useClientLayoutEffect = typeof document !== "undefined"
  && typeof document.createElement === "function"
  ? useLayoutEffect
  : useEffect;

export function environmentReviewActionsDisabled(
  checkingDocker: boolean,
  environmentReviewBusy: boolean,
): boolean {
  return checkingDocker || environmentReviewBusy;
}

export function resetEnvironmentEntryNavigationLock(
  phase: EnvironmentEntryPhase,
  locked: boolean,
): boolean {
  return phase === "welcome" ? false : locked;
}

export function EnvironmentEntryScreen({
  flow,
  logs,
  phase,
}: {
  flow: SetupFlow;
  logs: SetupLog[];
  phase: EnvironmentEntryPhase;
}) {
  const { t } = useTranslation();
  const navigateSetup = useSetupNavigation();
  const navigationInFlightRef = useRef(false);
  const welcome = phase === "welcome";
  const detecting = phase === "detecting";
  const actionsDisabled = environmentReviewActionsDisabled(
    flow.checkingDocker,
    flow.environmentReviewBusy,
  );

  useClientLayoutEffect(() => {
    // 页面骨架常驻后，返回欢迎阶段必须释放上一次前进操作留下的单飞锁。
    navigationInFlightRef.current = resetEnvironmentEntryNavigationLock(
      phase,
      navigationInFlightRef.current,
    );
  }, [phase]);

  const continueFromWelcome = () => {
    if (navigationInFlightRef.current) return;
    navigationInFlightRef.current = true;
    navigateSetup("detecting");
  };

  return (
    <SetupShell
      active={flow.presentation.stage}
      title={welcome ? t("setup.title") : t("setup.runtimeTitle")}
      subtitle={welcome ? t("setup.welcomeSubtitle") : t("setup.runtimeSubtitle")}
      logs={logs}
      contentOverflow={welcome ? "visible" : "auto"}
      previousAction={welcome ? undefined : {
        onClick: flow.goBack,
        disabled: detecting ? false : actionsDisabled,
      }}
      secondaryAction={welcome || detecting ? undefined : {
        label: flow.checkingDocker
          ? t("setup.recheckingEnvironment", "正在重新检测…")
          : t("setup.recheckEnvironment", "重新检测"),
        onClick: flow.redetectEnvironment,
        loading: flow.checkingDocker,
        disabled: actionsDisabled,
      }}
      nextAction={welcome ? {
        label: t("setup.nextStep", "下一步"),
        onClick: continueFromWelcome,
      } : {
        label: detecting ? t("setup.detecting") : t("setup.nextStep", "下一步"),
        onClick: flow.continueAfterEnvironmentReview,
        disabled: detecting || actionsDisabled,
        loading: detecting,
        icon: detecting ? "none" : "next",
      }}
    >
      {welcome ? <WelcomeContent /> : <EnvironmentReviewContent flow={flow} phase={phase} />}
    </SetupShell>
  );
}

export function WelcomeContent() {
  const { t } = useTranslation();
  return (
    <>
      <div className="mb-4 grid gap-3 border-b border-aegis-border pb-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-aegis-primary">JunQi Desktop</div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-aegis-text-dim">{t("setup.companyLabel")}</div>
          <div className="mt-0.5 text-base font-semibold text-aegis-text">{t("setup.companyName")}</div>
          <p className="mt-2 text-sm leading-6 text-aegis-text-muted min-[520px]:whitespace-nowrap" dir="auto">
            {t("setup.productIntro")}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-aegis-border bg-aegis-surface text-aegis-primary">
          <Monitor size={23} strokeWidth={1.7} />
        </div>
      </div>
      <LanguageThemeControls />
    </>
  );
}

export function EnvironmentReviewContent({
  flow,
  phase,
}: {
  flow: SetupFlow;
  phase: "detecting" | "review";
}) {
  const { t } = useTranslation();
  const detecting = phase === "detecting";
  const loading = detecting || flow.checkingDocker;
  const nativeReady = flow.openclawStatus?.installed === true
    && !flow.openclawStatus.relocation_required;
  const dockerInstalled = flow.dockerStatus?.available === true;
  const dockerReady = dockerInstalled && flow.dockerStatus?.daemon_running === true;
  const selectedRuntimeReady = flow.installMode === "docker" ? dockerReady : nativeReady;
  const loadingLabel = t("setup.detecting");

  return (
    <div className="grid gap-4" aria-busy={loading}>
      <StatusPanel
        icon={loading
          ? <RefreshCw size={22} className="animate-spin motion-reduce:animate-none" />
          : <CheckCircle2 size={22} />}
        tone={loading ? undefined : "success"}
        eyebrow={t("setup.steps.environment.title", "环境")}
        title={detecting
          ? loadingLabel
          : flow.checkingDocker
            ? t("setup.recheckingEnvironment", "正在重新检测…")
            : t("setup.environmentReviewReady", "环境检测完成")}
        message={detecting
          ? t("setup.runtimeSubtitle")
          : flow.checkingDocker
            ? t(
              "setup.recheckingEnvironmentHint",
              "正在刷新 OpenClaw、Gateway 和 Docker 状态，请稍候。",
            )
            : t(
              "setup.environmentReviewHint",
              "请确认检测结果。下一步将选择 OpenClaw 数据位置；返回此页面不会重新执行检测。",
            )}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <EnvironmentItem
          icon={<Server size={18} />}
          label={t("setup.selectedRuntime", "当前运行方式")}
          value={flow.installMode === "docker" ? t("setup.modeDocker") : t("setup.modeNative")}
          ready={selectedRuntimeReady}
          loading={loading}
          loadingLabel={loadingLabel}
        />
        <EnvironmentItem
          icon={<Monitor size={18} />}
          label={t("setup.modeNative")}
          value={nativeReady
            ? t("setup.environmentAvailable", "可用")
            : t("setup.environmentNeedsPreparation", "需要准备")}
          ready={nativeReady}
          loading={loading}
          loadingLabel={loadingLabel}
        />
        <EnvironmentItem
          icon={<Container size={18} />}
          label={t("setup.dockerDesktop", "Docker Desktop")}
          value={dockerReady
            ? t("setup.dockerRunning", "运行中，可使用")
            : dockerInstalled
              ? t("setup.dockerInstalledStopped", "已安装，尚未运行")
              : t("setup.dockerNotDetected", "未检测到 Docker")}
          ready={dockerReady}
          loading={loading}
          loadingLabel={loadingLabel}
        />
      </div>
    </div>
  );
}

function EnvironmentItem({
  icon,
  label,
  value,
  ready,
  loading = false,
  loadingLabel,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ready: boolean;
  loading?: boolean;
  loadingLabel: string;
}) {
  return (
    <div
      data-environment-item
      className="rounded-lg border border-aegis-border bg-aegis-surface/45 p-4"
    >
      <div className="flex items-center gap-2 text-aegis-primary">
        {icon}
        <span className="text-sm font-semibold text-aegis-text">{label}</span>
      </div>
      {loading ? (
        <div
          data-environment-item-loading
          aria-label={loadingLabel}
          className="mt-3 h-5 w-24 rounded bg-aegis-border/70"
        />
      ) : (
        <div
          className={ready
            ? "mt-3 min-h-5 text-sm font-medium text-aegis-success"
            : "mt-3 min-h-5 text-sm font-medium text-aegis-text-muted"}
        >
          {value}
        </div>
      )}
    </div>
  );
}
