import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENT_COLORS, normalizeAccentColor, readPersistedAccentColor } from './accent';

test('accent color inventory includes every settings swatch', () => {
  assert.deepEqual([...ACCENT_COLORS], ['teal', 'blue', 'purple', 'rose', 'amber', 'emerald']);
});

test('normalizeAccentColor rejects unknown persisted values', () => {
  assert.equal(normalizeAccentColor('purple'), 'purple');
  assert.equal(normalizeAccentColor('missing'), 'blue');
  assert.equal(normalizeAccentColor(null), 'blue');
});

test('readPersistedAccentColor preserves theme defaults when no accent is saved', () => {
  assert.equal(readPersistedAccentColor({ getItem: () => null }), null);
  assert.equal(readPersistedAccentColor({ getItem: () => 'missing' }), null);
  assert.equal(readPersistedAccentColor({ getItem: () => 'teal' }), 'teal');
});
