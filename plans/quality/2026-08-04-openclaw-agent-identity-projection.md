# OpenClaw Agent Identity Projection Plan

Date: 2026-08-04

- [x] Verify the current official protocol, source schema, handler, and avatar transport boundary.
- [x] Trace all current assistant identity presentation paths in chat, QuickChat, and typing state.
- [x] Add a connection-fenced read-only identity client and a connection-scoped session cache.
- [x] Route assistant name and configured marker presentation through the official response.
- [x] Add Gateway-client contract regressions.
- [x] Run complete validation, inspect the final diff, and scan modified files.
- [x] Commit with a Chinese message.

## File scope

- `src/services/gateway/OpenClawAgentIdentityClient.ts`
- `src/hooks/useOpenClawAgentIdentity.ts`
- `src/services/gateway/index.ts`
- `src/components/Chat/MessageBubble.tsx`
- `src/components/Chat/TypingIndicator.tsx`
- related tests and quality records
