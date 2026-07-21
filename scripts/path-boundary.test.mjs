import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { pathsOverlap, pathsOverlapAsync } from './path-boundary.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('filesystem path boundary policy', () => {
  test('detects equality and bidirectional containment', () => {
    assert.equal(pathsOverlap('/tmp/root/source', '/tmp/root/source'), true);
    assert.equal(pathsOverlap('/tmp/root/source', '/tmp/root/source/out'), true);
    assert.equal(pathsOverlap('/tmp/root/source/out', '/tmp/root/source'), true);
    assert.equal(pathsOverlap('/tmp/root/source', '/tmp/root/other'), false);
  });

  test('resolves existing symlink ancestors before checking overlap', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-path-boundary-'));
    roots.push(root);
    const real = path.join(root, 'real');
    await mkdir(path.join(real, 'source'), { recursive: true });
    const alias = path.join(root, 'alias');
    await symlink(real, alias);
    assert.equal(await pathsOverlapAsync(path.join(alias, 'source'), path.join(real, 'publication')), false);
    assert.equal(await pathsOverlapAsync(path.join(alias, 'source'), path.join(real, 'source', 'publication')), true);
  });
});
