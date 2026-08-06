import {
  getGatewayDeviceIdentityReference as getGatewayDeviceIdentityReferenceCommand,
  signGatewayDeviceChallenge as signGatewayDeviceChallengeCommand,
  type GatewayDeviceIdentityReference,
  type GatewayDeviceChallengeParams,
} from '@/api/tauri-commands';

export type GatewayDeviceChallenge = GatewayDeviceChallengeParams;

let identityReferenceInFlight: Promise<GatewayDeviceIdentityReference> | null = null;

/**
 * 在渲染进程内合并同一时刻的设备身份查询。
 *
 * 首次 Gateway 连接会同时经过凭据解析和挑战签名两条链路。身份私钥
 * 仍由 Rust 端的系统凭据库和进程缓存持有，这里只避免重复发起相同的
 * 身份引用 IPC；失败时清除单飞状态，让用户主动重试可以重新访问凭据库。
 */
export function getGatewayDeviceIdentityReference(): Promise<GatewayDeviceIdentityReference> {
  if (!identityReferenceInFlight) {
    identityReferenceInFlight = getGatewayDeviceIdentityReferenceCommand().catch((error) => {
      identityReferenceInFlight = null;
      throw error;
    });
  }
  return identityReferenceInFlight;
}

/** 仅供测试隔离进程内的单飞状态，不改变生产生命周期。 */
export function resetGatewayDeviceIdentityReferenceForTests(): void {
  identityReferenceInFlight = null;
}

export async function signGatewayDeviceChallenge(params: GatewayDeviceChallenge) {
  return signGatewayDeviceChallengeCommand(params);
}
