import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfigNavigationIntent } from './configNavigation';

test('keeps the selected config tab as durable navigation state', () => {
  const intent = readConfigNavigationIntent(new URLSearchParams('tab=providers'));

  assert.equal(intent.tab, 'providers');
  assert.equal(intent.addProvider, false);
  assert.equal(intent.consumedParams, undefined);
});

test('consumes only the one-shot add-provider action', () => {
  const intent = readConfigNavigationIntent(new URLSearchParams('tab=providers&action=add&from=sidebar'));

  assert.equal(intent.tab, 'providers');
  assert.equal(intent.addProvider, true);
  assert.equal(intent.consumedParams?.toString(), 'tab=providers&from=sidebar');
});

test('does not execute provider actions on another tab', () => {
  const intent = readConfigNavigationIntent(new URLSearchParams('tab=agents&action=add'));

  assert.equal(intent.tab, 'agents');
  assert.equal(intent.addProvider, false);
});
