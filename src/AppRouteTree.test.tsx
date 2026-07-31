import assert from 'node:assert/strict';
import test from 'node:test';
import { Navigate } from 'react-router-dom';
import { getFirstEnabledAppPath } from '@/config/edition';
import {
  resolveLegacyAgentWorkspaceRedirectTarget,
  UnknownAppRouteFallback,
} from './AppRouteTree';

test('unknown application routes recover through the established edition fallback', () => {
  const element = UnknownAppRouteFallback();
  assert.equal(element.type, Navigate);
  assert.equal(element.props.to, getFirstEnabledAppPath());
  assert.equal(element.props.replace, true);
});

test('the legacy workspace task route redirects only its unambiguous task deep link', () => {
  assert.equal(
    resolveLegacyAgentWorkspaceRedirectTarget('/ai-workspace', '?task=agent-task%3A123', ''),
    '/agent-run?taskId=agent-task%3A123',
  );
  assert.equal(
    resolveLegacyAgentWorkspaceRedirectTarget('/ai-workspace', '?task=agent-task%3A123&view=history', ''),
    null,
  );
});
