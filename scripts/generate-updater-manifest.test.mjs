import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateUpdaterManifest } from './generate-updater-manifest.mjs';

const releaseFixtures = [
  { filename: 'JunQi Desktop_2.0.0_x64-setup.exe', signed: true },
  { filename: 'JunQi Desktop_2.0.0_arm64-setup.exe', signed: true },
  { filename: 'JunQi Desktop_2.0.0_aarch64.dmg', signed: false },
  { filename: 'JunQi Desktop_2.0.0_x64.dmg', signed: false },
  { filename: 'JunQi Desktop_2.0.0_aarch64.app.tar.gz', signed: true },
  { filename: 'JunQi Desktop_2.0.0_x64.app.tar.gz', signed: true },
];

async function writeReleaseFixtures(root) {
  for (const [index, fixture] of releaseFixtures.entries()) {
    await writeFile(join(root, fixture.filename), `artifact-${index}`);
    if (fixture.signed) await writeFile(join(root, `${fixture.filename}.sig`), `signature-${index}\n`);
  }
}

test('generates an NSIS-only updater manifest from final signed artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junqi-updater-manifest-'));
  try {
    await writeReleaseFixtures(root);
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
    assert.equal(manifest.platforms['windows-aarch64'].signature, 'signature-1');
    assert.equal(manifest.platforms['windows-x86_64-msi'], undefined);
    assert.equal(manifest.platforms['darwin-aarch64'].signature, 'signature-4');
    assert.equal(manifest.platforms['darwin-x86_64'].signature, 'signature-5');
    assert.notEqual(
      manifest.platforms['darwin-aarch64'].url,
      manifest.platforms['darwin-x86_64'].url,
    );
    assert.doesNotMatch(manifest.platforms['windows-x86_64'].url, /offline/i);
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

test('rejects obsolete installer artifacts instead of publishing an ambiguous set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junqi-updater-unexpected-'));
  try {
    await writeReleaseFixtures(root);
    await writeFile(join(root, 'JunQi Desktop_2.0.0_x64_zh-CN.msi'), 'obsolete');
    await assert.rejects(
      generateUpdaterManifest({
        assetsDir: root,
        repo: 'smartrealm/openclaw-junqi',
        tag: 'v2.0.0',
        version: '2.0.0',
        output: join(root, 'latest.json'),
      }),
      /Unexpected release artifact: JunQi Desktop_2\.0\.0_x64_zh-CN\.msi/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
