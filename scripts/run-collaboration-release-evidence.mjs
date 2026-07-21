#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_P0_CASE_IDS,
  REQUIRED_SOAK_FAULT_IDS,
  REQUIRED_SOAK_INVARIANT_IDS,
  REQUIRED_VISUAL_SCENARIOS,
  REQUIRED_VISUAL_VIEWPORTS,
} from './validate-external-release-evidence.mjs';
import { runBehavioralGatewayVerification } from './verify-collaboration-behavioral-gateway.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export class ReleaseEvidenceHarnessError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReleaseEvidenceHarnessError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new ReleaseEvidenceHarnessError(code, message, details);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) {
      fail('INVALID_ARGUMENT', `Expected ${flag ?? '<missing>'} followed by a value`);
    }
    const key = flag.slice(2);
    if (!['type', 'output', 'evidence-root'].includes(key)) fail('INVALID_ARGUMENT', `Unknown argument: ${flag}`);
    if (Object.hasOwn(values, key)) fail('INVALID_ARGUMENT', `Argument repeated: ${flag}`);
    values[key] = value;
    index += 1;
  }
  if (!values.type || !values.output) fail('INVALID_ARGUMENT', '--type and --output are required');
  if (!['gateway', 'visual', 'soak'].includes(values.type)) fail('INVALID_ARGUMENT', `Unsupported evidence type: ${values.type}`);
  return values;
}

async function writeBlocker(output, type, code, message, details = undefined) {
  const directory = path.resolve(output);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const blocker = {
    schemaVersion: 1,
    evidenceType: type.toUpperCase(),
    status: 'BLOCKED',
    code,
    message,
    ...(details ? { details } : {}),
    createdAt: new Date().toISOString(),
  };
  const destination = path.join(directory, 'blocker.json');
  await writeFile(destination, `${JSON.stringify(blocker, null, 2)}\n`, { mode: 0o600 });
  return destination;
}

function missingGatewayCases(evidence) {
  return REQUIRED_P0_CASE_IDS.filter((id) => evidence?.claims?.[id]?.status !== 'VERIFIED');
}

async function runGateway({ evidenceRoot, gatewayRunner = runBehavioralGatewayVerification }) {
  let partial;
  try {
    partial = await gatewayRunner({ evidenceRoot });
  } catch (error) {
    const evidence = error?.evidencePath ? { evidencePath: error.evidencePath } : undefined;
    fail('PARTIAL_GATEWAY_HARNESS_FAILED', 'The available isolated Gateway harness failed before full-scope promotion', evidence);
  }
  const missing = missingGatewayCases(partial.evidence);
  if (missing.length > 0) {
    fail(
      'FULL_GATEWAY_SCOPE_REQUIRED',
      'The current real Gateway harness is intentionally partial; no FULL_BEHAVIORAL evidence may be emitted',
      { missingCases: missing, partialEvidencePath: partial.evidencePath },
    );
  }
  fail('FULL_GATEWAY_ADAPTER_MISSING', 'A full P0 adapter must convert real observations into the external evidence schema before release');
}

async function runVisual() {
  fail(
    'VISUAL_HARNESS_REQUIRED',
    'A real installer-bound browser harness is required before visual evidence can be produced',
    {
      viewports: REQUIRED_VISUAL_VIEWPORTS,
      scenarios: REQUIRED_VISUAL_SCENARIOS,
      requiredArtifacts: ['SCREENSHOT', 'INTERACTION_TRACE', 'CANDIDATE_INSTALLER'],
    },
  );
}

async function runSoak() {
  fail(
    'SOAK_HARNESS_REQUIRED',
    'A real 24-hour fault-injection harness is required before soak evidence can be produced',
    {
      faults: REQUIRED_SOAK_FAULT_IDS,
      finalInvariants: REQUIRED_SOAK_INVARIANT_IDS,
      minimumDurationMs: 24 * 60 * 60 * 1000,
    },
  );
}

export async function runReleaseEvidenceProducer(options) {
  const {
    type,
    output,
    evidenceRoot = path.join(output, 'partial'),
    gatewayRunner,
  } = options;
  try {
    if (type === 'gateway') await runGateway({ evidenceRoot, gatewayRunner });
    if (type === 'visual') await runVisual();
    if (type === 'soak') await runSoak();
    fail('PRODUCER_DID_NOT_TERMINATE', 'Evidence producer returned without a result');
  } catch (error) {
    const blockerPath = await writeBlocker(
      output,
      type,
      error instanceof ReleaseEvidenceHarnessError ? error.code : 'PRODUCER_FAILED',
      error instanceof Error ? error.message : String(error),
      error instanceof ReleaseEvidenceHarnessError ? error.details : undefined,
    );
    const wrapped = error instanceof ReleaseEvidenceHarnessError
      ? error
      : new ReleaseEvidenceHarnessError('PRODUCER_FAILED', error instanceof Error ? error.message : String(error));
    wrapped.blockerPath = blockerPath;
    throw wrapped;
  }
}

async function main() {
  try {
    await runReleaseEvidenceProducer(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error.code ?? 'PRODUCER_FAILED',
      message: error instanceof Error ? error.message : String(error),
      ...(error.blockerPath ? { blockerPath: error.blockerPath } : {}),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
