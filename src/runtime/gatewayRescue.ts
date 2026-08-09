import {
  gatewayRescueChat,
  listGatewayRescueTargets,
  type GatewayRescueContext,
  type GatewayRescueChatRequest,
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

export function createGatewayRescueChatRequest(
  target: GatewayRescueTarget,
  messages: GatewayRescueMessage[],
  context: GatewayRescueContext,
): GatewayRescueChatRequest {
  return {
    modelRef: target.modelRef,
    messages,
    context,
  };
}

export async function sendGatewayRescueMessage(
  target: GatewayRescueTarget,
  messages: GatewayRescueMessage[],
  context: GatewayRescueContext,
): Promise<string> {
  const response = await gatewayRescueChat(
    createGatewayRescueChatRequest(target, messages, context),
  );
  return response.text;
}
