// SetupPage — OpenClaw 首次启动向导：步骤路由
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import { combineUnlisteners, subscribeTauriEvent } from "@/utils/tauriEvents";
import { classifySetupMessage, normalizeSetupProgressPayload } from "@/hooks/setupProgressEvents";
import { translateSetupProgressMessage } from "@/hooks/setupProgressParams";
import { translateGatewayLogPayload } from "@/hooks/gatewayLogEvents";
import { useSetupFlow } from "@/hooks/useSetupFlow";
import type { StepState } from "@/hooks/useSetupFlow";
import type { DockerStatus } from "@/api/tauri-commands";
import { StorageSetupStep } from "@/components/setup/StorageSetupGate";
import { WelcomeScreen } from "./WelcomeScreen";
import { DetectingScreen } from "./DetectingScreen";
import { EnvironmentReviewScreen } from "./EnvironmentReviewScreen";
import { GatewayStoppedScreen } from "./GatewayStoppedScreen";
import { ModeSelectScreen } from "./ModeSelectScreen";
import { ProgressScreen } from "./ProgressScreen";
import { WizardScreen } from "./WizardScreen";
import { ReadyScreen } from "./ReadyScreen";
import { GitMissingScreen } from "./GitMissingScreen";
import { NodeMissingScreen } from "./NodeMissingScreen";

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
      if (!detail || !flow.acceptSetupProgressOperation(detail.operationId)) return;
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
        diagnostic: detail.diagnostic,
        coalesceKey: detail.logSlot ?? undefined,
      });
    });

    const unlistenGateway = subscribeTauriEvent("gateway-log", (event) => {
      const message = translateGatewayLogPayload(
        event.payload,
        (key, options) => t(key, options),
      );
      if (message) appendSetupLog({
        source: "gateway",
        message,
        level: classifySetupMessage(message),
      });
    });

    return combineUnlisteners([unlistenSetup, unlistenGateway]);
  }, [appendSetupLog, t]);

  const sharedLogs = useMemo(() => logs, [logs]);
  switch (setupStep) {
    case "welcome": return <WelcomeScreen logs={sharedLogs} />;
    case "detecting": return <DetectingScreen flow={flow} logs={sharedLogs} />;
    case "environment-review": return <EnvironmentReviewScreen flow={flow} logs={sharedLogs} />;
    case "storage": return <StorageSetupStep logs={sharedLogs} onReady={flow.completeStorageSetup} onBack={flow.goBack} forceConfigure={flow.forceStorageSelection} />;
    case "gateway-stopped": return <GatewayStoppedScreen flow={flow} logs={sharedLogs} />;
    case "choosing-mode": return <ModeSelectScreen flow={flow} logs={sharedLogs} />;
    case "ready": return <ReadyScreen flow={flow} logs={sharedLogs} />;
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "gateway-ready":
    case "error": return <ProgressScreen flow={flow} logs={sharedLogs} />;
    case "configure-openclaw": return <WizardScreen flow={flow} logs={sharedLogs} />;
    case "git-missing": return <GitMissingScreen flow={flow} logs={sharedLogs} />;
    case "node-missing": return <NodeMissingScreen flow={flow} logs={sharedLogs} />;
    default: return <DetectingScreen flow={flow} logs={sharedLogs} />;
  }
}
