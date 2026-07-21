import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  copyStableFile,
  StableFileError,
  readStableFile,
  writeNewRegularFile,
} from './stable-file.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-stable-file-'));
  roots.push(root);
  return root;
}

describe('stable file adapter', () => {
  test('reads the same regular file identity observed by discovery', async () => {
    const root = await fixture();
    const source = path.join(root, 'installer.exe');
    await writeFile(source, 'signed-installer');
    const observed = await lstat(source);
    assert.equal((await readStableFile(source, observed)).bytes.toString('utf8'), 'signed-installer');
  });

  test('rejects a source replaced after discovery and refuses destination overwrite', async () => {
    const root = await fixture();
    const source = path.join(root, 'installer.exe');
    await writeFile(source, 'first');
    const observed = await lstat(source);
    await writeFile(source, 'replacement-with-different-identity');
    await assert.rejects(
      readStableFile(source, observed),
      (error) => error instanceof StableFileError && error.code === 'FILE_CHANGED',
    );

    const destination = path.join(root, 'staged.exe');
    await writeNewRegularFile(destination, Buffer.from('staged'));
    await assert.rejects(writeNewRegularFile(destination, Buffer.from('overwrite')));
    assert.equal(await readFile(destination, 'utf8'), 'staged');
  });

  test('streams a stable source into an exclusive destination with a verified digest', async () => {
    const root = await fixture();
    const source = path.join(root, 'installer.dmg');
    const destination = path.join(root, 'publication.dmg');
    const bytes = Buffer.alloc(1024 * 1024 + 17, 0x5a);
    await writeFile(source, bytes);
    const observed = await lstat(source);

    const result = await copyStableFile(source, destination, observed);

    assert.equal(result.bytes, bytes.byteLength);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readFile(destination), bytes);
    await assert.rejects(copyStableFile(source, destination, observed));
    assert.deepEqual(await readFile(destination), bytes);
  });
});
