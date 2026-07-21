#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);

export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const QUALITY_EVIDENCE_SCHEMA_VERSION = 1;
export const EXTERNAL_ACCEPTANCE = 'NOT_EVALUATED';

const DEFAULT_OUTPUT_PATH = path.join(
  REPOSITORY_ROOT,
  'release-evidence',
  'automated-quality-evidence.json',
);

export const QUALITY_EVIDENCE_FILES = Object.freeze({
  desktopPackage: 'package.json',
  pluginPackage: 'packages/junqi-collab/package.json',
  pluginManifest: 'packages/junqi-collab/openclaw.plugin.json',
  bundle: 'src-tauri/resources/collaboration/junqi-collab.tgz',
  resourceMetadata: 'src-tauri/resources/collaboration/metadata.json',
  generatedMetadata: 'src/generated/collaborationPluginBundle.generated.json',
  pnpmLock: 'pnpm-lock.yaml',
  cargoLock: 'src-tauri/Cargo.lock',
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, field) {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${field} must be an object`);
  return value;
}

function boundedString(value, field, pattern = undefined) {
  invariant(typeof value === 'string', `${field} must be a string`);
  const normalized = value.trim();
  invariant(normalized.length > 0 && normalized.length <= 512, `${field} must be a bounded non-empty string`);
  invariant(!normalized.includes('\n') && !normalized.includes('\r'), `${field} must be a single line`);
  if (pattern) invariant(pattern.test(normalized), `${field} has an invalid format`);
  return normalized;
}

function sha256String(value, field) {
  return boundedString(value, field, /^[a-f0-9]{64}$/);
}

function gitObject(value, field) {
  return boundedString(value, field, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
}

function semanticVersion(value, field) {
  return boundedString(value, field, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
}

function positiveRunId(value, field) {
  const normalized = boundedString(String(value), field, /^[1-9]\d*$/);
  return normalized;
}

function positiveAttempt(value) {
  const normalized = positiveRunId(value, 'workflow.runAttempt');
  const attempt = Number(normalized);
  invariant(Number.isSafeInteger(attempt), 'workflow.runAttempt exceeds the safe integer range');
  return attempt;
}

function assertBundleMetadata(metadata, field) {
  const value = record(metadata, field);
  invariant(value.formatVersion === 1, `${field}.formatVersion must be 1`);
  invariant(value.pluginId === 'junqi-collab', `${field}.pluginId is invalid`);
  invariant(
    value.packageName === '@junqi/openclaw-collaboration',
    `${field}.packageName is invalid`,
  );
  semanticVersion(value.pluginVersion, `${field}.pluginVersion`);
  invariant(
    Number.isSafeInteger(value.schemaVersion) && value.schemaVersion > 0,
    `${field}.schemaVersion must be a positive integer`,
  );
  sha256String(value.sha256, `${field}.sha256`);
  invariant(value.archiveFile === 'junqi-collab.tgz', `${field}.archiveFile is invalid`);
  invariant(
    value.resourcePath === 'collaboration/junqi-collab.tgz',
    `${field}.resourcePath is invalid`,
  );
  return value;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Builds the signed artifact payload from already-observed facts. This function
 * performs no I/O and intentionally has no external-acceptance input.
 */
export function createAutomatedQualityEvidence(input) {
  const value = record(input, 'input');
  const desktopPackage = record(value.desktopPackage, 'desktopPackage');
  const pluginPackage = record(value.pluginPackage, 'pluginPackage');
  const pluginManifest = record(value.pluginManifest, 'pluginManifest');
  const resourceMetadata = assertBundleMetadata(value.resourceMetadata, 'resourceMetadata');
  const generatedMetadata = assertBundleMetadata(value.generatedMetadata, 'generatedMetadata');
  const hashes = record(value.hashes, 'hashes');
  const metadataHashes = record(hashes.metadata, 'hashes.metadata');
  const lockHashes = record(hashes.lockfiles, 'hashes.lockfiles');
  const toolchain = record(value.toolchain, 'toolchain');
  const workflow = record(value.workflow, 'workflow');

  invariant(desktopPackage.name === 'junqi-desktop', 'desktopPackage.name is invalid');
  const desktopVersion = semanticVersion(desktopPackage.version, 'desktopPackage.version');
  invariant(
    pluginPackage.name === '@junqi/openclaw-collaboration',
    'pluginPackage.name is invalid',
  );
  const pluginVersion = semanticVersion(pluginPackage.version, 'pluginPackage.version');
  invariant(pluginManifest.id === 'junqi-collab', 'pluginManifest.id is invalid');
  invariant(pluginManifest.version === pluginVersion, 'plugin manifest and package versions differ');
  invariant(resourceMetadata.pluginVersion === pluginVersion, 'resource metadata plugin version differs');
  invariant(generatedMetadata.pluginVersion === pluginVersion, 'generated metadata plugin version differs');
  invariant(
    resourceMetadata.schemaVersion === generatedMetadata.schemaVersion,
    'resource and generated metadata schema versions differ',
  );

  const bundleHash = sha256String(hashes.bundle, 'hashes.bundle');
  invariant(resourceMetadata.sha256 === bundleHash, 'resource metadata does not identify the bundle');
  invariant(generatedMetadata.sha256 === bundleHash, 'generated metadata does not identify the bundle');
  const resourceMetadataHash = sha256String(
    metadataHashes.resource,
    'hashes.metadata.resource',
  );
  const generatedMetadataHash = sha256String(
    metadataHashes.generated,
    'hashes.metadata.generated',
  );
  invariant(
    resourceMetadataHash === generatedMetadataHash,
    'resource and generated metadata are not byte-identical',
  );

  const expectedCommit = gitObject(value.expectedCommit, 'expectedCommit');
  const commit = gitObject(value.commit, 'commit');
  invariant(commit === expectedCommit, 'checked-out commit differs from the resolved release source');

  return {
    schemaVersion: QUALITY_EVIDENCE_SCHEMA_VERSION,
    evidenceType: 'AUTOMATED_QUALITY',
    repo: boundedString(value.repo, 'repo', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    source: {
      commit,
      tree: gitObject(value.tree, 'tree'),
    },
    desktop: {
      name: desktopPackage.name,
      version: desktopVersion,
    },
    plugin: {
      id: pluginManifest.id,
      packageName: pluginPackage.name,
      version: pluginVersion,
      schemaVersion: resourceMetadata.schemaVersion,
    },
    sha256: {
      bundle: bundleHash,
      metadata: {
        resource: resourceMetadataHash,
        generated: generatedMetadataHash,
      },
      lockfiles: {
        pnpm: sha256String(lockHashes.pnpm, 'hashes.lockfiles.pnpm'),
        cargo: sha256String(lockHashes.cargo, 'hashes.lockfiles.cargo'),
      },
    },
    toolchain: {
      node: boundedString(toolchain.node, 'toolchain.node'),
      pnpm: boundedString(toolchain.pnpm, 'toolchain.pnpm'),
      rustc: boundedString(toolchain.rustc, 'toolchain.rustc'),
      cargo: boundedString(toolchain.cargo, 'toolchain.cargo'),
    },
    workflow: {
      runId: positiveRunId(workflow.runId, 'workflow.runId'),
      runAttempt: positiveAttempt(workflow.runAttempt),
      prerequisiteJobs: ['quality-node', 'quality-rust'],
    },
    externalAcceptance: EXTERNAL_ACCEPTANCE,
  };
}

function parseJsonBytes(bytes, field) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${field} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return value;
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run ${command} ${args.join(' ')}: ${diagnostic}`);
  }
}

function runBytes(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Failed to verify ${command} ${args.join(' ')}`);
  }
}

function assertInsideRoot(root, candidate, field) {
  const relative = path.relative(root, candidate);
  invariant(
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${field} resolves outside the repository`,
  );
}

export async function assertEvidenceFilesMatchHead(repositoryRoot = REPOSITORY_ROOT) {
  const root = await realpath(path.resolve(repositoryRoot));
  const verified = {};
  for (const [key, relativePath] of Object.entries(QUALITY_EVIDENCE_FILES)) {
    const absolutePath = path.resolve(root, relativePath);
    assertInsideRoot(root, absolutePath, relativePath);
    const file = await lstat(absolutePath);
    invariant(file.isFile() && !file.isSymbolicLink(), `${relativePath} must be a regular tracked file`);
    const resolvedPath = await realpath(absolutePath);
    assertInsideRoot(root, resolvedPath, relativePath);
    invariant(resolvedPath === absolutePath, `${relativePath} must not traverse a symlink`);

    const gitPath = relativePath.split(path.sep).join('/');
    runBytes('git', ['ls-files', '--error-unmatch', '--', gitPath], root);
    const [workingBytes, headBytes] = await Promise.all([
      readFile(resolvedPath),
      Promise.resolve(runBytes('git', ['show', `HEAD:${gitPath}`], root)),
    ]);
    invariant(workingBytes.equals(headBytes), `${relativePath} differs from the resolved release source`);
    verified[key] = { path: resolvedPath, bytes: workingBytes };
  }
  return verified;
}

export async function collectAutomatedQualityEvidence(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const files = await assertEvidenceFilesMatchHead(repositoryRoot);
  const desktopPackage = parseJsonBytes(files.desktopPackage.bytes, 'desktop package');
  const pluginPackage = parseJsonBytes(files.pluginPackage.bytes, 'plugin package');
  const pluginManifest = parseJsonBytes(files.pluginManifest.bytes, 'plugin manifest');
  const resourceMetadata = parseJsonBytes(files.resourceMetadata.bytes, 'resource metadata');
  const generatedMetadata = parseJsonBytes(files.generatedMetadata.bytes, 'generated metadata');

  invariant(
    files.resourceMetadata.bytes.equals(files.generatedMetadata.bytes),
    'resource and generated metadata must be byte-identical',
  );

  return createAutomatedQualityEvidence({
    repo: options.repo,
    expectedCommit: options.expectedCommit,
    commit: run('git', ['rev-parse', 'HEAD^{commit}'], repositoryRoot),
    tree: run('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    desktopPackage,
    pluginPackage,
    pluginManifest,
    resourceMetadata,
    generatedMetadata,
    hashes: {
      bundle: sha256(files.bundle.bytes),
      metadata: {
        resource: sha256(files.resourceMetadata.bytes),
        generated: sha256(files.generatedMetadata.bytes),
      },
      lockfiles: {
        pnpm: sha256(files.pnpmLock.bytes),
        cargo: sha256(files.cargoLock.bytes),
      },
    },
    toolchain: {
      node: process.version,
      pnpm: run('pnpm', ['--version'], repositoryRoot),
      rustc: run('rustc', ['--version'], repositoryRoot),
      cargo: run('cargo', ['--version'], repositoryRoot),
    },
    workflow: {
      runId: options.workflowRunId,
      runAttempt: options.workflowRunAttempt,
    },
  });
}

function parseArguments(argv) {
  let outputPath = DEFAULT_OUTPUT_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      const next = argv[index + 1];
      invariant(typeof next === 'string' && next.length > 0, '--output requires a path');
      outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { outputPath };
}

async function writeJsonAtomic(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(temporaryPath, stableJson(value), { mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(`Could not write automated quality evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const { outputPath } = parseArguments(process.argv.slice(2));
  const evidence = await collectAutomatedQualityEvidence({
    repo: process.env.GITHUB_REPOSITORY,
    expectedCommit: process.env.EXPECTED_SOURCE_SHA,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  await writeJsonAtomic(outputPath, evidence);
  console.log(`Automated quality evidence written to ${outputPath}`);
  console.log(`Bundle SHA-256: ${evidence.sha256.bundle}`);
  console.log(`External acceptance: ${evidence.externalAcceptance}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Automated quality evidence generation failed: ${message.slice(0, 1024)}`);
    process.exitCode = 1;
  });
}
