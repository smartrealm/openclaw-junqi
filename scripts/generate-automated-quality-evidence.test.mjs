import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  EXTERNAL_ACCEPTANCE,
  QUALITY_EVIDENCE_FILES,
  QUALITY_EVIDENCE_SCHEMA_VERSION,
  assertEvidenceFilesMatchHead,
  createAutomatedQualityEvidence,
  sha256,
  stableJson,
} from './generate-automated-quality-evidence.mjs';

const BUNDLE_HASH = 'a'.repeat(64);
const METADATA_HASH = 'b'.repeat(64);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function git(directory, args) {
  execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
}

async function trackedFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'junqi-quality-evidence-'));
  temporaryDirectories.push(directory);
  for (const [key, relativePath] of Object.entries(QUALITY_EVIDENCE_FILES)) {
    const filePath = path.join(directory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    const bytes = key === 'bundle'
      ? Buffer.from([0, 1, 2, 3, 4])
      : Buffer.from(`${key}\n`, 'utf8');
    await writeFile(filePath, bytes);
  }
  git(directory, ['init']);
  git(directory, ['config', 'user.name', 'JunQi Test']);
  git(directory, ['config', 'user.email', 'test@junqi.invalid']);
  git(directory, ['add', '.']);
  git(directory, ['commit', '-m', 'fixture']);
  return directory;
}

function metadata(overrides = {}) {
  return {
    formatVersion: 1,
    pluginId: 'junqi-collab',
    packageName: '@junqi/openclaw-collaboration',
    pluginVersion: '0.2.0',
    schemaVersion: 10,
    sha256: BUNDLE_HASH,
    archiveFile: 'junqi-collab.tgz',
    resourcePath: 'collaboration/junqi-collab.tgz',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    repo: 'smartrealm/openclaw-junqi',
    expectedCommit: '1'.repeat(40),
    commit: '1'.repeat(40),
    tree: '2'.repeat(40),
    desktopPackage: { name: 'junqi-desktop', version: '0.5.4' },
    pluginPackage: { name: '@junqi/openclaw-collaboration', version: '0.2.0' },
    pluginManifest: { id: 'junqi-collab', version: '0.2.0' },
    resourceMetadata: metadata(),
    generatedMetadata: metadata(),
    hashes: {
      bundle: BUNDLE_HASH,
      metadata: { resource: METADATA_HASH, generated: METADATA_HASH },
      lockfiles: { pnpm: 'c'.repeat(64), cargo: 'd'.repeat(64) },
    },
    toolchain: {
      node: 'v22.23.1',
      pnpm: '9.15.9',
      rustc: 'rustc 1.88.0 (test)',
      cargo: 'cargo 1.88.0 (test)',
    },
    workflow: { runId: '123456789012345678', runAttempt: '2' },
    ...overrides,
  };
}

describe('automated quality evidence', () => {
  test('emits the bounded machine-readable contract without external acceptance claims', () => {
    const evidence = createAutomatedQualityEvidence({
      ...input(),
      externalAcceptance: 'PASS',
      gateway: { status: 'PASS' },
    });

    assert.equal(evidence.schemaVersion, QUALITY_EVIDENCE_SCHEMA_VERSION);
    assert.equal(evidence.evidenceType, 'AUTOMATED_QUALITY');
    assert.equal(evidence.externalAcceptance, EXTERNAL_ACCEPTANCE);
    assert.equal(evidence.externalAcceptance, 'NOT_EVALUATED');
    assert.equal('gateway' in evidence, false);
    assert.deepEqual(evidence.workflow, {
      runId: '123456789012345678',
      runAttempt: 2,
      prerequisiteJobs: ['quality-node', 'quality-rust'],
    });
    assert.deepEqual(evidence.plugin, {
      id: 'junqi-collab',
      packageName: '@junqi/openclaw-collaboration',
      version: '0.2.0',
      schemaVersion: 10,
    });
  });

  test('rejects a bundle hash not identified by both metadata copies', () => {
    assert.throws(
      () => createAutomatedQualityEvidence(input({
        hashes: {
          ...input().hashes,
          bundle: 'e'.repeat(64),
        },
      })),
      /metadata does not identify the bundle/,
    );
  });

  test('rejects diverged metadata bytes and schema declarations', () => {
    assert.throws(
      () => createAutomatedQualityEvidence(input({
        hashes: {
          ...input().hashes,
          metadata: { resource: METADATA_HASH, generated: 'e'.repeat(64) },
        },
      })),
      /metadata are not byte-identical/,
    );
    assert.throws(
      () => createAutomatedQualityEvidence(input({
        generatedMetadata: metadata({ schemaVersion: 11 }),
      })),
      /schema versions differ/,
    );
  });

  test('rejects source drift, malformed workflow identity, and package version drift', () => {
    assert.throws(
      () => createAutomatedQualityEvidence(input({ commit: '3'.repeat(40) })),
      /checked-out commit differs/,
    );
    assert.throws(
      () => createAutomatedQualityEvidence(input({ workflow: { runId: 'manual', runAttempt: 1 } })),
      /workflow.runId has an invalid format/,
    );
    assert.throws(
      () => createAutomatedQualityEvidence(input({
        pluginManifest: { id: 'junqi-collab', version: '0.2.1' },
      })),
      /manifest and package versions differ/,
    );
  });

  test('serializes deterministically with one trailing newline', () => {
    const evidence = createAutomatedQualityEvidence(input());
    const first = stableJson(evidence);
    const second = stableJson(createAutomatedQualityEvidence(input()));
    assert.equal(first, second);
    assert.equal(first.endsWith('\n'), true);
    assert.equal(first.endsWith('\n\n'), false);
    assert.equal(sha256(Buffer.from('junqi')), '75446f622ab4983eb0e06f7fd33089cc5cee8e54acfc4bacbbb360f968c6b349');
  });

  test('rejects every dirty package, bundle, metadata, and lock input against HEAD', async () => {
    const directory = await trackedFixture();
    await assert.doesNotReject(assertEvidenceFilesMatchHead(directory));

    for (const relativePath of Object.values(QUALITY_EVIDENCE_FILES)) {
      const filePath = path.join(directory, relativePath);
      const original = await readFile(filePath);
      await writeFile(filePath, Buffer.concat([original, Buffer.from('dirty')]));
      await assert.rejects(
        assertEvidenceFilesMatchHead(directory),
        new RegExp(`${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} differs from the resolved release source`),
      );
      await writeFile(filePath, original);
    }
  });

  test('rejects a tracked evidence input replaced by a symlink', async () => {
    const directory = await trackedFixture();
    const relativePath = QUALITY_EVIDENCE_FILES.bundle;
    const filePath = path.join(directory, relativePath);
    const original = await readFile(filePath);
    await rm(filePath);
    await symlink(path.join(directory, QUALITY_EVIDENCE_FILES.desktopPackage), filePath);
    await assert.rejects(
      assertEvidenceFilesMatchHead(directory),
      /must be a regular tracked file/,
    );
    await rm(filePath);
    await writeFile(filePath, original);
  });
});
