export type DingTalkSubmitLinkOpenOutcome = 'system-handoff' | 'failed';

export type DingTalkSubmitLinkFeedback = {
  readonly kind: 'notice' | 'error';
  readonly translationKey:
    | 'businessApplications.workbench.detail.submitLinkOpenRequested'
    | 'businessApplications.workbench.detail.submitLinkOpenFailed';
};

export function resolveDingTalkSubmitLinkFeedback(
  outcome: DingTalkSubmitLinkOpenOutcome | null,
): DingTalkSubmitLinkFeedback | null {
  if (outcome === 'system-handoff') {
    return {
      kind: 'notice',
      translationKey: 'businessApplications.workbench.detail.submitLinkOpenRequested',
    };
  }
  if (outcome === 'failed') {
    return {
      kind: 'error',
      translationKey: 'businessApplications.workbench.detail.submitLinkOpenFailed',
    };
  }
  return null;
}
