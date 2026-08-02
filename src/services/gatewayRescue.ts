import {
  gatewayRescueChat,
  listGatewayRescueTargets,
  type GatewayRescueContext,
  type GatewayRescueMessage,
  type GatewayRescueTarget,
} from '@/api/tauri-commands';

export type { GatewayRescueContext, GatewayRescueMessage, GatewayRescueTarget };

export function gatewayRescueTargetKey(target: GatewayRescueTarget): string {
  return target.modelRef;
}

export async function loadGatewayRescueTargets(): Promise<GatewayRescueTarget[]> {
  return listGatewayRescueTargets();
}

export async function sendGatewayRescueMessage(
  target: GatewayRescueTarget,
  messages: GatewayRescueMessage[],
  context: GatewayRescueContext,
): Promise<string> {
  const response = await gatewayRescueChat({
    modelRef: target.modelRef,
    messages,
    context,
  });
  return response.text;
}
