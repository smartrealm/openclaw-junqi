// ═══════════════════════════════════════════════════════════
// SetupPage — State-driven orchestrator
// Each setupStep maps to a dedicated screen component.
// Business logic lives in useSetupFlow hook.
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/stores/app-store";
import { useSetupFlow } from "@/hooks/useSetupFlow";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import type { DockerStatus } from "@/api/tauri-commands";
import clsx from "clsx";

// ═══════════════════════════════════════════════════════════
// Screen Components
// ═══════════════════════════════════════════════════════════

function Spin({ text }: { text: string }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100vh",alignItems:"center",justifyContent:"center",gap:16,background:"#0c1015" }}>
      <div style={{ width:32,height:32,border:"2px solid rgba(14,165,233,0.3)",borderTopColor:"#0ea5e9",borderRadius:"50%",animation:"spin 0.8s linear infinite" }} />
      <span style={{ color:"rgba(255,255,255,0.4)",fontSize:13,fontFamily:"system-ui,sans-serif" }}>{text}</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function DetectingScreen() {
  const { t } = useTranslation();
  return <Spin text={t("setup.detecting")} />;
}

function GatewayStoppedScreen({ flow }: { flow: SetupFlow }) {
  const { t } = useTranslation();
  const { setSetupStep, setSetupComplete } = useAppStore();
  return (
    <div className="flex flex-col h-screen bg-aegis-bg items-center justify-center gap-6 px-8">
      <div className="p-3 rounded-2xl bg-aegis-primary/10"><span style={{fontSize:32}}>🖥️</span></div>
      <h1 className="text-xl font-bold text-aegis-text">{t("setup.foundOclaw")}</h1>
      <p className="text-aegis-text-muted text-center max-w-md text-sm">{t("setup.gatewayNotRunning")}</p>
      <div className="flex gap-3">
        <button onClick={() => flow.startGateway()} className="px-5 py-2.5 rounded-xl text-sm font-bold bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110 transition-colors">{t("setup.startGatewayBtn")}</button>
        <button onClick={() => setSetupComplete(true)} className="px-5 py-2.5 rounded-xl text-sm border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface transition-colors">{t("setup.skipBtn", "Skip, enter directly")}</button>
      </div>
      <button onClick={() => setSetupStep("choosing-mode")} className="text-xs text-aegis-text-dim hover:text-aegis-text mt-2">{t("setup.reinstallBtn", "Reinstall OpenClaw")}</button>
    </div>
  );
}

function ModeSelectScreen({ flow }: { flow: SetupFlow }) {
  const { t } = useTranslation();
  const dockerAvailable = flow.dockerStatus?.available && flow.dockerStatus?.daemon_running;
  return (
    <div className="flex flex-col h-screen bg-aegis-bg">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <h1 className="text-[28px] font-bold text-aegis-text">{t("setup.title")}</h1>
        <p className="text-aegis-text-muted text-center max-w-md text-sm">{t("setup.chooseMode")}</p>
        <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
          <button onClick={() => flow.selectMode("native")} className="flex flex-col p-5 rounded-xl border border-aegis-border bg-aegis-elevated hover:border-aegis-primary hover:bg-aegis-primary/5 transition-all text-left cursor-pointer">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-aegis-primary/10 text-aegis-primary"><span>🖥️</span></div>
              <h3 className="text-base font-semibold text-aegis-text">{t("setup.modeNative")}</h3>
            </div>
            <p className="text-xs text-aegis-text-muted leading-relaxed">{t("setup.modeNativeDesc")}</p>
          </button>
          <div className={clsx("flex flex-col p-5 rounded-xl border border-aegis-border bg-aegis-elevated text-left transition-all", dockerAvailable ? "hover:border-aegis-primary hover:bg-aegis-primary/5 cursor-pointer" : "opacity-50")}
            onClick={() => dockerAvailable && flow.selectMode("docker")}>
            <div className="flex items-center gap-3 mb-3"><div className={clsx("p-2 rounded-lg",dockerAvailable ? "bg-aegis-success/10 text-aegis-success":"bg-aegis-text-dim/10 text-aegis-text-dim")}><span>🐳</span></div>
              <h3 className="text-base font-semibold text-aegis-text">{t("setup.modeDocker")}</h3></div>
            <p className="text-xs text-aegis-text-muted leading-relaxed mb-3">{t("setup.modeDockerDesc")}</p>
            {flow.checkingDocker ? <span className="text-xs text-aegis-text-dim animate-pulse">{t("setup.checkingDocker")}</span>
              : dockerAvailable ? <span className="text-xs text-aegis-success">✓ Docker {flow.dockerStatus?.version??""}</span>
              : <span className="text-xs text-aegis-danger">✗ {t("setup.dockerNotDetected")}</span>}
          </div>
        </div>
      </div>
      <div className="pb-3 flex justify-end px-4"><DebugButton /></div>
      <DebugDialog />
    </div>
  );
}

function ProgressScreen({ flow }: { flow: SetupFlow }) {
  const { t } = useTranslation();
  const { setupStep, setupError } = useAppStore();
  return (
    <div className="flex flex-col h-screen bg-aegis-bg">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <h1 className="text-[28px] font-bold text-aegis-text">{t("setup.settingUp")}</h1>
        <p className="text-aegis-text-muted text-center max-w-md text-sm">{t("setup.subtitle")}</p>
        <div className="w-full max-w-sm">
          <div className="w-full h-2 bg-aegis-surface rounded-full overflow-hidden">
            <div className="h-full bg-aegis-primary rounded-full transition-all duration-500" style={{width:`${flow.progress}%`}}/>
          </div>
          <p className="text-sm text-aegis-text-muted mt-3 text-center">{flow.statusMessage}</p>
        </div>
        {setupStep === "error" && setupError && (
          <div className="w-full max-w-sm">
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-red-400 text-sm font-mono break-all">{setupError}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => { useAppStore.getState().setSetupError(null); flow.runNativeSetup(); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110">{t("setup.retry")}</button>
                <button onClick={() => flow.goBack()} className="px-3 py-1.5 rounded-lg text-xs border border-aegis-border text-aegis-text-secondary">{t("setup.back")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="pb-3 flex justify-end px-4"><DebugButton /></div>
      <DebugDialog />
    </div>
  );
}

function GitMissingScreen({ flow }: { flow: SetupFlow }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-screen bg-aegis-bg">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <span style={{fontSize:32}}>📦</span>
        <h1 className="text-2xl font-bold text-aegis-text">{t("setup.gitRequired")}</h1>
        <p className="text-aegis-text-muted text-center max-w-md text-sm">{t("setup.gitRequiredDesc")}</p>
        <div className="flex gap-3">
          <button onClick={() => flow.retryGit()} className="px-4 py-2 rounded-lg text-sm bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110">{t("setup.gitRetry")}</button>
          <button onClick={() => flow.goBack()} className="px-4 py-2 rounded-lg text-sm border border-aegis-border text-aegis-text-secondary">{t("setup.backToModeSelection")}</button>
        </div>
      </div>
      <div className="pb-3 flex justify-end px-4"><DebugButton /></div>
      <DebugDialog />
    </div>
  );
}

function DebugButton() {
  return <button id="debug-btn" className="text-xs text-aegis-text-dim hover:text-aegis-text">Debug Log</button>;
}

function DebugDialog() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let fn: (() => void) | null = null;
    listen<string>("gateway-log", (e: any) => setLogs(p => [...p.slice(-200), e.payload]))
      .then((f: any) => { fn = f; }).catch(() => {});
    return () => { fn?.(); };
  }, [open]);

  useEffect(() => { if (open) ref.current?.scrollIntoView({behavior:"smooth"}); }, [logs, open]);

  useEffect(() => {
    const btn = document.getElementById("debug-btn");
    if (!btn) return;
    const h = () => setOpen(true);
    btn.addEventListener("click", h);
    return () => btn.removeEventListener("click", h);
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={()=>setOpen(false)}>
      <div className="bg-aegis-card-solid border border-aegis-border rounded-2xl w-full max-w-2xl max-h-[500px] flex flex-col shadow-lg mx-4" onClick={e=>e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-aegis-border flex items-center justify-between">
          <h3 className="text-sm font-mono text-aegis-text">Debug Log</h3>
          <button onClick={()=>setOpen(false)} className="text-aegis-text-muted hover:text-aegis-text">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? <span className="text-aegis-text-dim">No messages...</span>
            : logs.map((l,i) => <div key={i} className={l.toLowerCase().includes("error")?"text-red-400":"text-green-400"}>{l}</div>)}
          <div ref={ref}/>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// State Machine Orchestrator
// ═══════════════════════════════════════════════════════════

export function SetupPage() {
  const { setupStep } = useAppStore();
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [checkingDocker, setCheckingDocker] = useState(true);
  const [needsGit, setNeedsGit] = useState(false);

  const flow = useSetupFlow(
    progress, setProgress, statusMessage, setStatusMessage,
    dockerStatus, setDockerStatus, checkingDocker, setCheckingDocker,
    needsGit, setNeedsGit,
  );

  switch (setupStep) {
    case "detecting":         return <DetectingScreen />;
    case "gateway-stopped":   return <GatewayStoppedScreen flow={flow} />;
    case "choosing-mode":     return <ModeSelectScreen flow={flow} />;
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "ready":
    case "error":             return <ProgressScreen flow={flow} />;
    case "git-missing":       return <GitMissingScreen flow={flow} />;
    default:                  return <DetectingScreen />;
  }
}
