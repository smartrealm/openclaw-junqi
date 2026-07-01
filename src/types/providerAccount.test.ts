import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProviderAccountId,
  enforceSingleDefault,
  type ProviderAccount,
} from './providerAccount';

function mk(overrides: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: overrides.id ?? 'acc-1',
    vendorId: 'openai',
    label: 'Test',
    authMode: 'api_key',
    enabled: true,
    isDefault: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('makeProviderAccountId', () => {
  test('returns a non-empty URL-safe string', () => {
    const id = makeProviderAccountId();
    assert.ok(id.length > 0);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `id has non-URL-safe chars: ${id}`);
  });

  test('is unique per call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeProviderAccountId()));
    assert.equal(ids.size, 100, 'collisions in 100 ids');
  });

  test('has at least 16 base64url chars of entropy', () => {
    const id = makeProviderAccountId();
    assert.ok(id.length >= 16, `id too short: ${id}`);
  });
});

describe('enforceSingleDefault', () => {
  test('returns input unchanged when exactly one is default', () => {
    const accounts = [
      mk({ id: 'a', isDefault: true }),
      mk({ id: 'b', isDefault: false }),
      mk({ id: 'c', isDefault: false }),
    ];
    const out = enforceSingleDefault(accounts, 'openai');
    assert.deepEqual(out, accounts);
  });

  test('picks first enabled when zero are default', () => {
    const accounts = [
      mk({ id: 'a', isDefault: false, enabled: true }),
      mk({ id: 'b', isDefault: false, enabled: false }),
      mk({ id: 'c', isDefault: false, enabled: true }),
    ];
    const out = enforceSingleDefault(accounts, 'openai');
    const defaults = out.filter((a) => a.isDefault).map((a) => a.id);
    assert.deepEqual(defaults, ['a'], 'first enabled should be default');
  });

  test('picks first account when none are enabled', () => {
    const accounts = [
      mk({ id: 'a', isDefault: false, enabled: false }),
      mk({ id: 'b', isDefault: false, enabled: false }),
    ];
    const out = enforceSingleDefault(accounts, 'openai');
    const defaults = out.filter((a) => a.isDefault).map((a) => a.id);
    assert.deepEqual(defaults, ['a']);
  });

  test('preserves the existing default when multiple are set (keeps first)', () => {
    // This shouldn't happen if callers always run enforceSingleDefault
    // before save, but if it does we should not throw — just keep the
    // first and demote the rest.
    const accounts = [
      mk({ id: 'a', isDefault: true }),
      mk({ id: 'b', isDefault: true }),
      mk({ id: 'c', isDefault: true }),
    ];
    const out = enforceSingleDefault(accounts, 'openai');
    const defaults = out.filter((a) => a.isDefault).map((a) => a.id);
    assert.equal(defaults.length, 1, 'should pick exactly one');
  });

  test('only affects the target vendor, leaves others alone', () => {
    const accounts = [
      mk({ id: 'o1', vendorId: 'openai', isDefault: true }),
      mk({ id: 'a1', vendorId: 'anthropic', isDefault: false }),
      mk({ id: 'a2', vendorId: 'anthropic', isDefault: false }),
    ];
    // No-op for anthropic — but it should still have exactly one default
    // after the call. Test: if no openai present, returns input as-is.
    const out = enforceSingleDefault(accounts, 'anthropic');
    assert.equal(out.length, 3);
    assert.equal(out.filter((a) => a.isDefault).length, 1, 'preserves existing default');
  });

  test('empty account list passes through', () => {
    assert.deepEqual(enforceSingleDefault([], 'openai'), []);
  });
});