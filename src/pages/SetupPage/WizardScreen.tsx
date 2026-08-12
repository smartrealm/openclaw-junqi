// OpenClaw 官方向导步骤的容器层。
import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import { SetupShell, StatusPanel } from "@/components/setup/SetupFlowPanels";
import { AlertDialog } from "@/components/shared/AlertDialog";
import clsx from "clsx";
import type { OpenClawWizardStep } from "@/services/openclawWizard";
import { isWizardBodyMessageStep, WizardStepRenderer } from "./wizard/WizardStepRenderer";
import { resolveWizardAuthorizationUrl, WizardAuthorizationHint } from "./wizard/WizardAuthorizationHint";
import { wizardInitialValue } from "./wizard/WizardStepValue";

export { WizardAuthorizationHint } from "./wizard/WizardAuthorizationHint";

export function wizardLogVisibility(
  step: OpenClawWizardStep | null,
  error: string | null,
): "collapsed" | "expanded" {
  return !step || error ? "expanded" : "collapsed";
}

type WizardController = Pick<SetupFlow,
  | "wizardStep"
  | "wizardSubmitting"
  | "wizardActivity"
  | "wizardError"
  | "wizardRecoveryMode"
  | "submitWizardStep"
  | "pollWizard"
  | "retryWizard"
  | "reclaimWizard"
>;

export type WizardScreenCopy = {
  titleKey: string;
  titleFallback: string;
  connectingKey: string;
  connectingFallback: string;
};

const DEFAULT_WIZARD_COPY: WizardScreenCopy = {
  titleKey: "setup.wizard.title",
  titleFallback: "配置 OpenClaw",
  connectingKey: "setup.wizard.connecting",
  connectingFallback: "正在连接 OpenClaw 官方配置向导…",
};

export function wizardPrimaryActionDisabled({
  submitting,
  error,
  automatic = false,
  blocked = false,
  canRecover = true,
}: {
  submitting: boolean;
  error: string | null;
  automatic?: boolean;
  blocked?: boolean;
  canRecover?: boolean;
}): boolean {
  // 错误恢复会同步接管旧操作，因此不能被尚未提交到 React 的旧 loading 状态永久锁住。
  if (error) return false;
  return !canRecover || submitting || automatic || blocked;
}

export function WizardRestartConfirmation({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onClose={onClose}
      title={t("setup.wizard.restartConfirmationTitle", "确认重新开始官方向导")}
      message={t(
        "setup.wizard.restartConfirmationMessage",
        "OpenClaw 没有返回上一次会话的最终结果。重新开始会创建新的官方 Wizard，并可能重复执行已经写入的配置。仅在确认需要重新配置时继续。",
      )}
      variant="warning"
      cancelLabel={t("common.cancel", "取消")}
      confirmLabel={t("setup.wizard.restartConfirmationAction", "确认并重新开始")}
      onConfirm={onConfirm}
    />
  );
}

export function WizardScreen({
  flow,
  logs,
  wizard = flow,
  copy = DEFAULT_WIZARD_COPY,
  secondaryAction,
}: {
  flow: SetupFlow;
  logs: SetupLog[];
  wizard?: WizardController;
  copy?: WizardScreenCopy;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const { t } = useTranslation();
  const step = wizard.wizardStep;
  const [value, setValue] = useState<unknown>(() => step ? wizardInitialValue(step) : undefined);
  const [restartConfirmationOpen, setRestartConfirmationOpen] = useState(false);
  const autoPolledProgressStepRef = useRef<string | null>(null);
  const autoPollProgress = step?.type === "progress" && step.executor === "gateway";

  useEffect(() => {
    setValue(step ? wizardInitialValue(step) : undefined);
  }, [step?.id]);

  useEffect(() => {
    if (wizard.wizardRecoveryMode !== "terminal-unknown") {
      setRestartConfirmationOpen(false);
    }
  }, [wizard.wizardRecoveryMode]);

  const retryOrConfirmRestart = () => {
    if (wizard.wizardRecoveryMode === "terminal-unknown") {
      setRestartConfirmationOpen(true);
      return;
    }
    void wizard.retryWizard();
  };

  const restartConfirmation = (
    <WizardRestartConfirmation
      open={restartConfirmationOpen}
      onClose={() => setRestartConfirmationOpen(false)}
      onConfirm={async () => {
        await wizard.retryWizard();
      }}
    />
  );

  useEffect(() => {
    if (
      !step
      || !autoPollProgress
      || wizard.wizardSubmitting
      || wizard.wizardError
      || autoPolledProgressStepRef.current === step.id
    ) return;
    autoPolledProgressStepRef.current = step.id;
    void wizard.pollWizard();
  }, [autoPollProgress, step, wizard]);

  if (!step) {
    const failed = Boolean(wizard.wizardError);
    const canRecover = failed || wizard.wizardRecoveryMode !== null;
    return (
      <>
        <SetupShell
          active={flow.presentation.stage}
          contentIdentity={failed ? `wizard-error:${wizard.wizardRecoveryMode ?? "unknown"}` : "wizard-connecting"}
          title={failed
            ? t("setup.wizard.needsAttentionTitle", "OpenClaw 配置需要处理")
            : t(copy.titleKey, copy.titleFallback)}
          subtitle={failed
            ? t("setup.wizard.needsAttentionSubtitle", "请核对返回的错误，并使用当前可用的恢复操作。")
            : t("setup.wizard.officialStepSubtitle", "当前内容由所选 OpenClaw Runtime 提供。")}
          logs={logs}
          logVisibility={wizardLogVisibility(step, wizard.wizardError)}
          previousAction={{ onClick: flow.goBack, disabled: wizard.wizardSubmitting }}
          secondaryAction={secondaryAction}
          nextAction={{
            label: wizard.wizardRecoveryMode === "reclaim"
              ? t("setup.wizard.reclaim", "重新接管向导")
              : wizard.wizardRecoveryMode === "terminal-unknown"
                ? t("setup.wizard.restartAfterLoss", "重新开始官方向导")
              : wizard.wizardRecoveryMode === "runtime" || wizard.wizardRecoveryMode === "session"
                ? t("setup.gatewayReadyRetryAction", "重新核验")
              : wizard.wizardError ? t("setup.wizard.retry", "重试") : t("setup.wizard.connectingAction", "正在连接"),
            onClick: () => {
              if (wizard.wizardRecoveryMode === "reclaim") {
                void wizard.reclaimWizard();
                return;
              }
              retryOrConfirmRestart();
            },
            disabled: wizardPrimaryActionDisabled({
              submitting: wizard.wizardSubmitting,
              error: wizard.wizardError,
              canRecover,
            }),
            loading: wizard.wizardSubmitting,
            icon: "none",
          }}
        >
          <div className="flex min-h-[260px] items-center" aria-live="polite" aria-busy={!failed}>
            <StatusPanel
              icon={failed
                ? <CircleAlert size={22} />
                : <LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" />}
              tone={failed ? "danger" : "primary"}
              eyebrow={failed
                ? t("setup.wizard.needsAttentionEyebrow", "向导已暂停")
                : t("setup.wizard.connectingEyebrow", "正在连接")}
              title={failed
                ? t("setup.wizard.stepFailedTitle", "官方向导未能继续")
                : t(copy.connectingKey, copy.connectingFallback)}
              message={wizard.wizardError
                || wizard.wizardActivity
                || t("setup.wizard.connectingDescription", "正在等待所选 Runtime 返回第一个官方步骤。")}
            />
          </div>
        </SetupShell>
        {restartConfirmation}
      </>
    );
  }

  // 向导内容与分支均由 Gateway 定义，容器仅选择已支持的协议类型渲染器。
  const presentedStep = step;
  const options = Array.isArray(presentedStep.options) ? presentedStep.options : [];
  const blocked = (step.type === "select" || step.type === "multiselect")
    && options.length === 0;
  const messageRenderedInBody = isWizardBodyMessageStep(presentedStep.type);
  const authorizationStep = Boolean(
    presentedStep.deviceCode
    || resolveWizardAuthorizationUrl(presentedStep),
  );
  const waitingForOfficialStep = wizard.wizardSubmitting || autoPollProgress;
  const replaceStepWithWaiting = autoPollProgress || (authorizationStep && wizard.wizardSubmitting);
  const wizardTitle = wizard.wizardError
    ? t("setup.wizard.needsAttentionTitle", "OpenClaw 配置需要处理")
    : presentedStep.title || t(copy.titleKey, copy.titleFallback);
  const wizardSubtitle = wizard.wizardError
    ? t("setup.wizard.needsAttentionSubtitle", "请核对返回的错误，并使用当前可用的恢复操作。")
    : messageRenderedInBody
      ? ""
      : presentedStep.message || t("setup.wizard.officialStepSubtitle", "当前内容由所选 OpenClaw Runtime 提供。");
  const contentLayout = authorizationStep
    ? "authorization"
    : presentedStep.type === "select" || presentedStep.type === "multiselect"
      ? "options"
      : "compact";
  const contentState = wizard.wizardError
    ? "error"
    : replaceStepWithWaiting
      ? "waiting"
      : "step";
  const submitCurrentStep = async () => {
    await wizard.submitWizardStep(step.id, value);
  };

  return (
    <>
      <SetupShell
        active={flow.presentation.stage}
        contentIdentity={`${presentedStep.id}:${contentState}`}
        title={wizardTitle}
        subtitle={wizardSubtitle}
        logs={logs}
        logVisibility={wizardLogVisibility(step, wizard.wizardError)}
        previousAction={{
          label: t("setup.wizard.pauseAndReturn", "暂停并返回"),
          onClick: flow.goBack,
          disabled: false,
        }}
        secondaryAction={secondaryAction}
        nextAction={{
          label: wizard.wizardError
            ? wizard.wizardRecoveryMode === "terminal-unknown"
              ? t("setup.wizard.restartAfterLoss", "重新开始官方向导")
              : t("setup.wizard.retry", "重试")
            : autoPollProgress
              ? t("setup.wizard.processing", "正在处理…")
              : authorizationStep
                ? t("setup.wizard.authorizationComplete", "我已完成授权，继续")
              : step.type === "action" ? t("setup.wizard.run", "执行") : t("setup.nextStep", "下一步"),
          onClick: () => {
            if (wizard.wizardError) {
              retryOrConfirmRestart();
              return;
            }
            void submitCurrentStep();
          },
          disabled: wizardPrimaryActionDisabled({
            submitting: wizard.wizardSubmitting,
            error: wizard.wizardError,
            automatic: autoPollProgress,
            blocked,
          }),
          loading: wizard.wizardSubmitting || autoPollProgress,
          icon: wizard.wizardError ? "none" : "next",
        }}
      >
        <div
          data-wizard-content-layout={wizard.wizardError || replaceStepWithWaiting ? "compact" : contentLayout}
          className={clsx(
            "w-full",
            (wizard.wizardError || replaceStepWithWaiting || contentLayout === "compact") && "flex flex-col",
          )}
          dir="auto"
          aria-live={wizard.wizardError || replaceStepWithWaiting ? "polite" : undefined}
          aria-busy={waitingForOfficialStep}
        >
          {wizard.wizardError ? (
            <StatusPanel
              icon={<CircleAlert size={22} />}
              tone="danger"
              eyebrow={t("setup.wizard.needsAttentionEyebrow", "向导已暂停")}
              title={t("setup.wizard.stepFailedTitle", "官方向导未能继续")}
              message={wizard.wizardError}
            />
          ) : replaceStepWithWaiting ? (
            <StatusPanel
              icon={<LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" />}
              tone="primary"
              eyebrow={t("setup.wizard.processing", "正在处理…")}
              title={authorizationStep
                ? t("setup.wizard.waitingForAuthorization", "正在等待授权…")
                : t("setup.wizard.waitingForNextStep", "正在等待下一个官方步骤")}
              message={wizard.wizardActivity || (authorizationStep
                ? t(
                    "setup.wizard.authorizationPollingHint",
                    "OpenClaw 正在等待渠道插件返回授权结果。可以暂停并返回，稍后恢复同一官方会话。",
                  )
                : t(
                    "setup.wizard.waitingForNextStepDescription",
                    "OpenClaw 正在处理当前步骤，JunQi 将等待下一个步骤或官方终态。",
                  ))}
            />
          ) : (
            <fieldset disabled={wizard.wizardSubmitting} className="min-w-0 border-0 p-0 disabled:opacity-70">
              <div className="space-y-4">
                <WizardStepRenderer
                  step={presentedStep}
                  value={value}
                  setValue={setValue}
                  t={t}
                />
                <WizardAuthorizationHint
                  key={presentedStep.id}
                  step={presentedStep}
                />
              </div>
            </fieldset>
          )}
        </div>
      </SetupShell>
      {restartConfirmation}
    </>
  );
}

// ── 开机自启偏好(仅 Native 运行时) ──
// 通过官方 `openclaw gateway install/uninstall` 注册或移除系统服务;切换后
// 用现有 restart 流程把 Gateway 从"桌面托管"交接给系统服务(或反向),保证
// 结束时只有一个明确的托管方持有端口。Docker 运行时由容器重启策略负责。
