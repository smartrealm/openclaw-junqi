#!/usr/bin/env node
/**
 * Module-boundary checker (SPEC §1, T8).
 *
 * Enforces the dependency direction between source folders. The matrix
 * is the single source of truth — change it here and both humans and CI
 * see the same rules.
 *
 * Forbidden imports (per SPEC §1):
 *   theme/*       →  stores/, services/, components/
 *                   (EXCEPT theme/useTheme.ts which is the bridge to the store)
 *   services/*    →  stores/, theme/
 *   components/*  →  services/* directly (must go through stores)
 *   pages/*       →  state/* Rust directly (only via services + IPC)
 *
 * Bridge files (explicit allowlist for the few cases where the rule
 * needs to bend):
 *   theme/useTheme.ts       → may import from @/stores/settingsStore
 *
 * Run from repo root: node scripts/check-boundaries.mjs
 * Exits 1 on any violation so CI can fail the build.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');

// ── Boundary matrix (single source of truth) ─────────────────────────────

/**
 * Each rule:
 *   pattern:  glob of source files this rule applies to (matched against
 *             file's path under SRC, forward slashes)
 *   forbid:   list of glob patterns the matched file MUST NOT import
 *   message:  human-readable error shown on violation
 *   allow:    per-file exceptions (path → set of import prefixes allowed
 *             despite the rule). Used for documented bridges.
 */
const RULES = [
  {
    pattern: /^theme\/(?!useTheme\.ts).*/,   // theme/* except useTheme.ts
    forbid: [
      '@/stores/**',
      '@/services/**',
      '@/components/**',
    ],
    message: 'theme/* is a pure-math + DOM-side-effect module. It must not import from stores/services/components. See SPEC §1.',
  },
  {
    pattern: /^theme\/useTheme\.ts$/,
    forbid: [
      '@/services/**',
      '@/components/**',
    ],
    message: 'theme/useTheme.ts is a bridge to the store; it may import @/stores/settingsStore but must not reach into services/ or components/.',
  },
  {
    pattern: /^services\//,
    forbid: [
      '@/stores/**',
      '@/theme/**',
    ],
    message: 'services/* is a thin IPC adapter layer. It must not import from stores/ or theme/ — keep it stateless and pure. See SPEC §1.',
  },
  {
    pattern: /^components\//,
    forbid: [
      '@/services/',
    ],
    message: 'components/* must not import services/ directly. Go through stores/ so the state machine owns the side effects. See SPEC §1.',
  },
  {
    pattern: /^pages\//,
    forbid: [
      '@/state/',
    ],
    message: 'pages/* must not import Rust state/ directly. Use services/ + IPC commands. See SPEC §1.',
  },
];

// ── File walker ───────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(p);
    }
  }
  return out;
}

// ── Import extractor ──────────────────────────────────────────────────────

/**
 * Extract import specifiers from a TS/TSX file. Handles both:
 *   import { x } from 'foo'
 *   import 'foo'
 *   import type { x } from 'foo'
 *   const x = await import('foo')
 * Skips relative imports (those starting with . or /).
 */
function extractImports(content) {
  const out = [];
  // import ... from '...'
  const importRe = /(?:^|\n)\s*(?:import\s+(?:type\s+)?[\s\S]*?from\s+|import\s+)\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(importRe)) out.push(m[1]);
  // dynamic import('...')
  const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(dynRe)) out.push(m[1]);
  return out;
}

// ── Glob matcher ──────────────────────────────────────────────────────────

/** Minimal glob: ** matches any path segment(s), * matches within a segment. */
function matchGlob(pattern, str) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  return re.test(str);
}

// ── Path normalizer ───────────────────────────────────────────────────────

/** Turn `@/foo/bar` into `./src/foo/bar` so we can check directory inclusion. */
function resolveAlias(spec, fromFile) {
  if (spec.startsWith('@/')) return join(SRC, spec.slice(2));
  if (spec.startsWith('./') || spec.startsWith('../')) return join(dirname(fromFile), spec);
  return null; // bare module — ignore
}

// ── Main check ────────────────────────────────────────────────────────────

const files = walk(SRC);
const violations = [];

for (const file of files) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const content = readFileSync(file, 'utf8');
  const imports = extractImports(content);

  for (const rule of RULES) {
    if (!rule.pattern.test(rel)) continue;

    for (const imp of imports) {
      const resolved = resolveAlias(imp, file);
      if (!resolved) continue; // bare module — out of scope for boundary rules
      const targetRel = relative(SRC, resolved).replace(/\\/g, '/');
      for (const forbidden of rule.forbid) {
        if (matchGlob(forbidden, targetRel)) {
          violations.push({
            file: rel,
            import: imp,
            rule: rule.message,
            target: targetRel,
          });
        }
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log(`✓ Module boundaries clean (checked ${files.length} files)`);
  process.exit(0);
}

console.error(`✗ Module boundary violations (${violations.length}):\n`);
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    imports "${v.import}" → ${v.target}`);
  console.error(`    ${v.rule}\n`);
}
process.exit(1);