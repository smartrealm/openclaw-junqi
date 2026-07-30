// Step `ready` — completion and dashboard entry.
import { Check, CheckCircle2, Circle, LoaderCircle, Minus, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import type { GatewayAutostartStatus } from "@/api/tauri-commands";
import { disableGatewayAutostart, enableGatewayAutostart, gatewayAutostartStatus, handoffGatewayToOfficialService } from "@/api/tauri-commands";
import { SetupShell, STEP_META } from "@/components/setup/SetupFlowPanels";
import clsx from "clsx";
import { type InstallMode } from "@/stores/setup-navigation";
import { gatewayLifecycle } from "@/services/gateway/gatewayLifecycle";

export function GatewayAutostartPreference({
  installMode,
  onOperationStateChange,
}: {
  installMode: InstallMode;
  onOperationStateChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GatewayAutostartStatus | null | undefined>(undefined);
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

  useEffect(() => {
    onOperationStateChange(busy);
    return () => onOperationStateChange(false);
  }, [busy, onOperationStateChange]);

  if (installMode !== "native" || status === null || status?.supported === false) return null;
  if (status === undefined) {
    return (
      <section className="w-full border-t border-aegis-border pt-5 text-left" aria-busy="true">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-aegis-text-dim">
          {t("setup.runtimePreferences", "运行偏好")}
        </div>
        <div className="flex items-center gap-3 py-1">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-aegis-surface" />
          <span className="h-3 w-36 animate-pulse rounded bg-aegis-surface" />
        </div>
      </section>
    );
  }
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
      if (enabled) {
        const restarted = await gatewayLifecycle.restart("setup-autostart-disabled");
        if (!restarted.success) throw new Error(restarted.error || "Gateway restart failed");
      } else if (!(await handoffGatewayToOfficialService())) {
        throw new Error(t("setup.autostart.handoffFailed"));
      }
      setStatus(await gatewayAutostartStatus().catch(() => next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <section className="w-full border-t border-aegis-border pt-5 text-left">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-aegis-text-dim">
        {t("setup.runtimePreferences", "运行偏好")}
      </div>
      <div className="flex items-start gap-3 py-1">
        <span className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          enabled ? "bg-aegis-success/15 text-aegis-success" : "bg-aegis-primary/15 text-aegis-primary",
        )}>
          <Power size={18} />
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
    </section>
  );
}

export function ReadyScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const [autostartBusy, setAutostartBusy] = useState(false);
  const blockNavigation = autostartBusy || flow.enteringDashboard;
  const settledCount = flow.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const total = flow.steps.length || settledCount || 1;

  return (
    <SetupShell
      active={6}
      title={t("setup.ready")}
      subtitle={t("setup.readySubtitle")}
      logs={logs}
      previousAction={{ onClick: flow.goBack, disabled: blockNavigation }}
      nextAction={{
        label: flow.enteringDashboard
          ? t("setup.verifyingDashboardEntry", "正在验证 Gateway…")
          : t("setup.enterDashboard"),
        onClick: (event) => { void flow.enterDashboard(event.currentTarget); },
        disabled: blockNavigation,
        loading: flow.enteringDashboard,
        icon: flow.enteringDashboard ? "none" : "next",
      }}
    >
      <div className="flex flex-col items-center gap-5 py-5 text-center">
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
        {flow.dashboardEntryError && (
          <p className="w-full rounded-lg border border-aegis-danger/30 bg-aegis-danger/10 px-3 py-2 text-left text-xs text-aegis-danger">
            {flow.dashboardEntryError}
          </p>
        )}
        <GatewayAutostartPreference
          installMode={flow.installMode}
          onOperationStateChange={setAutostartBusy}
        />
      </div>
    </SetupShell>
  );
}
