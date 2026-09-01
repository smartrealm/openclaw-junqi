declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

  export type SessionTranscriptEvent = unknown;

  export interface SessionTranscriptReadParams {
    agentId?: string;
    sessionId: string;
    sessionKey: string;
  }

  export interface SessionTranscriptAssistantMirrorAppendParams {
    agentId?: string;
    config?: OpenClawConfig;
    deliveryMirror?:
      | {
          kind: "channel-final";
          sourceMessageId?: string;
        }
      | {
          kind: "channel-final-suppressed";
          reason: "stale-foreground";
          sourceMessageId?: string;
        };
    idempotencyKey?: string;
    mediaUrls?: string[];
    sessionId: string;
    sessionKey: string;
    text?: string;
    updateMode?: "inline" | "file-only" | "none";
  }

  export type SessionTranscriptMirrorAppendResult =
    | { ok: true; messageId: string }
    | { ok: false; code?: "blocked" | "session-rebound"; reason: string };

  export function appendAssistantMirrorMessageByIdentity(
    params: SessionTranscriptAssistantMirrorAppendParams,
  ): Promise<SessionTranscriptMirrorAppendResult>;

  export function readSessionTranscriptEvents(
    params: SessionTranscriptReadParams,
  ): Promise<SessionTranscriptEvent[]>;
}
