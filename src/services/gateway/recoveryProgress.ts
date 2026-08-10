// Gateway 生命周期协调器与进度展示共享的稳定类型。

export type GatewayRecoveryStatus = 'running' | 'completed' | 'failed';

export interface GatewayRecoveryProgress {
  step: 'gateway';
  message: string;
  progress: number;
  key: string;
  status: GatewayRecoveryStatus;
  params?: Record<string, unknown>;
}
