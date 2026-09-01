import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  export interface SessionTranscriptAssistantMirrorAppendParams {
    agentId: string;
    sessionKey: string;
    sessionId?: string;
    config?: OpenClawConfig;
    deliveryMirror?: {
      kind: "channel-final";
      sourceMessageId?: string;
    };
    idempotencyKey?: string;
    mediaUrls?: string[];
    text?: string;
    updateMode?: "inline" | "none";
  }

  export type SessionTranscriptMirrorAppendResult =
    | { ok: true; messageId: string }
    | { ok: false; code?: string; reason: string };

  export function appendAssistantMirrorMessageByIdentity(
    params: SessionTranscriptAssistantMirrorAppendParams,
  ): Promise<SessionTranscriptMirrorAppendResult>;
}
