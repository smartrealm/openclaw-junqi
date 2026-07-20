import type { GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import { getTemplateById, type ProviderTemplate } from '@/pages/ConfigManager/providerTemplates';
import {
  extractEnvRefKey,
  resolveProviderSecret,
  type ProviderSecretSource,
} from '@/pages/ConfigManager/providerSecretResolver';
import { invoke } from '@tauri-apps/api/core';

export type RescueProviderApi = 'openai-compatible' | 'anthropic-messages';

export interface GatewayRescueTarget {
  providerId: string;
  modelId: string;
  modelRef: string;
  baseUrl: string;
  apiKey: string;
  api: RescueProviderApi;
  source: 'primary' | 'configured-provider' | 'manual';
  credentialSource: ProviderSecretSource | 'manual';
  template?: ProviderTemplate;
}

export interface GatewayRescueMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GatewayRescueContext {
  error: string;
  logs?: string;
}

export type GatewayRescueFailureKind = 'authentication' | 'permission' | 'request';

export function classifyGatewayRescueFailure(error: unknown): GatewayRescueFailureKind {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/(^|\D)401(\D|$)|invalid api key|unauthori[sz]ed/i.test(message)) return 'authentication';
  if (/(^|\D)403(\D|$)|forbidden|permission denied/i.test(message)) return 'permission';
  return 'request';
}

function parseModelRef(modelRef: string): { providerId: string; modelId: string } | null {
  const trimmed = modelRef.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash >= trimmed.length - 1) return null;
  return {
    providerId: trimmed.slice(0, slash).trim().toLowerCase(),
    modelId: trimmed.slice(slash + 1).trim(),
  };
}

function firstModelRef(config: GatewayRuntimeConfig): string {
  const primary = String(config.agents?.defaults?.model?.primary ?? '').trim();
  if (primary) return primary;
  return Object.keys(config.agents?.defaults?.models ?? {})[0] ?? '';
}

function configuredModelRefs(config: GatewayRuntimeConfig): string[] {
  const refs = new Set<string>();
  const add = (value: unknown) => {
    const ref = String(value ?? '').trim();
    if (parseModelRef(ref)) refs.add(ref);
  };
  add(config.agents?.defaults?.model?.primary);
  for (const ref of Object.keys(config.agents?.defaults?.models ?? {})) add(ref);
  return [...refs];
}

function providerModelRefs(config: GatewayRuntimeConfig, providerId: string): string[] {
  const provider = getProviderConfig(config, providerId);
  if (!Array.isArray(provider?.models)) return [];
  const refs = new Set<string>();
  for (const model of provider.models) {
    const id = String(model?.id ?? '').trim();
    if (!id) continue;
    const parsed = parseModelRef(id);
    if (parsed && parsed.providerId !== providerId) continue;
    refs.add(parsed ? id : `${providerId}/${id}`);
  }
  return [...refs];
}

function findProfileKey(config: GatewayRuntimeConfig, providerId: string): string | undefined {
  const profiles = config.auth?.profiles ?? {};
  const main = `${providerId}:main`;
  if (profiles[main]) return main;
  return Object.entries(profiles).find(([, profile]) => (
    String(profile?.provider ?? '').trim().toLowerCase() === providerId
  ))?.[0];
}

function getProviderConfig(config: GatewayRuntimeConfig, providerId: string): Record<string, any> | undefined {
  const providers = config.models?.providers ?? {};
  return (
    providers[providerId] as Record<string, any> | undefined ??
    Object.entries(providers).find(([key]) => key.trim().toLowerCase() === providerId)?.[1] as Record<string, any> | undefined
  );
}

function readProviderConfigApiKey(config: GatewayRuntimeConfig, providerConfig: Record<string, any> | undefined): string {
  const raw = providerConfig?.apiKey;
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const envKey = extractEnvRefKey(trimmed);
  if (envKey) return String(config.env?.vars?.[envKey] ?? '').trim();
  return trimmed;
}

function resolveApi(template?: ProviderTemplate): RescueProviderApi | null {
  if (template?.api === 'anthropic-messages') return 'anthropic-messages';
  if (!template || template.api === 'openai-completions') return 'openai-compatible';
  return null;
}

export function resolveGatewayRescueTarget(config: GatewayRuntimeConfig): GatewayRescueTarget | null {
  return resolveGatewayRescueTargets(config)[0] ?? null;
}

function buildTargetFromProvider(
  config: GatewayRuntimeConfig,
  providerId: string,
  modelRef: string,
  source: GatewayRescueTarget['source'],
): GatewayRescueTarget | null {
  const parsed = parseModelRef(modelRef);
  const modelId = parsed?.providerId === providerId
    ? parsed.modelId
    : modelRef.trim();
  if (!modelId) return null;
  const providerConfig = getProviderConfig(config, providerId);
  const template = getTemplateById(providerId);
  const api = resolveApi(template);
  if (!api) return null;

  const baseUrl = String(providerConfig?.baseUrl ?? template?.baseUrl ?? '').trim();
  if (!baseUrl) return null;

  const profileKey = findProfileKey(config, providerId);
  const secret = resolveProviderSecret(config, providerId, template, profileKey);
  const apiKey = String(secret.value ?? '').trim() || readProviderConfigApiKey(config, providerConfig);
  if (!apiKey) return null;

  return {
    providerId,
    modelId,
    modelRef,
    baseUrl,
    apiKey,
    api,
    source,
    credentialSource: secret.source,
    template,
  };
}

export function gatewayRescueTargetKey(target: GatewayRescueTarget): string {
  return [target.api, target.baseUrl, target.providerId, target.modelId].join('\u0000');
}

export function resolveGatewayRescueTargets(config: GatewayRuntimeConfig): GatewayRescueTarget[] {
  const targets: GatewayRescueTarget[] = [];
  const seen = new Set<string>();
  const add = (target: GatewayRescueTarget | null) => {
    if (!target) return;
    const key = gatewayRescueTargetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  const primaryRef = firstModelRef(config);
  const primary = parseModelRef(primaryRef);
  if (primary) add(buildTargetFromProvider(config, primary.providerId, primaryRef, 'primary'));

  for (const modelRef of configuredModelRefs(config)) {
    const parsed = parseModelRef(modelRef);
    if (!parsed) continue;
    add(buildTargetFromProvider(config, parsed.providerId, modelRef, 'configured-provider'));
  }

  for (const providerId of Object.keys(config.models?.providers ?? {})) {
    const normalizedProviderId = providerId.trim().toLowerCase();
    for (const modelRef of providerModelRefs(config, normalizedProviderId)) {
      add(buildTargetFromProvider(
        config,
        normalizedProviderId,
        modelRef,
        'configured-provider',
      ));
    }
  }

  return targets;
}

export function buildManualGatewayRescueTarget(input: {
  api: RescueProviderApi;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  providerId?: string;
}): GatewayRescueTarget | null {
  const api = input.api;
  const baseUrl = input.baseUrl.trim();
  const apiKey = input.apiKey.trim();
  const modelId = input.modelId.trim();
  if (!api || !baseUrl || !apiKey || !modelId) return null;
  const providerId = input.providerId?.trim() || 'manual';
  return {
    providerId,
    modelId,
    modelRef: `${providerId}/${modelId}`,
    baseUrl,
    apiKey,
    api,
    source: 'manual',
    credentialSource: 'manual',
  };
}

export async function sendGatewayRescueMessage(
  target: GatewayRescueTarget,
  messages: GatewayRescueMessage[],
  context: GatewayRescueContext,
): Promise<string> {
  const response = await invoke<{ text: string }>('gateway_rescue_chat', {
    req: {
      api: target.api,
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      modelId: target.modelId,
      messages,
      context,
    },
  });
  return response.text;
}
