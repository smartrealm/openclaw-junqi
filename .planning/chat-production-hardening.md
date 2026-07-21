# Chat Production Hardening Plan

- [x] CHAT-01: make artifact rendering source-first, script-free, and CSP-constrained
- [x] CHAT-02: introduce a shared send lifecycle with explicit delivery states
- [x] CHAT-03: move prepared attachments into session-scoped draft state
- [x] CHAT-04: route all supported files through official OpenClaw attachments and retain them in queues
- [x] CHAT-05: preserve optimistic transcript tails and coalesce forced history refreshes
- [x] CHAT-06: replace message-id HTTP pagination with `chat.history` offsets
- [x] CHAT-07: replace unsupported persona patching with visible draft instructions
- [x] CHAT-08: remove first-message desktop-context injection
- [x] CHAT-09: send recorded audio as an attachment and make local voice persistence directory-safe
- [x] CHAT-10: serialize session mutations ahead of sends
- [x] CHAT-11: expose `chat.message.get` for truncated transcript entries
- [x] Run focused tests after each phase
- [x] Run the complete test, lint, build, and HTTP UI smoke gates

The in-app browser runtime was unavailable in this environment, so screenshot and interactive
visual verification could not run. The development server and application entry modules were
verified over HTTP instead.
