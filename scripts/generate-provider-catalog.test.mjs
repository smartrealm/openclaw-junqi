import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./generate-provider-catalog.js', import.meta.url), 'utf8');

test('BUG-MP-05 generator is ESM and binds generation to an isolated official OpenClaw CLI', () => {
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.match(source, /OPENCLAW_CONFIG_PATH/);
  assert.match(source, /OPENCLAW_BIN/);
  assert.doesNotMatch(source, /process\.env\.PATH/);
  assert.match(source, /shell: process\.platform === 'win32'/);
  assert.match(source, /--allow-template-fallback/);
});

test('provider catalog regeneration rejects a workspace OpenClaw package that differs from the pinned version', async () => {
  const { assertPinnedOpenClawVersion } = await import('./generate-provider-catalog.js');

  assert.doesNotThrow(() => assertPinnedOpenClawVersion('2026.7.1-2', '2026.7.1-2'));
  assert.throws(
    () => assertPinnedOpenClawVersion('2026.7.1-2', '2026.7.1'),
    /Workspace OpenClaw version mismatch[\s\S]*pnpm install --frozen-lockfile/,
  );
  assert.throws(
    () => assertPinnedOpenClawVersion('^2026.7.1', '2026.7.1'),
    /must pin OpenClaw to an exact version/,
  );
});

test('BUG-FCA-12 media generation resolves the workspace-pinned OpenClaw package', () => {
  assert.match(source, /packages', 'junqi-collab', 'node_modules', 'openclaw'/);
  assert.match(source, /workspaceOpenClawRoot/);
  assert.match(source, /assertPinnedOpenClawVersion/);
  assert.match(source, /registerImageGenerationProvider/);
  assert.match(source, /registerVideoGenerationProvider/);

  const media = fs.readFileSync(new URL('../src/generated/mediaCatalog.generated.ts', import.meta.url), 'utf8');
  const imageRows = media.match(/GENERATED_IMAGE_GENERATION_MODELS[\s\S]*?\] as const/)?.[0].match(/"id":/g) ?? [];
  const videoRows = media.match(/GENERATED_VIDEO_GENERATION_MODELS[\s\S]*?\] as const/)?.[0].match(/"id":/g) ?? [];
  assert.ok(imageRows.length > 0, 'pinned image-generation catalog must not be empty');
  assert.ok(videoRows.length > 0, 'pinned video-generation catalog must not be empty');
});
