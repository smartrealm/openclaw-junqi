import assert from 'node:assert/strict';
import test from 'node:test';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';
import { OPENCLAW_COMMANDS } from './commands';
import { OPENCLAW_COMMAND_CATEGORIES } from './types';

const EXPECTED_CATEGORY_COUNTS = {
  setup: 5,
  gateway: 9,
  diagnostics: 9,
  models: 13,
  auth: 7,
  channels: 5,
  automation: 7,
} as const;

const OFFICIAL_PAGES_WITHOUT_COMMAND_ANCHORS = new Set(['status-all', 'status-deep']);

test('OpenClaw command references are unique and point only to official docs', () => {
  const ids = new Set<string>();
  const commands = new Set<string>();
  const summaryKeys = new Set<string>();

  for (const item of OPENCLAW_COMMANDS) {
    assert.ok(!ids.has(item.id), `duplicate command id: ${item.id}`);
    assert.ok(!commands.has(item.command), `duplicate command syntax: ${item.command}`);
    assert.ok(!summaryKeys.has(item.summaryKey), `duplicate command summary: ${item.summaryKey}`);
    ids.add(item.id);
    commands.add(item.command);
    summaryKeys.add(item.summaryKey);

    const url = new URL(item.docsUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'docs.openclaw.ai');
    assert.ok(url.pathname.startsWith('/cli/'));
    assert.ok(item.summaryKey.startsWith('openclawCommands.items.'));
    assert.ok(item.keywords.length > 0);
    assert.ok(!item.command.includes('|'), `${item.id} must copy a shell-safe example, not pipe shorthand`);
    const copiedText = item.copyCommand ?? item.command;
    assert.ok(!/[<>]/.test(copiedText), `${item.id} must not copy shell redirection placeholders`);

    if (!OFFICIAL_PAGES_WITHOUT_COMMAND_ANCHORS.has(item.id)) {
      assert.ok(url.hash.length > 1, `${item.id} must use a verified official heading anchor`);
    }
  }
});

test('OpenClaw command inventory keeps the expected operational depth', () => {
  assert.equal(OPENCLAW_COMMANDS.length, 55);

  for (const category of OPENCLAW_COMMAND_CATEGORIES) {
    const actualCount = OPENCLAW_COMMANDS.filter((item) => item.category === category).length;
    assert.equal(actualCount, EXPECTED_CATEGORY_COUNTS[category], `${category} command count changed`);
  }
});

test('every OpenClaw command has copy in all supported locale catalogs', () => {
  const catalogs = [zh, en, ar] as const;
  for (const item of OPENCLAW_COMMANDS) {
    const itemKey = item.summaryKey.replace('openclawCommands.items.', '');
    for (const catalog of catalogs) {
      const items = catalog.openclawCommands.items as Record<string, string>;
      assert.ok(items[itemKey]?.trim(), `missing localized summary for ${item.id}`);
    }
  }

  for (const category of ['all', ...OPENCLAW_COMMAND_CATEGORIES]) {
    for (const catalog of catalogs) {
      const categories = catalog.openclawCommands.categories as Record<string, string>;
      assert.ok(categories[category]?.trim(), `missing localized category label for ${category}`);
    }
  }
});
