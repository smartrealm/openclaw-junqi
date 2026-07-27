// Step `choosing-mode` — Native or Docker runtime choice.
import { Check, CheckCircle2, Container, Circle, Monitor, Package, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell } from "@/components/setup/SetupFlowPanels";
import clsx from "clsx";
import { type InstallMode } from "@/stores/setup-navigation";

export function ModeSelectScreen({ flow, logs }: { flow: SetupFlow; logs: SetupLog[] }) {
  const { t } = useTranslation();
  const [selectedMode, setSelectedMode] = useState<InstallMode>(flow.installMode);
  const [submitting, setSubmitting] = useState(false);
  const submitSelection = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await flow.selectMode(selectedMode);
    } finally {
      setSubmitting(false);
    }
  };
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

  const nativeInstalled = flow.openclawStatus?.installed === true;
  const dockerImageAvailable = flow.dockerStatus?.image_available === true;
  const selectedModeReady = selectedMode === "native" ? nativeInstalled : dockerImageAvailable;
  const dockerStatusText = flow.checkingDocker
    ? t("setup.checkingDocker")
    : dockerAvailable
      ? dockerImageAvailable
        ? t("setup.dockerReady", {
            version: flow.dockerStatus?.version ?? "",
            defaultValue: "Docker {{version}} 和 OpenClaw 镜像已就绪",
          })
        : t("setup.dockerImageWillPrepare", {
            version: flow.dockerStatus?.version ?? "",
            defaultValue: "Docker {{version}} 已运行；继续后将准备 OpenClaw 镜像",
          })
      : flow.dockerStatus?.unsupported_reason
        ? t("setup.dockerUnsupportedX86", "Windows 32 位仅支持 Native；不会检测或安装 Docker")
        : flow.dockerStatus?.available
          ? t("setup.dockerDaemonStopped")
          : t("setup.dockerNotDetected");
  const primaryLabel = selectedModeReady
    ? t("setup.useRuntimeAndContinue", {
        runtime: selectedMode === "native" ? t("setup.modeNative") : t("setup.modeDocker"),
        defaultValue: "使用 {{runtime}} 并继续",
      })
    : t("setup.prepareRuntimeAndContinue", {
        runtime: selectedMode === "native" ? t("setup.modeNative") : t("setup.modeDocker"),
        defaultValue: "准备 {{runtime}} 并继续",
      });

  return (
    <SetupShell
      active={3}
      title={t("setup.modeSelectionTitle", "确认 OpenClaw 运行方式")}
      subtitle={t("setup.chooseMode")}
      logs={logs}
      previousAction={{ onClick: flow.goBack, disabled: submitting }}
      nextAction={{
        label: primaryLabel,
        onClick: () => { void submitSelection(); },
        disabled: submitting || (selectedMode === "docker" && !dockerAvailable),
        loading: submitting,
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
          <div className={clsx("mt-auto flex items-center gap-2 pt-4 text-xs", nativeInstalled ? "text-aegis-success" : "text-aegis-text-dim")}>
            {nativeInstalled ? <Check size={13} /> : <Package size={13} />}
            <span>
              {nativeInstalled
                ? t("setup.nativeDetected", {
                    version: flow.openclawStatus?.version ?? "",
                    defaultValue: "OpenClaw {{version}} 已安装，可直接使用",
                  })
                : t("setup.nativeWillPrepare", "继续后将检查并按需安装缺失组件")}
            </span>
          </div>
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
            <div className={clsx("mt-auto flex items-center gap-2 pt-4 text-xs", dockerImageAvailable ? "text-aegis-success" : dockerAvailable ? "text-aegis-text-dim" : "text-aegis-danger")}>
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

