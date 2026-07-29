# User Message Recovery Actions Plan

Date: 2026-07-29

## Tasks

- [x] Verify the bundled OpenClaw 2026.7.1 per-message capability boundary.
- [x] Remove the composer-recall edit path from user bubbles.
- [x] Extract a pure capability policy for local failed/cancelled messages.
- [x] Add an inline failed-message editor that preserves retry attachments and identity.
- [x] Add a confirmed delete action for messages that never entered the native transcript.
- [x] Add behavior and structural regressions.
- [x] Run focused tests, TypeScript/module boundaries, full tests, production build, and diff checks.
- [ ] Perform Tauri desktop interaction verification.

## Verification

- Focused chat action tests: 19 passed.
- `pnpm lint`: passed, including TypeScript ESLint and module boundaries.
- `pnpm test`: passed; the final release-script phase reported 223 passed.
- `pnpm build`: passed, including collaboration bundle, `tsc`, and Vite chunk policy.
- Locale JSON parsing and `git diff --check`: passed.
- Tauri desktop interaction verification: not run in this environment.

## Files

- `src/components/Chat/localUserMessageMutations.ts`
- `src/components/Chat/InlineUserMessageEditor.tsx`
- `src/components/Chat/MessageBubble.tsx`
- `src/components/Chat/ChatView.tsx`
- `src/components/Chat/chatProductionHardening.test.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`

## Rollback boundary

The change does not alter OpenClaw transcripts or add Gateway methods. Rollback is limited to local failed-message recovery controls and translations.
