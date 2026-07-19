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
        const appId = await readChannelEnrollmentCredential(this.completion.sessionId, 'appId');
        step = await this.advance(step, appId, submit, 'App ID');
        continue;
      }
      if (isPlaintextSecretModeStep(step)) {
        step = await this.advance(step, 'plaintext', submit, 'secret storage mode');
        continue;
      }
      if (step.type === 'text' && step.sensitive) {
        const appSecret = await readChannelEnrollmentCredential(this.completion.sessionId, 'appSecret');
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
    if (!result || result.done || !result.step) {
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
    if (!result) {
      throw new Error(`OpenClaw did not accept the Feishu ${stage} step.`);
    }
    return result;
  }
}
