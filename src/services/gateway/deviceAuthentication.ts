import { buildDeviceAuthPayload, loadOrCreateDeviceIdentity, signDevicePayload } from '@/api/device-identity';

export async function signGatewayDeviceChallenge(params: { nonce: string; clientId: string; clientMode: string; role: string; scopes: string[]; token: string }) {
  const identity = await loadOrCreateDeviceIdentity();
  const signedAt = Date.now();
  const signature = await signDevicePayload(identity.privateKey, buildDeviceAuthPayload({
    deviceId: identity.deviceId, clientId: params.clientId, clientMode: params.clientMode, role: params.role,
    scopes: params.scopes, signedAtMs: signedAt, token: params.token, nonce: params.nonce,
  }));
  return { deviceId: identity.deviceId, publicKey: identity.publicKey, signature, signedAt, nonce: params.nonce };
}
