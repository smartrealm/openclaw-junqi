import { detectGatewayConfig, type GatewayConfigInfo } from '@/api/tauri-commands';
import {
  bindGatewayCredentialToInstance,
  type GatewayCredentialRuntimeBinding,
} from './credentialProvider';
import { resolveGatewayConnectionCredentialRuntimeKey } from './GatewayConnectionTargetResolver';
import { getCurrentRuntimeIdentity } from './runtimeIdentity';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

export interface GatewayCredentialBindingDependencies {
  detectConfig: () => Promise<GatewayConfigInfo>;
  currentIdentity: () => RuntimeIdentity | null;
  bindCredential: (
    gatewayUrl: string,
    collaborationInstanceId: string,
    options: { sourceRuntimeKeys: string[]; isCurrent: () => boolean },
  ) => Promise<GatewayCredentialRuntimeBinding>;
}

const defaultDependencies: GatewayCredentialBindingDependencies = {
  detectConfig: detectGatewayConfig,
  currentIdentity: getCurrentRuntimeIdentity,
  bindCredential: bindGatewayCredentialToInstance,
};

function matchesExpectedIdentity(
  identity: RuntimeIdentity | null,
  gatewayUrl: string,
  collaborationInstanceId: string,
  expectedConnectionId: string,
): boolean {
  return Boolean(
    identity?.verified
    && identity.connectionId === expectedConnectionId
    && identity.endpoint === gatewayUrl
    && identity.runtimeId === collaborationInstanceId,
  );
}

/** Promotes a device credential only while its authenticated socket remains current. */
export async function bindGatewayCredentialToCurrentInstance(
  gatewayUrl: string,
  collaborationInstanceId: string,
  expectedConnectionId: string,
  dependencies: GatewayCredentialBindingDependencies = defaultDependencies,
): Promise<GatewayCredentialRuntimeBinding> {
  const activeConfig = await dependencies.detectConfig().catch(() => null);
  const sourceRuntimeKey = resolveGatewayConnectionCredentialRuntimeKey(gatewayUrl, activeConfig);
  const isCurrent = () => matchesExpectedIdentity(
    dependencies.currentIdentity(),
    gatewayUrl,
    collaborationInstanceId,
    expectedConnectionId,
  );
  if (!isCurrent()) {
    throw new Error('Gateway identity changed before credential binding completed');
  }
  return dependencies.bindCredential(gatewayUrl, collaborationInstanceId, {
    sourceRuntimeKeys: [sourceRuntimeKey],
    isCurrent,
  });
}
