/**
 * Tests for check-boundaries.mjs — the SPEC §1 module boundary enforcer.
 *
 * The script reads every .ts/.tsx file under src/, extracts its import
 * specifiers, and matches them against the rule matrix. These tests
 * replicate the rule matrix inline + a fake file tree so we can
 * exercise the violation-detection paths without touching the real
 * src/ directory.
 *
 * IMPORTANT — KEEP IN SYNC: the RULES array below MUST match the one
 * in check-boundaries.mjs. If you change one, change the other and
 * run this test file to verify. The `production run against real src/`
 * test at the bottom is the canonical smoke test — it spawns the
 * real script against the real src/ and asserts the exit code is 0.
 *
 * Run: node --test scripts/check-boundaries.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── RULE MATRIX (mirror of check-boundaries.mjs) ────────────────────────
// Each rule:
//   pattern:  glob of source files this rule applies to
//   forbid:   list of glob patterns the matched file MUST NOT import
// KEEP IN SYNC with check-boundaries.mjs.
const RULES = [
  {
    pattern: /^theme\/(?!useTheme\.ts).*/,   // theme/* except useTheme.ts
    forbid: ['@/stores/**', '@/services/**', '@/components/**'],
  },
  {
    pattern: /^theme\/useTheme\.ts$/,
    forbid: ['@/services/**', '@/components/**'],
  },
  {
    pattern: /^services\//,
    forbid: ['@/stores/**', '@/theme/**'],
  },
  {
    pattern: /^components\//,
    forbid: ['@/services/**'],
  },
  {
    pattern: /^pages\//,
    forbid: ['@/state/**'],
  },
];

// ─── Helpers replicated from check-boundaries.mjs ─────────────────────────

function extractImports(content) {
  const out = [];
  const importRe = /(?:^|\n)\s*(?:import\s+(?:type\s+)?[\s\S]*?from\s+|import\s+)\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(importRe)) out.push(m[1]);
  const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(dynRe)) out.push(m[1]);
  return out;
}

function matchGlob(pattern, str) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${escaped}$`).test(str);
}

// Synthetic checker: walk a {rel: content} map and emit violations.
// Identical algorithm to check-boundaries.mjs but operates on a
// sandboxed tree. We preserve the `@/` prefix on aliased imports so
// they line up against the `@/`-prefixed globs in RULES.forbid (the
// production script keeps `@/` too — it computes target paths under
// SRC via `relative(SRC, resolved)` where `resolved` already includes
// `src/`, so the `@/` stays in the target string).
function checkSynthetic(files) {
  const violations = [];
  for (const [rel, content] of Object.entries(files)) {
    const imports = extractImports(content);
    for (const rule of RULES) {
      if (!rule.pattern.test(rel)) continue;
      for (const imp of imports) {
        const target = imp.startsWith('@/')
          ? imp                         // keep @/ prefix — matches glob
          : imp.startsWith('./') || imp.startsWith('../')
            ? join(dirname(rel), imp).replace(/\\/g, '/')
            : null;
        if (target == null) continue;
        for (const forbidden of rule.forbid) {
          if (matchGlob(forbidden, target)) {
            violations.push({ file: rel, import: imp, target });
          }
        }
      }
    }
  }
  return violations;
}

describe('check-boundaries.mjs rule matrix', () => {
  test('rule matrix has expected shape', () => {
    assert.ok(Array.isArray(RULES));
    for (const rule of RULES) {
      assert.ok(rule.pattern instanceof RegExp, `rule.pattern is not RegExp: ${JSON.stringify(rule)}`);
      assert.ok(Array.isArray(rule.forbid), `rule.forbid is not array: ${JSON.stringify(rule)}`);
    }
  });

  test('rules cover the SPEC §1 boundary matrix (theme, services, components, pages)', () => {
    // Filter by rule.pattern.source. Note RegExp .source retains the
    // ^ anchor so we look for '^theme/' / '^services/' etc. rather than
    // a bare 'theme' prefix.
    const themes = RULES.filter((r) => r.pattern.source.startsWith('^theme'));
    const services = RULES.filter((r) => r.pattern.source.startsWith('^services'));
    const components = RULES.filter((r) => r.pattern.source.startsWith('^components'));
    const pages = RULES.filter((r) => r.pattern.source.startsWith('^pages'));
    assert.ok(themes.length >= 1, 'no theme/* rule');
    assert.ok(services.length >= 1, 'no services/* rule');
    assert.ok(components.length >= 1, 'no components/* rule');
    assert.ok(pages.length >= 1, 'no pages/* rule');
  });

  test('useTheme.ts is the only theme/* file allowed to import from stores/', () => {
    // Main theme rule excludes useTheme.ts via negative lookahead.
    // RegExp .source retains the ^ anchor so we look for '^theme'.
    const themeMainRule = RULES.find(
      (r) => r.pattern.source.startsWith('^theme') && r.pattern.source.includes('?!'),
    );
    assert.ok(themeMainRule, 'no main theme rule with negative lookahead');
    const useThemeRule = RULES.find((r) => r.pattern.source.includes('useTheme'));
    assert.ok(useThemeRule, 'no useTheme-specific rule');
    assert.ok(
      useThemeRule.forbid.some((g) => g.includes('@/services')),
      'useTheme rule must still block @/services',
    );
  });
});

describe('check-boundaries.mjs violation detection', () => {
  test('flags theme/* importing from @/stores (the main bug)', () => {
    const violations = checkSynthetic({
      'theme/bad.ts': `import { useSettingsStore } from '@/stores/settingsStore';`,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, 'theme/bad.ts');
    assert.equal(violations[0].import, '@/stores/settingsStore');
  });

  test('does NOT flag theme/useTheme.ts importing from @/stores (the bridge)', () => {
    const violations = checkSynthetic({
      'theme/useTheme.ts': `import { useSettingsStore } from '@/stores/settingsStore';`,
    });
    assert.equal(violations.length, 0,
      'useTheme.ts is the documented bridge to settingsStore and should be allowed');
  });

  test('flags theme/* importing from @/services', () => {
    const violations = checkSynthetic({
      'theme/foo.ts': `import { gateway } from '@/services/gateway';`,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].import, '@/services/gateway');
  });

  test('flags services/* importing from @/stores', () => {
    const violations = checkSynthetic({
      'services/foo.ts': `import { useChatStore } from '@/stores/chatStore';`,
    });
    assert.equal(violations.length, 1);
  });

  test('flags components/* importing from @/services directly', () => {
    const violations = checkSynthetic({
      'components/Foo.tsx': `import { gateway } from '@/services/gateway';`,
    });
    assert.equal(violations.length, 1);
  });

  test('flags pages/* importing from @/state/ (Rust)', () => {
    const violations = checkSynthetic({
      'pages/Foo.tsx': `import { something } from '@/state/something';`,
    });
    assert.equal(violations.length, 1);
  });

  test('allows relative imports within theme/', () => {
    const violations = checkSynthetic({
      'theme/foo.ts': `import { bar } from './bar';\nimport { baz } from '../types';`,
    });
    assert.equal(violations.length, 0);
  });

  test('allows same-layer imports (services/foo → services/bar)', () => {
    const violations = checkSynthetic({
      'services/foo.ts': `import { bar } from './bar';`,
    });
    assert.equal(violations.length, 0);
  });

  test('skips bare module specifiers (npm packages)', () => {
    const violations = checkSynthetic({
      'theme/foo.ts': `import { useState } from 'react';\nimport clsx from 'clsx';`,
    });
    assert.equal(violations.length, 0);
  });

  test('catches dynamic imports too (the original bug pattern)', () => {
    // SessionRowItem originally used await import('@/services/gateway')
    // which caused a chunk-level circular dep → boot error. The static
    // checker should catch dynamic imports as well so we never reintroduce.
    const violations = checkSynthetic({
      'components/Layout/Foo.tsx': `const m = await import('@/services/gateway');`,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].import, '@/services/gateway');
  });

  test('multi-import statement — counts each forbidden import', () => {
    const violations = checkSynthetic({
      'theme/bad.ts': `
        import { useSettingsStore } from '@/stores/settingsStore';
        import { gateway } from '@/services/gateway';
        import { useTheme } from '@/theme/useTheme';
      `,
    });
    // Two forbidden (stores + services), one allowed (useTheme).
    assert.equal(violations.length, 2);
    const targets = violations.map((v) => v.import).sort();
    assert.deepEqual(targets, ['@/services/gateway', '@/stores/settingsStore']);
  });

  test('production run against real src/ is clean (smoke test)', () => {
    // Canonical contract: real src/ has zero violations.
    const result = spawnSync('node', ['scripts/check-boundaries.mjs'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0,
      `check-boundaries.mjs exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Module boundaries clean/);
  });
});