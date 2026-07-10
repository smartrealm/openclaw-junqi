import { circularViewTransition, type TransitionOrigin } from './circularViewTransition';

export function enterWorkspaceWithTransition(
  update: () => void,
  origin?: TransitionOrigin,
): void {
  void circularViewTransition.run({
    origin,
    direction: 'reveal',
    durationMs: 780,
    fallbackClass: 'aegis-workspace-entry-fallback',
    update,
  });
}
