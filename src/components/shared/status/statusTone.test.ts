import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  STATUS_TONES,
  isStatusTone,
  resolveStatusTone,
  statusToneColor,
  statusToneGlow,
  statusToneLabel,
  toneAnimatesByDefault,
  type StatusTone,
} from './statusTone';

test('BUG-FCA-04 canonical domain has no synonyms', () => {
  assert.equal(new Set(STATUS_TONES).size, STATUS_TONES.length);
  for (const tone of STATUS_TONES) {
    assert.ok(isStatusTone(tone), `${tone} must be recognized as canonical`);
    assert.equal(resolveStatusTone(tone), tone, `${tone} must map to itself`);
  }
});

test('BUG-FCA-04 every legacy and lifecycle vocabulary resolves', () => {
  // The three vocabularies that existed before convergence, plus the
  // cross-layer task/boot/chat/workshop values StatusIcon accepts.
  const cases: Record<string, StatusTone> = {
    // legacy shared/StatusDot
    active: 'running',
    sleeping: 'dormant',
    error: 'failed',
    paused: 'attention',
    // legacy shared/badge tones
    primary: 'info',
    ok: 'success',
    ended: 'success',
    err: 'failed',
    danger: 'failed',
    warn: 'warning',
    live: 'running',
    // lifecycle (StatusBadge)
    idle: 'idle',
    running: 'running',
    attention: 'attention',
    failed: 'failed',
    // task / boot / chat / workshop
    todo: 'idle',
    pending: 'idle',
    queue: 'idle',
    queued: 'idle',
    inProgress: 'running',
    input_required: 'attention',
    awaiting_review: 'attention',
    review: 'info',
    done: 'success',
    completed: 'success',
    interrupted: 'warning',
    detached: 'warning',
    skipped: 'neutral',
    cancelled: 'neutral',
    sent: 'success',
  };

  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(resolveStatusTone(input), expected, `${input} must resolve to ${expected}`);
  }
});

test('BUG-FCA-04 connection lifecycle uses canonical success, warning and failed tones', () => {
  assert.equal(resolveStatusTone('success'), 'success');
  assert.equal(resolveStatusTone('warning'), 'warning');
  assert.equal(resolveStatusTone('failed'), 'failed');
  assert.notEqual(
    statusToneColor(resolveStatusTone('warning')),
    statusToneColor(resolveStatusTone('idle')),
    'connecting must not be visually collapsed into idle',
  );
});

test('BUG-FCA-04 unknown and empty values degrade to neutral instead of throwing', () => {
  for (const input of ['', 'not-a-status', 'RUNNING', null, undefined]) {
    assert.equal(resolveStatusTone(input as string), 'neutral');
  }
  assert.equal(isStatusTone('ok'), false, 'an alias is not a canonical tone');
  assert.equal(isStatusTone(42), false);
});

test('BUG-FCA-04 every tone paints from a theme token, never a literal color', () => {
  for (const tone of STATUS_TONES) {
    const color = statusToneColor(tone);
    assert.match(
      color,
      /var\(--aegis-/,
      `${tone} must resolve through an --aegis-* custom property, got ${color}`,
    );
    assert.doesNotMatch(color, /#[0-9a-fA-F]{3,8}\b/, `${tone} must not hardcode a hex color`);

    const glow = statusToneGlow(tone);
    assert.ok(
      glow === 'transparent' || /var\(--aegis-/.test(glow),
      `${tone} glow must be a theme token or transparent, got ${glow}`,
    );
  }
});

test('BUG-FCA-04 only in-flight work animates by default', () => {
  const animated = STATUS_TONES.filter(toneAnimatesByDefault);
  assert.deepEqual(animated, ['running']);
});

test('BUG-FCA-04 every tone has a distinct i18n key and fallback', () => {
  const keys = STATUS_TONES.map((tone) => statusToneLabel(tone).key);
  assert.equal(new Set(keys).size, keys.length, 'tone i18n keys must be unique');
  for (const tone of STATUS_TONES) {
    const { key, fallback } = statusToneLabel(tone);
    assert.match(key, /^status\./);
    assert.ok(fallback.length > 0);
  }
});

test('BUG-FCA-04 the dormant tone is defined by all four themes', () => {
  const themeDir = new URL('../../../styles/themes/', import.meta.url);
  const themes = readdirSync(themeDir).filter((name) => name.endsWith('.css'));
  assert.ok(themes.length >= 4, `expected at least four themes, found ${themes.join(', ')}`);
  for (const theme of themes) {
    const source = readFileSync(new URL(theme, themeDir), 'utf8');
    assert.match(
      source,
      /--aegis-status-dormant:/,
      `${theme} must define --aegis-status-dormant so the dormant tone is not blank`,
    );
  }
});

test('BUG-FCA-04 exactly one StatusDot implementation remains', () => {
  const sharedDir = new URL('../', import.meta.url);
  const definition = /export (function|const) StatusDot\b/;
  const owners: string[] = [];

  const walk = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;
      const source = readFileSync(new URL(entry.name, dir), 'utf8');
      if (definition.test(source)) owners.push(`${prefix}${entry.name}`);
    }
  };
  walk(sharedDir, '');

  assert.deepEqual(
    owners,
    ['badge/Badge.tsx'],
    'StatusDot must be defined once; re-export it instead of reimplementing',
  );
});

test('BUG-FCA-04 agent activity dots keep their original green/amber reading', () => {
  // The removed `shared/StatusDot` painted active with `bg-aegis-success`
  // (green) and idle with `bg-aegis-warning` (amber). Convergence must not
  // silently repaint an agent activity dot blue/grey, so AgentHub states
  // its intent with canonical tones instead of the legacy vocabulary.
  const source = readFileSync(new URL('../../../pages/AgentHub/index.tsx', import.meta.url), 'utf8');
  const calls = source.match(/<StatusDot[^>]*>/g) ?? [];
  assert.ok(calls.length > 0, 'expected AgentHub to render status dots');
  for (const call of calls) {
    // Legacy words can appear inside a ternary, so scan the whole call for
    // the string literals rather than only the `tone=` prefix.
    assert.doesNotMatch(
      call,
      /['"](active|idle|sleeping)['"]/,
      `AgentHub must not reuse the legacy dot vocabulary: ${call}`,
    );
  }

  // Running is green, resting is amber, never-active is the dormant grey.
  assert.equal(statusToneColor(resolveStatusTone('success')), 'rgb(var(--aegis-status-ended))');
  assert.equal(statusToneColor(resolveStatusTone('warning')), 'rgb(var(--aegis-warning))');
  assert.equal(statusToneColor(resolveStatusTone('dormant')), 'rgb(var(--aegis-status-dormant))');
});
