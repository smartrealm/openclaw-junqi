import {
  COLLABORATION_PLUGIN_BUNDLE,
  type CollaborationPluginBundleMetadata,
} from './bundledPlugin';
import type { CollaborationCapabilities } from './types';

export const REQUIRED_COLLABORATION_FEATURES = [
  'SQLITE_AUTHORITY',
  'COMMAND_OUTBOX',
  'TASK_RECONCILE',
  'EXACT_TRANSCRIPT_DELIVERY',
  'EXACT_TRANSCRIPT_IDENTITY',
  'PLUGIN_SUBAGENT_TASK_LOOKUP',
  'PLUGIN_SUBAGENT_TASK_CANCEL',
  'EVENT_CURSOR',
  'SESSION_DELETE_CAS',
  'WRITE_INSTANCE_FENCE',
  'WORKFLOW_TEMPLATES',
] as const;

export interface CollaborationCapabilityIssue {
  code: 'PLUGIN_VERSION' | 'SCHEMA_VERSION' | 'DURABILITY' | 'FEATURE_EVIDENCE' | 'FEATURES';
  message: string;
  details: Record<string, unknown>;
}

export function collaborationCapabilityIssue(
  capabilities: CollaborationCapabilities,
  bundle: CollaborationPluginBundleMetadata = COLLABORATION_PLUGIN_BUNDLE,
): CollaborationCapabilityIssue | null {
  if (capabilities.pluginVersion !== bundle.pluginVersion) {
    return {
      code: 'PLUGIN_VERSION',
      message: 'The loaded collaboration plugin version does not match this JunQi build.',
      details: { expected: bundle.pluginVersion, actual: capabilities.pluginVersion ?? null },
    };
  }
  if (capabilities.schemaVersion !== bundle.schemaVersion) {
    return {
      code: 'SCHEMA_VERSION',
      message: 'The loaded collaboration schema is not compatible with this JunQi build.',
      details: { expected: bundle.schemaVersion, actual: capabilities.schemaVersion },
    };
  }
  if (
    capabilities.durableState !== true
    || capabilities.durableRuntime !== true
    || capabilities.durableRuntimeDetails?.supported !== true
  ) {
    return {
      code: 'DURABILITY',
      message: 'The collaboration plugin did not confirm its durable runtime contract.',
      details: {
        durableState: capabilities.durableState ?? null,
        durableRuntime: capabilities.durableRuntime,
        runtimeSupported: capabilities.durableRuntimeDetails?.supported ?? null,
      },
    };
  }
  const evidence = capabilities.featureEvidence;
  if (
    evidence?.kind !== 'DECLARED_PLUGIN_CONTRACT'
    || evidence.behaviorVerified !== false
    || evidence.requiredBehaviorGate !== 'ISOLATED_REAL_GATEWAY'
    || evidence.structuralChecks?.pluginServiceStarted !== true
    || evidence.structuralChecks?.databaseIntegrity !== 'ok'
  ) {
    return {
      code: 'FEATURE_EVIDENCE',
      message: 'The collaboration plugin did not provide the capability evidence required by this JunQi build.',
      details: {
        kind: evidence?.kind ?? null,
        behaviorVerified: evidence?.behaviorVerified ?? null,
        requiredBehaviorGate: evidence?.requiredBehaviorGate ?? null,
        pluginServiceStarted: evidence?.structuralChecks?.pluginServiceStarted ?? null,
        databaseIntegrity: evidence?.structuralChecks?.databaseIntegrity ?? null,
      },
    };
  }
  const missingFeatures = REQUIRED_COLLABORATION_FEATURES.filter(
    (feature) => capabilities.features?.[feature] !== true,
  );
  if (missingFeatures.length > 0) {
    return {
      code: 'FEATURES',
      message: 'The collaboration plugin is missing capabilities required by this JunQi build.',
      details: { missingFeatures },
    };
  }
  return null;
}
