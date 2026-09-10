import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseTargetContractArguments } from './verify-dingtalk-target-contracts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-dingtalk-target-contracts.mjs');

describe('DingTalk target contract audit CLI', () => {
  test('accepts only one explicit absolute DWS path', () => {
    assert.deepEqual(parseTargetContractArguments([
      '--dws-path',
      path.join(ROOT, 'controlled', 'dws'),
    ]), {
      dwsPath: path.join(ROOT, 'controlled', 'dws'),
    });
    assert.deepEqual(parseTargetContractArguments([
      '--',
      '--dws-path',
      path.join(ROOT, 'controlled', 'dws'),
    ]), {
      dwsPath: path.join(ROOT, 'controlled', 'dws'),
    });
    assert.throws(() => parseTargetContractArguments([]), /Exactly --dws-path/);
    assert.throws(
      () => parseTargetContractArguments(['--dws-path', 'dws']),
      /must be absolute/,
    );
    assert.throws(
      () => parseTargetContractArguments(['--profile', 'corp:user']),
      /Unsupported argument/,
    );
  });

  test('rejects missing target input before resolving or starting DWS', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(JSON.parse(result.stderr), {
      success: false,
      error: {
        code: 'TARGET_CONTRACT_INPUT_INVALID',
        message: 'Exactly --dws-path and its value are required',
      },
    });
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(ROOT), false);
  });
});
