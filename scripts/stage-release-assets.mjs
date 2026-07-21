#!/usr/bin/env node

import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_EVIDENCE_ARTIFACT_DEPTH,
  MAX_EVIDENCE_ARTIFACT_ENTRIES,
  MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES,
} from './evidence-content-policy.mjs';
import { pathsOverlapAsync } from './path-boundary.mjs';
import { copyStableFile } from './stable-file.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_ASSET_SPECS = 16;

export class ReleaseAssetStagingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReleaseAssetStagingError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new ReleaseAssetStagingError(code, message, details);
}

function parseArgs(argv) {
  const values = { specs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--')) fail('INVALID_ARGUMENT', `Unexpected argument: ${flag ?? '<missing>'}`);
    if (flag === '--output') values.output = value;
    else if (flag === '--prefix') values.prefix = value;
    else if (flag === '--spec') values.specs.push(value);
    else if (flag === '--specs-env') values.specsEnv = value;
    else fail('INVALID_ARGUMENT', `Unknown argument: ${flag}`);
    if (value == null || value.length === 0) fail('INVALID_ARGUMENT', `${flag} requires a value`);
    index += 1;
  }
  if (values.specsEnv) {
    const fromEnvironment = process.env[values.specsEnv];
    if (typeof fromEnvironment !== 'string') fail('INVALID_ARGUMENT', `Environment variable ${values.specsEnv} is missing`);
    values.specs.push(...fromEnvironment.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
  }
  if (!values.output || !values.prefix || values.specs.length === 0) {
    fail('INVALID_ARGUMENT', '--output, --prefix, and at least one --spec are required');
  }
  return values;
}

function parseSpec(value) {
  if (typeof value !== 'string') fail('INVALID_SPEC', 'Asset spec must be a string');
  const separator = value.lastIndexOf('|');
  if (separator <= 0 || separator === value.length - 1) fail('INVALID_SPEC', `Asset spec must be ROOT|EXTENSION: ${value}`);
  const root = value.slice(0, separator).trim();
  const extension = value.slice(separator + 1).trim().toLowerCase();
  if (!root || !/^\.[a-z0-9]+$/.test(extension)) fail('INVALID_SPEC', `Asset spec has an invalid root or extension: ${value}`);
  return { root: path.resolve(root), extension };
}

async function collectRegularFiles(root, extension, relative = '', state = { entries: 0, bytes: 0 }, depth = 0) {
  if (depth > MAX_EVIDENCE_ARTIFACT_DEPTH) fail('TREE_LIMIT_EXCEEDED', `Asset source exceeds the maximum directory depth: ${root}`);
  const stat = await lstat(root).catch((error) => {
    if (error?.code === 'ENOENT') fail('SOURCE_MISSING', `Asset source directory does not exist: ${root}`);
    throw error;
  });
  if (stat.isSymbolicLink()) fail('SYMLINK_REJECTED', `Asset source is a symlink: ${root}`);
  if (!stat.isDirectory()) fail('SOURCE_NOT_DIRECTORY', `Asset source is not a directory: ${root}`);

  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    state.entries += 1;
    if (state.entries > MAX_EVIDENCE_ARTIFACT_ENTRIES) fail('TREE_LIMIT_EXCEEDED', `Asset source contains too many filesystem entries: ${root}`);
    const absolute = path.join(root, entry.name);
    const entryRelative = path.join(relative, entry.name);
    const entryStat = await lstat(absolute);
    if (entryStat.isSymbolicLink()) fail('SYMLINK_REJECTED', `Asset source contains a symlink: ${entryRelative}`);
    if (entryStat.isDirectory()) {
      files.push(...await collectRegularFiles(absolute, extension, entryRelative, state, depth + 1));
      continue;
    }
    if (!entryStat.isFile()) fail('SPECIAL_FILE_REJECTED', `Asset source contains a special file: ${entryRelative}`);
    state.bytes += entryStat.size;
    if (state.bytes > MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES) fail('TREE_LIMIT_EXCEEDED', `Asset source exceeds the aggregate byte limit: ${root}`);
    if (entry.name.toLowerCase().endsWith(extension)) {
      files.push({ absolute, relative: entryRelative, stat: entryStat });
    }
  }
  return files;
}

export async function stageReleaseAssets({ output, prefix, specs }) {
  const destination = path.resolve(output);
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9._-]+$/.test(prefix)) {
    fail('INVALID_PREFIX', 'Release asset prefix must contain only ASCII letters, digits, dot, underscore, or hyphen');
  }
  if (!Array.isArray(specs) || specs.length === 0) fail('INVALID_SPEC', 'At least one release asset source spec is required');
  if (specs.length > MAX_ASSET_SPECS) fail('TREE_LIMIT_EXCEEDED', `At most ${MAX_ASSET_SPECS} asset source specs are allowed`);
  const parsedSpecs = specs.map(parseSpec);
  for (const spec of parsedSpecs) {
    if (await pathsOverlapAsync(spec.root, destination)) {
      fail('OUTPUT_SOURCE_OVERLAP', 'Output directory must not be inside an asset source directory', {
        source: spec.root,
        output: destination,
      });
    }
  }
  const destinationStat = await lstat(destination).catch((error) => {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  });
  if (destinationStat?.isSymbolicLink()) fail('SYMLINK_REJECTED', `Output directory is a symlink: ${destination}`);
  if (destinationStat) fail('OUTPUT_EXISTS', `Output path already exists; refusing destructive replacement: ${destination}`);
  const sourceFiles = [];
  const sourceState = { entries: 0, bytes: 0 };
  for (const spec of parsedSpecs) {
    const matches = await collectRegularFiles(spec.root, spec.extension, '', sourceState);
    if (matches.length !== 1) {
      fail('SOURCE_CARDINALITY', `Expected exactly one ${spec.extension} under ${spec.root}, found ${matches.length}`, {
        root: spec.root,
        extension: spec.extension,
        matches: matches.map((match) => match.relative),
      });
    }
    sourceFiles.push(matches[0]);
  }

  await mkdir(destination, { recursive: true, mode: 0o755 });

  const names = new Set();
  const manifest = [];
  for (const source of sourceFiles) {
    const name = `${prefix}-${path.basename(source.relative)}`;
    if (names.has(name)) fail('NAME_COLLISION', `Staged release asset name collides: ${name}`);
    names.add(name);
    const destinationPath = path.join(destination, name);
    const copied = await copyStableFile(source.absolute, destinationPath, source.stat);
    manifest.push({ name, bytes: copied.bytes, sha256: copied.sha256 });
  }
  manifest.sort((left, right) => left.name.localeCompare(right.name));
  return { output: destination, files: manifest };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await stageReleaseAssets(args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const payload = {
      code: error instanceof ReleaseAssetStagingError ? error.code : 'STAGING_FAILED',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof ReleaseAssetStagingError && error.details ? { details: error.details } : {}),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
