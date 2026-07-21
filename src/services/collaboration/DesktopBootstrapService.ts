import {
  abandonCollaborationBootstrap,
  applyCollaborationBootstrap,
  configureCollaborationBootstrap,
  confirmCollaborationBootstrapHealth,
  getCollaborationBootstrapStatus,
  probeCollaborationBootstrap,
  recoverCollaborationBootstrap,
  restartCollaborationBootstrapGateway,
} from '@/api/tauri-commands';
import type {
  BootstrapApplyParams,
  BootstrapAbandonParams,
  BootstrapConfigureParams,
  BootstrapConfirmHealthParams,
  BootstrapProbeParams,
  BootstrapRecoverParams,
  BootstrapRestartParams,
  CollaborationBootstrapConfigureResult,
  CollaborationBootstrapAbandonResult,
  CollaborationBootstrapProbe,
  CollaborationBootstrapRestartResult,
  CollaborationBootstrapResult,
  CollaborationBootstrapStatus,
} from '@/types/collaborationBootstrap';
import { REQUIRED_COLLABORATION_FEATURES } from './capabilityContract';

export interface DesktopBootstrapTransport {
  probe(params?: BootstrapProbeParams): Promise<CollaborationBootstrapProbe>;
  apply(params: BootstrapApplyParams): Promise<CollaborationBootstrapResult>;
  status(): Promise<CollaborationBootstrapStatus>;
  recover(params: BootstrapRecoverParams): Promise<CollaborationBootstrapResult>;
  abandon(params: BootstrapAbandonParams): Promise<CollaborationBootstrapAbandonResult>;
  confirmHealth(params: BootstrapConfirmHealthParams): Promise<CollaborationBootstrapResult>;
  restart(params: BootstrapRestartParams): Promise<CollaborationBootstrapRestartResult>;
  configure(params: BootstrapConfigureParams): Promise<CollaborationBootstrapConfigureResult>;
}

const tauriTransport: DesktopBootstrapTransport = {
  probe: probeCollaborationBootstrap,
  apply: applyCollaborationBootstrap,
  status: getCollaborationBootstrapStatus,
  recover: recoverCollaborationBootstrap,
  abandon: abandonCollaborationBootstrap,
  confirmHealth: confirmCollaborationBootstrapHealth,
  restart: restartCollaborationBootstrapGateway,
  configure: configureCollaborationBootstrap,
};

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function agentId(value: string, field: string): string {
  const raw = required(value, field);
  if (raw === '*') throw new TypeError(`${field} must be an explicit agent id`);
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized.length > 128) {
    throw new TypeError(`${field} must be a valid OpenClaw agent id`);
  }
  return normalized;
}

function explicitAgentIds(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('allowedAgentIds must contain at least one explicit agent id');
  }
  if (values.length > 64) throw new TypeError('allowedAgentIds cannot contain more than 64 agents');
  const normalized = values.map((value, index) => agentId(value, `allowedAgentIds[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('allowedAgentIds contains duplicate normalized agent ids');
  }
  return normalized;
}

/**
 * Typed Desktop-side bootstrap control plane. The Rust layer remains the
 * mutation authority and owns its durable single-flight journal.
 */
export class DesktopBootstrapService {
  constructor(private readonly transport: DesktopBootstrapTransport = tauriTransport) {}

  probe(
    targetFingerprint?: string,
    expectedConnectionId?: string,
  ): Promise<CollaborationBootstrapProbe> {
    const fingerprint = targetFingerprint?.trim();
    const connectionId = expectedConnectionId?.trim();
    if (Boolean(fingerprint) !== Boolean(connectionId)) {
      throw new TypeError('targetFingerprint and expectedConnectionId must be provided together');
    }
    return this.transport.probe(fingerprint && connectionId
      ? { targetFingerprint: fingerprint, expectedConnectionId: connectionId }
      : {});
  }

  status(): Promise<CollaborationBootstrapStatus> {
    return this.transport.status();
  }

  apply(params: BootstrapApplyParams): Promise<CollaborationBootstrapResult> {
    return this.transport.apply({
      targetFingerprint: required(params.targetFingerprint, 'targetFingerprint'),
      expectedConnectionId: required(params.expectedConnectionId, 'expectedConnectionId'),
    });
  }

  recover(params: BootstrapRecoverParams): Promise<CollaborationBootstrapResult> {
    if (params.strategy !== 'resume' && params.strategy !== 'rollback') {
      throw new TypeError('strategy must be resume or rollback');
    }
    return this.transport.recover({
      targetFingerprint: required(params.targetFingerprint, 'targetFingerprint'),
      expectedConnectionId: required(params.expectedConnectionId, 'expectedConnectionId'),
      strategy: params.strategy,
    });
  }

  abandon(params: BootstrapAbandonParams): Promise<CollaborationBootstrapAbandonResult> {
    return this.transport.abandon({
      operationId: required(params.operationId, 'operationId'),
      orphanTargetFingerprint: required(params.orphanTargetFingerprint, 'orphanTargetFingerprint'),
      currentTargetFingerprint: required(params.currentTargetFingerprint, 'currentTargetFingerprint'),
      expectedConnectionId: required(params.expectedConnectionId, 'expectedConnectionId'),
    });
  }

  confirmHealth(params: BootstrapConfirmHealthParams): Promise<CollaborationBootstrapResult> {
    const collaborationInstanceId = required(
      params.collaborationInstanceId,
      'collaborationInstanceId',
    );
    const pluginVersion = required(params.pluginVersion, 'pluginVersion');
    if (!Number.isSafeInteger(params.schemaVersion) || params.schemaVersion < 1) {
      throw new TypeError('schemaVersion must be a positive integer');
    }
    if (params.durableState !== true) {
      throw new TypeError('durableState must be true');
    }
    if (params.durableRuntime !== true || params.durableRuntimeSupported !== true) {
      throw new TypeError('durableRuntime and durableRuntimeSupported must be true');
    }
    if (
      params.featureEvidenceKind !== 'DECLARED_PLUGIN_CONTRACT'
      || params.featureEvidenceBehaviorVerified !== false
      || params.featureEvidenceRequiredBehaviorGate !== 'ISOLATED_REAL_GATEWAY'
      || params.featureEvidencePluginServiceStarted !== true
      || params.featureEvidenceDatabaseIntegrity !== 'ok'
    ) {
      throw new TypeError('feature evidence does not match the collaboration capability contract');
    }
    const features = params.features;
    if (
      !features
      || REQUIRED_COLLABORATION_FEATURES.some((feature) => features[feature] !== true)
      || Object.values(features).some((value) => typeof value !== 'boolean')
    ) {
      throw new TypeError('features must include the complete collaboration capability contract');
    }
    return this.transport.confirmHealth({
      operationId: required(params.operationId, 'operationId'),
      targetFingerprint: required(params.targetFingerprint, 'targetFingerprint'),
      expectedConnectionId: required(params.expectedConnectionId, 'expectedConnectionId'),
      collaborationInstanceId,
      pluginVersion,
      schemaVersion: params.schemaVersion,
      durableState: true,
      durableRuntime: true,
      durableRuntimeSupported: true,
      featureEvidenceKind: 'DECLARED_PLUGIN_CONTRACT',
      featureEvidenceBehaviorVerified: false,
      featureEvidenceRequiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
      featureEvidencePluginServiceStarted: true,
      featureEvidenceDatabaseIntegrity: 'ok',
      features: Object.fromEntries(
        REQUIRED_COLLABORATION_FEATURES.map((feature) => [feature, true]),
      ),
    });
  }

  restart(params: BootstrapRestartParams): Promise<CollaborationBootstrapRestartResult> {
    return this.transport.restart({
      operationId: required(params.operationId, 'operationId'),
      targetFingerprint: required(params.targetFingerprint, 'targetFingerprint'),
      expectedConnectionId: required(params.expectedConnectionId, 'expectedConnectionId'),
    });
  }

  configure(params: BootstrapConfigureParams): Promise<CollaborationBootstrapConfigureResult> {
    const coordinatorAgentId = agentId(params.coordinatorAgentId, 'coordinatorAgentId');
    const allowedAgentIds = explicitAgentIds(params.allowedAgentIds);
    if (!allowedAgentIds.includes(coordinatorAgentId)) {
      throw new TypeError('allowedAgentIds must include coordinatorAgentId');
    }
    return this.transport.configure({
      targetFingerprint: required(params.targetFingerprint, 'targetFingerprint'),
      expectedConnectionId: required(params.expectedConnectionId, 'expectedConnectionId'),
      coordinatorAgentId,
      allowedAgentIds,
    });
  }
}

export const desktopBootstrapService = new DesktopBootstrapService();
