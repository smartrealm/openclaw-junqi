#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { readStableFile, writeNewRegularFile } from './stable-file.mjs';

export const RELEASE_PUBLICATION_SEAL_KIND = 'JUNQI_RELEASE_PUBLICATION_SEAL';
export const RELEASE_PUBLICATION_SEAL_SCHEMA_VERSION = 1;
export const MAX_RELEASE_PUBLICATION_SEAL_BYTES = 1024 * 1024;
export const MAX_RELEASE_PUBLICATION_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_RELEASE_PUBLICATION_METADATA_BYTES = 2 * MAX_RELEASE_PUBLICATION_SEAL_BYTES;
export const MAX_RELEASE_PUBLICATION_TOTAL_BYTES =
  MAX_RELEASE_PUBLICATION_INSTALLER_BYTES + MAX_RELEASE_PUBLICATION_METADATA_BYTES;
const MAX_SEAL_FILES = 130;
const INSTALLER_EXTENSIONS = Object.freeze(new Set(['.dmg', '.exe', '.msi']));
const REQUIRED_METADATA = Object.freeze(new Set([
  'release-assets-manifest.json',
  'release-decision.json',
]));
const SAFE_SOURCE_SHA = /^[a-f0-9]{40}$/;
const SAFE_RELEASE_REF = /^refs\/(?:tags\/v[0-9A-Za-z][0-9A-Za-z._-]*|heads\/[A-Za-z0-9._/-]+)$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export class ReleasePublicationSealError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReleasePublicationSealError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new ReleasePublicationSealError(code, message, details);
}

function assertSourceSha(sourceSha) {
  if (typeof sourceSha !== 'string' || !SAFE_SOURCE_SHA.test(sourceSha)) {
    fail('INVALID_SEAL_SOURCE', 'Publication seal sourceSha must be a full lowercase commit SHA');
  }
  return sourceSha;
}

function assertReleaseRef(releaseRef) {
  if (typeof releaseRef !== 'string' || !SAFE_RELEASE_REF.test(releaseRef)) {
    fail('INVALID_SEAL_REF', 'Publication seal releaseRef must be a safe Git ref');
  }
  return releaseRef;
}

function assertFileName(name) {
  if (typeof name !== 'string' || !SAFE_FILE_NAME.test(name) || name.includes('/') || name.includes('\\')) {
    fail('INVALID_SEAL_FILE', 'Publication seal contains an unsafe file name');
  }
  const isMetadata = REQUIRED_METADATA.has(name);
  const isInstaller = INSTALLER_EXTENSIONS.has(path.extname(name).toLowerCase());
  if (!isMetadata && !isInstaller) fail('INVALID_SEAL_FILE', `Unsupported publication file: ${name}`);
  return name;
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('INVALID_SEAL_DIGEST', `${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function assertSealDigest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('INVALID_SEAL_DIGEST', 'Expected seal digest must be a lowercase SHA-256 hex digest');
  }
  return value;
}

function assertBytes(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_SEAL_BYTES', `${label} must be a non-negative safe integer`);
  return value;
}

function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_SEAL_FILES) {
    fail('INVALID_SEAL_FILES', 'Publication seal file list has an invalid size');
  }
  const names = new Set();
  let totalBytes = 0;
  const normalized = files.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      fail('INVALID_SEAL_FILES', `Publication seal file ${index} is invalid`);
    }
    const name = assertFileName(file.name);
    if (names.has(name)) fail('DUPLICATE_SEAL_FILE', `Publication seal repeats ${name}`);
    names.add(name);
    const bytes = assertBytes(file.bytes, `Publication seal ${name}.bytes`);
    const sha256 = assertDigest(file.sha256, `Publication seal ${name}.sha256`);
    if (INSTALLER_EXTENSIONS.has(path.extname(name).toLowerCase())
      && bytes > MAX_RELEASE_PUBLICATION_INSTALLER_BYTES) {
      fail('SEAL_SIZE_LIMIT', `Installer exceeds the per-file publication limit: ${name}`);
    }
    if (REQUIRED_METADATA.has(name) && bytes > MAX_RELEASE_PUBLICATION_SEAL_BYTES) {
      fail('SEAL_SIZE_LIMIT', `Provenance metadata exceeds the per-file publication limit: ${name}`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_RELEASE_PUBLICATION_TOTAL_BYTES) fail('SEAL_SIZE_LIMIT', 'Publication seal exceeds the aggregate byte limit');
    return { name, bytes, sha256 };
  }).sort((left, right) => left.name.localeCompare(right.name));

  for (const required of REQUIRED_METADATA) {
    if (!names.has(required)) fail('SEAL_METADATA_MISSING', `Publication seal is missing ${required}`);
  }
  if (!normalized.some((file) => INSTALLER_EXTENSIONS.has(path.extname(file.name).toLowerCase()))) {
    fail('SEAL_INSTALLER_MISSING', 'Publication seal contains no installer');
  }
  return normalized;
}

function freezeSeal(seal) {
  return Object.freeze({
    ...seal,
    files: Object.freeze(seal.files.map((file) => Object.freeze({ ...file }))),
  });
}

export function createReleasePublicationSeal({ sourceSha, releaseRef, files }) {
  return freezeSeal({
    schemaVersion: RELEASE_PUBLICATION_SEAL_SCHEMA_VERSION,
    kind: RELEASE_PUBLICATION_SEAL_KIND,
    sourceSha: assertSourceSha(sourceSha),
    releaseRef: assertReleaseRef(releaseRef),
    files: normalizeFiles(files),
  });
}

export function serializeReleasePublicationSeal(seal) {
  const normalized = createReleasePublicationSeal(seal);
  return `${JSON.stringify(normalized)}\n`;
}

export async function writeReleasePublicationSeal(sealPath, seal) {
  const resolved = path.resolve(sealPath);
  const parent = path.dirname(resolved);
  const parentStat = await lstat(parent).catch((error) => {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!parentStat) await mkdir(parent, { recursive: true, mode: 0o700 });
  const finalParentStat = await lstat(parent);
  if (finalParentStat.isSymbolicLink() || !finalParentStat.isDirectory()) {
    fail('SEAL_PATH_INVALID', 'Publication seal parent must be a regular directory');
  }
  await writeNewRegularFile(resolved, Buffer.from(serializeReleasePublicationSeal(seal)), 0o400);
  return resolved;
}

function parseSealValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SEAL', 'Publication seal must be a JSON object');
  if (value.schemaVersion !== RELEASE_PUBLICATION_SEAL_SCHEMA_VERSION || value.kind !== RELEASE_PUBLICATION_SEAL_KIND) {
    fail('INVALID_SEAL', 'Publication seal schema is unsupported');
  }
  return createReleasePublicationSeal(value);
}

export async function readReleasePublicationSeal(
  sealPath,
  { sourceSha, releaseRef = undefined, sealSha256 = undefined } = {},
) {
  if (typeof sealPath !== 'string' || !sealPath.trim()) fail('SEAL_MISSING', 'Publication seal path is required');
  const resolved = path.resolve(sealPath);
  const stat = await lstat(resolved).catch((error) => {
    if (error?.code === 'ENOENT') fail('SEAL_MISSING', `Publication seal does not exist: ${resolved}`);
    throw error;
  });
  if (stat.isSymbolicLink() || !stat.isFile()) fail('SEAL_PATH_INVALID', 'Publication seal must be a regular file');
  if (stat.size > MAX_RELEASE_PUBLICATION_SEAL_BYTES) fail('SEAL_TOO_LARGE', 'Publication seal exceeds its size limit');
  const snapshot = await readStableFile(resolved, stat, MAX_RELEASE_PUBLICATION_SEAL_BYTES);
  if (sealSha256 !== undefined) {
    const actualDigest = createHash('sha256').update(snapshot.bytes).digest('hex');
    if (!timingSafeEqual(Buffer.from(actualDigest, 'hex'), Buffer.from(assertSealDigest(sealSha256), 'hex'))) {
      fail('SEAL_DIGEST_MISMATCH', 'Publication seal bytes differ from the trusted step digest');
    }
  }
  let value;
  try {
    value = JSON.parse(snapshot.bytes.toString('utf8'));
  } catch {
    fail('INVALID_SEAL', 'Publication seal is not valid JSON');
  }
  const seal = parseSealValue(value);
  if (sourceSha !== undefined && seal.sourceSha !== assertSourceSha(sourceSha)) {
    fail('SEAL_SOURCE_MISMATCH', 'Publication seal is bound to a different source SHA');
  }
  if (releaseRef !== undefined && seal.releaseRef !== assertReleaseRef(releaseRef)) {
    fail('SEAL_REF_MISMATCH', 'Publication seal is bound to a different release ref');
  }
  return seal;
}

function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function assertReleasePublicationSealMatchesAssets(
  seal,
  assets,
  { sourceSha = undefined, releaseRef = undefined } = {},
) {
  const normalizedSeal = parseSealValue(seal);
  if (sourceSha !== undefined && normalizedSeal.sourceSha !== assertSourceSha(sourceSha)) {
    fail('SEAL_SOURCE_MISMATCH', 'Publication seal is bound to a different source SHA');
  }
  if (releaseRef !== undefined && normalizedSeal.releaseRef !== assertReleaseRef(releaseRef)) {
    fail('SEAL_REF_MISMATCH', 'Publication seal is bound to a different release ref');
  }
  if (!Array.isArray(assets)) fail('SEAL_ASSET_MISMATCH', 'Release assets must be an array');
  const actual = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || actual.has(asset.name)) {
      fail('SEAL_ASSET_MISMATCH', 'Release assets contain duplicate or malformed names');
    }
    actual.set(asset.name, asset);
  }
  if (actual.size !== normalizedSeal.files.length) fail('SEAL_ASSET_MISMATCH', 'Release asset set differs from the publication seal');
  for (const expected of normalizedSeal.files) {
    const candidate = actual.get(expected.name);
    if (!candidate || candidate.bytes !== expected.bytes || !equalDigest(candidate.sha256, expected.sha256)) {
      fail('SEAL_ASSET_MISMATCH', `Release asset differs from the publication seal: ${expected.name}`);
    }
  }
  return true;
}
