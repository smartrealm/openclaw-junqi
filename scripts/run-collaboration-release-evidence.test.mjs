import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { runReleaseEvidenceProducer } from './run-collaboration-release-evidence.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function outputDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-evidence-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('release evidence producer fail-closed boundary', () => {
  test('does not promote the partial Gateway harness to full evidence', async () => {
    const output = await outputDirectory();
    await assert.rejects(
      runReleaseEvidenceProducer({
        type: 'gateway',
        output,
        evidenceRoot: path.join(output, 'partial'),
        gatewayRunner: async () => ({
          evidencePath: path.join(output, 'partial', 'evidence.json'),
          evidence: { claims: { 'P0-01': { status: 'NOT_IN_SCOPE' } } },
        }),
      }),
      (error) => error.code === 'FULL_GATEWAY_SCOPE_REQUIRED',
    );
    const blocker = JSON.parse(await readFile(path.join(output, 'blocker.json'), 'utf8'));
    assert.equal(blocker.status, 'BLOCKED');
    assert.notEqual(blocker.code, 'PASS');
  });

  test('requires real visual and soak harnesses instead of writing synthetic PASS evidence', async () => {
    for (const type of ['visual', 'soak']) {
      const output = await outputDirectory();
      await assert.rejects(
        runReleaseEvidenceProducer({ type, output }),
        (error) => error.code === `${type.toUpperCase()}_HARNESS_REQUIRED`,
      );
      const blocker = JSON.parse(await readFile(path.join(output, 'blocker.json'), 'utf8'));
      assert.equal(blocker.status, 'BLOCKED');
      assert.equal(blocker.evidenceType, type.toUpperCase());
    }
  });
});
