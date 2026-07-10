import { flushSync } from 'react-dom';

export type TransitionOrigin = Element | { x: number; y: number } | null | undefined;
export type CircularTransitionDirection = 'reveal' | 'conceal';

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition?: () => void;
}

type ViewTransitionStarter = (update: () => void) => ViewTransitionLike;

export interface CircularViewTransitionOptions {
  origin?: TransitionOrigin;
  direction?: CircularTransitionDirection;
  durationMs?: number;
  fallbackClass?: string;
  update: () => void;
}

export function resolveTransitionOrigin(
  origin: TransitionOrigin,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  if (origin && 'getBoundingClientRect' in origin) {
    const rect = origin.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  if (origin && 'x' in origin && 'y' in origin) return origin;
  return { x: viewportWidth / 2, y: viewportHeight / 2 };
}

export function coveringRadius(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  return Math.hypot(
    Math.max(x, viewportWidth - x),
    Math.max(y, viewportHeight - y),
  );
}

class CircularViewTransitionCoordinator {
  private active: ViewTransitionLike | null = null;
  private generation = 0;

  run(options: CircularViewTransitionOptions): Promise<void> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      options.update();
      return Promise.resolve();
    }

    const root = document.documentElement;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const startViewTransition = (document as unknown as {
      startViewTransition?: ViewTransitionStarter;
    }).startViewTransition?.bind(document);
    let updated = false;
    const commit = () => {
      if (updated) return;
      updated = true;
      flushSync(options.update);
    };

    if (reducedMotion || !startViewTransition) {
      commit();
      if (!reducedMotion && options.fallbackClass) {
        root.classList.remove(options.fallbackClass);
        void root.offsetHeight;
        root.classList.add(options.fallbackClass);
        window.setTimeout(() => root.classList.remove(options.fallbackClass!), options.durationMs ?? 650);
      }
      return Promise.resolve();
    }

    this.active?.skipTransition?.();
    this.active = null;
    const generation = ++this.generation;
    const direction = options.direction ?? 'reveal';
    const duration = options.durationMs ?? 650;
    const { x, y } = resolveTransitionOrigin(options.origin, window.innerWidth, window.innerHeight);
    const radius = coveringRadius(x, y, window.innerWidth, window.innerHeight);

    root.classList.remove('aegis-view-transition-conceal');
    root.toggleAttribute('data-view-transitioning', true);
    if (direction === 'conceal') root.classList.add('aegis-view-transition-conceal');

    let transition: ViewTransitionLike;
    try {
      transition = startViewTransition(commit);
    } catch {
      commit();
      this.cleanup(generation);
      return Promise.resolve();
    }
    this.active = transition;

    const animate = transition.ready.then(() => {
      if (generation !== this.generation) return;
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${radius}px at ${x}px ${y}px)`,
      ];
      const animation = root.animate(
        { clipPath: direction === 'conceal' ? [...clipPath].reverse() : clipPath },
        {
          duration,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: direction === 'conceal'
            ? '::view-transition-old(root)'
            : '::view-transition-new(root)',
        },
      );
      return animation.finished.catch(() => undefined);
    });

    return Promise.allSettled([animate, transition.finished])
      .then(() => undefined)
      .finally(() => this.cleanup(generation));
  }

  private cleanup(generation: number): void {
    if (generation !== this.generation) return;
    this.active = null;
    const root = document.documentElement;
    root.removeAttribute('data-view-transitioning');
    root.classList.remove('aegis-view-transition-conceal');
  }
}

export const circularViewTransition = new CircularViewTransitionCoordinator();
