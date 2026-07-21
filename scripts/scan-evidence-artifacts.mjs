#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { lstat, opendir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_EVIDENCE_ARTIFACT_DEPTH,
  MAX_EVIDENCE_ARTIFACT_ENTRIES,
  MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES,
  scanTextChunk,
} from './evidence-content-policy.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_SCAN_BYTES = 512 * 1024 * 1024;
const BINARY_EXTENSIONS = new Set([
  '.app', '.appimage', '.dmg', '.exe', '.gz', '.ico', '.jpg', '.jpeg', '.msi',
  '.png', '.tar', '.webp', '.woff', '.woff2', '.zip',
]);

export class EvidenceContentScanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EvidenceContentScanError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EvidenceContentScanError(code, message);
}

async function scanFile(filePath, relativePath, expectedMetadata) {
  const metadata = expectedMetadata ?? await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail('INVALID_ARTIFACT_FILE', relativePath);
  if (metadata.size > MAX_SCAN_BYTES) fail('CONTENT_SCAN_LIMIT', relativePath);
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile()
      || openedMetadata.dev !== metadata.dev
      || openedMetadata.ino !== metadata.ino
      || openedMetadata.size !== metadata.size) {
      fail('ARTIFACT_CHANGED', relativePath);
    }
    let tail = '';
    let bytesRead = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      bytesRead += chunk.byteLength;
      if (bytesRead > openedMetadata.size) fail('ARTIFACT_CHANGED', relativePath);
      const result = scanTextChunk(tail, chunk.toString('utf8'));
      if (result.code) fail('SECRET_IN_ARTIFACT', `${relativePath} contains a forbidden credential pattern (${result.code})`);
      tail = result.tail;
    }
    const result = scanTextChunk(tail, '');
    if (result.code) fail('SECRET_IN_ARTIFACT', `${relativePath} contains a forbidden credential pattern (${result.code})`);
    const finalMetadata = await handle.stat();
    if (finalMetadata.dev !== openedMetadata.dev
      || finalMetadata.ino !== openedMetadata.ino
      || finalMetadata.size !== openedMetadata.size
      || finalMetadata.mtimeMs !== openedMetadata.mtimeMs
      || finalMetadata.ctimeMs !== openedMetadata.ctimeMs) {
      fail('ARTIFACT_CHANGED', relativePath);
    }
  } finally {
    await handle?.close();
  }
}

async function walk(rootPath, state, relative = '', depth = 0) {
  if (depth > MAX_EVIDENCE_ARTIFACT_DEPTH) fail('CONTENT_SCAN_LIMIT', relative || '.');
  const directory = await opendir(rootPath);
  for await (const entry of directory) {
    const absolute = path.join(rootPath, entry.name);
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const metadata = await lstat(absolute);
    state.entries += 1;
    if (state.entries > MAX_EVIDENCE_ARTIFACT_ENTRIES) fail('CONTENT_SCAN_LIMIT', childRelative);
    if (metadata.isSymbolicLink()) fail('SYMLINK_FORBIDDEN', childRelative);
    if (metadata.isDirectory()) {
      await walk(absolute, state, childRelative, depth + 1);
    } else if (metadata.isFile()) {
      state.bytes += metadata.size;
      if (state.bytes > MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES) fail('CONTENT_SCAN_LIMIT', childRelative);
      if (!BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        await scanFile(absolute, childRelative, metadata);
      }
    } else if (!metadata.isFile()) {
      fail('INVALID_ARTIFACT_FILE', childRelative);
    }
  }
}

export async function scanEvidenceArtifactRoot(rootPath) {
  const resolved = path.resolve(rootPath);
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('INVALID_ARTIFACT_ROOT', resolved);
  const state = { entries: 0, bytes: 0 };
  await walk(resolved, state);
  return { rootPath: resolved, status: 'CLEAN', entries: state.entries, bytes: state.bytes };
}

function parseRoot(argv) {
  if (argv.length !== 2 || argv[0] !== '--root' || !argv[1]) fail('INVALID_ARGUMENT', 'Usage: --root <directory>');
  return argv[1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const result = await scanEvidenceArtifactRoot(parseRoot(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof EvidenceContentScanError ? error.code : 'CONTENT_SCAN_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}
