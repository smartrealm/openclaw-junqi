import { invoke } from '@tauri-apps/api/core';

export interface GatewayRescueTarget {
  providerId: string;
  modelId: string;
  modelRef: string;
  source: 'primary' | 'configured';
}

export interface GatewayRescueMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GatewayRescueContext {
  error: string;
  logs?: string;
}

export function gatewayRescueTargetKey(target: GatewayRescueTarget): string {
  return target.modelRef;
}

export async function loadGatewayRescueTargets(): Promise<GatewayRescueTarget[]> {
  return invoke<GatewayRescueTarget[]>('list_gateway_rescue_targets');
}

export async function sendGatewayRescueMessage(
  target: GatewayRescueTarget,
  messages: GatewayRescueMessage[],
  context: GatewayRescueContext,
): Promise<string> {
  const response = await invoke<{ text: string }>('gateway_rescue_chat', {
    req: {
      modelRef: target.modelRef,
      messages,
      context,
    },
  });
  return response.text;
}
