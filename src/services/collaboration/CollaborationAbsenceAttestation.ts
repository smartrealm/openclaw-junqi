import type {
  BootstrapTargetClass,
  CollaborationBootstrapProbe,
} from '@/types/collaborationBootstrap';
import type { RuntimeDeploymentKind, RuntimeIdentity } from '@/types/gatewayRuntime';
import { getCurrentRuntimeIdentity } from '@/services/gateway/runtimeIdentity';
import { desktopBootstrapService } from './DesktopBootstrapService';

type AttestableTargetClass = Extract<
  BootstrapTargetClass,
  'native_managed' | 'system_service' | 'docker'
>;

export type CollaborationAbsenceRejectionCode =
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_NOT_ATTESTED'
  | 'IDENTITY_CHANGED'
  | 'TARGET_UNSUPPORTED'
  | 'PROBE_FAILED'
  | 'PROBE_IDENTITY_MISMATCH'
  | 'PROBE_NOT_AUTHORITATIVE'
  | 'PLUGIN_NOT_PROVEN_MISSING'
  | 'DURABLE_STATE_NOT_ABSENT';

export interface CollaborationAbsenceObservation {
  before: RuntimeIdentity;
  after: RuntimeIdentity | null;
  probe: CollaborationBootstrapProbe;
}

export interface CollaborationAbsenceDecision {
  satisfied: boolean;
  code: CollaborationAbsenceRejectionCode | null;
  reason: string | null;
}

export interface CollaborationAbsenceProof {
  readonly targetFingerprint: string;
  readonly connectionId: string;
  readonly targetClass: AttestableTargetClass;
  readonly deploymentKind: RuntimeDeploymentKind;
  readonly ownership: RuntimeIdentity['ownership'];
  readonly gatewayVersion: string;
  readonly localStateDir: string;
  readonly localConfigPath: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  assertCurrent(identity?: RuntimeIdentity | null): void;
}

const TARGET_CLASS_BY_DEPLOYMENT: Partial<
  Record<RuntimeDeploymentKind, AttestableTargetClass>
> = {
  managed_child: 'native_managed',
  system_service: 'system_service',
  docker: 'docker',
};

function rejected(
  code: CollaborationAbsenceRejectionCode,
  reason: string,
): CollaborationAbsenceDecision {
  return { satisfied: false, code, reason };
}

function optionalFieldIsEmpty(value: unknown): boolean {
  return value === undefined || value === null;
}

function pluginSnapshotProvesMissing(probe: CollaborationBootstrapProbe): boolean {
  const plugin = probe.plugin;
  if (!plugin || typeof plugin !== 'object') return false;
  return plugin.installed === false
    && plugin.enabled === false
    && optionalFieldIsEmpty(plugin.status)
    && optionalFieldIsEmpty(plugin.version)
    && optionalFieldIsEmpty(plugin.source)
    && optionalFieldIsEmpty(plugin.rootDir)
    && optionalFieldIsEmpty(plugin.installRecord);
}

function identityIsAttested(identity: RuntimeIdentity): boolean {
  if (!identity || typeof identity !== 'object') return false;
  const candidate = identity as unknown as Record<string, unknown>;
  const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
  return candidate.verified === true
    && candidate.desktopMutationAllowed === true
    && candidate.ownership === 'junqi_managed'
    && candidate.endpointAttestation === 'matched'
    && candidate.pathAttestation === 'matched'
    && nonEmpty(candidate.targetFingerprint)
    && nonEmpty(candidate.connectionId)
    && nonEmpty(candidate.localStateDir)
    && nonEmpty(candidate.localConfigPath);
}

function deploymentContractIsAttested(identity: RuntimeIdentity): boolean {
  if (identity.deploymentKind === 'managed_child') {
    return identity.persistence === 'desktop_bound' && identity.desktopExitContinuity === false;
  }
  if (identity.deploymentKind === 'system_service' || identity.deploymentKind === 'docker') {
    return identity.persistence === 'desktop_independent' && identity.desktopExitContinuity === true;
  }
  return false;
}

/**
 * The only accepted proof that a missing collaboration RPC has no durable
 * authority behind it. Every ambiguous observation is rejected.
 */
export class CollaborationAbsenceSpecification {
  evaluate(observation: CollaborationAbsenceObservation): CollaborationAbsenceDecision {
    const { before, after, probe } = observation;
    if (!identityIsAttested(before)) {
      return rejected('IDENTITY_NOT_ATTESTED', 'The active Gateway identity is not attested for local inspection');
    }
    if (!after) {
      return rejected('IDENTITY_CHANGED', 'The Gateway connection ended while collaboration absence was inspected');
    }
    if (
      !identityIsAttested(after)
      || after.targetFingerprint !== before.targetFingerprint
      || after.connectionId !== before.connectionId
      || after.deploymentKind !== before.deploymentKind
      || after.ownership !== before.ownership
      || after.localStateDir !== before.localStateDir
      || after.localConfigPath !== before.localConfigPath
    ) {
      return rejected('IDENTITY_CHANGED', 'The attested Gateway identity changed while collaboration absence was inspected');
    }

    const targetClass = TARGET_CLASS_BY_DEPLOYMENT[before.deploymentKind];
    if (!targetClass || !deploymentContractIsAttested(before)) {
      return rejected('TARGET_UNSUPPORTED', 'External and unknown Gateway targets cannot prove local collaboration absence');
    }
    if (
      probe.targetFingerprint !== before.targetFingerprint
      || probe.connectionId !== before.connectionId
      || probe.targetClass !== targetClass
      || probe.deploymentKind !== before.deploymentKind
      || probe.ownership !== before.ownership
      || probe.gatewayVersion !== before.gatewayVersion
      || probe.stateDir !== before.localStateDir
      || probe.configPath !== before.localConfigPath
    ) {
      return rejected('PROBE_IDENTITY_MISMATCH', 'The collaboration probe does not belong to the exact attested Gateway connection');
    }
    const expectedDurability = targetClass !== 'native_managed';
    if (
      probe.ok !== true
      || probe.code !== 'PLUGIN_MISSING'
      || probe.durableRuntime !== expectedDurability
      || probe.mutationAllowed !== true
      || probe.manualInstallRequired !== false
      || probe.manualInstallInstructions !== null
      || probe.busy !== false
      || probe.recoveryRequired !== false
      || !Array.isArray(probe.warnings)
      || probe.warnings.length !== 0
    ) {
      return rejected('PROBE_NOT_AUTHORITATIVE', 'The collaboration probe is busy, ambiguous, warned, or otherwise non-authoritative');
    }
    if (!pluginSnapshotProvesMissing(probe)) {
      return rejected('PLUGIN_NOT_PROVEN_MISSING', 'The collaboration plugin snapshot does not prove complete absence');
    }
    if (probe.durableCollaborationState !== 'absent') {
      return rejected('DURABLE_STATE_NOT_ABSENT', 'Durable collaboration state is present, corrupt, or could not be inspected');
    }
    return { satisfied: true, code: null, reason: null };
  }
}

export class CollaborationAbsenceAttestationError extends Error {
  constructor(
    public readonly code: CollaborationAbsenceRejectionCode,
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'CollaborationAbsenceAttestationError';
  }
}

/** Immutable evidence token issued only after the complete specification passes. */
export class CollaborationAbsenceAttestation implements CollaborationAbsenceProof {
  static readonly TTL_MS = 30_000;

  private constructor(
    public readonly targetFingerprint: string,
    public readonly connectionId: string,
    public readonly targetClass: AttestableTargetClass,
    public readonly deploymentKind: RuntimeDeploymentKind,
    public readonly ownership: RuntimeIdentity['ownership'],
    public readonly gatewayVersion: string,
    public readonly localStateDir: string,
    public readonly localConfigPath: string,
    public readonly issuedAtMs: number,
    public readonly expiresAtMs: number,
  ) {
    Object.freeze(this);
  }

  assertCurrent(identity: RuntimeIdentity | null = getCurrentRuntimeIdentity()): void {
    if (
      Date.now() > this.expiresAtMs
      || !identityIsAttested(identity as RuntimeIdentity)
      || identity?.targetFingerprint !== this.targetFingerprint
      || identity.connectionId !== this.connectionId
      || identity.deploymentKind !== this.deploymentKind
      || identity.ownership !== this.ownership
      || identity.gatewayVersion !== this.gatewayVersion
      || identity.localStateDir !== this.localStateDir
      || identity.localConfigPath !== this.localConfigPath
    ) {
      throw new CollaborationAbsenceAttestationError(
        'IDENTITY_CHANGED',
        'The attested Gateway identity is no longer current',
      );
    }
  }

  static from(observation: CollaborationAbsenceObservation): CollaborationAbsenceAttestation {
    const decision = new CollaborationAbsenceSpecification().evaluate(observation);
    if (!decision.satisfied) {
      throw new CollaborationAbsenceAttestationError(
        decision.code ?? 'PROBE_NOT_AUTHORITATIVE',
        decision.reason ?? 'Collaboration absence could not be proven',
      );
    }
    const issuedAtMs = Date.now();
    return new CollaborationAbsenceAttestation(
      observation.before.targetFingerprint,
      observation.before.connectionId,
      TARGET_CLASS_BY_DEPLOYMENT[observation.before.deploymentKind]!,
      observation.before.deploymentKind,
      observation.before.ownership,
      observation.before.gatewayVersion,
      observation.before.localStateDir,
      observation.before.localConfigPath,
      issuedAtMs,
      issuedAtMs + CollaborationAbsenceAttestation.TTL_MS,
    );
  }
}

export interface CollaborationAbsenceAttestorDependencies {
  getRuntimeIdentity(): RuntimeIdentity | null;
  probe(targetFingerprint: string, expectedConnectionId: string): Promise<CollaborationBootstrapProbe>;
}

const defaultDependencies: CollaborationAbsenceAttestorDependencies = {
  getRuntimeIdentity: getCurrentRuntimeIdentity,
  probe: (targetFingerprint, expectedConnectionId) => (
    desktopBootstrapService.probe(targetFingerprint, expectedConnectionId)
  ),
};

export class CollaborationAbsenceAttestor {
  constructor(
    private readonly dependencies: CollaborationAbsenceAttestorDependencies = defaultDependencies,
  ) {}

  async attest(): Promise<CollaborationAbsenceAttestation> {
    const before = this.dependencies.getRuntimeIdentity();
    if (!before) {
      throw new CollaborationAbsenceAttestationError(
        'IDENTITY_UNAVAILABLE',
        'The active Gateway identity is unavailable; collaboration absence cannot be proven',
      );
    }
    if (!identityIsAttested(before)) {
      throw new CollaborationAbsenceAttestationError(
        'IDENTITY_NOT_ATTESTED',
        'The active Gateway identity is not attested for local collaboration-state inspection',
      );
    }

    let probe: CollaborationBootstrapProbe;
    try {
      probe = await this.dependencies.probe(before.targetFingerprint, before.connectionId);
    } catch (error) {
      throw new CollaborationAbsenceAttestationError(
        'PROBE_FAILED',
        'The local collaboration-state probe failed',
        error,
      );
    }
    return CollaborationAbsenceAttestation.from({
      before,
      after: this.dependencies.getRuntimeIdentity(),
      probe,
    });
  }

  /** Re-run the complete absence specification immediately before a mutation. */
  async assertCurrent(proof: CollaborationAbsenceProof): Promise<void> {
    proof.assertCurrent(this.dependencies.getRuntimeIdentity());
    const before = this.dependencies.getRuntimeIdentity();
    if (!before) {
      throw new CollaborationAbsenceAttestationError(
        'IDENTITY_UNAVAILABLE',
        'The active Gateway identity is unavailable; collaboration absence cannot be revalidated',
      );
    }
    let probe: CollaborationBootstrapProbe;
    try {
      probe = await this.dependencies.probe(proof.targetFingerprint, proof.connectionId);
    } catch (error) {
      throw new CollaborationAbsenceAttestationError(
        'PROBE_FAILED',
        'The local collaboration-state probe failed during mutation fencing',
        error,
      );
    }
    const after = this.dependencies.getRuntimeIdentity();
    const decision = new CollaborationAbsenceSpecification().evaluate({ before, after, probe });
    if (!decision.satisfied) {
      throw new CollaborationAbsenceAttestationError(
        decision.code ?? 'PROBE_NOT_AUTHORITATIVE',
        decision.reason ?? 'Collaboration absence is no longer proven',
      );
    }
  }
}

export const collaborationAbsenceAttestor = new CollaborationAbsenceAttestor();
