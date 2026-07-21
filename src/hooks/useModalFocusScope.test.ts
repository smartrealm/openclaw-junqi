import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModalFocusScopeRegistry,
  focusModalTarget,
  handleModalFocusScopeKeyDown,
  resolveInitialFocusTarget,
  resolveTabWrapTarget,
  restoreModalFocus,
  type ModalFocusScopeKeyEvent,
  type ModalFocusTarget,
} from './useModalFocusScope';

class FocusTarget implements ModalFocusTarget {
  readonly calls: Array<FocusOptions | undefined> = [];

  constructor(
    readonly name: string,
    readonly isConnected = true,
    private failuresRemaining = 0,
  ) {}

  focus(options?: FocusOptions): void {
    this.calls.push(options);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error(`focus failed for ${this.name}`);
    }
  }
}

interface RecordedKeyEvent extends ModalFocusScopeKeyEvent {
  prevented: number;
  propagationStopped: number;
  immediatePropagationStopped: number;
}

function keyEvent(
  key: string,
  overrides: Partial<ModalFocusScopeKeyEvent> = {},
): RecordedKeyEvent {
  const event: RecordedKeyEvent = {
    key,
    prevented: 0,
    propagationStopped: 0,
    immediatePropagationStopped: 0,
    preventDefault() {
      event.prevented += 1;
    },
    stopPropagation() {
      event.propagationStopped += 1;
    },
    stopImmediatePropagation() {
      event.immediatePropagationStopped += 1;
    },
    ...overrides,
  };
  return event;
}

test('initial focus strategy selects only the target promised by its contract', () => {
  const container = new FocusTarget('container');
  const explicit = new FocusTarget('explicit');
  const first = new FocusTarget('first');

  assert.equal(resolveInitialFocusTarget('container', container, explicit, [first]), container);
  assert.equal(
    resolveInitialFocusTarget('autofocus-or-container', container, explicit, [first]),
    explicit,
  );
  assert.equal(
    resolveInitialFocusTarget('autofocus-or-container', container, null, [first]),
    container,
  );
  assert.equal(resolveInitialFocusTarget('first', container, explicit, [first]), first);
  assert.equal(resolveInitialFocusTarget('first', container, explicit, []), container);
});

test('Tab and Shift+Tab wrap only at modal boundaries', () => {
  const container = new FocusTarget('container');
  const first = new FocusTarget('first');
  const middle = new FocusTarget('middle');
  const last = new FocusTarget('last');
  const targets = [first, middle, last];

  assert.equal(resolveTabWrapTarget(targets, last, false, container), first);
  assert.equal(resolveTabWrapTarget(targets, first, true, container), last);
  assert.equal(resolveTabWrapTarget(targets, middle, false, container), null);
  assert.equal(resolveTabWrapTarget(targets, middle, true, container), null);
  assert.equal(resolveTabWrapTarget(targets, null, false, container), first);
  assert.equal(resolveTabWrapTarget(targets, null, true, container), last);
  assert.equal(resolveTabWrapTarget([], null, false, container), container);
});

test('keyboard handler wraps focus and leaves native interior Tab navigation untouched', () => {
  const container = new FocusTarget('container');
  const first = new FocusTarget('first');
  const middle = new FocusTarget('middle');
  const last = new FocusTarget('last');
  const closing = () => assert.fail('Tab must not close the modal');

  const boundaryEvent = keyEvent('Tab');
  assert.equal(handleModalFocusScopeKeyDown(boundaryEvent, {
    focusableTargets: [first, middle, last],
    activeTarget: last,
    fallbackTarget: container,
    escapeDisabled: false,
    onEscape: closing,
  }), 'tab-wrapped');
  assert.equal(first.calls.length, 1);
  assert.deepEqual(
    [boundaryEvent.prevented, boundaryEvent.propagationStopped, boundaryEvent.immediatePropagationStopped],
    [1, 1, 1],
  );

  const interiorEvent = keyEvent('Tab');
  assert.equal(handleModalFocusScopeKeyDown(interiorEvent, {
    focusableTargets: [first, middle, last],
    activeTarget: middle,
    fallbackTarget: container,
    escapeDisabled: false,
    onEscape: closing,
  }), 'ignored');
  assert.equal(interiorEvent.prevented, 0);

  const backwardsEvent = keyEvent('Tab', { shiftKey: true });
  assert.equal(handleModalFocusScopeKeyDown(backwardsEvent, {
    focusableTargets: [first, middle, last],
    activeTarget: first,
    fallbackTarget: container,
    escapeDisabled: false,
    onEscape: closing,
  }), 'tab-wrapped');
  assert.equal(last.calls.length, 1);
});

test('Escape closes the top scope, while busy and composition states are deterministic', () => {
  const container = new FocusTarget('container');
  let closeCount = 0;

  const escapeEvent = keyEvent('Escape');
  assert.equal(handleModalFocusScopeKeyDown(escapeEvent, {
    focusableTargets: [],
    activeTarget: null,
    fallbackTarget: container,
    escapeDisabled: false,
    onEscape: () => { closeCount += 1; },
  }), 'escape');
  assert.equal(closeCount, 1);
  assert.equal(escapeEvent.prevented, 1);

  const blockedEvent = keyEvent('Escape');
  assert.equal(handleModalFocusScopeKeyDown(blockedEvent, {
    focusableTargets: [],
    activeTarget: null,
    fallbackTarget: container,
    escapeDisabled: true,
    onEscape: () => { closeCount += 1; },
  }), 'escape-blocked');
  assert.equal(closeCount, 1);
  assert.equal(blockedEvent.prevented, 1);

  const composingEvent = keyEvent('Escape', { isComposing: true });
  assert.equal(handleModalFocusScopeKeyDown(composingEvent, {
    focusableTargets: [],
    activeTarget: null,
    fallbackTarget: container,
    escapeDisabled: false,
    onEscape: () => { closeCount += 1; },
  }), 'ignored');
  assert.equal(closeCount, 1);
  assert.equal(composingEvent.prevented, 0);
});

test('modal registry gives explicit layers precedence and mount order breaks ties', () => {
  const registry = new ModalFocusScopeRegistry<string>();
  const detailsId = Symbol('details');
  const drawerId = Symbol('drawer');
  const actionId = Symbol('action');

  registry.register(detailsId, 'details', 10);
  registry.register(actionId, 'action', 30);
  registry.register(drawerId, 'drawer', 20);
  registry.register(detailsId, 'details-replayed', 10);
  assert.equal(registry.top()?.id, actionId);

  const afterAction = registry.unregister(actionId);
  assert.equal(afterAction.wasTop, true);
  assert.equal(afterAction.nextTop?.id, drawerId);

  registry.register(detailsId, 'details-latest', 20);
  assert.equal(registry.top()?.id, detailsId);
  const afterDetails = registry.unregister(detailsId);
  assert.equal(afterDetails.nextTop?.id, drawerId);
});

test('focus helper retries without options for browsers that reject preventScroll', () => {
  const target = new FocusTarget('legacy-browser', true, 1);
  assert.equal(focusModalTarget(target), true);
  assert.equal(target.calls.length, 2);
  assert.deepEqual(target.calls[0], { preventScroll: true });
  assert.equal(target.calls[1], undefined);

  const disconnected = new FocusTarget('removed-opener', false);
  assert.equal(focusModalTarget(disconnected), false);
  assert.equal(disconnected.calls.length, 0);
});

test('unmount restoration prefers the opener and falls back to the surviving parent scope', () => {
  const opener = new FocusTarget('opener');
  const parent = new FocusTarget('parent');
  assert.equal(restoreModalFocus(opener, parent), true);
  assert.equal(opener.calls.length, 1);
  assert.equal(parent.calls.length, 0);

  const removedOpener = new FocusTarget('removed-opener', false);
  assert.equal(restoreModalFocus(removedOpener, parent), true);
  assert.equal(parent.calls.length, 1);

  const removedParent = new FocusTarget('removed-parent', false);
  assert.equal(restoreModalFocus(removedOpener, removedParent), false);
});
