#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_EVIDENCE_ARTIFACT_ENTRIES,
  MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES,
} from './evidence-content-policy.mjs';
import { pathsOverlapAsync } from './path-boundary.mjs';
import {
  createReleasePublicationSeal,
  MAX_RELEASE_PUBLICATION_TOTAL_BYTES,
  writeReleasePublicationSeal,
} from './release-publication-seal.mjs';
import { copyStableFile, readStableFile } from './stable-file.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_INSTALLER_FILES = 128;
const INSTALLER_EXTENSIONS = Object.freeze(new Set(['.dmg', '.exe', '.msi']));
const REQUIRED_METADATA = Object.freeze(new Set([
  'release-assets-manifest.json',
  'release-decision.json',
]));
const MAX_METADATA_BYTES = 1024 * 1024;

export class ReleasePublicationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReleasePublicationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new ReleasePublicationError(code, message, details);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
    if (!['installers', 'metadata', 'output', 'source-sha', 'release-ref', 'seal-output'].includes(key)) {
      fail('INVALID_ARGUMENT', `Unknown argument: ${flag}`);
    }
    if (Object.hasOwn(values, key)) fail('INVALID_ARGUMENT', `Argument repeated: ${flag}`);
    values[key] = value;
    index += 1;
  }
  for (const key of ['installers', 'metadata', 'output', 'source-sha', 'release-ref']) {
    if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  }
  if (!/^[a-f0-9]{40}$/.test(values['source-sha'])) {
    fail('INVALID_ARGUMENT', '--source-sha must be a full commit SHA');
  }
  if (!/^refs\/(?:tags\/v[0-9A-Za-z][0-9A-Za-z._-]*|heads\/[A-Za-z0-9._/-]+)$/.test(values['release-ref'])) {
    fail('INVALID_ARGUMENT', '--release-ref must be a safe Git tag or branch ref');
  }
  return values;
}

async function regularTopLevelFiles(root, label) {
  const resolved = path.resolve(root);
  const rootStat = await lstat(resolved).catch((error) => {
    if (error?.code === 'ENOENT') fail('ROOT_MISSING', `${label} directory does not exist`);
    throw error;
  });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('ROOT_INVALID', `${label} root must be a regular directory`);
  const entries = await readdir(resolved, { withFileTypes: true });
  if (entries.length > MAX_EVIDENCE_ARTIFACT_ENTRIES) fail('TREE_LIMIT_EXCEEDED', `${label} contains too many filesystem entries`);
  const files = [];
  let totalBytes = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(resolved, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) fail('SYMLINK_REJECTED', `${label} contains a symbolic link`);
    if (!stat.isFile()) fail('INVALID_FILE_TREE', `${label} must contain only top-level regular files`);
    if (stat.size > MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES) fail('TREE_LIMIT_EXCEEDED', `${label} contains an oversized file`);
    totalBytes += stat.size;
    if (totalBytes > MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES) fail('TREE_LIMIT_EXCEEDED', `${label} exceeds the aggregate byte limit`);
    files.push({ name: entry.name, absolute, stat });
  }
  return { root: resolved, files, totalBytes };
}

async function readJsonSnapshot(file) {
  if (file.stat.size > MAX_METADATA_BYTES) fail('METADATA_TOO_LARGE', `Metadata file exceeds the bounded publication limit: ${file.name}`);
  const snapshot = await readStableFile(file.absolute, file.stat, MAX_METADATA_BYTES);
  let value;
  try {
    value = JSON.parse(snapshot.bytes.toString('utf8'));
  } catch {
    fail('INVALID_METADATA', `Metadata file is not valid JSON: ${file.name}`);
  }
  return { ...file, ...snapshot, value, sha256: sha256(snapshot.bytes) };
}

function validateManifest(manifest, sourceSha, releaseRef) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('INVALID_MANIFEST', 'Release asset manifest must be an object');
  if (manifest.schemaVersion !== 1 || !manifest.source || typeof manifest.source !== 'object') {
    fail('INVALID_MANIFEST', 'Release asset manifest schema is unsupported');
  }
  if (manifest.source.commit !== sourceSha || manifest.source.releaseRef !== releaseRef) {
    fail('MANIFEST_SOURCE_MISMATCH', 'Release asset manifest is bound to a different source');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0 || manifest.artifacts.length > MAX_INSTALLER_FILES) {
    fail('INVALID_MANIFEST', 'Release asset manifest has an invalid artifact count');
  }
  const names = new Set();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('INVALID_MANIFEST', 'Release asset manifest artifact is invalid');
    const { name, bytes, sha256: digest } = artifact;
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\')
      || !INSTALLER_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      fail('INVALID_MANIFEST', 'Release asset manifest contains an unsafe artifact name');
    }
    if (names.has(name) || !Number.isSafeInteger(bytes) || bytes < 0 || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      fail('INVALID_MANIFEST', 'Release asset manifest contains a duplicate or malformed artifact');
    }
    names.add(name);
  }
  return names;
}

function assertSameSet(actual, expected, code, message) {
  if (actual.size !== expected.size || [...actual].some((value) => !expected.has(value))) fail(code, message);
}

async function ensureOutside(root, candidate, label) {
  if (await pathsOverlapAsync(root, candidate)) {
    fail('OUTPUT_SOURCE_OVERLAP', `Publication output must be outside ${label}`);
  }
}

export function assertPublicationByteBudget(installerBytes, metadataBytes) {
  for (const [value, label] of [[installerBytes, 'installer'], [metadataBytes, 'metadata']]) {
    if (!Number.isSafeInteger(value) || value < 0) fail('TREE_LIMIT_EXCEEDED', `${label} byte total is invalid`);
  }
  if (installerBytes + metadataBytes > MAX_RELEASE_PUBLICATION_TOTAL_BYTES) {
    fail('TREE_LIMIT_EXCEEDED', 'Publication snapshot exceeds the combined installer and provenance byte limit');
  }
}

export async function stageReleasePublication({ installers, metadata, output, sourceSha, releaseRef, sealOutput = undefined }) {
  const installerTree = await regularTopLevelFiles(installers, 'Installer');
  const metadataTree = await regularTopLevelFiles(metadata, 'Metadata');
  assertPublicationByteBudget(installerTree.totalBytes, metadataTree.totalBytes);
  const outputPath = path.resolve(output);
  await ensureOutside(installerTree.root, outputPath, 'installer source');
  await ensureOutside(metadataTree.root, outputPath, 'metadata source');
  const sealOutputPath = sealOutput === undefined ? undefined : path.resolve(sealOutput);
  if (sealOutputPath) {
    await ensureOutside(installerTree.root, sealOutputPath, 'installer source');
    await ensureOutside(metadataTree.root, sealOutputPath, 'metadata source');
    await ensureOutside(outputPath, sealOutputPath, 'publication output');
  }

  const installerFiles = installerTree.files;
  if (installerFiles.length === 0 || installerFiles.length > MAX_INSTALLER_FILES) fail('INVALID_INSTALLER_COUNT', 'Installer snapshot has an invalid file count');
  const metadataByName = new Map(metadataTree.files.map((file) => [file.name, file]));
  assertSameSet(new Set(metadataByName.keys()), REQUIRED_METADATA, 'INVALID_METADATA_SET', 'Metadata snapshot must contain exactly the release manifest and decision');

  const manifestFile = await readJsonSnapshot(metadataByName.get('release-assets-manifest.json'));
  const decisionFile = await readJsonSnapshot(metadataByName.get('release-decision.json'));
  const manifestNames = validateManifest(manifestFile.value, sourceSha, releaseRef);
  if (decisionFile.value?.schemaVersion !== 1
    || decisionFile.value?.kind !== 'SATISFIED'
    || decisionFile.value?.sourceSha !== sourceSha
    || decisionFile.value?.releaseRef !== releaseRef) {
    fail('INVALID_DECISION', 'Release decision is not bound to this source');
  }
  assertSameSet(new Set(installerFiles.map((file) => file.name)), manifestNames, 'MANIFEST_ASSET_SET_MISMATCH', 'Installer snapshot differs from the attested manifest');

  const manifestByName = new Map(manifestFile.value.artifacts.map((artifact) => [artifact.name, artifact]));
  const temporary = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(temporary, { recursive: false, mode: 0o700 });
  let committed = false;
  let sealWritten = false;
  try {
    const files = [];
    for (const source of installerFiles) {
      const artifact = manifestByName.get(source.name);
      const copied = await copyStableFile(source.absolute, path.join(temporary, source.name), source.stat, 0o600);
      if (copied.bytes !== artifact.bytes || copied.sha256 !== artifact.sha256) {
        fail('SOURCE_DIGEST_MISMATCH', `Installer differs from the attested manifest: ${source.name}`);
      }
      files.push({ name: source.name, bytes: copied.bytes, sha256: copied.sha256 });
    }
    for (const name of REQUIRED_METADATA) {
      const source = metadataByName.get(name);
      const expected = name === 'release-assets-manifest.json' ? manifestFile : decisionFile;
      const copied = await copyStableFile(source.absolute, path.join(temporary, name), source.stat, 0o600);
      if (copied.bytes !== expected.bytes.byteLength || copied.sha256 !== expected.sha256) {
        fail('METADATA_CHANGED', `Metadata changed while creating the publication snapshot: ${name}`);
      }
      files.push({ name, bytes: copied.bytes, sha256: copied.sha256 });
    }

    const existing = await lstat(outputPath).catch((error) => {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing?.isSymbolicLink()) fail('SYMLINK_REJECTED', 'Publication output cannot be a symbolic link');
    if (existing) fail('OUTPUT_EXISTS', 'Publication output already exists; refusing destructive replacement');
    const sortedFiles = files.sort((left, right) => left.name.localeCompare(right.name));
    const seal = createReleasePublicationSeal({
      sourceSha,
      releaseRef,
      files: sortedFiles,
    });
    if (sealOutputPath) {
      await writeReleasePublicationSeal(sealOutputPath, seal);
      sealWritten = true;
    }
    await rename(temporary, outputPath);
    committed = true;
    return {
      status: 'STAGED',
      output: outputPath,
      files: sortedFiles,
      seal,
      ...(sealOutputPath ? { sealPath: sealOutputPath } : {}),
    };
  } finally {
    if (!committed) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    if (!committed && sealWritten && sealOutputPath) {
      await rm(sealOutputPath, { force: true }).catch(() => undefined);
    }
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await stageReleasePublication({
      installers: args.installers,
      metadata: args.metadata,
      output: args.output,
      sourceSha: args['source-sha'],
      releaseRef: args['release-ref'],
      sealOutput: args['seal-output'],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof ReleasePublicationError ? error.code : 'PUBLICATION_STAGING_FAILED',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof ReleasePublicationError && error.details ? { details: error.details } : {}),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
