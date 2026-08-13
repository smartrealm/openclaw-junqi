import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Minus,
  Package,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "framer-motion";
import { save } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import clsx from "clsx";
import {
  exportSetupDiagnosticsBundle,
  openSetupDiagnosticsDirectory,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import type { SetupLog } from "@/stores/app-store";
import type { InstallTarget, SetupFlow, StepState } from "@/hooks/useSetupFlow";
import { SetupContentScene, SetupStepScene, useSetupStepScrollKey, type SetupContentMotion } from "@/motion/setupStepTransition";

const useClientLayoutEffect = typeof document !== "undefined"
  && typeof document.createElement === "function"
  ? useLayoutEffect
  : useEffect;

const SETUP_STEPS = [
  { id: "environment", titleKey: "setup.steps.environment.title", titleFallback: "Environment", descriptionKey: "setup.steps.environment.description", descriptionFallback: "OpenClaw / Docker" },
  { id: "storage", titleKey: "setup.steps.storage.title", titleFallback: "Data location", descriptionKey: "setup.steps.storage.description", descriptionFallback: "Configuration / Workspace" },
  { id: "runtime", titleKey: "setup.steps.runtime.title", titleFallback: "Runtime", descriptionKey: "setup.steps.runtime.description", descriptionFallback: "Install and start Gateway" },
  { id: "configuration", titleKey: "setup.steps.configuration.title", titleFallback: "OpenClaw setup", descriptionKey: "setup.steps.configuration.description", descriptionFallback: "Models / credentials / optional channels" },
  { id: "ready", titleKey: "setup.steps.ready.title", titleFallback: "Complete", descriptionKey: "setup.steps.ready.description", descriptionFallback: "Enter dashboard" },
] as const;

export const STEP_META: Record<string, { titleKey: string; titleFallback: string; descriptionKey: string; descriptionFallback: string }> = {
  git: {
    titleKey: "setup.installSteps.git.title",
    titleFallback: "Git",
    descriptionKey: "setup.installSteps.git.description",
    descriptionFallback: "检测源码与包管理工具，仅在安装需要时补齐",
  },
  node: {
    titleKey: "setup.installSteps.node.title",
    titleFallback: "Node.js",
    descriptionKey: "setup.installSteps.node.description",
    descriptionFallback: "确认本地运行时版本，缺失时安装内置版本",
  },
  npm: {
    titleKey: "setup.installSteps.npm.title",
    titleFallback: "npm",
    descriptionKey: "setup.installSteps.npm.description",
    descriptionFallback: "确认包管理器版本与 OpenClaw 安装能力",
  },
  openclaw: {
    titleKey: "setup.installSteps.openclaw.title",
    titleFallback: "OpenClaw",
    descriptionKey: "setup.installSteps.openclaw.description",
    descriptionFallback: "检查 CLI 包与 Gateway 能力，必要时执行安装",
  },
  gateway: {
    titleKey: "setup.installSteps.gateway.title",
    titleFallback: "OpenClaw Gateway",
    descriptionKey: "setup.installSteps.gateway.description",
    descriptionFallback: "验证 Gateway 配置并准备启动控制通道",
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

type SetupAction = {
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  loading?: boolean;
};

type SetupNextAction = SetupAction & {
  label: string;
  loading?: boolean;
  icon?: "next" | "none";
};

function Stepper({ active, activeComplete = false }: { active: number; activeComplete?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="px-6 pt-6" dir="ltr">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-5 items-start rounded-xl border border-aegis-border bg-aegis-elevated px-3 py-3 shadow-sm">
        {SETUP_STEPS.map(({ id, titleKey, titleFallback, descriptionKey, descriptionFallback }, i) => {
          const done = i < active;
          const current = i === active;
          const currentComplete = current && activeComplete;
          return (
            <div key={id} className="relative flex min-w-0 flex-col items-center gap-2 text-center">
              {i < SETUP_STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className={clsx(
                    "absolute left-[calc(50%+1rem)] right-[calc(-50%+1rem)] top-4 h-[2px] rounded-full transition-colors",
                    i < active ? "bg-aegis-primary/35" : "bg-aegis-border",
                  )}
                />
              )}
              <div
                data-setup-step-current-complete={currentComplete || undefined}
                className={clsx(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-black transition-colors",
                  done && "border-aegis-primary/45 bg-aegis-primary/10 text-aegis-primary",
                  current && !currentComplete && "border-aegis-primary bg-aegis-bg text-aegis-primary shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.12)]",
                  currentComplete && "border-aegis-success bg-aegis-success/10 text-aegis-success shadow-[0_0_0_3px_rgb(var(--aegis-success)/0.12)]",
                  !done && !current && "border-aegis-border bg-aegis-surface text-aegis-text-dim",
                )}
              >
                {done || currentComplete ? <Check size={15} strokeWidth={3} /> : i + 1}
              </div>
              <div className="min-w-0 px-1">
                <div
                  className={clsx(
                    "break-words text-xs font-bold leading-4",
                    current && "text-aegis-text",
                    done && !current && "text-aegis-text-secondary",
                    !done && !current && "text-aegis-text-dim",
                  )}
                  dir="auto"
                >
                  {t(titleKey, titleFallback)}
                </div>
                <div
                  className={clsx("mt-0.5 hidden break-words text-[11px] font-medium leading-4 sm:block", current ? "text-aegis-text-secondary" : "text-aegis-text-dim")}
                  dir="auto"
                >
                  {t(descriptionKey, descriptionFallback)}
                </div>
              </div>
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
    .map(formatSetupLogLine)
    .join("\n");
  const copyLogs = () => {
    if (!logText) return;
    void navigator.clipboard?.writeText(logText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => undefined);
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
          logs.map((log, i) => (
            <div
              key={`${log.source}-${i}`}
              className={clsx(
                log.level === "error" && "text-red-300",
                log.level === "warn" && "text-amber-300",
                log.level === "success" && "text-aegis-success",
                (!log.level || log.level === "info") && "text-aegis-text-secondary",
              )}
            >
              <span className="text-aegis-text-dim">[{log.source}]</span> {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SetupShell({
  active,
  activeComplete = false,
  title,
  subtitle,
  children,
  logs,
  previousAction,
  secondaryAction,
  nextAction,
  wide = false,
  showLogToggle = true,
  logVisibility = "collapsed",
  contentIdentity,
  contentMotion = "ambient",
}: {
  active: number;
  activeComplete?: boolean;
  title: string;
  subtitle: string;
  children: ReactNode;
  logs: SetupLog[];
  previousAction?: SetupAction;
  secondaryAction?: SetupAction;
  nextAction?: SetupNextAction;
  wide?: boolean;
  showLogToggle?: boolean;
  logVisibility?: "collapsed" | "expanded";
  contentIdentity?: string;
  contentMotion?: SetupContentMotion;
}) {
  const { t } = useTranslation();
  const [showLogs, setShowLogs] = useState(logVisibility === "expanded");
  const contentViewportRef = useRef<HTMLElement>(null);
  const scrollKey = useSetupStepScrollKey(contentIdentity);
  const isRuntime = active >= 2 && active < 4;
  const showActions = previousAction || secondaryAction || nextAction;
  const hasContentTransition = contentIdentity !== undefined;
  // 调用方要求默认展开时，即使首条运行日志尚未到达也保留日志区域，避免界面布局跳动。
  const shouldShowLogs = isRuntime && showLogToggle && (logs.length > 0 || logVisibility === "expanded");

  useEffect(() => {
    setShowLogs(logVisibility === "expanded");
  }, [logVisibility]);

  useClientLayoutEffect(() => {
    // 步骤变化时在首次绘制前复位滚动，不通过 React key 重建主体和异步状态组件。
    if (contentViewportRef.current) contentViewportRef.current.scrollTop = 0;
  }, [scrollKey]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-aegis-bg text-aegis-text" dir="ltr">
      <div
        data-tauri-drag-region
        className="h-[32px] shrink-0 chrome-bg border-b border-aegis-border/30"
      />
      <Stepper active={active} activeComplete={activeComplete} />
      <main
        ref={contentViewportRef}
        data-setup-scroll-key={scrollKey ?? "setup"}
        className="flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6"
      >
        <SetupStepScene className="flex-none">
          <section className={clsx(
            "flex w-full flex-col",
            wide ? "max-w-5xl" : "max-w-3xl",
          )}>
            <div className={clsx(
              "mb-4 flex h-[96px] shrink-0 flex-col items-center text-center sm:mb-5",
              subtitle ? "" : "justify-center",
            )}>
              <h1 className="line-clamp-1 text-2xl font-semibold tracking-normal text-aegis-text sm:text-[30px]" dir="auto">{title}</h1>
              {subtitle && (
                <p className="mx-auto mt-2 line-clamp-2 min-h-12 max-w-xl text-sm leading-6 text-aegis-text-muted" dir="auto">{subtitle}</p>
              )}
            </div>
            <div
              data-setup-content-layout="stable"
              data-setup-content-sizing="content"
              className={clsx(
                wide ? "" : "rounded-xl border border-aegis-border bg-aegis-elevated p-4 shadow-sm sm:p-6",
                "flex flex-col",
              )}
            >
              <div
                data-setup-content-viewport="stable"
                className="w-full"
              >
                {hasContentTransition ? (
                  <SetupContentScene identity={scrollKey ?? "wizard"} motion={contentMotion}>
                    {children}
                  </SetupContentScene>
                ) : children}
              </div>
              {shouldShowLogs && (
                <div className="mt-4 shrink-0 border-t border-aegis-border pt-4">
                  <button
                    type="button"
                    onClick={() => setShowLogs((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-lg border border-aegis-border px-3 py-2 text-xs font-medium text-aegis-text-secondary transition-[background-color,border-color,color,transform] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] hover:bg-aegis-surface active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45"
                  >
                    {showLogs ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showLogs ? t("setup.hideLogs") : t("setup.viewLogs")}
                  </button>
                  {showLogs && <LogPanel logs={logs} />}
                </div>
              )}
            </div>
          </section>
        </SetupStepScene>
      </main>
      {showActions && (
        <footer className="shrink-0 border-t border-aegis-border/60 bg-aegis-bg/95 px-3 py-3 backdrop-blur sm:px-6">
          <div data-setup-footer-layout="responsive" className={clsx("mx-auto grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(112px,1fr)_minmax(0,auto)] sm:items-center", wide ? "max-w-5xl" : "max-w-3xl")}>
            <div data-setup-footer-previous className="flex min-w-0 justify-start">
              {previousAction && (
              <button
                type="button"
                onClick={previousAction.onClick}
                disabled={previousAction.disabled}
                className="inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-lg border-2 border-aegis-border bg-aegis-elevated px-4 py-2.5 text-[15px] font-bold text-aegis-text transition-[background-color,border-color,color,transform,opacity] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] shadow-sm hover:bg-aegis-surface active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ChevronLeft size={15} />
                {previousAction.label ?? t("setup.previousStep")}
              </button>
              )}
            </div>
            <div data-setup-footer-actions className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {secondaryAction && (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled || secondaryAction.loading}
                  className="inline-flex min-w-[112px] items-center justify-center gap-2 rounded-lg border-2 border-aegis-border bg-aegis-elevated px-4 py-2.5 text-[14px] font-bold text-aegis-text-secondary transition-[background-color,border-color,color,transform,opacity] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] hover:bg-aegis-surface active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
                >
                  {secondaryAction.loading && <RefreshCw size={14} className="animate-spin motion-reduce:animate-none" />}
                  {secondaryAction.label}
                </button>
              )}
              {nextAction ? (
              <button
                data-setup-footer-primary
                type="button"
                onClick={nextAction.onClick}
                disabled={nextAction.disabled || nextAction.loading}
                className="inline-flex w-full min-w-[122px] items-center justify-center gap-2 rounded-lg border-2 border-aegis-primary bg-aegis-primary px-4 py-2.5 text-[15px] font-bold text-[var(--aegis-btn-primary-text)] transition-[background-color,border-color,color,transform,opacity] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] shadow-sm hover:bg-aegis-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/55 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
              >
                {nextAction.loading && <RefreshCw size={15} className="animate-spin motion-reduce:animate-none" />}
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

export function StatusPanel({
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
          <p className="mt-2 min-h-12 max-w-[68ch] break-words text-sm leading-6 text-aegis-text-muted" dir="auto">{message}</p>
          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

type TierBadgeStyles = {
  border: string;
  bg: string;
  text: string;
};

const TIER_BADGE: Record<InstallTarget["tier"], TierBadgeStyles> = {
  user: { border: "border-aegis-success/45", bg: "bg-aegis-success/10", text: "text-aegis-success" },
  userMissingPath: { border: "border-amber-500/45", bg: "bg-amber-500/10", text: "text-amber-200" },
  custom: { border: "border-sky-500/45", bg: "bg-sky-500/10", text: "text-sky-200" },
  existing: { border: "border-sky-500/45", bg: "bg-sky-500/10", text: "text-sky-200" },
};

function resolveInstallNote(target: InstallTarget, t: TFunction): string {
  switch (target.tier) {
    case "user":
      return t("setup.installTarget.user.note", "与终端 `npm i -g` 落点一致；安装后 `openclaw` 已在你的 PATH 中");
    case "userMissingPath":
      return t("setup.installTarget.userMissingPath.note", "与终端 npm 的全局落点一致，但该目录尚未加入 PATH；可通过终端集成启用 `openclaw`");
    case "custom":
      return t("setup.installTarget.custom.note", "OpenClaw 将安装到你选择的 npm 全局目录；终端可用性由终端集成单独验证");
    case "existing":
      if (target.path && target.version) {
        return t("setup.installTarget.existing.note", {
          version: target.version,
          path: target.path,
          defaultValue: "已检测到 OpenClaw {{version}}（位于 {{path}}），跳过安装",
        });
      }
      if (target.path) {
        return t("setup.installTarget.existing.noteNoVersion", {
          path: target.path,
          defaultValue: "已检测到 OpenClaw（位于 {{path}}），跳过安装",
        });
      }
      return t("setup.installTarget.existing.noteNoPath", "已检测到 OpenClaw 安装，但路径与版本未返回");
  }
}

export function InstallTargetCard({ target }: { target: InstallTarget }) {
  const { t } = useTranslation();
  const styles = TIER_BADGE[target.tier];
  const tierLabel = t(
    `setup.installTarget.${target.tier}.tier`,
    target.tier === "user"
      ? "用户 npm 前缀"
      : target.tier === "userMissingPath"
        ? "用户 npm 前缀（未加入 PATH）"
        : target.tier === "custom"
          ? "自定义 npm 前缀"
          : "已安装",
  );
  const note = resolveInstallNote(target, t);
  return (
    <div className="mt-3 rounded-md border border-aegis-border bg-aegis-bg/55 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-aegis-text-dim">
        <Package size={12} />
        {t("setup.installTarget.title", "安装位置")}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className={clsx(
          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          styles.border,
          styles.bg,
          styles.text,
        )}>
          {tierLabel}
        </span>
        <code
          data-testid="install-target-path"
          className="break-all rounded bg-aegis-bg/70 px-1.5 py-0.5 font-mono text-[11px] text-aegis-text"
        >
          {target.path}
        </code>
        {target.version && (
          <span
            data-testid="install-target-version"
            className="rounded bg-aegis-bg/70 px-1.5 py-0.5 font-mono text-[11px] text-aegis-text-muted"
          >
            v{target.version}
          </span>
        )}
      </div>
      {note && (
        <p className="mt-1.5 text-[11px] leading-4 text-aegis-text-muted" dir="auto">
          {note}
        </p>
      )}
    </div>
  );
}

function RuntimeDetailRow({
  label,
  value,
  tone = "neutral",
  mono = false,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "error";
  mono?: boolean;
}) {
  const toneClass = {
    neutral: "text-aegis-text-secondary",
    ok: "text-aegis-success",
    warn: "text-amber-200",
    error: "text-red-300",
  }[tone];

  return (
    <div className="grid grid-cols-[92px_1fr] gap-3 border-b border-aegis-border/55 py-2.5 last:border-b-0">
      <div className="text-[11px] font-medium text-aegis-text-dim" dir="auto">{label}</div>
      <div className={clsx("min-w-0 break-words text-xs leading-5", toneClass, mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

function RuntimeCheck({ label, ok }: { label: string; ok?: boolean | null }) {
  const { t } = useTranslation();
  const known = typeof ok === "boolean";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-aegis-border bg-aegis-bg/45 px-3 py-2">
      <span className="min-w-0 text-xs text-aegis-text-secondary" dir="auto">{label}</span>
      <span className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        known && ok && "bg-aegis-success/10 text-aegis-success",
        known && !ok && "bg-red-500/10 text-red-300",
        !known && "bg-aegis-surface text-aegis-text-dim",
      )}>
        {known && ok ? <Check size={11} strokeWidth={3} /> : known ? <X size={11} strokeWidth={3} /> : <Circle size={10} />}
        {known ? (ok ? t("setup.runtimeDetails.ok", "通过") : t("setup.runtimeDetails.failed", "失败")) : t("setup.runtimeDetails.unknown", "未知")}
      </span>
    </div>
  );
}

function installMethodLabel(source: string | null | undefined, target: InstallTarget | null, t: TFunction): string {
  switch (source) {
    case "OPENCLAW_BIN":
      return t("setup.runtimeDetails.sourceEnv", "环境变量 OPENCLAW_BIN 指定");
    case "saved-selection":
      return t("setup.runtimeDetails.sourceSaved", "JunQi 已保存的 OpenClaw 路径");
    case "saved-selection:user-npm-prefix":
      return t("setup.runtimeDetails.sourceSavedUserNpm", "JunQi 已保存路径（npm 全局安装）");
    case "user-npm-prefix":
      return t("setup.runtimeDetails.sourceUserNpm", "npm 全局安装（用户 prefix）");
    case "PATH":
      return t("setup.runtimeDetails.sourcePath", "系统 PATH 中发现");
  }
  if (!target) return t("setup.runtimeDetails.methodDetected", "检测到的本机安装");
  switch (target.tier) {
    case "user":
      return t("setup.runtimeDetails.methodUser", "npm 全局安装（用户 prefix）");
    case "userMissingPath":
      return t("setup.runtimeDetails.methodUserMissingPath", "npm 全局安装（未加入 PATH）");
    case "custom":
      return t("setup.runtimeDetails.methodCustom", "npm 全局安装（自定义 prefix）");
    case "existing":
      return t("setup.runtimeDetails.methodExisting", "已有安装（跳过安装）");
  }
}

export function OpenClawRuntimeDetails({
  status,
  installTarget,
  gatewayState = "stopped",
}: {
  status: OpenclawStatus | null;
  installTarget: InstallTarget | null;
  gatewayState?: "checking" | "starting" | "stopped" | "running" | "unknown";
}) {
  const { t } = useTranslation();
  const installed = Boolean(status?.installed);
  const gatewayTone =
    gatewayState === "running" ? "ok" :
      gatewayState === "stopped" ? "warn" :
        gatewayState === "checking" || gatewayState === "starting" ? "neutral" : "neutral";
  const gatewayLabel =
    gatewayState === "running" ? t("setup.runtimeDetails.gatewayRunning", "运行中") :
      gatewayState === "stopped" ? t("setup.runtimeDetails.gatewayStopped", "未运行") :
        gatewayState === "checking" ? t("setup.runtimeDetails.gatewayChecking", "检测中") :
          gatewayState === "starting" ? t("setup.startingGateway") :
          t("setup.runtimeDetails.unknown", "未知");

  return (
    <section className="rounded-xl border border-aegis-border bg-aegis-elevated p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalSquare size={16} className="text-aegis-primary" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-aegis-text" dir="auto">
              {t("setup.runtimeDetails.title", "安装与运行信息")}
            </div>
            <div className="mt-0.5 text-[11px] text-aegis-text-dim" dir="auto">
              {t("setup.runtimeDetails.subtitle", "JunQi 当前实际检测到的 OpenClaw 环境")}
            </div>
          </div>
        </div>
        <span className={clsx(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
          installed ? "bg-aegis-success/10 text-aegis-success" : "bg-red-500/10 text-red-300",
        )}>
          {installed ? <CheckCircle2 size={13} /> : <X size={13} />}
          {installed ? t("setup.runtimeDetails.installed", "已安装") : t("setup.runtimeDetails.notInstalled", "未安装")}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="rounded-lg border border-aegis-border bg-aegis-bg/45 px-3">
          <RuntimeDetailRow
            label={t("setup.runtimeDetails.method", "安装方式")}
            value={installMethodLabel(status?.source, installTarget, t)}
            tone={installed ? "ok" : "warn"}
          />
          <RuntimeDetailRow
            label={t("setup.runtimeDetails.binaryPath", "二进制路径")}
            value={status?.path || t("setup.runtimeDetails.notReturned", "未返回")}
            tone={status?.path ? "neutral" : "warn"}
            mono
          />
          <RuntimeDetailRow
            label={t("setup.runtimeDetails.version", "版本")}
            value={status?.version ? `v${status.version}` : t("setup.runtimeDetails.notReturned", "未返回")}
            tone={status?.version ? "neutral" : "warn"}
            mono
          />
          <RuntimeDetailRow
            label={t("setup.runtimeDetails.gateway", "Gateway")}
            value={gatewayLabel}
            tone={gatewayTone}
          />
        </div>

        <div className="grid content-start gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <RuntimeCheck label={t("setup.runtimeDetails.binaryFound", "找到 openclaw 可执行文件")} ok={status?.binary_found ?? null} />
          <RuntimeCheck label={t("setup.runtimeDetails.packageValid", "npm 包信息有效")} ok={status?.package_valid ?? null} />
          <RuntimeCheck label={t("setup.runtimeDetails.gatewayCommandOk", "支持 Gateway 启动命令")} ok={status?.gateway_command_ok ?? null} />
        </div>
      </div>

      {status?.error && (
        <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 font-mono text-[11px] leading-5 text-red-300">
          {status.error}
        </div>
      )}

      {installTarget && (
        <InstallTargetCard target={installTarget} />
      )}
    </section>
  );
}

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
  if (status === "skipped") return <Minus size={15} strokeWidth={2.4} />;
  if (status === "running") return <RefreshCw size={15} className="animate-spin motion-reduce:animate-none" />;
  if (status === "error") return <X size={15} strokeWidth={2.5} />;
  return <Circle size={14} />;
}

export function currentStepOf(steps: StepState[]): StepState | null {
  return steps.find((s) => s.status === "running")
    ?? steps.find((s) => s.status === "error")
    ?? steps.find((s) => s.status === "pending")
    ?? steps[steps.length - 1]
    ?? null;
}

function installationCompletionPercent(steps: StepState[]): number {
  if (steps.length === 0) return 0;
  const completed = steps.reduce((total, step) => {
    if (step.status === "done" || step.status === "skipped") return total + 1;
    if (step.status !== "running") return total;
    // A running step may report byte/process progress. It contributes only its
    // completed fraction and cannot make the overall workflow read as complete
    // until the step itself has settled.
    const fraction = typeof step.progress === "number"
      ? Math.max(0, Math.min(99, step.progress)) / 100
      : 0;
    return total + fraction;
  }, 0);
  return Math.round((completed / steps.length) * 100);
}

export function installStepTitle(step: StepState | null, t: TFunction): string | null {
  if (!step) return null;
  const meta = STEP_META[step.id];
  return meta ? t(meta.titleKey, meta.titleFallback) : step.label;
}

function InstallationTimeline({ steps }: { steps: StepState[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const visibleSteps = steps.length > 0 ? steps : [{ id: "gateway", label: "Gateway", status: "pending" as const }];
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const current = currentStepOf(visibleSteps);

  useEffect(() => {
    const viewport = viewportRef.current;
    const row = current ? rowRefs.current.get(current.id) : null;
    if (!viewport || !row) return;
    const viewportTop = viewport.scrollTop;
    const viewportBottom = viewportTop + viewport.clientHeight;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop >= viewportTop && rowBottom <= viewportBottom) return;
    viewport.scrollTo({
      top: Math.max(0, rowTop - (viewport.clientHeight - row.offsetHeight) / 2),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [current?.id, current?.status, reduceMotion]);

  return (
    <section className="h-[390px] overflow-hidden bg-aegis-elevated">
      <div className="flex h-12 items-center border-b border-aegis-border px-4">
        <div className="text-sm font-semibold text-aegis-text">{t("setup.installPanel.timeline", "执行步骤")}</div>
      </div>
      <div ref={viewportRef} className="h-[342px] overflow-auto px-4 py-2">
      {visibleSteps.map((s, index) => (
        <div
          key={s.id}
          ref={(node) => {
            if (node) rowRefs.current.set(s.id, node);
            else rowRefs.current.delete(s.id);
          }}
          className={clsx(
            "relative grid grid-cols-[34px_1fr] gap-3 py-3",
            index < visibleSteps.length - 1 && "after:absolute after:left-[16px] after:top-11 after:h-[calc(100%-34px)] after:w-px after:bg-aegis-border",
          )}
        >
          <div className={clsx(
            "relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border bg-aegis-elevated",
            s.status === "done" && "border-aegis-success bg-aegis-success/15 text-aegis-success",
            s.status === "running" && "border-aegis-primary bg-aegis-primary/15 text-aegis-primary",
            s.status === "error" && "border-aegis-danger bg-aegis-danger/15 text-aegis-danger",
            s.status === "skipped" && "border-aegis-border bg-aegis-surface text-aegis-text-muted",
            s.status === "pending" && "border-aegis-border text-aegis-text-dim",
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
                s.status === "error" && "bg-aegis-danger/10 text-aegis-danger",
                s.status === "skipped" && "bg-aegis-surface text-aegis-text-muted",
                s.status === "pending" && "bg-aegis-surface text-aegis-text-dim",
              )}>
                {stepStatusText(s.status, t)}
              </span>
            </div>
            {s.detail && <div className="mt-2 break-words rounded-lg bg-aegis-surface/55 px-3 py-2 font-mono text-xs leading-5 text-aegis-text-secondary">{s.detail}</div>}
            {s.status === "running" && (
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-aegis-surface">
                  {typeof s.progress === "number" ? (
                    <div
                      className={clsx(
                        "h-full rounded-full bg-aegis-primary transition-[width] duration-300",
                        !reduceMotion && "animate-pulse",
                      )}
                      style={{
                        width: `${Math.max(2, Math.min(100, s.progress))}%`,
                      }}
                    />
                  ) : (
                    <div
                      className={clsx(
                        "h-full w-1/3 rounded-full bg-aegis-primary",
                        !reduceMotion && "animate-pulse",
                      )}
                    />
                  )}
                </div>
                {typeof s.progress === "number" && (
                  <span className="w-9 text-right font-mono text-[11px] tabular-nums text-aegis-text-dim">
                    {Math.round(s.progress)}%
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      </div>
    </section>
  );
}

function logTone(level: SetupLog["level"]): string {
  switch (level) {
    case "error": return "text-aegis-danger";
    case "warn": return "text-aegis-warning";
    case "success": return "text-aegis-success";
    default: return "text-aegis-text-secondary";
  }
}

function formatSetupLogLine(log: SetupLog): string {
  const timestamp = new Date(log.ts).toLocaleTimeString();
  const source = log.step ?? log.source;
  const diagnostic = log.diagnostic ? " [diagnostic]" : "";
  return `${timestamp} [${source}]${diagnostic} ${log.message}`;
}

function InstallLiveLog({ logs }: { logs: SetupLog[] }) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [copied, setCopied] = useState(false);
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState(false);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [bundleExportState, setBundleExportState] = useState<"idle" | "success" | "error">("idle");
  useLayoutEffect(() => {
    if (!followRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scrollToLatest = () => {
      if (followRef.current) viewport.scrollTop = viewport.scrollHeight;
    };
    scrollToLatest();
    // Wrapped process output can change height after the DOM commit. Follow it
    // on the next frame while preserving a user's deliberate scroll position.
    const frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [logs]);

  const copyLogs = () => {
    const text = logs
      .map(formatSetupLogLine)
      .join("\n");
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => undefined);
  };

  const openDiagnosticsDirectory = async () => {
    setOpeningDirectory(true);
    setDirectoryError(false);
    try {
      await openSetupDiagnosticsDirectory();
    } catch {
      setDirectoryError(true);
    } finally {
      setOpeningDirectory(false);
    }
  };

  const exportDiagnosticsBundle = async () => {
    setExportingBundle(true);
    setBundleExportState("idle");
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const destination = await save({
        defaultPath: `junqi-install-diagnostics-${timestamp}.zip`,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (!destination) return;
      await exportSetupDiagnosticsBundle(destination);
      setBundleExportState("success");
    } catch {
      setBundleExportState("error");
    } finally {
      setExportingBundle(false);
    }
  };

  return (
    <section className="h-[390px] overflow-hidden border-t border-aegis-border bg-aegis-bg/35 lg:border-l lg:border-t-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-aegis-border px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-aegis-text">
          <TerminalSquare size={15} />
          {t("setup.installPanel.activity", "执行记录")}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-normal text-aegis-text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-aegis-success" />
            {t("setup.installPanel.live", "实时")}
          </span>
          <span className="font-mono text-[10px] font-normal tabular-nums text-aegis-text-dim">
            {logs.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { void exportDiagnosticsBundle(); }}
            disabled={exportingBundle}
            title={bundleExportState === "error"
              ? t("setup.installPanel.exportLogsFailed", "无法导出安装诊断包")
              : bundleExportState === "success"
                ? t("setup.installPanel.exportLogsComplete", "安装诊断包已导出")
                : t("setup.installPanel.exportLogs", "导出安装诊断包")}
            aria-label={t("setup.installPanel.exportLogs", "导出安装诊断包")}
            className={clsx(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-aegis-surface disabled:opacity-40",
              bundleExportState === "error"
                ? "text-red-300"
                : bundleExportState === "success"
                  ? "text-aegis-success"
                  : "text-aegis-text-secondary",
            )}
          >
            <Download size={13} />
          </button>
          <button
            type="button"
            onClick={() => { void openDiagnosticsDirectory(); }}
            disabled={openingDirectory}
            title={directoryError
              ? t("setup.installPanel.openLogsFailed", "无法打开日志目录")
              : t("setup.installPanel.openLogs", "打开完整日志目录")}
            aria-label={t("setup.installPanel.openLogs", "打开完整日志目录")}
            className={clsx(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-aegis-surface disabled:opacity-40",
              directoryError ? "text-red-300" : "text-aegis-text-secondary",
            )}
          >
            <FolderOpen size={13} />
          </button>
          <button
            type="button"
            onClick={copyLogs}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-surface disabled:opacity-40"
          >
            <Copy size={12} />
            {copied ? t("setup.copiedLogs") : t("setup.copyLogs")}
          </button>
        </div>
      </header>
      <div
        ref={viewportRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
        className="h-[342px] overflow-auto px-4 py-3 font-mono text-[11px] leading-5"
      >
        {logs.length === 0 ? (
          <div className="py-10 text-center text-aegis-text-dim">{t("setup.logsEmpty")}</div>
        ) : logs.map((log, index) => (
          <div
            key={`${log.ts}-${index}-${log.message}`}
            className="grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 border-b border-aegis-border/35 py-1.5 last:border-0 sm:grid-cols-[58px_72px_minmax(0,1fr)]"
          >
            <time className="tabular-nums text-aegis-text-dim">
              {new Date(log.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </time>
            <span className="truncate text-aegis-text-dim">{log.step ?? log.source}</span>
            <span className={clsx(
              "col-span-2 min-w-0 break-words sm:col-span-1",
              logTone(log.level),
              log.diagnostic && "opacity-80",
            )}>
              {log.diagnostic && <span className="mr-1 text-[9px] uppercase text-aegis-text-dim">diag</span>}
              {log.message}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

type InstallationConsoleProps = {
  flow: Pick<SetupFlow, "steps" | "installTarget">;
  logs: SetupLog[];
  setupStep: string;
};

export function InstallationConsole({
  flow,
  logs,
  setupStep,
}: InstallationConsoleProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const [mobileView, setMobileView] = useState<"steps" | "logs">("steps");
  const current = currentStepOf(flow.steps);
  const completed = flow.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const total = flow.steps.length || 1;
  const percent = installationCompletionPercent(flow.steps);
  const isError = setupStep === "error";
  useEffect(() => {
    if (isError) setMobileView("logs");
  }, [isError]);
  const currentMeta = current ? STEP_META[current.id] : null;
  const currentTitle = installStepTitle(current, t) ?? t("setup.preparingGateway", "正在准备 Gateway...");
  const currentDescription = currentMeta
    ? t(currentMeta.descriptionKey, currentMeta.descriptionFallback)
    : t("setup.subtitle");
  const summaryLabel = isError
    ? t("setup.error", "安装遇到问题")
    : t("setup.installPanel.current", "当前执行");

  const activityPanel = (
    <div id="setup-installation-details" className="overflow-hidden rounded-xl border border-aegis-border bg-aegis-elevated">
      <div className="flex gap-1 border-b border-aegis-border p-2 lg:hidden">
        {(["steps", "logs"] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setMobileView(view)}
            className={clsx(
              "flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
              mobileView === view
                ? "bg-aegis-surface text-aegis-text"
                : "text-aegis-text-dim hover:text-aegis-text-secondary",
            )}
          >
            {view === "steps"
              ? t("setup.installPanel.timeline", "执行步骤")
              : t("setup.installPanel.activity", "执行记录")}
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(390px,1.1fr)]">
        <div className={clsx(mobileView !== "steps" && "hidden lg:block")}>
          <InstallationTimeline steps={flow.steps} />
        </div>
        <div className={clsx(mobileView !== "logs" && "hidden lg:block")}>
          <InstallLiveLog logs={logs} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={clsx(
        "grid gap-3 rounded-xl border p-4",
        "md:grid-cols-[1fr_168px]",
        isError ? "border-aegis-danger/35 bg-aegis-danger/5" : "border-aegis-primary/30 bg-aegis-primary/5",
      )}>
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-aegis-text-muted">
            {isError
              ? <X size={15} className="text-aegis-danger" />
              : <CircleDot size={15} className="text-aegis-primary" />}
            {summaryLabel}
          </div>
          <div className="text-lg font-semibold text-aegis-text" dir="auto">{currentTitle}</div>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-aegis-text-muted">{currentDescription}</p>
          {current?.id === "openclaw" && flow.installTarget && (
            <InstallTargetCard target={flow.installTarget} />
          )}
        </div>
        <div className="flex flex-col justify-center rounded-xl border border-aegis-border/70 bg-aegis-bg/55 px-4 py-3">
          <div className="text-[11px] font-semibold text-aegis-text-dim">{t("setup.installPanel.progress", "总进度")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-aegis-text">{percent}%</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-aegis-surface">
            <div
              className={clsx(
                "h-full rounded-full transition-[width] duration-300",
                isError ? "bg-aegis-danger" : "bg-aegis-primary",
                !isError && !reduceMotion && "animate-pulse",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-aegis-text-dim">{completed}/{total} {t("setup.installPanel.stepsDone", "个步骤已处理")}</div>
        </div>
      </div>

      {activityPanel}
    </div>
  );
}
