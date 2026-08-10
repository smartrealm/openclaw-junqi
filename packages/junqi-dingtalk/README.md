# JunQi DingTalk Business Plugin

This OpenClaw plugin exposes a fixed DingTalk business tool set backed by the DWS command line runtime.

The Gateway owns execution, approval, session policy, and tool visibility. JunQi Desktop consumes the same `tools.effective` and `tools.invoke` contracts used by Chat. The plugin never exposes an arbitrary command runner.

Every business call requires an explicit DWS profile in `<corpId>:<userId>` form. Before execution, the plugin reads the current DWS leaf schema and fails closed if the canonical path, CLI path, effect, risk, confirmation, or idempotency contract differs from the reviewed tool specification.

Write tools require an OpenClaw plugin approval. Only `allow-once` and `deny` are offered. When the verified DWS leaf also requires confirmation, `--yes` is appended only after OpenClaw grants the approval.

Configuration:

- `dwsPath`: optional absolute DWS executable or verified npm `bin/dws.js` path. JavaScript entries run through the current Gateway Node.js runtime. If omitted, the plugin resolves `PATH` and rejects ambiguous matches.
- `timeoutMs`: command timeout from 1 to 120 seconds. Default: 30 seconds.
- `maxOutputBytes`: combined bounded output limit from 64 KiB to 8 MiB. Default: 2 MiB.

The plugin does not store DWS credentials, business payloads, or tool results.
