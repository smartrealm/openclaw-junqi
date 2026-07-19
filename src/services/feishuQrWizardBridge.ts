import {
  completeChannelEnrollment,
  readChannelEnrollmentCredential,
  type ChannelEnrollmentCompletion,
} from '@/services/channelEnrollment';
import {
  isFeishuDomainSelectionStep,
  isFeishuQrSetupMethodStep,
  isPlaintextSecretModeStep,
  type OpenClawWizardResult,
  type OpenClawWizardStep,
} from '@/services/openclawWizard';

export type WizardStepSubmitter = (
  stepId: string,
  value?: unknown,
) => Promise<OpenClawWizardResult | null>;

/**
 * Adapts a verified desktop QR enrollment to the existing official Feishu
 * wizard branch. OpenClaw remains the sole writer of its configuration and
 * continues to own policy questions and final Gateway setup.
 */
export class FeishuQrWizardBridge {
  constructor(private readonly completion: ChannelEnrollmentCompletion) {}

  async complete(initialStep: OpenClawWizardStep, submit: WizardStepSubmitter): Promise<void> {
    let step = await this.answer(
      initialStep,
      'manual',
      isFeishuQrSetupMethodStep,
      submit,
      'setup method',
    );
    step = await this.answer(
      step,
      this.completion.domain,
      isFeishuDomainSelectionStep,
      submit,
      'domain',
    );
    step = await this.answer(step, undefined, (candidate) => candidate.type === 'note', submit, 'credential guidance');
    const appId = await readChannelEnrollmentCredential(this.completion.sessionId, 'appId');
    step = await this.answer(
      step,
      appId,
      (candidate) => candidate.type === 'text' && !candidate.sensitive,
      submit,
      'App ID',
    );
    step = await this.answer(step, 'plaintext', isPlaintextSecretModeStep, submit, 'secret storage mode');
    const appSecret = await readChannelEnrollmentCredential(this.completion.sessionId, 'appSecret');
    await this.answer(step, appSecret, (candidate) => candidate.type === 'text', submit, 'App Secret');
    await completeChannelEnrollment(this.completion.sessionId);
  }

  private async answer(
    step: OpenClawWizardStep,
    value: unknown,
    matches: (candidate: OpenClawWizardStep) => boolean,
    submit: WizardStepSubmitter,
    stage: string,
  ): Promise<OpenClawWizardStep> {
    if (!matches(step)) {
      throw new Error(`OpenClaw changed the Feishu ${stage} step.`);
    }
    const result = await submit(step.id, value);
    if (!result || result.done || !result.step) {
      throw new Error(`OpenClaw did not continue after the Feishu ${stage} step.`);
    }
    return result.step;
  }
}
