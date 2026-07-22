import { isTerminalAgentId, terminalAgentLauncher } from './terminalAgentCatalog';
import type { TerminalAgentId } from './terminalAgentCatalog';
import type { TerminalHookEvent } from './shellLifecycle';

export interface TerminalPersistentNotificationPayload {
  level: 'attention' | 'completed' | 'error';
  agent: TerminalAgentId;
  title: string;
  body: string;
  url: string;
}

export function terminalNotificationTarget(shellId: string): string {
  const normalized = shellId.trim();
  return normalized ? `/terminal?focusShell=${encodeURIComponent(normalized)}` : '/terminal';
}

export function terminalNotificationFocusShellId(search: string): string | null {
  const shellId = new URLSearchParams(search).get('focusShell')?.trim() ?? '';
  return shellId && shellId.length <= 256 ? shellId : null;
}

/**
 * Converts only Hook-confirmed lifecycle changes into Inbox records. A Claude
 * `Stop` hook yields attention; a subsequent prompt resets the state to
 * running, allowing the next attention transition to notify again.
 */
export class TerminalHookNotificationTracker {
  private readonly lifecycleByRun = new Map<string, TerminalHookEvent['event']>();
  private readonly toolFailures = new Set<string>();

  next(event: TerminalHookEvent, shellId: string, shellTitle: string): TerminalPersistentNotificationPayload | null {
    if (!isTerminalAgentId(event.agent)) return null;
    const agent = terminalAgentLauncher(event.agent);
    const title = shellTitle.trim() || 'Terminal';
    const url = terminalNotificationTarget(shellId);

    if (event.kind === 'lifecycle') {
      const runKey = `${shellId}:${event.runId}`;
      const previous = this.lifecycleByRun.get(runKey);
      this.lifecycleByRun.set(runKey, event.event);
      if (previous === event.event) return null;
      if (event.event === 'attention') {
        return {
          level: 'attention',
          agent: agent.id,
          title: `${agent.label} is waiting on you`,
          body: title,
          url,
        };
      }
      if (event.event === 'ended') {
        return {
          level: 'completed',
          agent: agent.id,
          title: `${agent.label} finished`,
          body: title,
          url,
        };
      }
      return null;
    }

    if (event.kind !== 'tool' || event.event !== 'post' || event.success !== false) return null;
    const failureKey = `${shellId}:${event.runId}:${event.toolUseId || `${event.toolName || 'tool'}:${event.identifier || ''}`}`;
    if (this.toolFailures.has(failureKey)) return null;
    this.toolFailures.add(failureKey);
    return {
      level: 'error',
      agent: agent.id,
      title: 'Command failed',
      body: title,
      url,
    };
  }
}
