import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  TASK_BRIEF_CARD_KINDS,
  TASK_BRIEF_REFERENCE_KINDS,
} from './domain';

const localeNames = ['zh', 'zh-TW', 'en'] as const;
const sources = [
  ...readdirSync(new URL('../pages/TaskBriefs/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => new URL(`../pages/TaskBriefs/${entry.name}`, import.meta.url)),
  new URL('../components/Focus/FocusControl.tsx', import.meta.url),
  new URL('./promptLabels.ts', import.meta.url),
];

const dynamicKeys = [
  ...TASK_BRIEF_CARD_KINDS.flatMap((kind) => [
    `taskBriefs.cardKinds.${kind}`,
    `taskBriefs.cardPlaceholders.${kind}`,
  ]),
  ...TASK_BRIEF_REFERENCE_KINDS.map((kind) => `taskBriefs.referenceKinds.${kind}`),
  ...['draft', 'ready', 'launched', 'archived'].map((status) => `taskBriefs.status.${status}`),
  ...[
    'brief-archived',
    'project-required',
    'goal-required',
    'acceptance-required',
    'ambiguous-language',
    'reference-incomplete',
    'context-suggested',
  ].map((finding) => `taskBriefs.findings.${finding}`),
  ...['idle', 'running', 'attention', 'success', 'error', 'unavailable']
    .map((state) => `focus.states.${state}`),
  'nav.taskBriefs',
  'agentWorkspace.untitledTask',
  'agentWorkspace.run.taskUnavailable',
  'agentWorkspace.run.taskUnavailableDetail',
  'dynamicIsland.focused',
];

function literalTranslationKeys(source: string): string[] {
  const keys = new Set<string>();
  const pattern = /\bt\(\s*(['"])([^'"\x60]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) keys.add(match[2]);
  return [...keys];
}

function nestedValue(catalog: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, catalog);
}

test('Task Brief and Focus translations are complete in every supported locale', () => {
  const usedKeys = new Set(dynamicKeys);
  for (const source of sources) {
    for (const key of literalTranslationKeys(readFileSync(source, 'utf8'))) usedKeys.add(key);
  }

  for (const localeName of localeNames) {
    const catalog = JSON.parse(
      readFileSync(new URL(`../locales/${localeName}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const missing = [...usedKeys].filter((key) => {
      const value = nestedValue(catalog, key);
      return typeof value !== 'string' || value.trim() === '';
    }).sort();
    assert.deepEqual(missing, [], `${localeName} has incomplete Task Brief or Focus translations`);
  }
});

test('Task Brief prompt compiler does not own a fixed display language', () => {
  const compiler = readFileSync(new URL('./compiler.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(compiler, /\p{Script=Han}/u);
});
