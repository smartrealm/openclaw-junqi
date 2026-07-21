import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { scanEvidenceArtifactRoot, EvidenceContentScanError } from './scan-evidence-artifacts.mjs';
import {
  MAX_EVIDENCE_ARTIFACT_ENTRIES,
  forbiddenSecretCode,
  scanTextChunk,
  shouldScanEvidenceKind,
} from './evidence-content-policy.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('evidence content policy', () => {
  test('scans only text evidence kinds and detects high-confidence credentials', () => {
    assert.equal(shouldScanEvidenceKind('LOG'), true);
    assert.equal(shouldScanEvidenceKind('SCREENSHOT'), false);
    assert.equal(forbiddenSecretCode('authorization: Bearer ghp_123456789012345678901234'), 'BEARER_TOKEN');
    assert.equal(forbiddenSecretCode('-----BEGIN PRIVATE KEY-----'), 'PRIVATE_KEY');
    assert.equal(forbiddenSecretCode('status=PASS'), undefined);
  });

  test('preserves cross-chunk matches without returning secret bytes', () => {
    const first = scanTextChunk('', 'authorization: Bearer ghp_1234567890');
    const second = scanTextChunk(first.tail, '123456789012345678901234');
    assert.equal(second.code, 'BEARER_TOKEN');
    assert.equal(second.tail.includes('ghp_'), true);
  });

  test('rejects secrets in text files but leaves binary assets alone', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-evidence-scan-'));
    roots.push(root);
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await writeFile(path.join(root, 'nested', 'trace.json'), '{"status":"PASS"}\n');
    await writeFile(path.join(root, 'screenshot.png'), Buffer.from('-----BEGIN PRIVATE KEY-----'));
    await scanEvidenceArtifactRoot(root);
    await writeFile(path.join(root, 'nested', 'secret.log'), 'token=abcdefghijklmnopqrstuvwxyz123456\n');
    await assert.rejects(
      scanEvidenceArtifactRoot(root),
      (error) => error instanceof EvidenceContentScanError && error.code === 'SECRET_IN_ARTIFACT',
    );
  });

  test('rejects an unbounded evidence directory before scanning every file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-evidence-budget-'));
    roots.push(root);
    await Promise.all(
      Array.from({ length: MAX_EVIDENCE_ARTIFACT_ENTRIES + 1 }, (_, index) => (
        writeFile(path.join(root, `trace-${index}.json`), '{}\n')
      )),
    );
    await assert.rejects(
      scanEvidenceArtifactRoot(root),
      (error) => error instanceof EvidenceContentScanError && error.code === 'CONTENT_SCAN_LIMIT',
    );
  });
});
