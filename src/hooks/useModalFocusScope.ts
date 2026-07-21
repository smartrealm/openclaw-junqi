import { useEffect, useRef, type MutableRefObject } from 'react';

export interface ModalFocusTarget {
  readonly isConnected?: boolean;
  focus(options?: FocusOptions): void;
}

export interface ModalFocusScopeEntry<T> {
  id: symbol;
  container: T;
  layer: number;
  sequence: number;
}

/**
 * Registry for nested modal surfaces. Layer wins over mount order so a child
 * action dialog remains authoritative even when React effects are replayed.
 */
export class ModalFocusScopeRegistry<T> {
  private readonly entries: ModalFocusScopeEntry<T>[] = [];
  private sequence = 0;

  register(id: symbol, container: T, layer = 0): ModalFocusScopeEntry<T> {
    this.unregister(id);
    const entry = { id, container, layer, sequence: ++this.sequence };
    this.entries.push(entry);
    return entry;
  }

  unregister(id: symbol): {
    wasTop: boolean;
    nextTop: ModalFocusScopeEntry<T> | null;
  } {
    const topBefore = this.top();
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index >= 0) this.entries.splice(index, 1);
    return {
      wasTop: topBefore?.id === id,
      nextTop: this.top(),
    };
  }

  isTop(id: symbol): boolean {
    return this.top()?.id === id;
  }

  top(): ModalFocusScopeEntry<T> | null {
    let top: ModalFocusScopeEntry<T> | null = null;
    for (const entry of this.entries) {
      if (
        !top
        || entry.layer > top.layer
        || (entry.layer === top.layer && entry.sequence > top.sequence)
      ) {
        top = entry;
      }
    }
    return top;
  }
}

export type ModalInitialFocus = 'container' | 'first' | 'autofocus-or-container';

export function resolveInitialFocusTarget<T>(
  strategy: ModalInitialFocus,
  container: T,
  autofocusTarget: T | null,
  focusableTargets: readonly T[],
): T {
  switch (strategy) {
    case 'first':
      return focusableTargets[0] ?? container;
    case 'autofocus-or-container':
      return autofocusTarget ?? container;
    case 'container':
      return container;
  }
}

/** Return a target only when native Tab navigation would leave the scope. */
export function resolveTabWrapTarget<T>(
  focusableTargets: readonly T[],
  activeTarget: T | null,
  backwards: boolean,
  fallbackTarget: T,
): T | null {
  if (focusableTargets.length === 0) return fallbackTarget;
  const index = activeTarget === null ? -1 : focusableTargets.indexOf(activeTarget);
  if (index < 0) {
    return backwards
      ? focusableTargets[focusableTargets.length - 1]!
      : focusableTargets[0]!;
  }
  if (backwards && index === 0) return focusableTargets[focusableTargets.length - 1]!;
  if (!backwards && index === focusableTargets.length - 1) return focusableTargets[0]!;
  return null;
}

export function focusModalTarget(target: ModalFocusTarget | null | undefined): boolean {
  if (!target || target.isConnected === false) return false;
  try {
    target.focus({ preventScroll: true });
    return true;
  } catch {
    try {
      target.focus();
      return true;
    } catch {
      return false;
    }
  }
}

export function restoreModalFocus(
  previousTarget: ModalFocusTarget | null | undefined,
  fallbackTarget: ModalFocusTarget | null | undefined,
): boolean {
  return focusModalTarget(previousTarget) || focusModalTarget(fallbackTarget);
}

export type ModalFocusScopeKeyResult =
  | 'ignored'
  | 'escape'
  | 'escape-blocked'
  | 'tab-wrapped';

export interface ModalFocusScopeKeyEvent {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  preventDefault(): void;
  stopPropagation?(): void;
  stopImmediatePropagation?(): void;
}

function consumeModalKey(event: ModalFocusScopeKeyEvent): void {
  event.preventDefault();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
}

export function handleModalFocusScopeKeyDown<T extends ModalFocusTarget>(
  event: ModalFocusScopeKeyEvent,
  options: {
    focusableTargets: readonly T[];
    activeTarget: T | null;
    fallbackTarget: T;
    escapeDisabled: boolean;
    onEscape: () => void;
  },
): ModalFocusScopeKeyResult {
  if (event.isComposing) return 'ignored';
  if (event.key === 'Escape') {
    consumeModalKey(event);
    if (options.escapeDisabled) return 'escape-blocked';
    options.onEscape();
    return 'escape';
  }
  if (
    event.key !== 'Tab'
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) return 'ignored';

  const target = resolveTabWrapTarget(
    options.focusableTargets,
    options.activeTarget,
    Boolean(event.shiftKey),
    options.fallbackTarget,
  );
  if (!target) return 'ignored';
  consumeModalKey(event);
  focusModalTarget(target);
  return 'tab-wrapped';
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

function isTabbable(element: HTMLElement): boolean {
  if (
    element.tabIndex < 0
    || element.hidden
    || element.getAttribute('aria-hidden') === 'true'
    || element.getAttribute('aria-disabled') === 'true'
    || element.closest('[inert], [aria-hidden="true"]')
  ) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  return element.getClientRects().length > 0;
}

function compareTabOrder(left: HTMLElement, right: HTMLElement): number {
  const leftPositive = left.tabIndex > 0;
  const rightPositive = right.tabIndex > 0;
  if (leftPositive && rightPositive && left.tabIndex !== right.tabIndex) {
    return left.tabIndex - right.tabIndex;
  }
  if (leftPositive !== rightPositive) return leftPositive ? -1 : 1;
  return 0;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isTabbable)
    .sort(compareTabOrder);
}

function autofocusElement(container: HTMLElement): HTMLElement | null {
  const candidate = container.querySelector<HTMLElement>('[data-modal-initial-focus], [autofocus]');
  return candidate && isTabbable(candidate) ? candidate : null;
}

const focusScopeRegistry = new ModalFocusScopeRegistry<HTMLElement>();

export interface UseModalFocusScopeOptions {
  active: boolean;
  onEscape: () => void;
  escapeDisabled?: boolean;
  initialFocus?: ModalInitialFocus;
  layer?: number;
  restoreFocus?: boolean;
}

/**
 * Owns keyboard focus for one modal surface. Only the highest active layer may
 * handle Tab, Escape, or focus containment; cleanup restores the opener.
 */
export function useModalFocusScope<T extends HTMLElement>({
  active,
  onEscape,
  escapeDisabled = false,
  initialFocus = 'container',
  layer = 0,
  restoreFocus = true,
}: UseModalFocusScopeOptions): MutableRefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const scopeIdRef = useRef(Symbol('modal-focus-scope'));
  const onEscapeRef = useRef(onEscape);
  const escapeDisabledRef = useRef(escapeDisabled);
  onEscapeRef.current = onEscape;
  escapeDisabledRef.current = escapeDisabled;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const document = container.ownerDocument;
    const HTMLElementConstructor = document.defaultView?.HTMLElement;
    const activeElement = document.activeElement;
    const previousFocus = HTMLElementConstructor && activeElement instanceof HTMLElementConstructor
      ? activeElement as HTMLElement
      : null;
    let lastFocusedInside: HTMLElement | null = null;
    const scopeId = scopeIdRef.current;

    focusScopeRegistry.register(scopeId, container, layer);

    const focusInitial = () => {
      const targets = focusableElements(container);
      const target = resolveInitialFocusTarget(
        initialFocus,
        container,
        autofocusElement(container),
        targets,
      );
      if (focusModalTarget(target)) lastFocusedInside = target;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!focusScopeRegistry.isTop(scopeId)) return;
      handleModalFocusScopeKeyDown(event, {
        focusableTargets: focusableElements(container),
        activeTarget: container.contains(document.activeElement)
          ? document.activeElement as HTMLElement
          : null,
        fallbackTarget: container,
        escapeDisabled: escapeDisabledRef.current,
        onEscape: () => onEscapeRef.current(),
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!focusScopeRegistry.isTop(scopeId)) return;
      const target = event.target;
      const NodeConstructor = document.defaultView?.Node;
      if (NodeConstructor && target instanceof NodeConstructor && container.contains(target)) {
        if (HTMLElementConstructor && target instanceof HTMLElementConstructor) {
          lastFocusedInside = target as HTMLElement;
        }
        return;
      }
      const retained = lastFocusedInside && container.contains(lastFocusedInside)
        ? lastFocusedInside
        : null;
      if (!focusModalTarget(retained)) focusInitial();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    if (focusScopeRegistry.isTop(scopeId)) focusInitial();

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      const { wasTop, nextTop } = focusScopeRegistry.unregister(scopeId);
      if (!restoreFocus || !wasTop) return;
      restoreModalFocus(previousFocus, nextTop?.container);
    };
  }, [active, initialFocus, layer, restoreFocus]);

  return containerRef;
}
