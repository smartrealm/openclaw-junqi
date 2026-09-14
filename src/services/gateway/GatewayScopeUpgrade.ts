export type GatewayScopeUpgradeOutcome =
  | { status: 'approved'; requestId: string; scopes: string[] }
  | { status: 'rejected' | 'expired'; requestId: string };

export interface GatewayScopeUpgradeOperation {
  requestId: string;
  completion: Promise<GatewayScopeUpgradeOutcome>;
}

export class GatewayScopeUpgradeCancelledError extends Error {
  constructor() {
    super('Gateway scope upgrade was cancelled');
    this.name = 'GatewayScopeUpgradeCancelledError';
  }
}

interface GatewayScopeUpgradeConnectionSnapshot {
  connectionId: string;
  scopes: string[];
}

interface GatewayScopeUpgradeDependencies {
  captureConnection(): GatewayScopeUpgradeConnectionSnapshot | null;
  requestFenced(
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
    options?: { timeoutMs?: number | null; signal?: AbortSignal },
  ): Promise<unknown>;
  applyRotatedDeviceCredential(
    token: string,
    scopes: readonly string[],
    connectionId: string,
  ): Promise<void>;
}

interface ActiveScopeUpgrade {
  controller: AbortController;
  registration: Promise<GatewayScopeUpgradeOperation>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRequestId(value: unknown): string {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const requestId = nonEmptyString(record?.requestId);
  if (!requestId) throw new Error('Gateway 返回了无效的权限升级请求标识');
  return requestId;
}

function readOutcome(
  value: unknown,
  requestId: string,
  requiredScopes: readonly string[],
): GatewayScopeUpgradeOutcome & { deviceToken?: string } {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (nonEmptyString(record?.requestId) !== requestId) {
    throw new Error('Gateway 权限升级终态的请求标识不匹配');
  }
  if (record?.status === 'rejected' || record?.status === 'expired') {
    return { status: record.status, requestId };
  }
  const deviceToken = record?.status === 'approved' ? nonEmptyString(record.deviceToken) : null;
  const scopes = record?.status === 'approved' && Array.isArray(record.scopes)
    ? record.scopes.map(nonEmptyString)
    : [];
  if (!deviceToken || scopes.length === 0 || scopes.some((scope) => scope === null)) {
    throw new Error('Gateway 返回了无效的权限升级凭据');
  }
  const approvedScopes = scopes as string[];
  if (!requiredScopes.every((scope) => approvedScopes.includes(scope) || approvedScopes.includes('operator.admin'))) {
    throw new Error('Gateway 权限升级终态未授予请求的权限');
  }
  return { status: 'approved', requestId, deviceToken, scopes: approvedScopes };
}

/** 执行一次绑定当前已核验设备身份的官方权限升级。 */
export class GatewayScopeUpgradeCoordinator {
  private active: ActiveScopeUpgrade | null = null;

  constructor(private readonly dependencies: GatewayScopeUpgradeDependencies) {}

  begin(requiredScopes: readonly string[]): Promise<GatewayScopeUpgradeOperation> {
    if (this.active) return this.active.registration;
    const normalizedRequiredScopes = [...new Set(requiredScopes.map((scope) => scope.trim()).filter(Boolean))];
    if (normalizedRequiredScopes.length === 0) {
      return Promise.reject(new Error('权限升级至少需要一个目标权限'));
    }
    const controller = new AbortController();
    const active = { controller } as ActiveScopeUpgrade;
    active.registration = this.register(active, normalizedRequiredScopes);
    this.active = active;
    return active.registration;
  }

  cancel(): void {
    const active = this.active;
    this.active = null;
    active?.controller.abort();
  }

  private async register(
    active: ActiveScopeUpgrade,
    requiredScopes: readonly string[],
  ): Promise<GatewayScopeUpgradeOperation> {
    const snapshot = this.dependencies.captureConnection();
    if (!snapshot?.connectionId) {
      if (this.active === active) this.active = null;
      throw new Error('权限升级需要当前已核验的 Gateway 连接');
    }
    const scopes = [...new Set([...requiredScopes, ...snapshot.scopes])];
    let registration: unknown;
    try {
      registration = await this.dependencies.requestFenced(
        'device.scopes.requestUpgrade',
        { scopes },
        snapshot.connectionId,
        { signal: active.controller.signal },
      );
    } catch (error) {
      if (this.active === active) this.active = null;
      if (active.controller.signal.aborted) throw new GatewayScopeUpgradeCancelledError();
      throw error;
    }
    let requestId: string;
    try {
      requestId = readRequestId(registration);
    } catch (error) {
      if (this.active === active) this.active = null;
      throw error;
    }
    const completion = this.waitForCompletion(
      active,
      snapshot.connectionId,
      requestId,
      requiredScopes,
    );
    return { requestId, completion };
  }

  private async waitForCompletion(
    active: ActiveScopeUpgrade,
    connectionId: string,
    requestId: string,
    requiredScopes: readonly string[],
  ): Promise<GatewayScopeUpgradeOutcome> {
    try {
      const value = await this.dependencies.requestFenced(
        'device.scopes.waitUpgrade',
        { requestId },
        connectionId,
        { timeoutMs: null, signal: active.controller.signal },
      );
      const outcome = readOutcome(value, requestId, requiredScopes);
      if (outcome.status !== 'approved') return outcome;
      await this.dependencies.applyRotatedDeviceCredential(
        outcome.deviceToken!,
        outcome.scopes,
        connectionId,
      );
      return { status: 'approved', requestId, scopes: outcome.scopes };
    } catch (error) {
      if (active.controller.signal.aborted) throw new GatewayScopeUpgradeCancelledError();
      throw error;
    } finally {
      if (this.active === active) this.active = null;
    }
  }
}
