import type { ToolsEffectiveResult } from '@/services/gateway/toolsEffective';

export type BrowserProviderId = 'openclaw-native' | 'ego-lite';
export type BrowserProviderProbeStatus = 'available' | 'notInstalled' | 'unsupported';

export interface BrowserProviderProbe {
  providerId: 'ego-lite';
  status: BrowserProviderProbeStatus;
  platform: string;
  platformSupported: boolean;
  executablePath?: string;
}

export interface BrowserProviderDescriptor {
  id: BrowserProviderId;
  nameKey: string;
  descriptionKey: string;
  capabilityKey: string;
  docsUrl: string;
  installCommand?: string;
}

export const BROWSER_PROVIDER_DESCRIPTORS: readonly BrowserProviderDescriptor[] = [
  {
    id: 'openclaw-native',
    nameKey: 'browserProviders.openclawName',
    descriptionKey: 'browserProviders.openclawDescription',
    capabilityKey: 'browserProviders.openclawCapability',
    docsUrl: 'https://docs.openclaw.ai/tools/browser',
  },
  {
    id: 'ego-lite',
    nameKey: 'browserProviders.egoLiteName',
    descriptionKey: 'browserProviders.egoLiteDescription',
    capabilityKey: 'browserProviders.egoLiteCapability',
    docsUrl: 'https://github.com/citrolabs/ego-lite',
    installCommand: 'npx skills add citrolabs/ego-lite',
  },
] as const;

const PROVIDER_PROBE_STATUSES: readonly BrowserProviderProbeStatus[] = [
  'available',
  'notInstalled',
  'unsupported',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`browser provider probe returned an invalid ${field}`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value, field);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`browser provider probe returned an invalid ${field}`);
  }
  return value as T;
}

function parseProbe(value: unknown, index: number): BrowserProviderProbe {
  if (!isRecord(value)) {
    throw new Error(`browser provider probe returned an invalid provider at index ${index}`);
  }
  const providerId = value.providerId;
  if (providerId !== 'ego-lite') {
    throw new Error(`browser provider probe returned an invalid providerId at index ${index}`);
  }
  if (typeof value.platformSupported !== 'boolean') {
    throw new Error(`browser provider probe returned an invalid platformSupported at index ${index}`);
  }
  const probe: BrowserProviderProbe = {
    providerId,
    status: enumValue(value.status, PROVIDER_PROBE_STATUSES, `providers[${index}].status`),
    platform: requiredString(value.platform, `providers[${index}].platform`),
    platformSupported: value.platformSupported,
  };
  const executablePath = nullableString(value.executablePath, `providers[${index}].executablePath`);
  if (executablePath) probe.executablePath = executablePath;
  return probe;
}

export function parseBrowserProviderProbes(value: unknown): BrowserProviderProbe[] {
  if (!Array.isArray(value)) {
    throw new Error('browser provider probe returned an invalid result');
  }
  return value.map(parseProbe);
}

export function hasOpenClawBrowserTool(result: ToolsEffectiveResult | null): boolean {
  return result?.groups.some((group) => group.tools.some((tool) => tool.id === 'browser')) ?? false;
}

export function findEgoLiteProbe(
  probes: readonly BrowserProviderProbe[],
): BrowserProviderProbe | undefined {
  return probes.find((probe) => probe.providerId === 'ego-lite');
}
