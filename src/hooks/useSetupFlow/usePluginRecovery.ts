// Gateway plugin recovery: the structured heal ladder for BUG-CPI-07 and its
// disable-and-continue fallback for findings that cannot be healed.
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MutableRefObject } from "react";
import type { InstallMode, SetupStep } from "@/stores/setup-navigation";
import type { PostStorageStep, SetupLog } from "@/stores/app-store";
import { pullOpenclawImage } from "@/api/tauri-commands";
import {
  diagnoseGatewayRecovery,
  gatewayMigrationRetryDelayMs,
  runOpenClawRepair,
} from "@/services/gateway/openclawRepair";
import {
  disableOpenclawPlugin,
  healOpenclawPlugin,
  isAwaitingGatewayVerification,
  listBrokenGatewayPlugins,
  mergeBrokenPlugins,
  planPluginRecovery,
  pluginsNeedingHeal,
  unhealedPlugins,
  UNVERIFIABLE_PLUGIN_REASON,
  type BrokenGatewayPlugin,
  type PluginHealOutcome,
} from "@/services/gateway/pluginRecovery";
import type { StepStatus } from "./types";

export interface PluginRecoveryPorts {
  setupError: string | null;
  installMode: InstallMode;
  /** Owned by the flow: Gateway startup and Back both clear it. */
  pluginHealAttemptedRef: MutableRefObject<Set<string>>;
  beginRun: () => number;
  isRunActive: (runId: number) => boolean;
  patchStep: (id: string, status: StepStatus, detail?: string) => void;
  report: (message: string, nextProgress?: number) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  replaceSetupStep: (step: SetupStep) => void;
  setSetupError: (error: string | null) => void;
  setGatewayRunning: (running: boolean) => void;
  setPostStorageStep: (step: PostStorageStep) => void;
  setForceStorageSelection: (force: boolean) => void;
  startGatewayAction: (requestedMode?: InstallMode, existingRunId?: number) => Promise<boolean>;
  isConflictingRecoveryInFlight: () => boolean;
}

export function usePluginRecovery({
  setupError,
  installMode,
  pluginHealAttemptedRef,
  beginRun,
  isRunActive,
  patchStep,
  report,
  appendSetupLog,
  replaceSetupStep,
  setSetupError,
  setGatewayRunning,
  setPostStorageStep,
  setForceStorageSelection,
  startGatewayAction,
  isConflictingRecoveryInFlight,
}: PluginRecoveryPorts) {
  const { t } = useTranslation();
  const [repairing, setRepairing] = useState(false);
  const repairInFlightRef = useRef<"repair" | "disable" | null>(null);
  const [brokenPlugins, setBrokenPlugins] = useState<BrokenGatewayPlugin[]>([]);
  const repairAndRetry = useCallback(async () => {
    if (repairInFlightRef.current || isConflictingRecoveryInFlight()) return;
    repairInFlightRef.current = "repair";
    const failure = setupError;
    const runId = beginRun();
    setRepairing(true);
    setSetupError(null);
    setBrokenPlugins([]);
    const analyzingMessage = t("setup.analyzingGatewayFailure", "正在分析 Gateway 启动失败并选择恢复方式…");
    patchStep("gateway", "running", analyzingMessage);
    report(analyzingMessage);
    appendSetupLog({ source: "setup", step: "gateway", message: analyzingMessage, level: "info" });
    try {
      const recommendation = failure
        ? await diagnoseGatewayRecovery(failure).catch(() => "repair" as const)
        : "repair";
      if (recommendation === "select_storage") {
        const message = t(
          "setup.stateDirectoryIncompatible",
          "当前 OpenClaw 数据目录不支持所需权限操作。请选择本机支持权限操作的数据目录后重试。",
        );
        setForceStorageSelection(true);
        setGatewayRunning(false);
        setPostStorageStep("choosing-mode");
        appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
        report(message);
        replaceSetupStep("storage");
        return;
      }
      if (recommendation === "retry") {
        const retryDelay = gatewayMigrationRetryDelayMs(failure || "");
        if (retryDelay > 0) {
          const waitSeconds = Math.ceil(retryDelay / 1000);
          const message = t(
            "setup.waitingForGatewayLock",
            "检测到另一个 Gateway 的迁移锁，{{seconds}} 秒后自动重试…",
            { seconds: waitSeconds },
          );
          patchStep("gateway", "running", message);
          report(message);
          appendSetupLog({ source: "setup", step: "gateway", message, level: "info" });
          await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
          if (!isRunActive(runId)) return;
        }
        await startGatewayAction();
        return;
      }
      // BUG-CPI-07: Gateway 拒绝启动常由单个损坏插件引起（payload 烟测失败）。
      // 先做结构化插件巡检并尝试自愈梯子（定向更新 → 强制重装，每级复检）；
      // 不可自愈时给用户"临时禁用并启动"的降级出口，避免陷入修复→失败死循环。
      // Docker 运行时的插件载荷在容器内，由镜像刷新修复路径覆盖，巡检返回空。
      const broken = await listBrokenGatewayPlugins(failure ?? undefined)
        .catch(() => [] as BrokenGatewayPlugin[]);
      if (!isRunActive(runId)) return;
      if (broken.length > 0) {
        const showDisableFallback = (plugins: BrokenGatewayPlugin[]) => {
          setBrokenPlugins(plugins);
          const blockedMessage = t("setup.pluginNotHealable", {
            plugins: plugins.map((plugin) => plugin.id).join(", "),
            defaultValue: "插件 {{plugins}} 无法自动修复，可能是其安装包缺少必需文件。可临时禁用后继续启动。",
          });
          patchStep("gateway", "error", blockedMessage);
          appendSetupLog({ source: "setup", step: "gateway", message: blockedMessage, level: "error" });
          setSetupError(blockedMessage);
          report(blockedMessage);
          replaceSetupStep("error");
        };
        const candidates = pluginsNeedingHeal(broken, pluginHealAttemptedRef.current);
        if (candidates.length === 0) {
          showDisableFallback(broken);
          return;
        }
        const healingMessage = t("setup.pluginHealing", {
          plugins: candidates.map((plugin) => plugin.id).join(", "),
          defaultValue: "检测到损坏的插件（{{plugins}}），正在尝试自动修复…",
        });
        patchStep("gateway", "running", healingMessage);
        report(healingMessage);
        appendSetupLog({ source: "setup", step: "gateway", message: healingMessage, level: "info" });
        const outcomes: PluginHealOutcome[] = [];
        for (const plugin of candidates) {
          const outcome = await healOpenclawPlugin(plugin.id, plugin.reason).catch((error): PluginHealOutcome => ({
            id: plugin.id,
            healed: false,
            attempted: [],
            error: error instanceof Error ? error.message : String(error),
          }));
          if (!isRunActive(runId)) return;
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: outcome.healed
              ? t("setup.pluginHealed", { plugin: outcome.id, defaultValue: "插件 {{plugin}} 已修复" })
              : isAwaitingGatewayVerification(plugin, outcome)
                ? t("setup.pluginHealAwaitingStartCheck", {
                    plugin: outcome.id,
                    defaultValue: "插件 {{plugin}} 已完成修复尝试，等待 Gateway 启动验证",
                  })
                : t("setup.pluginHealFailed", {
                    plugin: outcome.id,
                    error: outcome.error ?? "",
                    defaultValue: "插件 {{plugin}} 无法自动修复 {{error}}",
                  }),
            level: outcome.healed || isAwaitingGatewayVerification(plugin, outcome) ? "info" : "warn",
          });
          outcomes.push(outcome);
        }
        const alreadyStartVerified = broken.filter(
          (plugin) => plugin.reason === UNVERIFIABLE_PLUGIN_REASON
            && pluginHealAttemptedRef.current.has(plugin.id),
        );
        const remaining = mergeBrokenPlugins(
          alreadyStartVerified,
          unhealedPlugins(candidates, outcomes),
        );
        // healed 的语义是"已验证修复"。gateway-smoke-check 类发现只有 Gateway
        // 自己的烟测能观测，自愈梯子永远不会为其报告 healed；此处用一次真实
        // 启动做验证（结果由下一轮 repairAndRetry 的 attempted 记录判定）。
        const recoveryPlan = planPluginRecovery(remaining, pluginHealAttemptedRef.current);
        if (recoveryPlan.action === "start-gateway") {
          if (recoveryPlan.startVerification.length > 0) {
            recoveryPlan.startVerification.forEach((plugin) => pluginHealAttemptedRef.current.add(plugin.id));
            appendSetupLog({
              source: "setup",
              step: "gateway",
              message: t("setup.pluginUnverifiedStartCheck", {
                plugins: recoveryPlan.startVerification.map((plugin) => plugin.id).join(", "),
                defaultValue: "插件 {{plugins}} 的修复效果无法离线验证，正在启动 Gateway 进行验证…",
              }),
              level: "info",
            });
          }
          await startGatewayAction();
          return;
        }
        // 已验证不可自愈（上游安装包缺文件等）：交给用户决定是否临时禁用。
        showDisableFallback(remaining);
        return;
      }
      if (installMode === "docker") {
        const repairingMessage = t(
          "setup.repairingDocker",
          "正在刷新 Docker 镜像并重建 Gateway…",
        );
        patchStep("gateway", "running", repairingMessage);
        report(repairingMessage);
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: t("setup.dockerRepairStarting", "正在刷新选定的 Docker 镜像…"),
          level: "info",
        });
        await pullOpenclawImage();
        if (!isRunActive(runId)) return;
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: t("setup.dockerRepairComplete", "镜像已刷新，正在重新创建 Docker Gateway…"),
          level: "info",
        });
        await startGatewayAction();
        return;
      }
      const repairingMessage = t("setup.repairingGateway", "正在修复 OpenClaw 和插件状态…");
      patchStep("gateway", "running", repairingMessage);
      report(repairingMessage);
      appendSetupLog({
        source: "setup",
        step: "gateway",
        message: t("setup.repairStarting", "开始运行 OpenClaw 官方修复流程…"),
        level: "info",
      });
      await runOpenClawRepair();
      if (!isRunActive(runId)) return;
      appendSetupLog({
        source: "setup",
        step: "gateway",
        message: t("setup.repairComplete", "修复完成，正在重新启动 Gateway…"),
        level: "info",
      });
      await startGatewayAction("native");
    } catch (error) {
      if (!isRunActive(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      patchStep("gateway", "error", message);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
    } finally {
      repairInFlightRef.current = null;
      setRepairing(false);
    }
  }, [setupError, beginRun, isRunActive, isConflictingRecoveryInFlight, setSetupError, patchStep, t, report, appendSetupLog, startGatewayAction, replaceSetupStep, installMode, setGatewayRunning, setPostStorageStep]);

  // BUG-CPI-07 最后一级降级：临时禁用不可自愈的插件后继续启动。插件保持
  // 已安装状态，待其修复版本发布后可在设置中重新启用并重走自愈梯子。
  const disablePluginsAndRetry = useCallback(async () => {
    if (repairInFlightRef.current || isConflictingRecoveryInFlight()) return;
    const plugins = brokenPlugins;
    if (plugins.length === 0) return;
    repairInFlightRef.current = "disable";
    const runId = beginRun();
    setRepairing(true);
    setSetupError(null);
    try {
      for (const plugin of plugins) {
        const disablingMessage = t("setup.pluginDisabling", {
          plugin: plugin.id,
          defaultValue: "正在临时禁用插件 {{plugin}}…",
        });
        patchStep("gateway", "running", disablingMessage);
        report(disablingMessage);
        await disableOpenclawPlugin(plugin.id);
        if (!isRunActive(runId)) return;
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: t("setup.pluginDisabled", {
            plugin: plugin.id,
            defaultValue: "插件 {{plugin}} 已临时禁用；其修复版本发布后可在设置中重新启用",
          }),
          level: "warn",
        });
      }
      setBrokenPlugins([]);
      pluginHealAttemptedRef.current.clear();
      await startGatewayAction();
    } catch (error) {
      if (!isRunActive(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      patchStep("gateway", "error", message);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
    } finally {
      repairInFlightRef.current = null;
      setRepairing(false);
    }
  }, [brokenPlugins, beginRun, isRunActive, isConflictingRecoveryInFlight, setSetupError, patchStep, t, report, appendSetupLog, startGatewayAction, replaceSetupStep]);

  return {
    repairing,
    brokenPlugins,
    setBrokenPlugins,
    repairAndRetry,
    disablePluginsAndRetry,
    isPluginRecoveryInFlight: () => repairInFlightRef.current !== null,
  };
}
