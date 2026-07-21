import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  ReleasePublicationError,
  assertPublicationByteBudget,
  stageReleasePublication,
} from './stage-release-publication.mjs';
import {
  MAX_RELEASE_PUBLICATION_INSTALLER_BYTES,
  readReleasePublicationSeal,
} from './release-publication-seal.mjs';

const temporaryDirectories = [];
const SOURCE_SHA = 'a'.repeat(40);
const RELEASE_REF = 'refs/tags/v1.2.3';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-publication-'));
  temporaryDirectories.push(root);
  const installers = path.join(root, 'installers');
  const metadata = path.join(root, 'metadata');
  await mkdir(installers);
  await mkdir(metadata);
  const installerBytes = Buffer.from('signed-installer');
  await writeFile(path.join(installers, 'JunQi.dmg'), installerBytes);
  await writeFile(path.join(metadata, 'release-assets-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    source: { commit: SOURCE_SHA, releaseRef: RELEASE_REF },
    bundleSha256: 'b'.repeat(64),
    artifacts: [{ name: 'JunQi.dmg', bytes: installerBytes.byteLength, sha256: digest(installerBytes) }],
  }, null, 2)}\n`);
  await writeFile(path.join(metadata, 'release-decision.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'SATISFIED',
    sourceSha: SOURCE_SHA,
    releaseRef: RELEASE_REF,
  })}\n`);
  return { root, installers, metadata, output: path.join(root, 'publication') };
}

function expectCode(code) {
  return (error) => error instanceof ReleasePublicationError && error.code === code;
}

describe('immutable release publication snapshot', () => {
  test('reserves provenance bytes outside the maximum installer budget', () => {
    assert.doesNotThrow(() => assertPublicationByteBudget(
      MAX_RELEASE_PUBLICATION_INSTALLER_BYTES,
      2 * 1024 * 1024,
    ));
    assert.throws(
      () => assertPublicationByteBudget(MAX_RELEASE_PUBLICATION_INSTALLER_BYTES, 2 * 1024 * 1024 + 1),
      expectCode('TREE_LIMIT_EXCEEDED'),
    );
  });

  test('copies only manifest-bound installers and provenance metadata', async () => {
    const paths = await fixture();
    const result = await stageReleasePublication({
      ...paths,
      sourceSha: SOURCE_SHA,
      releaseRef: RELEASE_REF,
    });

    assert.equal(result.status, 'STAGED');
    assert.deepEqual(result.files.map((file) => file.name), [
      'JunQi.dmg',
      'release-assets-manifest.json',
      'release-decision.json',
    ]);
    assert.deepEqual(result.seal.files, result.files);
    assert.equal(await readFile(path.join(paths.output, 'JunQi.dmg'), 'utf8'), 'signed-installer');
  });

  test('writes a non-overwritable seal when requested and binds it to the staged bytes', async () => {
    const paths = await fixture();
    const sealPath = path.join(paths.root, 'publication-seal.json');
    const result = await stageReleasePublication({
      ...paths,
      sourceSha: SOURCE_SHA,
      releaseRef: RELEASE_REF,
      sealOutput: sealPath,
    });
    assert.equal(result.sealPath, sealPath);
    assert.deepEqual(await readReleasePublicationSeal(sealPath, {
      sourceSha: SOURCE_SHA,
      releaseRef: RELEASE_REF,
    }), result.seal);
  });

  test('rejects an installer that differs from the attested manifest', async () => {
    const paths = await fixture();
    await writeFile(path.join(paths.installers, 'JunQi.dmg'), 'replacement');
    await assert.rejects(
      stageReleasePublication({ ...paths, sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF }),
      expectCode('SOURCE_DIGEST_MISMATCH'),
    );
  });

  test('rejects extra metadata, symbolic links, and output/source overlap', async () => {
    const paths = await fixture();
    await writeFile(path.join(paths.metadata, 'debug.json'), '{}');
    await assert.rejects(
      stageReleasePublication({ ...paths, sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF }),
      expectCode('INVALID_METADATA_SET'),
    );
    await rm(path.join(paths.metadata, 'debug.json'));
    await symlink(path.join(paths.installers, 'JunQi.dmg'), path.join(paths.installers, 'linked.dmg'));
    await assert.rejects(
      stageReleasePublication({ ...paths, sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF }),
      expectCode('SYMLINK_REJECTED'),
    );
    await rm(path.join(paths.installers, 'linked.dmg'));
    await assert.rejects(
      stageReleasePublication({
        ...paths,
        output: path.join(paths.installers, 'publication'),
        sourceSha: SOURCE_SHA,
        releaseRef: RELEASE_REF,
      }),
      expectCode('OUTPUT_SOURCE_OVERLAP'),
    );
    await assert.rejects(
      stageReleasePublication({
        ...paths,
        output: paths.root,
        sourceSha: SOURCE_SHA,
        releaseRef: RELEASE_REF,
      }),
      expectCode('OUTPUT_SOURCE_OVERLAP'),
    );
    assert.equal(await readFile(path.join(paths.installers, 'JunQi.dmg'), 'utf8'), 'signed-installer');
  });

  test('rejects oversized metadata before parsing or allocating it', async () => {
    const paths = await fixture();
    await writeFile(path.join(paths.metadata, 'release-decision.json'), Buffer.alloc(1024 * 1024 + 1, 0x20));
    await assert.rejects(
      stageReleasePublication({ ...paths, sourceSha: SOURCE_SHA, releaseRef: RELEASE_REF }),
      expectCode('METADATA_TOO_LARGE'),
    );
  });
});
