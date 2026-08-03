import {
  signGatewayDeviceChallenge as signGatewayDeviceChallengeCommand,
  type GatewayDeviceChallengeParams,
} from '@/api/tauri-commands';

export type GatewayDeviceChallenge = GatewayDeviceChallengeParams;

export async function signGatewayDeviceChallenge(params: GatewayDeviceChallenge) {
  return signGatewayDeviceChallengeCommand(params);
}
