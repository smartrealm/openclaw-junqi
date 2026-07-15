import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateUpdaterManifest } from './generate-updater-manifest.mjs';

test('generates a complete updater manifest from final signed artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junqi-updater-manifest-'));
  const fixtures = [
    'JunQi Desktop_2.0.0_x64-setup.exe',
    'JunQi Desktop_2.0.0_x64_zh-CN.msi',
    'JunQi Desktop_2.0.0_arm64-setup.exe',
    'JunQi Desktop_2.0.0_arm64_zh-CN.msi',
    'JunQi Desktop_2.0.0_universal.app.tar.gz',
  ];
  try {
    for (const [index, filename] of fixtures.entries()) {
      await writeFile(join(root, filename), `artifact-${index}`);
      await writeFile(join(root, `${filename}.sig`), `signature-${index}\n`);
    }
    const output = join(root, 'latest.json');
    const manifest = await generateUpdaterManifest({
      assetsDir: root,
      repo: 'smartrealm/openclaw-junqi',
      tag: 'v2.0.0',
      version: '2.0.0',
      notes: 'release notes',
      pubDate: '2026-07-16T00:00:00.000Z',
      output,
    });

    assert.equal(manifest.platforms['windows-x86_64'].signature, 'signature-0');
    assert.equal(manifest.platforms['windows-aarch64-msi'].signature, 'signature-3');
    assert.equal(manifest.platforms['darwin-universal'].signature, 'signature-4');
    assert.match(manifest.platforms['windows-x86_64'].url, /JunQi%20Desktop_2\.0\.0_x64-setup\.exe$/);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed when a required updater artifact is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junqi-updater-missing-'));
  try {
    await assert.rejects(
      generateUpdaterManifest({
        assetsDir: root,
        repo: 'smartrealm/openclaw-junqi',
        tag: 'v2.0.0',
        version: '2.0.0',
        output: join(root, 'latest.json'),
      }),
      /Expected exactly one Windows x64 NSIS installer/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
