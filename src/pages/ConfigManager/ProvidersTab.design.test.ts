import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('the model-service picker uses a quiet two-pane work layout', async () => {
  const source = await read('./ProvidersTab.tsx');
  const picker = source.slice(
    source.indexOf('function PickStep'),
    source.indexOf('/** Compact card used by the existing providers list'),
  );

  assert.match(picker, /grid-cols-\[148px_minmax\(0,1fr\)\]/);
  assert.match(picker, /providerIcon\.icon/);
  assert.doesNotMatch(picker, /bg-gradient-to-br/);
  assert.doesNotMatch(picker, /rounded-full/);
});

test('the add-service dialog remains compact and exposes both workflow steps', async () => {
  const source = await read('./ProvidersTab.tsx');
  const dialog = source.slice(
    source.indexOf('function AddProviderModal'),
    source.indexOf('// ProvidersTab — Main Component'),
  );

  assert.match(dialog, /max-w-\[780px\]/);
  assert.match(dialog, /config\.pickProviderStep/);
  assert.match(dialog, /config\.configureProviderStep/);
  assert.match(dialog, /role="dialog"/);
  assert.doesNotMatch(dialog, /rounded-2xl/);
});

test('the providers overview uses one compact summary instead of stat cards', async () => {
  const source = await read('./ProvidersTab.tsx');
  const overview = source.slice(
    source.indexOf('{/* ── A) Overview Hero Card'),
    source.indexOf('{/* ── B) Unified Provider Cards'),
  );

  assert.match(overview, /data-testid="provider-compact-summary"/);
  assert.doesNotMatch(overview, /<StatCard/);
});

test('routing controls expose ordered fallbacks and guard configured-only mode', async () => {
  const source = await read('./ProvidersTab.tsx');
  const overview = source.slice(
    source.indexOf('{/* ── A) Overview Hero Card'),
    source.indexOf('{/* ── B) Unified Providers List'),
  );

  assert.match(overview, /data-testid="model-routing-health"/);
  assert.match(source, /data-testid="default-model-fallback-chain"/);
  assert.match(overview, /requestModelCatalogMode/);
  assert.match(overview, /replaceModeBlocked/);
  assert.match(overview, /DefaultFallbackChainControls/);
});
