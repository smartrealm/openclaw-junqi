import {
  completeChannelEnrollment,
  readChannelEnrollmentCredential,
  type ChannelEnrollmentCompletion,
} from '@/services/channelEnrollment';
import {
  type OpenClawWizardResult,
  type OpenClawWizardStep,
} from '@/services/openclawWizard';

function hasExactStringOptions(step: OpenClawWizardStep, expected: readonly string[]): boolean {
  if (step.type !== 'select' || !Array.isArray(step.options)) return false;
  const values = step.options.map((option) => option.value);
  return values.length === expected.length
    && expected.every((value) => values.includes(value));
}
/**
 * Compatibility adapter for OpenClaw's Feishu 2026.7.x terminal-QR branch.
 * It matches official option identities only; display text and step ids remain
 * fully Gateway-owned. Unknown or changed protocol shapes fall back to the
 * generic wizard instead of being guessed from translated copy.
 */
export function isFeishuQrSetupMethodStep(step: OpenClawWizardStep): boolean {
  return hasExactStringOptions(step, ['manual', 'scan']);
}

function isFeishuDomainSelectionStep(step: OpenClawWizardStep): boolean {
  return hasExactStringOptions(step, ['feishu', 'lark']);
}

function isPlaintextSecretModeStep(step: OpenClawWizardStep): boolean {
  return hasExactStringOptions(step, ['plaintext', 'ref']);
}

export type WizardStepSubmitter = (
  stepId: string,
  value?: unknown,
) => Promise<OpenClawWizardResult | null>;

/** The official session was replaced, so its temporary QR credentials are no longer usable. */
export class FeishuQrWizardSessionChangedError extends Error {}

/**
 * Adapts a verified desktop QR enrollment to the existing official Feishu
 * wizard branch. OpenClaw remains the sole writer of its configuration and
 * continues to own policy questions and final Gateway setup.
 */
export class FeishuQrWizardBridge {
  constructor(private readonly completion: ChannelEnrollmentCompletion) {}

  async complete(initialStep: OpenClawWizardStep, submit: WizardStepSubmitter): Promise<void> {
    let step = initialStep;
    // A timeout can occur after OpenClaw accepted an answer but before its
    // response reached the desktop. Identify the current official step on
    // every iteration, so resuming never replays a previous credential.
    //
    // 协议顺序契约:这一步链路里的 key field 顺序是固定的,任何倒置都会被
    // 视为协议漂移——必须保留此处的隐含不变量作为回归断言:
    //   1. 域选择(domain)
    //   2. credential note
    //   3. App ID (text 非 sensitive)
    //   4. secret 模式选择(必须在 App Secret 提交之前)
    //   5. App Secret (text sensitive)
    // 'manual' 是官方用词但语义上意味着「用户自己粘贴」,无副作用选它的
    // 值会绕过官方对路径合法性的部分校验,所以提前转发一次拿走。
    let appIdSubmitted = false;
    let secretModeSubmitted = false;
    for (let attempts = 0; attempts < 6; attempts += 1) {
      if (isFeishuQrSetupMethodStep(step)) {
        step = await this.advance(step, 'manual', submit, 'setup method');
        continue;
      }
      if (isFeishuDomainSelectionStep(step)) {
        step = await this.advance(step, this.completion.domain, submit, 'domain');
        continue;
      }
      if (step.type === 'note') {
        step = await this.advance(step, undefined, submit, 'credential guidance');
        continue;
      }
      if (step.type === 'text' && !step.sensitive) {
        // 顺序不变量:App ID 必须在 secret 模式之前出现;反之则视为协议漂移。
        if (secretModeSubmitted) {
          throw new FeishuQrWizardSessionChangedError(
            'OpenClaw asked for App ID after the secret storage mode was selected.',
          );
        }
        const appId = await readChannelEnrollmentCredential(this.completion.sessionId, 'appId');
        step = await this.advance(step, appId, submit, 'App ID');
        appIdSubmitted = true;
        continue;
      }
      if (isPlaintextSecretModeStep(step)) {
        // 顺序不变量:secret 模式必须在 App Secret 之前。
        if (appIdSubmitted === false) {
          throw new FeishuQrWizardSessionChangedError(
            'OpenClaw returned the secret storage mode before the App ID step.',
          );
        }
        step = await this.advance(step, 'plaintext', submit, 'secret storage mode');
        secretModeSubmitted = true;
        continue;
      }
      if (step.type === 'text' && step.sensitive) {
        if (!appIdSubmitted) {
          throw new FeishuQrWizardSessionChangedError(
            'OpenClaw returned the App Secret step before collecting the App ID.',
          );
        }
        const appSecret = await readChannelEnrollmentCredential(
          this.completion.sessionId,
          'appSecret',
        );
        await this.submitFinal(step, appSecret, submit, 'App Secret');
        await completeChannelEnrollment(this.completion.sessionId);
        return;
      }
      throw new FeishuQrWizardSessionChangedError('OpenClaw returned an unsupported Feishu enrollment step.');
    }
    throw new FeishuQrWizardSessionChangedError('OpenClaw did not complete the Feishu enrollment flow.');
  }

  private async advance(
    step: OpenClawWizardStep,
    value: unknown,
    submit: WizardStepSubmitter,
    stage: string,
  ): Promise<OpenClawWizardStep> {
    const result = await submit(step.id, value);
    if (!result || result.error || result.status === 'error' || result.done || !result.step) {
      throw new Error(`OpenClaw did not continue after the Feishu ${stage} step.`);
    }
    return result.step;
  }

  private async submitFinal(
    step: OpenClawWizardStep,
    value: unknown,
    submit: WizardStepSubmitter,
    stage: string,
  ): Promise<OpenClawWizardResult> {
    const result = await submit(step.id, value);
    if (!result || result.error || result.status === 'error') {
      // 显式不输出 value:即便 Gateway/React DevTools 拿到错误对象,
      // App Secret 也不会出现在堆栈和日志里。
      throw new Error(`OpenClaw did not accept the Feishu ${stage} step.`);
    }
    return result;
  }
}
