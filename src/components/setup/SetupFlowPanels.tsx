import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Copy,
  Eye,
  EyeOff,
  Package,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import { useState } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import clsx from "clsx";
import type { OpenclawStatus } from "@/api/tauri-commands";
import { GatewayLifecyclePanel } from "@/components/settings/GatewayLifecyclePanel";
import type { SetupLog } from "@/stores/app-store";
import type { InstallTarget, SetupFlow, StepState } from "@/hooks/useSetupFlow";

type SetupStepId = "identity" | "runtime" | "install" | "ready";

const SETUP_STEPS: SetupStepId[] = ["identity", "runtime", "install", "ready"];

export const STEP_META: Record<string, { titleKey: string; titleFallback: string; descriptionKey: string; descriptionFallback: string }> = {
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

type SetupAction = {
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
};

type SetupNextAction = SetupAction & {
  label: string;
  loading?: boolean;
  icon?: "next" | "none";
};

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

export function SetupShell({
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
  previousAction?: SetupAction;
  nextAction?: SetupNextAction;
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
          <p className="mt-2 max-w-[68ch] break-words text-sm leading-6 text-aegis-text-muted" dir="auto">{message}</p>
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
  xdg: { border: "border-amber-500/45", bg: "bg-amber-500/10", text: "text-amber-200" },
  sandbox: { border: "border-rose-500/45", bg: "bg-rose-500/10", text: "text-rose-200" },
  existing: { border: "border-sky-500/45", bg: "bg-sky-500/10", text: "text-sky-200" },
};

function resolveInstallNote(target: InstallTarget, t: TFunction): string {
  switch (target.tier) {
    case "user":
      return t("setup.installTarget.user.note", "与终端 `npm i -g` 落点一致；安装后 `openclaw` 已在你的 PATH 中");
    case "xdg":
      return t("setup.installTarget.xdg.note", {
        binPath: target.binPath ?? "",
        defaultValue: "请将 {{binPath}} 加入 PATH，以便在终端使用 `openclaw`",
      });
    case "sandbox":
      return t("setup.installTarget.sandbox.note", "openclaw 装在 JunQi 沙盒目录内，终端不会在 PATH 中找到，请从 JunQi 工作台启动或自行 symlink");
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
      : target.tier === "xdg"
        ? "XDG 回退"
        : target.tier === "sandbox"
          ? "JunQi 沙盒"
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
    case "saved-selection:xdg-fallback":
      return t("setup.runtimeDetails.sourceSavedXdg", "JunQi 已保存路径（XDG 回退安装）");
    case "saved-selection:junqi-sandbox":
      return t("setup.runtimeDetails.sourceSavedSandbox", "JunQi 已保存路径（JunQi 沙盒安装）");
    case "user-npm-prefix":
      return t("setup.runtimeDetails.sourceUserNpm", "npm 全局安装（用户 prefix）");
    case "xdg-fallback":
      return t("setup.runtimeDetails.sourceXdg", "JunQi 回退安装（~/.local）");
    case "junqi-sandbox":
      return t("setup.runtimeDetails.sourceSandbox", "JunQi 托管安装（沙盒目录）");
    case "PATH":
      return t("setup.runtimeDetails.sourcePath", "系统 PATH 中发现");
  }
  if (!target) return t("setup.runtimeDetails.methodDetected", "检测到的本机安装");
  switch (target.tier) {
    case "user":
      return t("setup.runtimeDetails.methodUser", "npm 全局安装（用户 prefix）");
    case "xdg":
      return t("setup.runtimeDetails.methodXdg", "JunQi 回退安装（~/.local）");
    case "sandbox":
      return t("setup.runtimeDetails.methodSandbox", "JunQi 托管安装（沙盒目录）");
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
  gatewayState?: "checking" | "stopped" | "running" | "unknown";
}) {
  const { t } = useTranslation();
  const installed = Boolean(status?.installed);
  const gatewayTone =
    gatewayState === "running" ? "ok" :
      gatewayState === "stopped" ? "warn" :
        gatewayState === "checking" ? "neutral" : "neutral";
  const gatewayLabel =
    gatewayState === "running" ? t("setup.runtimeDetails.gatewayRunning", "运行中") :
      gatewayState === "stopped" ? t("setup.runtimeDetails.gatewayStopped", "未运行") :
        gatewayState === "checking" ? t("setup.runtimeDetails.gatewayChecking", "检测中") :
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
          <RuntimeCheck label={t("setup.runtimeDetails.versionOk", "版本可读取")} ok={status?.version_ok ?? null} />
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

function InstallationTimeline({ steps, awaitingGatewayStart = false }: { steps: StepState[]; awaitingGatewayStart?: boolean }) {
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
                {awaitingGatewayStart && s.id === "gateway" && s.status === "pending"
                  ? t("setup.installPanel.waitingToStart", "等待启动")
                  : stepStatusText(s.status, t)}
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

export function InstallationConsole({ flow, logs, setupStep }: { flow: SetupFlow; logs: SetupLog[]; setupStep: string }) {
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
          {flow.installTarget && (
            <InstallTargetCard target={flow.installTarget} />
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
        <InstallationTimeline steps={flow.steps} awaitingGatewayStart={isAwaitingGatewayStart} />
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
