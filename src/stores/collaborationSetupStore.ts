import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  COLLABORATION_PLUGIN_BUNDLE,
  resolveBundledCollaborationPlugin,
  type CollaborationPluginBundleMetadata,
  type ResolvedCollaborationPluginBundle,
} from '@/services/collaboration/bundledPlugin';
import {
  collaborationCapabilityIssue,
  REQUIRED_COLLABORATION_FEATURES,
} from '@/services/collaboration/capabilityContract';
import {
  desktopBootstrapService,
  type DesktopBootstrapTransport,
} from '@/services/collaboration/DesktopBootstrapService';
import type { CollaborationCapabilities } from '@/services/collaboration/types';
import {
  bindCollaborationRuntimeIdentity,
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';
import { useCollaborationStore } from '@/stores/collaborationStore';
import type {
  BootstrapConfigureParams,
  BootstrapAbandonParams,
  BootstrapApplyParams,
  BootstrapConfirmHealthParams,
  BootstrapRecoverParams,
  BootstrapRecoveryStrategy,
  BootstrapRestartParams,
  BootstrapTargetClass,
  CollaborationBootstrapConfigureResult,
  CollaborationBootstrapAbandonResult,
  CollaborationBootstrapProbe,
  CollaborationBootstrapRestartResult,
  CollaborationBootstrapResult,
  CollaborationBootstrapStatus,
} from '@/types/collaborationBootstrap';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

export const COLLABORATION_SETUP_REQUESTED_EVENT = 'junqi:collaboration-setup-requested';

export type CollaborationSetupMutation =
  | 'apply'
  | 'configure'
  | 'recover_resume'
  | 'recover_rollback'
  | 'abandon'
  | 'restart'
  | 'confirm_health';

export type CollaborationSetupResult =
  | CollaborationBootstrapResult
  | CollaborationBootstrapRestartResult
  | CollaborationBootstrapConfigureResult
  | CollaborationBootstrapAbandonResult;

export interface CollaborationAgentConfigurationDraft {
  coordinatorAgentId: string | null;
  allowedAgentIds: string[];
  touched: boolean;
}

export type CollaborationSetupViewKind =
  | 'loading'
  | 'identity_unavailable'
  | 'busy'
  | 'recovery'
  | 'health_pending'
  | 'manual'
  | 'runtime_not_durable'
  | 'unsupported'
  | 'install'
  | 'repair'
  | 'update'
  | 'ready'
  | 'error';

export interface CollaborationSetupViewDecision {
  kind: CollaborationSetupViewKind;
  canApply: boolean;
  canRecover: boolean;
  canAbandon?: boolean;
  targetClass: BootstrapTargetClass;
  pluginVersion: string | null;
  expectedVersion: string;
  blockedReason?: string;
}

interface BootstrapServiceApi {
  probe(targetFingerprint?: string, expectedConnectionId?: string): Promise<CollaborationBootstrapProbe>;
  status(): Promise<CollaborationBootstrapStatus>;
  apply(params: BootstrapApplyParams): Promise<CollaborationBootstrapResult>;
  recover(params: BootstrapRecoverParams): Promise<CollaborationBootstrapResult>;
  abandon(params: BootstrapAbandonParams): Promise<CollaborationBootstrapAbandonResult>;
  confirmHealth(params: BootstrapConfirmHealthParams): Promise<CollaborationBootstrapResult>;
  restart(params: BootstrapRestartParams): Promise<CollaborationBootstrapRestartResult>;
  configure(params: BootstrapConfigureParams): Promise<CollaborationBootstrapConfigureResult>;
}

interface SetupEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

type RuntimeIdentitySubscriber = (listener: (identity: RuntimeIdentity | null) => void) => () => void;

export interface CollaborationSetupDependencies {
  service: BootstrapServiceApi;
  resolveBundle: () => Promise<ResolvedCollaborationPluginBundle>;
  getRuntimeIdentity: () => RuntimeIdentity | null;
  subscribeRuntimeIdentity: RuntimeIdentitySubscriber;
  bindRuntimeIdentity: (collaborationInstanceId: string, expectedConnectionId: string) => RuntimeIdentity | null;
  eventTarget?: SetupEventTarget;
  bundle: CollaborationPluginBundleMetadata;
  reloadCapabilities: () => Promise<CollaborationCapabilities>;
  wait: (delayMs: number) => Promise<void>;
}

export interface CollaborationSetupState {
  open: boolean;
  requestReason: string | null;
  identity: RuntimeIdentity | null;
  probe: CollaborationBootstrapProbe | null;
  status: CollaborationBootstrapStatus | null;
  bundle: CollaborationPluginBundleMetadata;
  resolvedBundlePath: string | null;
  capabilities: CollaborationCapabilities | null;
  agentConfiguration: CollaborationAgentConfigurationDraft;
  loading: boolean;
  mutation: CollaborationSetupMutation | null;
  lastResult: CollaborationSetupResult | null;
  error: string | null;
  restartAvailable: boolean;

  start: () => () => void;
  requestSetup: (reason?: string | null) => void;
  close: () => void;
  refresh: (options?: { clearError?: boolean }) => Promise<void>;
  applyFixedBundle: () => Promise<void>;
  selectCoordinatorAgent: (agentId: string) => void;
  setAgentAllowed: (agentId: string, allowed: boolean) => void;
  configureAgents: () => Promise<void>;
  recover: (strategy: BootstrapRecoveryStrategy) => Promise<void>;
  abandonOrphan: () => Promise<void>;
  requestRestart: () => Promise<void>;
  observeCapabilities: (capabilities: CollaborationCapabilities | null) => Promise<void>;
}

function isMutableDurableTarget(targetClass: BootstrapTargetClass): boolean {
  return targetClass === 'system_service' || targetClass === 'docker';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseCollaborationSetupRequest(event: Event): string | null {
  const detail = 'detail' in event ? (event as CustomEvent<unknown>).detail : null;
  if (!detail || typeof detail !== 'object') return null;
  const reason = (detail as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 80) : null;
}

export function deriveCollaborationSetupView(
  state: Pick<
    CollaborationSetupState,
    'identity' | 'probe' | 'status' | 'bundle' | 'capabilities' | 'loading' | 'mutation' | 'error'
  >,
): CollaborationSetupViewDecision {
  const targetClass = state.probe?.targetClass ?? 'unknown';
  const pluginVersion = state.probe?.plugin.version?.trim() || null;
  const base = {
    targetClass,
    pluginVersion,
    expectedVersion: state.bundle.pluginVersion,
  };
  if (state.loading && (!state.probe || !state.status)) {
    return { ...base, kind: 'loading', canApply: false, canRecover: false };
  }
  if (!state.identity?.verified) {
    return {
      ...base,
      kind: 'identity_unavailable',
      canApply: false,
      canRecover: false,
      blockedReason: 'A verified Gateway connection is required.',
    };
  }
  if (state.mutation || state.status?.busy || state.probe?.busy) {
    return { ...base, kind: 'busy', canApply: false, canRecover: false };
  }

  const journal = state.status?.journal;
  if (state.status?.recoveryRequired || state.probe?.recoveryRequired) {
    const sameTarget = Boolean(
      journal
      && journal.target.targetFingerprint === state.identity.targetFingerprint
      && state.status?.targetFingerprint === state.identity.targetFingerprint,
    );
    const canRecover = sameTarget && isMutableDurableTarget(targetClass);
    const canAbandon = Boolean(
      journal
      && journal.target.targetFingerprint !== state.identity.targetFingerprint
      && state.probe?.targetFingerprint === state.identity.targetFingerprint
      && state.identity.desktopMutationAllowed
      && state.identity.desktopExitContinuity
      && state.identity.persistence === 'desktop_independent'
      && isMutableDurableTarget(targetClass),
    );
    return {
      ...base,
      kind: 'recovery',
      canApply: false,
      canRecover,
      canAbandon,
      ...(!canRecover && !canAbandon
        ? { blockedReason: 'Reconnect to the verified runtime that owns this recovery journal.' }
        : !canRecover
          ? { blockedReason: 'The recovery journal belongs to another target. Archive its evidence explicitly before changing this runtime.' }
          : {}),
    };
  }
  const completedHealthPending = journal?.status === 'completed' && journal.healthPending;
  const rollbackRestartPending = journal?.status === 'rolled_back' && journal.restartRequired;
  if (completedHealthPending || rollbackRestartPending) {
    const sameTarget = journal.target.targetFingerprint === state.identity.targetFingerprint
      && state.status?.targetFingerprint === state.identity.targetFingerprint;
    const canRecover = Boolean(
      completedHealthPending
      && state.status?.recoverable
      && sameTarget
      && isMutableDurableTarget(targetClass),
    );
    return {
      ...base,
      kind: 'health_pending',
      canApply: false,
      canRecover,
      ...(!sameTarget ? { blockedReason: 'Reconnect to the runtime that was updated.' } : {}),
    };
  }
  if (targetClass === 'external_local' || targetClass === 'external_remote') {
    return { ...base, kind: 'manual', canApply: false, canRecover: false };
  }
  if (targetClass === 'native_managed' || state.identity.deploymentKind === 'managed_child') {
    return {
      ...base,
      kind: 'runtime_not_durable',
      canApply: false,
      canRecover: false,
      blockedReason: 'The managed child stops with JunQi and cannot own durable collaboration runs.',
    };
  }
  if (targetClass === 'unknown') {
    return {
      ...base,
      kind: 'unsupported',
      canApply: false,
      canRecover: false,
      blockedReason: state.probe?.message || 'This runtime could not be classified safely.',
    };
  }
  if (state.error || state.probe?.ok === false) {
    return {
      ...base,
      kind: 'error',
      canApply: false,
      canRecover: false,
      blockedReason: state.error || state.probe?.message,
    };
  }

  const canApply = Boolean(
    state.probe
    && state.status
    && state.probe.targetFingerprint === state.identity.targetFingerprint
    && state.probe.connectionId === state.identity.connectionId
    && state.status.targetFingerprint === state.identity.targetFingerprint
    && state.probe.mutationAllowed
    && state.identity.desktopMutationAllowed
    && state.identity.desktopExitContinuity
    && state.identity.persistence === 'desktop_independent'
    && isMutableDurableTarget(targetClass),
  );
  const plugin = state.probe?.plugin;
  if (!plugin?.installed) return { ...base, kind: 'install', canApply, canRecover: false };
  if (plugin.version !== state.bundle.pluginVersion) {
    return { ...base, kind: 'update', canApply, canRecover: false };
  }
  if (!plugin.enabled || plugin.status !== 'loaded') {
    return { ...base, kind: 'repair', canApply, canRecover: false };
  }
  if (!state.capabilities) {
    return {
      ...base,
      kind: 'repair',
      canApply,
      canRecover: false,
      blockedReason: 'The loaded plugin did not advertise its collaboration capability contract.',
    };
  }
  const capabilityIssue = collaborationCapabilityIssue(state.capabilities, state.bundle);
  if (capabilityIssue) {
    return {
      ...base,
      kind: 'update',
      canApply,
      canRecover: false,
      blockedReason: capabilityIssue.message,
    };
  }
  return { ...base, kind: 'ready', canApply: false, canRecover: false };
}

export function createHealthConfirmation(
  status: CollaborationBootstrapStatus,
  identity: RuntimeIdentity | null,
  capabilities: CollaborationCapabilities,
  bundle: CollaborationPluginBundleMetadata,
): BootstrapConfirmHealthParams | null {
  const journal = status.journal;
  const features = capabilities.features ?? {};
  const featureEvidence = capabilities.featureEvidence;
  const capabilityContractValid = collaborationCapabilityIssue(capabilities, bundle) === null;
  if (
    !journal
    || journal.status !== 'completed'
    || !journal.healthPending
    || (journal.operation !== 'apply' && journal.operation !== 'recover_resume')
    || !identity?.verified
    || identity.persistence !== 'desktop_independent'
    || !identity.desktopExitContinuity
    || identity.deploymentKind === 'managed_child'
    || identity.targetFingerprint !== journal.target.targetFingerprint
    || status.targetFingerprint !== identity.targetFingerprint
    || identity.connectionId === journal.target.connectionId
    || identity.runtimeId !== capabilities.collaborationInstanceId
    || !identity.methods.includes('junqi.collab.capabilities')
    || journal.package.pluginId !== bundle.pluginId
    || journal.package.pluginVersion !== bundle.pluginVersion
    || journal.package.sha256.toLowerCase() !== bundle.sha256
    || capabilities.pluginVersion !== bundle.pluginVersion
    || capabilities.schemaVersion !== bundle.schemaVersion
    || !capabilityContractValid
    || !featureEvidence
  ) {
    return null;
  }
  return {
    operationId: journal.operationId,
    targetFingerprint: identity.targetFingerprint,
    expectedConnectionId: identity.connectionId,
    collaborationInstanceId: capabilities.collaborationInstanceId,
    pluginVersion: capabilities.pluginVersion,
    schemaVersion: capabilities.schemaVersion,
    durableState: true,
    durableRuntime: true,
    durableRuntimeSupported: true,
    featureEvidenceKind: featureEvidence.kind,
    featureEvidenceBehaviorVerified: featureEvidence.behaviorVerified,
    featureEvidenceRequiredBehaviorGate: featureEvidence.requiredBehaviorGate ?? '',
    featureEvidencePluginServiceStarted: featureEvidence.structuralChecks?.pluginServiceStarted === true,
    featureEvidenceDatabaseIntegrity: typeof featureEvidence.structuralChecks?.databaseIntegrity === 'string'
      ? featureEvidence.structuralChecks.databaseIntegrity
      : '',
    features: Object.fromEntries(
      REQUIRED_COLLABORATION_FEATURES.map((feature) => [feature, true]),
    ),
  };
}

function defaultEventTarget(): SetupEventTarget | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

const EMPTY_AGENT_CONFIGURATION: CollaborationAgentConfigurationDraft = {
  coordinatorAgentId: null,
  allowedAgentIds: [],
  touched: false,
};

function uniqueAgentIds(values: readonly string[], availableIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || !availableIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function reconcileAgentConfiguration(
  capabilities: CollaborationCapabilities | null,
  current: CollaborationAgentConfigurationDraft = EMPTY_AGENT_CONFIGURATION,
): CollaborationAgentConfigurationDraft {
  const available = capabilities?.configuredAgents ?? [];
  const availableIds = new Set(available.map((agent) => agent.id));
  if (availableIds.size === 0) return { ...EMPTY_AGENT_CONFIGURATION };

  const liveCoordinator = capabilities?.coordinatorAgentId;
  const coordinatorAgentId = current.touched && current.coordinatorAgentId && availableIds.has(current.coordinatorAgentId)
    ? current.coordinatorAgentId
    : liveCoordinator && availableIds.has(liveCoordinator)
      ? liveCoordinator
      : available[0]?.id ?? null;
  const requestedAllowed = current.touched
    ? current.allowedAgentIds
    : capabilities?.allowedAgentIds ?? [];
  const allowedAgentIds = uniqueAgentIds(requestedAllowed, availableIds);
  if (coordinatorAgentId && !allowedAgentIds.includes(coordinatorAgentId)) {
    allowedAgentIds.unshift(coordinatorAgentId);
  }
  return { coordinatorAgentId, allowedAgentIds, touched: current.touched };
}

function sameAgentSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((agentId) => right.includes(agentId));
}

export function collaborationConfigurationMatches(
  capabilities: CollaborationCapabilities,
  coordinatorAgentId: string,
  allowedAgentIds: readonly string[],
): boolean {
  if (
    capabilities.configured !== true
    || capabilities.coordinatorAgentId !== coordinatorAgentId
    || !sameAgentSet(capabilities.allowedAgentIds, allowedAgentIds)
  ) {
    return false;
  }
  const agentsById = new Map(capabilities.configuredAgents.map((agent) => [agent.id, agent]));
  return allowedAgentIds.every((agentId) => agentsById.get(agentId)?.allowed === true)
    && agentsById.get(coordinatorAgentId)?.coordinator === true;
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export function createCollaborationSetupStore(
  dependencies: CollaborationSetupDependencies = {
    service: desktopBootstrapService,
    resolveBundle: resolveBundledCollaborationPlugin,
    getRuntimeIdentity: getCurrentRuntimeIdentity,
    subscribeRuntimeIdentity,
    bindRuntimeIdentity: bindCollaborationRuntimeIdentity,
    eventTarget: defaultEventTarget(),
    bundle: COLLABORATION_PLUGIN_BUNDLE,
    reloadCapabilities: () => useCollaborationStore.getState().bootstrap(true),
    wait: defaultWait,
  },
): UseBoundStore<StoreApi<CollaborationSetupState>> {
  let refreshGeneration = 0;
  let lifecycleCleanup: (() => void) | null = null;
  let healthConfirmationKey: string | null = null;

  const loadCapabilities = async (identity: RuntimeIdentity | null): Promise<CollaborationCapabilities | null> => {
    if (!identity?.verified || !identity.methods.includes('junqi.collab.capabilities')) return null;
    const capabilities = await dependencies.reloadCapabilities();
    const liveIdentity = dependencies.getRuntimeIdentity();
    if (
      !liveIdentity?.verified
      || liveIdentity.targetFingerprint !== identity.targetFingerprint
      || liveIdentity.connectionId !== identity.connectionId
    ) {
      throw new Error('The Gateway identity changed while collaboration capabilities were being read');
    }
    const boundIdentity = dependencies.bindRuntimeIdentity(
      capabilities.collaborationInstanceId,
      identity.connectionId,
    );
    if (!boundIdentity || boundIdentity.targetFingerprint !== identity.targetFingerprint) {
      throw new Error('Collaboration capabilities could not be bound to the active Gateway connection');
    }
    return capabilities;
  };

  const store = create<CollaborationSetupState>((set, get) => ({
    open: false,
    requestReason: null,
    identity: dependencies.getRuntimeIdentity(),
    probe: null,
    status: null,
    bundle: dependencies.bundle,
    resolvedBundlePath: null,
    capabilities: null,
    agentConfiguration: { ...EMPTY_AGENT_CONFIGURATION },
    loading: false,
    mutation: null,
    lastResult: null,
    error: null,
    restartAvailable: false,

    start: () => {
      if (lifecycleCleanup) return () => undefined;
      const eventListener: EventListener = (event) => {
        get().requestSetup(parseCollaborationSetupRequest(event));
      };
      dependencies.eventTarget?.addEventListener(COLLABORATION_SETUP_REQUESTED_EVENT, eventListener);
      const unsubscribeIdentity = dependencies.subscribeRuntimeIdentity((identity) => {
        const prior = get().identity;
        const changed = (
          prior?.targetFingerprint !== identity?.targetFingerprint
          || prior?.connectionId !== identity?.connectionId
        );
        set({
          identity,
          ...(changed ? {
            capabilities: null,
            agentConfiguration: { ...EMPTY_AGENT_CONFIGURATION },
          } : {}),
        });
        if (changed) {
          void get().refresh();
        }
      });
      void get().refresh();
      lifecycleCleanup = () => {
        dependencies.eventTarget?.removeEventListener(COLLABORATION_SETUP_REQUESTED_EVENT, eventListener);
        unsubscribeIdentity();
        lifecycleCleanup = null;
      };
      return lifecycleCleanup;
    },

    requestSetup: (reason) => {
      set({ open: true, requestReason: reason?.trim() || null, error: null });
      void get().refresh();
    },

    close: () => {
      if (get().mutation) return;
      set({ open: false, requestReason: null });
    },

    refresh: async (options = {}) => {
      const generation = ++refreshGeneration;
      const identity = dependencies.getRuntimeIdentity();
      set({
        identity,
        loading: true,
        ...(options.clearError ? { error: null } : {}),
      });
      try {
        const [status, probe, resolvedBundle, capabilities] = await Promise.all([
          dependencies.service.status(),
          dependencies.service.probe(
            identity?.verified ? identity.targetFingerprint : undefined,
            identity?.verified ? identity.connectionId : undefined,
          ),
          dependencies.resolveBundle().catch(() => null),
          loadCapabilities(identity).catch(() => null),
        ]);
        if (generation !== refreshGeneration) return;
        const liveIdentity = dependencies.getRuntimeIdentity();
        const probeMatchesRuntime = !liveIdentity?.verified
          || !probe.targetFingerprint
          || (
            probe.targetFingerprint === liveIdentity.targetFingerprint
            && probe.connectionId === liveIdentity.connectionId
          );
        const statusIsCoherent = !status.targetFingerprint
          || status.targetFingerprint === liveIdentity?.targetFingerprint
          || status.targetFingerprint === status.journal?.target.targetFingerprint;
        const runtimeStateMatches = probeMatchesRuntime && statusIsCoherent;
        const acceptedCapabilities = capabilities
          && probeMatchesRuntime
          && liveIdentity?.targetFingerprint === identity?.targetFingerprint
          && liveIdentity?.connectionId === identity?.connectionId
          ? capabilities
          : null;
        set({
          ...(runtimeStateMatches
            ? { status, probe }
            : {
              status: null,
              probe: null,
              capabilities: null,
              agentConfiguration: { ...EMPTY_AGENT_CONFIGURATION },
            }),
          resolvedBundlePath: resolvedBundle?.tgzPath ?? null,
          ...(acceptedCapabilities ? {
            capabilities: acceptedCapabilities,
            agentConfiguration: reconcileAgentConfiguration(
              acceptedCapabilities,
              get().agentConfiguration,
            ),
          } : {}),
          loading: false,
          identity: liveIdentity,
          restartAvailable: Boolean(
            runtimeStateMatches
            &&
            liveIdentity?.verified
            && isMutableDurableTarget(probe.targetClass)
            && status.journal?.operationId
            && status.journal.restartRequired
            && status.journal.target.targetFingerprint === liveIdentity.targetFingerprint,
          ),
        });
      } catch (error) {
        if (generation !== refreshGeneration) return;
        set({ loading: false, error: errorText(error) });
      }
    },

    applyFixedBundle: async () => {
      const before = get();
      const decision = deriveCollaborationSetupView(before);
      if (!decision.canApply || !before.identity) {
        set({ error: decision.blockedReason || 'This runtime is not eligible for Desktop installation.' });
        return;
      }
      const fingerprint = before.identity.targetFingerprint;
      set({ mutation: 'apply', error: null, lastResult: null });
      try {
        const resolved = await dependencies.resolveBundle();
        if (
          resolved.pluginVersion !== before.bundle.pluginVersion
          || resolved.schemaVersion !== before.bundle.schemaVersion
          || resolved.sha256 !== before.bundle.sha256
          || resolved.resourcePath !== before.bundle.resourcePath
        ) {
          throw new Error('The resolved collaboration resource does not match generated bundle metadata');
        }
        const liveIdentity = dependencies.getRuntimeIdentity();
        if (!liveIdentity?.verified || liveIdentity.targetFingerprint !== fingerprint) {
          throw new Error('The active Gateway target changed before installation');
        }
        const result = await dependencies.service.apply({
          targetFingerprint: fingerprint,
          expectedConnectionId: liveIdentity.connectionId,
        });
        if (result.targetFingerprint && result.targetFingerprint !== fingerprint) {
          throw new Error('The bootstrap result belongs to a different Gateway target');
        }
        set({ lastResult: result, error: result.ok ? null : result.message });
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ mutation: null });
        await get().refresh();
      }
    },

    selectCoordinatorAgent: (agentId) => {
      const capabilities = get().capabilities;
      const id = agentId.trim();
      if (!capabilities?.configuredAgents.some((agent) => agent.id === id)) return;
      const current = get().agentConfiguration;
      set({
        agentConfiguration: {
          coordinatorAgentId: id,
          allowedAgentIds: current.allowedAgentIds.includes(id)
            ? current.allowedAgentIds
            : [id, ...current.allowedAgentIds],
          touched: true,
        },
        error: null,
      });
    },

    setAgentAllowed: (agentId, allowed) => {
      const id = agentId.trim();
      const capabilities = get().capabilities;
      const current = get().agentConfiguration;
      if (!capabilities?.configuredAgents.some((agent) => agent.id === id)) return;
      if (!allowed && current.coordinatorAgentId === id) {
        set({ error: 'The coordinator must remain in the explicit allowed-agent set.' });
        return;
      }
      const next = allowed
        ? [...new Set([...current.allowedAgentIds, id])]
        : current.allowedAgentIds.filter((candidate) => candidate !== id);
      set({
        agentConfiguration: { ...current, allowedAgentIds: next, touched: true },
        error: null,
      });
    },

    configureAgents: async () => {
      const before = get();
      const identity = before.identity;
      const decision = deriveCollaborationSetupView(before);
      const draft = reconcileAgentConfiguration(before.capabilities, before.agentConfiguration);
      const configuredIds = new Set(before.capabilities?.configuredAgents.map((agent) => agent.id) ?? []);
      const maintenance = before.capabilities?.maintenance;
      if (
        !identity?.verified
        || decision.kind !== 'ready'
        || !isMutableDurableTarget(decision.targetClass)
        || !identity.desktopMutationAllowed
        || !draft.coordinatorAgentId
        || draft.allowedAgentIds.length === 0
        || !draft.allowedAgentIds.includes(draft.coordinatorAgentId)
        || draft.allowedAgentIds.some((agentId) => !configuredIds.has(agentId))
        || !maintenance
        || maintenance.active
        || (maintenance.activeRuns?.length ?? 0) > 0
      ) {
        set({
          error: maintenance && (maintenance.active || (maintenance.activeRuns?.length ?? 0) > 0)
            ? 'Finish active collaboration runs and maintenance before changing the Agent policy.'
            : 'Choose a coordinator and an explicit allowed set on a verified, mutable Gateway.',
        });
        return;
      }
      const targetFingerprint = identity.targetFingerprint;
      const expectedConnectionId = identity.connectionId;
      const coordinatorAgentId = draft.coordinatorAgentId;
      const allowedAgentIds = [...draft.allowedAgentIds];
      set({ mutation: 'configure', error: null, lastResult: null, agentConfiguration: draft });
      try {
        const liveIdentity = dependencies.getRuntimeIdentity();
        if (
          !liveIdentity?.verified
          || liveIdentity.targetFingerprint !== targetFingerprint
          || liveIdentity.connectionId !== expectedConnectionId
        ) {
          throw new Error('The active Gateway target changed before Agent configuration');
        }
        const result = await dependencies.service.configure({
          targetFingerprint,
          expectedConnectionId,
          coordinatorAgentId,
          allowedAgentIds,
        });
        if (
          result.targetFingerprint !== targetFingerprint
          || result.connectionId !== expectedConnectionId
        ) {
          throw new Error('The configuration result belongs to a different Gateway connection');
        }
        set({ lastResult: result, error: result.ok ? null : result.message });
        if (!result.ok) return;
        if (
          result.coordinatorAgentId !== coordinatorAgentId
          || !sameAgentSet(result.allowedAgentIds, allowedAgentIds)
        ) {
          throw new Error('OpenClaw did not persist the requested collaboration Agent policy');
        }

        let confirmed: CollaborationCapabilities | null = null;
        for (let attempt = 0; attempt < 7; attempt += 1) {
          await dependencies.wait(attempt === 0 ? 350 : 700);
          const currentIdentity = dependencies.getRuntimeIdentity();
          if (currentIdentity && currentIdentity.targetFingerprint !== targetFingerprint) {
            throw new Error('The active Gateway target changed while Agent configuration was reloading');
          }
          try {
            const capabilities = await loadCapabilities(currentIdentity);
            if (
              capabilities
              && collaborationConfigurationMatches(capabilities, coordinatorAgentId, allowedAgentIds)
            ) {
              confirmed = capabilities;
              break;
            }
          } catch {
            // Plugin reload may briefly remove the RPC surface; retry against the same target.
          }
        }
        if (!confirmed) {
          set({
            error: result.reloadExpected
              ? 'The policy was saved, but the live plugin has not confirmed it yet. Refresh after OpenClaw finishes reloading.'
              : 'The policy was saved, but config reload is disabled. Restart this Gateway, reconnect, and refresh.',
          });
          return;
        }
        set({
          capabilities: confirmed,
          agentConfiguration: reconcileAgentConfiguration(confirmed),
          error: null,
        });
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ mutation: null });
        await get().refresh();
      }
    },

    recover: async (strategy) => {
      const before = get();
      const decision = deriveCollaborationSetupView(before);
      if (!decision.canRecover || !before.identity) {
        set({ error: decision.blockedReason || 'This recovery journal does not belong to the active runtime.' });
        return;
      }
      const fingerprint = before.identity.targetFingerprint;
      set({
        mutation: strategy === 'resume' ? 'recover_resume' : 'recover_rollback',
        error: null,
        lastResult: null,
      });
      try {
        const liveIdentity = dependencies.getRuntimeIdentity();
        if (
          !liveIdentity?.verified
          || liveIdentity.targetFingerprint !== fingerprint
          || liveIdentity.connectionId !== before.identity.connectionId
        ) {
          throw new Error('The active Gateway target or connection changed before recovery');
        }
        const result = await dependencies.service.recover({
          targetFingerprint: fingerprint,
          expectedConnectionId: liveIdentity.connectionId,
          strategy,
        });
        if (result.targetFingerprint && result.targetFingerprint !== fingerprint) {
          throw new Error('The recovery result belongs to a different Gateway target');
        }
        set({ lastResult: result, error: result.ok ? null : result.message });
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ mutation: null });
        await get().refresh();
      }
    },

    abandonOrphan: async () => {
      const before = get();
      const identity = before.identity;
      const journal = before.status?.journal;
      const decision = deriveCollaborationSetupView(before);
      if (
        !identity?.verified
        || !journal
        || decision.kind !== 'recovery'
        || !decision.canAbandon
      ) {
        set({ error: decision.blockedReason || 'There is no orphaned recovery journal for this target.' });
        return;
      }
      set({ mutation: 'abandon', error: null, lastResult: null });
      try {
        const result = await dependencies.service.abandon({
          operationId: journal.operationId,
          orphanTargetFingerprint: journal.target.targetFingerprint,
          currentTargetFingerprint: identity.targetFingerprint,
          expectedConnectionId: identity.connectionId,
        });
        if (
          result.operationId !== journal.operationId
          || result.orphanTargetFingerprint !== journal.target.targetFingerprint
          || result.currentTargetFingerprint !== identity.targetFingerprint
        ) {
          throw new Error('The abandon result belongs to another bootstrap operation or target');
        }
        if (result.ok && (!result.evidenceRetained || !result.applyUnblocked)) {
          throw new Error('The orphaned bootstrap evidence was not durably archived');
        }
        set({ lastResult: result, error: result.ok ? null : result.message });
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ mutation: null });
        await get().refresh();
      }
    },

    requestRestart: async () => {
      const before = get();
      const identity = before.identity;
      const decision = deriveCollaborationSetupView(before);
      const journal = before.status?.journal;
      if (
        !identity?.verified
        || !journal
        || decision.kind !== 'health_pending'
        || !before.restartAvailable
        || journal.target.targetFingerprint !== identity.targetFingerprint
      ) return;
      set({ mutation: 'restart', error: null });
      let restartIssued = false;
      try {
        const result = await dependencies.service.restart({
          operationId: journal.operationId,
          targetFingerprint: identity.targetFingerprint,
          expectedConnectionId: identity.connectionId,
        });
        if (
          result.operationId !== journal.operationId
          || result.targetFingerprint !== identity.targetFingerprint
          || result.previousConnectionId !== identity.connectionId
        ) {
          throw new Error('The restart result belongs to a different bootstrap operation or Gateway connection');
        }
        restartIssued = result.restartRequested;
        set({
          lastResult: result,
          error: result.ok ? null : result.message,
          ...(restartIssued ? { restartAvailable: false } : {}),
        });
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ mutation: null });
        if (!restartIssued) await get().refresh();
      }
    },

    observeCapabilities: async (capabilities) => {
      if (!capabilities) {
        set({ capabilities: null, agentConfiguration: { ...EMPTY_AGENT_CONFIGURATION } });
        return;
      }
      const observedIdentity = dependencies.getRuntimeIdentity();
      const identity = observedIdentity?.connectionId
        ? dependencies.bindRuntimeIdentity(
          capabilities.collaborationInstanceId,
          observedIdentity.connectionId,
        )
        : null;
      if (!identity || identity.targetFingerprint !== observedIdentity?.targetFingerprint) {
        set({ capabilities: null, agentConfiguration: { ...EMPTY_AGENT_CONFIGURATION } });
        return;
      }
      set({
        identity,
        capabilities,
        agentConfiguration: reconcileAgentConfiguration(capabilities, get().agentConfiguration),
      });
      if (get().mutation) return;
      let status: CollaborationBootstrapStatus;
      try {
        status = await dependencies.service.status();
      } catch {
        return;
      }
      const confirmation = createHealthConfirmation(status, identity, capabilities, dependencies.bundle);
      set({ status, identity });
      if (!confirmation) return;
      const key = [
        confirmation.operationId,
        confirmation.targetFingerprint,
        confirmation.collaborationInstanceId,
        identity?.connectionId,
      ].join(':');
      if (healthConfirmationKey === key) return;
      healthConfirmationKey = key;
      set({ mutation: 'confirm_health', error: null });
      try {
        const result = await dependencies.service.confirmHealth(confirmation);
        set({ lastResult: result, error: result.ok ? null : result.message });
        if (!result.ok) healthConfirmationKey = null;
      } catch (error) {
        healthConfirmationKey = null;
        set({ error: errorText(error) });
      } finally {
        set({ mutation: null });
        await get().refresh();
      }
    },
  }));

  return store;
}

export const useCollaborationSetupStore = createCollaborationSetupStore();

// Compile-time guard: the concrete service must continue to satisfy the setup contract.
const _bootstrapTransportCompatibility: DesktopBootstrapTransport | null = null;
void _bootstrapTransportCompatibility;
