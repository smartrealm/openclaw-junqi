import { resolveResource } from '@tauri-apps/api/path';
import metadataDocument from '@/generated/collaborationPluginBundle.generated.json';

export interface CollaborationPluginBundleMetadata {
  formatVersion: 1;
  pluginId: 'junqi-collab';
  packageName: '@junqi/openclaw-collaboration';
  pluginVersion: string;
  schemaVersion: number;
  sha256: string;
  archiveFile: 'junqi-collab.tgz';
  resourcePath: string;
}

export interface ResolvedCollaborationPluginBundle extends CollaborationPluginBundleMetadata {
  tgzPath: string;
}

type ResourceResolver = (resourcePath: string) => Promise<string>;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Invalid collaboration bundle ${field}`);
  }
  return value.trim();
}

export function validateCollaborationPluginBundleMetadata(
  value: unknown,
): CollaborationPluginBundleMetadata {
  const document = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const pluginVersion = requiredText(document.pluginVersion, 'pluginVersion');
  const resourcePath = requiredText(document.resourcePath, 'resourcePath');
  const hash = requiredText(document.sha256, 'sha256').toLowerCase();
  if (document.formatVersion !== 1) throw new TypeError('Unsupported collaboration bundle metadata');
  if (document.pluginId !== 'junqi-collab') throw new TypeError('Invalid collaboration bundle pluginId');
  if (document.packageName !== '@junqi/openclaw-collaboration') {
    throw new TypeError('Invalid collaboration bundle packageName');
  }
  if (document.archiveFile !== 'junqi-collab.tgz') {
    throw new TypeError('Invalid collaboration bundle archiveFile');
  }
  if (!Number.isSafeInteger(document.schemaVersion) || Number(document.schemaVersion) < 1) {
    throw new TypeError('Invalid collaboration bundle schemaVersion');
  }
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Invalid collaboration bundle sha256');
  if (resourcePath !== 'collaboration/junqi-collab.tgz') {
    throw new TypeError('Invalid collaboration bundle resourcePath');
  }
  return {
    formatVersion: 1,
    pluginId: 'junqi-collab',
    packageName: '@junqi/openclaw-collaboration',
    pluginVersion,
    schemaVersion: Number(document.schemaVersion),
    sha256: hash,
    archiveFile: 'junqi-collab.tgz',
    resourcePath,
  };
}

export const COLLABORATION_PLUGIN_BUNDLE = Object.freeze(
  validateCollaborationPluginBundleMetadata(metadataDocument),
);

function isAbsolutePlatformPath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

/** Resolve only the generated Tauri resource. Callers cannot supply a path or hash. */
export async function resolveBundledCollaborationPlugin(
  resolver: ResourceResolver = resolveResource,
): Promise<ResolvedCollaborationPluginBundle> {
  const tgzPath = (await resolver(COLLABORATION_PLUGIN_BUNDLE.resourcePath)).trim();
  if (!tgzPath || !isAbsolutePlatformPath(tgzPath)) {
    throw new Error('Tauri returned an invalid collaboration bundle resource path');
  }
  return { ...COLLABORATION_PLUGIN_BUNDLE, tgzPath };
}
