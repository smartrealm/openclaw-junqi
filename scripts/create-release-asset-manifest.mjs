#!/usr/bin/env node

import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_ARTIFACT_DEPTH,
  MAX_EVIDENCE_ARTIFACT_ENTRIES,
  MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES,
} from './evidence-content-policy.mjs';
import { pathsOverlapAsync } from './path-boundary.mjs';
import { hashStableFile, readStableFile, writeNewRegularFile } from './stable-file.mjs';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INSTALLER_EXTENSIONS = new Set(['.dmg', '.exe', '.msi']);

export class ReleaseAssetManifestError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReleaseAssetManifestError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new ReleaseAssetManifestError(code, message, details);
}

async function gitValue(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
    return stdout.trim();
  } catch (error) {
    fail('GIT_IDENTITY_UNAVAILABLE', `Unable to resolve git ${args.join(' ')}: ${error.message}`);
  }
}

async function collectFiles(root, relative = '', state = { entries: 0, bytes: 0 }, depth = 0) {
  if (depth > MAX_EVIDENCE_ARTIFACT_DEPTH) fail('TREE_LIMIT_EXCEEDED', 'Release asset tree exceeds the maximum directory depth');
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    state.entries += 1;
    if (state.entries > MAX_EVIDENCE_ARTIFACT_ENTRIES) fail('TREE_LIMIT_EXCEEDED', 'Release asset tree contains too many filesystem entries');
    const absolute = path.join(root, entry.name);
    const entryRelative = path.join(relative, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) fail('SYMLINK_REJECTED', `Release asset tree contains a symlink: ${entryRelative}`);
    if (stat.isDirectory()) {
      files.push(...await collectFiles(absolute, entryRelative, state, depth + 1));
      continue;
    }
    if (!stat.isFile()) fail('SPECIAL_FILE_REJECTED', `Release asset tree contains a special file: ${entryRelative}`);
    state.bytes += stat.size;
    if (state.bytes > MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES) fail('TREE_LIMIT_EXCEEDED', 'Release asset tree exceeds the aggregate byte limit');
    files.push({ absolute, relative: entryRelative, stat });
  }
  return files;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) fail('INVALID_ARGUMENT', `Expected ${flag ?? '<missing>'} followed by a value`);
    const key = flag.slice(2);
    if (!['root', 'output', 'source-sha', 'release-ref'].includes(key)) fail('INVALID_ARGUMENT', `Unknown argument: ${flag}`);
    if (Object.hasOwn(values, key)) fail('INVALID_ARGUMENT', `Argument repeated: ${flag}`);
    values[key] = value;
    index += 1;
  }
  for (const key of ['root', 'output', 'source-sha', 'release-ref']) {
    if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  }
  if (!/^[a-f0-9]{40}$/.test(values['source-sha'])) fail('INVALID_ARGUMENT', '--source-sha must be a full commit SHA');
  if (!/^refs\/(?:tags\/v[0-9A-Za-z][0-9A-Za-z._-]*|heads\/[A-Za-z0-9._/-]+)$/.test(values['release-ref'])) {
    fail('INVALID_ARGUMENT', '--release-ref must be a safe Git tag or branch ref');
  }
  return values;
}

export async function createReleaseAssetManifest({ root, output, sourceSha, releaseRef }) {
  const rootPath = path.resolve(root);
  const outputPath = path.resolve(output);
  if (await pathsOverlapAsync(rootPath, outputPath)) fail('OUTPUT_ROOT_OVERLAP', 'Manifest output must not overlap the release asset root');
  const rootStat = await lstat(rootPath).catch((error) => {
    if (error?.code === 'ENOENT') fail('ROOT_MISSING', `Release asset root does not exist: ${rootPath}`);
    throw error;
  });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('ROOT_INVALID', 'Release asset root must be a regular directory');

  const actualSourceSha = await gitValue(path.resolve(path.dirname(SCRIPT_PATH), '..'), ['rev-parse', 'HEAD^{commit}']);
  if (actualSourceSha !== sourceSha) fail('SOURCE_MISMATCH', 'Release asset manifest source differs from the checked-out commit', { expected: sourceSha, actual: actualSourceSha });

  const generatedMetadataPath = path.resolve(path.dirname(SCRIPT_PATH), '../src/generated/collaborationPluginBundle.generated.json');
  const metadataStat = await lstat(generatedMetadataPath).catch((error) => {
    if (error?.code === 'ENOENT') fail('BUNDLE_METADATA_MISSING', 'Generated collaboration metadata is missing');
    throw error;
  });
  if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) fail('BUNDLE_METADATA_INVALID', 'Generated collaboration metadata must be a regular file');
  let generatedMetadata;
  try {
    generatedMetadata = JSON.parse((await readStableFile(generatedMetadataPath, metadataStat, MAX_EVIDENCE_BYTES)).bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('BUNDLE_METADATA_INVALID', 'Generated collaboration metadata is not valid JSON');
    throw error;
  }
  if (typeof generatedMetadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(generatedMetadata.sha256)) {
    fail('BUNDLE_METADATA_INVALID', 'Generated collaboration metadata does not contain a valid bundle digest');
  }

  const files = await collectFiles(rootPath);
  if (files.length === 0) fail('EMPTY_ROOT', 'Release asset root is empty');
  const artifacts = [];
  for (const file of files) {
    if (file.relative.includes(path.sep) || file.relative.includes('/') || file.relative.includes('\\')) {
      fail('NESTED_ASSET', `Release asset must be a top-level file: ${file.relative}`);
    }
    const extension = path.extname(file.relative).toLowerCase();
    if (!INSTALLER_EXTENSIONS.has(extension)) fail('UNEXPECTED_ASSET', `Unexpected release asset: ${file.relative}`);
    const snapshot = await hashStableFile(file.absolute, file.stat);
    artifacts.push({ name: file.relative, bytes: snapshot.bytes, sha256: snapshot.sha256 });
  }
  artifacts.sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(artifacts.map((artifact) => artifact.name)).size !== artifacts.length) fail('DUPLICATE_ASSET', 'Release asset names are not unique');

  const manifest = {
    schemaVersion: 1,
    source: { commit: sourceSha, releaseRef },
    bundleSha256: generatedMetadata.sha256,
    artifacts,
  };
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeNewRegularFile(outputPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), 0o600);
  return manifest;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const manifest = await createReleaseAssetManifest({
      root: args.root,
      output: args.output,
      sourceSha: args['source-sha'],
      releaseRef: args['release-ref'],
    });
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error.code ?? 'MANIFEST_FAILED',
      message: error instanceof Error ? error.message : String(error),
      ...(error.details ? { details: error.details } : {}),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
