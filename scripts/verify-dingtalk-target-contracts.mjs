#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export function parseTargetContractArguments(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  assert.deepEqual(normalized.length, 2, 'Exactly --dws-path and its value are required');
  assert.equal(normalized[0], '--dws-path', `Unsupported argument: ${normalized[0] ?? 'missing'}`);
  assert.equal(typeof normalized[1], 'string', 'Missing value for --dws-path');
  assert.ok(normalized[1].length > 0, 'Missing value for --dws-path');
  assert.ok(path.isAbsolute(normalized[1]), '--dws-path must be absolute');
  return { dwsPath: normalized[1] };
}

export async function runTargetContractAudit(input) {
  const [auditModule, runnerModule, schemaModule, toolSpecsModule] = await Promise.all([
    import('../packages/junqi-dingtalk/dist/contract-audit.js'),
    import('../packages/junqi-dingtalk/dist/dws-runner.js'),
    import('../packages/junqi-dingtalk/dist/schema-contract.js'),
    import('../packages/junqi-dingtalk/dist/tool-specs.js'),
  ]);
  const { auditDingTalkContracts } = auditModule;
  const { DwsRunner, normalizeRunnerConfig } = runnerModule;
  const { DwsSchemaRegistry } = schemaModule;
  const { DINGTALK_TOOL_SPECS } = toolSpecsModule;
  const runner = new DwsRunner(normalizeRunnerConfig({
    dwsPath: input.dwsPath,
    timeoutMs: 120_000,
  }));
  return await auditDingTalkContracts(
    new DwsSchemaRegistry(runner),
    DINGTALK_TOOL_SPECS,
    4,
  );
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    const input = parseTargetContractArguments(process.argv.slice(2));
    const result = await runTargetContractAudit(input);
    console.log(JSON.stringify(result, null, 2));
    if (result.failedCount > 0) process.exitCode = 1;
  } catch (error) {
    const inputError = error instanceof assert.AssertionError;
    console.error(JSON.stringify({
      success: false,
      error: {
        code: inputError ? 'TARGET_CONTRACT_INPUT_INVALID' : 'TARGET_CONTRACT_AUDIT_FAILED',
        message: inputError
          ? error.message.split('\n', 1)[0]
          : 'Target DWS contract audit could not start',
      },
    }));
    process.exitCode = 1;
  }
}
