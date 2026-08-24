import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDingTalkSubmitLinkFeedback } from './dingTalkSubmitLinkPresentation';

test('钉钉提交入口的系统接手与打开失败使用不同且真实的反馈语义', () => {
  assert.deepEqual(resolveDingTalkSubmitLinkFeedback('system-handoff'), {
    kind: 'notice',
    translationKey: 'businessApplications.workbench.detail.submitLinkOpenRequested',
  });
  assert.deepEqual(resolveDingTalkSubmitLinkFeedback('failed'), {
    kind: 'error',
    translationKey: 'businessApplications.workbench.detail.submitLinkOpenFailed',
  });
  assert.equal(resolveDingTalkSubmitLinkFeedback(null), null);
});
