import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const storageGate = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');

function flattenMessages(value: unknown, prefix = '', result: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      flattenMessages(entry, path, result);
    } else {
      result[path] = entry;
    }
  }
  return result;
}

test('BUG-ONB-01 stale detection cannot override Back navigation', () => {
  const detection = setupFlow.slice(
    setupFlow.indexOf('// ── 挂载后自动检测'),
    setupFlow.indexOf('// ── Docker detect'),
  );

  assert.match(detection, /let cancelled = false/);
  assert.match(detection, /await checkOpenclaw\(\);\s*if \(cancelled\) return/);
  assert.match(detection, /await window\.aegis\.config\.detect\(\);\s*if \(cancelled\) return/);
  assert.match(detection, /return \(\) => \{\s*cancelled = true/);
});

test('BUG-ONB-02 storage results cannot advance an unmounted or applying step', () => {
  assert.match(storageGate, /const mountedRef = useRef\(false\)/);
  assert.match(storageGate, /if \(!mountedRef\.current\) return;\s*onReadyRef\.current/);
  assert.match(storageGate, /return \(\) => \{\s*mountedRef\.current = false/);
  assert.match(storageGate, /previousAction=\{\{ onClick: onBack, disabled: applying \}\}/);
});

test('BUG-ONB-03 ready cannot fall into a branch-agnostic native start step', () => {
  const ready = setupPage.slice(
    setupPage.indexOf('function ReadyScreen'),
    setupPage.indexOf('function GitMissingScreen'),
  );

  assert.doesNotMatch(ready, /previousAction/);
  assert.doesNotMatch(ready, /install-complete/);
  assert.match(ready, /flow\.enterWorkspace/);
});

test('BUG-ONB-04 update completion preserves the OpenClaw onboarding gate', () => {
  const stopped = setupPage.slice(
    setupPage.indexOf('function GatewayStoppedScreen'),
    setupPage.indexOf('function ModeSelectScreen'),
  );

  assert.match(stopped, /flow\.needsOnboarding \? "configure-openclaw" : "ready"/);
});

test('BUG-ONB-05 Docker mode selection is a keyboard-operable native button', () => {
  const mode = setupPage.slice(
    setupPage.indexOf('function ModeSelectScreen'),
    setupPage.indexOf('function ProgressScreen'),
  );

  assert.match(mode, /<button\s+type="button"\s+disabled=\{!dockerAvailable\}[\s\S]*?flow\.selectMode\("docker"\)/);
  assert.doesNotMatch(mode, /onClick=\{\(\) => dockerAvailable && flow\.selectMode\("docker"\)\}/);
});

test('BUG-ONB-06 every setup message is complete in all supported locales', () => {
  const locales = Object.fromEntries(['zh', 'en', 'ar'].map((locale) => [
    locale,
    flattenMessages(JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'))),
  ])) as Record<string, Record<string, unknown>>;
  const setupKeys = Object.keys(locales.zh).filter((key) => key.startsWith('setup.'));

  for (const locale of ['en', 'ar']) {
    for (const key of setupKeys) {
      assert.equal(typeof locales[locale][key], 'string', `${locale} is missing ${key}`);
      assert.notEqual(String(locales[locale][key]).trim(), '', `${locale} has an empty ${key}`);
    }
  }
});

test('BUG-ONB-07 wizard body messages are not duplicated as subtitles', () => {
  const wizard = setupPage.slice(
    setupPage.indexOf('function WizardScreen'),
    setupPage.indexOf('function ReadyScreen'),
  );

  assert.match(wizard, /const messageRenderedInBody = step\.type === "confirm"/);
  assert.match(wizard, /subtitle=\{wizardSubtitle\}/);
  assert.match(wizard, /aria-label=\{step\.title \|\| t\("setup\.wizard\.textInput"/);
});

test('BUG-ONB-08 the product summary is not constrained to an awkward narrow line length', () => {
  const welcome = setupPage.slice(
    setupPage.indexOf('function WelcomeScreen'),
    setupPage.indexOf('function DetectingScreen'),
  );
  assert.doesNotMatch(welcome, /max-w-\[42ch\]/);
});
