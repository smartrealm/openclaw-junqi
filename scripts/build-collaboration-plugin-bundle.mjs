#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runNpmCommand } from './npm-command.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
export const PLUGIN_ROOT = path.join(REPOSITORY_ROOT, 'packages', 'junqi-collab');
export const RESOURCE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'src-tauri',
  'resources',
  'collaboration',
);
export const GENERATED_DIRECTORY = path.join(REPOSITORY_ROOT, 'src', 'generated');
export const BUNDLED_ARCHIVE_PATH = path.join(RESOURCE_DIRECTORY, 'junqi-collab.tgz');
export const RESOURCE_METADATA_PATH = path.join(RESOURCE_DIRECTORY, 'metadata.json');
export const GENERATED_METADATA_PATH = path.join(
  GENERATED_DIRECTORY,
  'collaborationPluginBundle.generated.json',
);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createBundleMetadata({ packageJson, schemaVersion, archiveBytes }) {
  if (packageJson.name !== '@junqi/openclaw-collaboration') {
    throw new Error(`Unexpected collaboration package name: ${packageJson.name ?? '<missing>'}`);
  }
  if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
    throw new Error('The collaboration package version is missing');
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`Invalid collaboration schema version: ${schemaVersion}`);
  }
  return {
    formatVersion: 1,
    pluginId: 'junqi-collab',
    packageName: packageJson.name,
    pluginVersion: packageJson.version,
    schemaVersion,
    sha256: sha256(archiveBytes),
    archiveFile: 'junqi-collab.tgz',
    resourcePath: 'collaboration/junqi-collab.tgz',
  };
}

async function writeIfChanged(filePath, bytes) {
  let current;
  try {
    current = await readFile(filePath);
  } catch {
    current = null;
  }
  const next = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (current?.equals(next)) return false;
  await writeFile(filePath, next);
  return true;
}

async function findPackedArchive(distDirectory) {
  const archives = (await readdir(distDirectory))
    .filter((entry) => entry.endsWith('.tgz'))
    .sort();
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one packed collaboration archive, found ${archives.length}`);
  }
  return path.join(distDirectory, archives[0]);
}

export async function buildCollaborationPluginBundle() {
  runNpmCommand(['run', 'pack:plugin'], {
    cwd: PLUGIN_ROOT,
    stdio: 'inherit',
  });

  const packageJson = JSON.parse(await readFile(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
  const schemaModuleUrl = `${pathToFileURL(path.join(PLUGIN_ROOT, 'dist', 'schema.js')).href}?bundle=${Date.now()}`;
  const { SCHEMA_VERSION: schemaVersion } = await import(schemaModuleUrl);
  const sourceArchive = await findPackedArchive(path.join(PLUGIN_ROOT, 'dist'));
  const archiveBytes = await readFile(sourceArchive);
  const metadata = createBundleMetadata({ packageJson, schemaVersion, archiveBytes });
  const metadataJson = stableJson(metadata);

  await mkdir(RESOURCE_DIRECTORY, { recursive: true });
  await mkdir(GENERATED_DIRECTORY, { recursive: true });
  await Promise.all([
    writeIfChanged(BUNDLED_ARCHIVE_PATH, archiveBytes),
    writeIfChanged(RESOURCE_METADATA_PATH, metadataJson),
    writeIfChanged(GENERATED_METADATA_PATH, metadataJson),
  ]);

  console.log(
    `Bundled ${metadata.packageName}@${metadata.pluginVersion} `
      + `(schema ${metadata.schemaVersion}, sha256 ${metadata.sha256})`,
  );
  return metadata;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await buildCollaborationPluginBundle();
}
