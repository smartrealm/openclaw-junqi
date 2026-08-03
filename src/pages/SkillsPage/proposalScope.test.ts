import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_SESSION_PROPOSAL_SCOPE,
  GATEWAY_DEFAULT_PROPOSAL_SCOPE,
  proposalScopeValueForAgent,
  resolveProposalScopeAgentId,
} from './proposalScope';

test('resolves proposal scope only from the documented default, active session, or explicit agent values', () => {
  assert.equal(resolveProposalScopeAgentId(GATEWAY_DEFAULT_PROPOSAL_SCOPE, 'main'), undefined);
  assert.equal(resolveProposalScopeAgentId(ACTIVE_SESSION_PROPOSAL_SCOPE, ' main '), 'main');
  assert.equal(resolveProposalScopeAgentId(ACTIVE_SESSION_PROPOSAL_SCOPE, undefined), undefined);
  assert.equal(resolveProposalScopeAgentId(proposalScopeValueForAgent('research'), 'main'), 'research');
  assert.equal(resolveProposalScopeAgentId('agent:   ', 'main'), undefined);
  assert.equal(resolveProposalScopeAgentId('untrusted-scope', 'main'), undefined);
});
