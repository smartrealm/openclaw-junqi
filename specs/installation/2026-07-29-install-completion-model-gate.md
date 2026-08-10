# Install Completion Model Gate Spec

Date: 2026-07-29

2026-08-09 复审：本规格中的安装后实时模型门禁已废止。当前契约以
`specs/quality/2026-08-09-openclaw-installation-completion-contract.md` 为准。

## Acceptance

- [x] Setup completion checks the selected Gateway again in the final action.
- [x] Setup completion re-reads official `openclaw.setup.detect.setupComplete` for the selected runtime.
- [x] Setup completion does not repeat the live active-model probe after the official Wizard terminal result.
- [x] 官方实时模型验证不改写 `setupComplete`，也不阻断已完成的官方配置。
- [x] Gateway failure routes to Gateway recovery.
- [x] `setupComplete=false` routes to official OpenClaw configuration.
- [x] The gate is a small injected service with behavior tests, not more inline
      branching in the setup hook.
- [x] Wizard start, next, and status results reject unknown top-level fields.
- [x] Wizard start requires a non-empty session id and next rejects a session id.
- [x] Wizard cancellation accepts only the installed synchronous `cancelled`
      result and preserves local state on protocol drift.
- [x] Wizard error diagnostics redact credentials before UI/log
      storage without rewriting official Wizard step content.
