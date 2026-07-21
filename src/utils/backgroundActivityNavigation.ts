import type { BackgroundActivityKind } from './sessionPresentation';
import { cronJobIdFromSessionKey } from './sessionPresentation';

export type BackgroundActivityNavigationTarget =
  | { kind: 'chat'; sessionKey: string }
  | { kind: 'route'; to: string };

type BackgroundActivityNavigationStrategy = (sessionKey: string) => BackgroundActivityNavigationTarget;

function routeWithSession(path: string, sessionKey: string, jobId?: string | null): string {
  const search = new URLSearchParams();
  if (jobId) search.set('job', jobId);
  search.set('session', sessionKey);
  return `${path}?${search.toString()}`;
}

const BACKGROUND_ACTIVITY_NAVIGATION: Record<
  BackgroundActivityKind,
  BackgroundActivityNavigationStrategy
> = {
  dreaming: (sessionKey) => ({
    kind: 'route',
    to: routeWithSession('/cron', sessionKey, cronJobIdFromSessionKey(sessionKey)),
  }),
  cron: (sessionKey) => ({
    kind: 'route',
    to: routeWithSession('/cron', sessionKey, cronJobIdFromSessionKey(sessionKey)),
  }),
  subagent: (sessionKey) => ({ kind: 'chat', sessionKey }),
  system: (sessionKey) => ({
    kind: 'route',
    to: routeWithSession('/activity', sessionKey),
  }),
};

export function resolveBackgroundActivityNavigation(
  kind: BackgroundActivityKind,
  sessionKey: string,
): BackgroundActivityNavigationTarget {
  return BACKGROUND_ACTIVITY_NAVIGATION[kind](sessionKey);
}
