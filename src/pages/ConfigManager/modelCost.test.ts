import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelCostDraft, parseModelCostDraft } from './modelCost';

test('model cost draft preserves zero and decimal prices', () => {
  assert.deepEqual(createModelCostDraft({
    input: 5,
    output: 30,
    cacheRead: 0.5,
    cacheWrite: 0,
  }), {
    input: '5',
    output: '30',
    cacheRead: '0.5',
    cacheWrite: '0',
  });
});

test('model cost parser writes OpenClaw USD per million token fields', () => {
  assert.deepEqual(parseModelCostDraft({
    input: '5',
    output: '30',
    cacheRead: '0.5',
    cacheWrite: '6.25',
  }), {
    ok: true,
    cost: {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    },
  });
});

test('model cost parser clears empty flat pricing and preserves tiered pricing', () => {
  const empty = { input: '', output: '', cacheRead: '', cacheWrite: '' };
  assert.deepEqual(parseModelCostDraft(empty), { ok: true, cost: undefined });
  assert.deepEqual(parseModelCostDraft(empty, {
    tieredPricing: [{ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, range: [0, 200_000] }],
  }), {
    ok: true,
    cost: {
      tieredPricing: [{ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, range: [0, 200_000] }],
    },
  });
});

test('model cost parser requires all four flat price fields together', () => {
  assert.deepEqual(parseModelCostDraft({ input: '5', output: '', cacheRead: '', cacheWrite: '' }), {
    ok: false,
    field: 'output',
  });
});

test('model cost parser rejects negative and non-finite values', () => {
  assert.deepEqual(parseModelCostDraft({ input: '-1', output: '', cacheRead: '', cacheWrite: '' }), {
    ok: false,
    field: 'input',
  });
  assert.deepEqual(parseModelCostDraft({ input: '', output: '1e999', cacheRead: '', cacheWrite: '' }), {
    ok: false,
    field: 'output',
  });
});
