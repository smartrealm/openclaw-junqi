import type { BusinessActivityAttempt } from '@/business-applications/activityStore';
import type { OpenClawAuditEvent } from '@/services/gateway/OpenClawAuditClient';

export interface DingTalkBusinessActivitySummary {
  readonly official: number;
  readonly local: number;
  readonly agents: number;
  readonly active: number;
  readonly attention: number;
}

export function summarizeDingTalkBusinessActivity(
  events: readonly OpenClawAuditEvent[],
  attempts: readonly BusinessActivityAttempt[],
): DingTalkBusinessActivitySummary {
  const agents = new Set<string>();
  for (const event of events) {
    const agentId = event.agentId ?? event.actor.id;
    if (agentId) agents.add(agentId);
  }
  for (const attempt of attempts) {
    if (attempt.agentId) agents.add(attempt.agentId);
  }
  return {
    official: events.length,
    local: attempts.length,
    agents: agents.size,
    active: events.filter((event) => event.status === 'started').length
      + attempts.filter((attempt) => attempt.state === 'pending' || attempt.state === 'approval_required').length,
    attention: events.filter((event) => ['failed', 'blocked', 'timed_out', 'unknown'].includes(event.status)).length
      + attempts.filter((attempt) => attempt.state === 'failed' || attempt.state === 'unknown').length,
  };
}
