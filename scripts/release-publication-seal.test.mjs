import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  assertReleasePublicationSealMatchesAssets,
  createReleasePublicationSeal,
  MAX_RELEASE_PUBLICATION_INSTALLER_BYTES,
  readReleasePublicationSeal,
  ReleasePublicationSealError,
  serializeReleasePublicationSeal,
  writeReleasePublicationSeal,
} from './release-publication-seal.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const RELEASE_REF = 'refs/tags/v1.2.3';
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureFiles() {
  const installer = Buffer.from('installer');
  const manifest = Buffer.from('{"schemaVersion":1}\n');
  const decision = Buffer.from('{"schemaVersion":1,"kind":"SATISFIED"}\n');
  return [
    { name: 'JunQi.dmg', bytes: installer.byteLength, sha256: digest(installer) },
    { name: 'release-assets-manifest.json', bytes: manifest.byteLength, sha256: digest(manifest) },
    { name: 'release-decision.json', bytes: decision.byteLength, sha256: digest(decision) },
  ];
}

function expectCode(code) {
  return (error) => error instanceof ReleasePublicationSealError && error.code === code;
}

describe('release publication seal', () => {
  test('round-trips a strict source/ref/file digest value object', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-seal-'));
    roots.push(root);
    const sealPath = path.join(root, 'seal.json');
    const seal = createReleasePublicationSeal({ sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF, files: fixtureFiles() });
    await writeReleasePublicationSeal(sealPath, seal);
    assert.equal((await readFile(sealPath)).toString().endsWith('\n'), true);
    assert.deepEqual(await readReleasePublicationSeal(sealPath, {
      sourceSha: SOURCE_SHA,
      releaseRef: RELEASE_REF,
    }), seal);
    await assert.rejects(
      readReleasePublicationSeal(sealPath, { sealSha256: '0'.repeat(64) }),
      expectCode('SEAL_DIGEST_MISMATCH'),
    );
    assert.equal(serializeReleasePublicationSeal(seal), serializeReleasePublicationSeal(await readReleasePublicationSeal(sealPath)));
  });

  test('matches exact assets and rejects replacement, source drift, and unsafe shape', async () => {
    const seal = createReleasePublicationSeal({ sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF, files: fixtureFiles() });
    assert.equal(assertReleasePublicationSealMatchesAssets(seal, seal.files), true);
    assert.equal(assertReleasePublicationSealMatchesAssets(seal, seal.files, {
      sourceSha: SOURCE_SHA,
      releaseRef: RELEASE_REF,
    }), true);
    assert.throws(
      () => assertReleasePublicationSealMatchesAssets(seal, seal.files, {
        sourceSha: 'b'.repeat(40),
        releaseRef: RELEASE_REF,
      }),
      expectCode('SEAL_SOURCE_MISMATCH'),
    );
    assert.throws(
      () => assertReleasePublicationSealMatchesAssets(seal, seal.files, {
        sourceSha: SOURCE_SHA,
        releaseRef: 'refs/tags/v9.9.9',
      }),
      expectCode('SEAL_REF_MISMATCH'),
    );
    assert.throws(
      () => assertReleasePublicationSealMatchesAssets(seal, seal.files.map((file) => file.name === 'JunQi.dmg'
        ? { ...file, sha256: 'b'.repeat(64) }
        : file)),
      expectCode('SEAL_ASSET_MISMATCH'),
    );
    assert.throws(
      () => createReleasePublicationSeal({ sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF, files: [
        ...fixtureFiles(),
        { name: 'unexpected.txt', bytes: 1, sha256: 'c'.repeat(64) },
      ] }),
      expectCode('INVALID_SEAL_FILE'),
    );
    assert.throws(
      () => createReleasePublicationSeal({
        sourceSha: SOURCE_SHA,
        releaseRef: RELEASE_REF,
        files: fixtureFiles().map((file) => file.name === 'JunQi.dmg'
          ? { ...file, bytes: MAX_RELEASE_PUBLICATION_INSTALLER_BYTES + 1 }
          : file),
      }),
      expectCode('SEAL_SIZE_LIMIT'),
    );
  });

  test('leaves the provenance allowance outside the 2 GiB installer ceiling', () => {
    const files = [
      {
        name: 'JunQi.dmg',
        bytes: MAX_RELEASE_PUBLICATION_INSTALLER_BYTES,
        sha256: 'a'.repeat(64),
      },
      { name: 'release-assets-manifest.json', bytes: 1, sha256: 'b'.repeat(64) },
      { name: 'release-decision.json', bytes: 1, sha256: 'c'.repeat(64) },
    ];
    assert.deepEqual(
      createReleasePublicationSeal({ sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF, files }).files,
      files,
    );
  });

  test('rejects a symlinked seal and refuses overwrite', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-seal-'));
    roots.push(root);
    const seal = createReleasePublicationSeal({ sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF, files: fixtureFiles() });
    const real = path.join(root, 'real.json');
    const linked = path.join(root, 'linked.json');
    await writeReleasePublicationSeal(real, seal);
    await symlink(real, linked);
    await assert.rejects(readReleasePublicationSeal(linked), expectCode('SEAL_PATH_INVALID'));
    await assert.rejects(writeReleasePublicationSeal(real, seal), (error) => error?.code === 'EEXIST');
  });

  test('requires a regular parent boundary for a newly written seal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-seal-'));
    roots.push(root);
    const seal = createReleasePublicationSeal({ sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF, files: fixtureFiles() });
    const parent = path.join(root, 'nested');
    await mkdir(parent);
    await writeReleasePublicationSeal(path.join(parent, 'seal.json'), seal);
    await assert.rejects(
      readReleasePublicationSeal(path.join(parent, 'seal.json'), { sourceSha: 'b'.repeat(40) }),
      expectCode('SEAL_SOURCE_MISMATCH'),
    );
  });
});
