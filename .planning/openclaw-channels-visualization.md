# OpenClaw Channels 可视化执行计划

## Phase A - 官方合法性与路由

| Bug | 文件 | 修复 |
| --- | --- | --- |
| CH-03 | `src/services/channelConfig.ts` | 将内嵌 `agentId` 迁移为根级 `bindings[]` route mutation |
| CH-07 | `src/services/channelConfig.ts` | 增加共享递归脱敏并移除原始配置复制 |

## Phase B - 官方运行时适配

| Bug | 文件 | 修复 |
| --- | --- | --- |
| CH-01/02 | `src-tauri/src/commands/openclaw_channel.rs` | 封装目录、capabilities、status、logs CLI JSON |
| CH-08 | `src-tauri/src/commands/openclaw_cli.rs` | 提取 provider/channel 共用的跨平台 CLI 执行与 JSON 解析 |
| CH-01/06 | `src/services/openclawChannelRuntime.ts` | 标准化目录、schema、状态、认证能力与缓存 |

## Phase C - 可视化操作

| Bug | 文件 | 修复 |
| --- | --- | --- |
| CH-04 | `src/pages/ChannelsCenter/index.tsx` | QR modal、start/wait/logout 与原生登录向导 |
| CH-05 | `src/pages/ChannelsCenter/index.tsx` | installable 渠道转官方 add 向导 |
| CH-06/09 | `src/pages/ChannelsCenter/index.tsx` | 官方 status/probe、账户生命周期、capabilities 和日志 |
| CH-02/08 | `src/pages/ConfigManager/ChannelsTab.tsx` | 复用官方目录和 schema 驱动编辑器 |

## Phase D - 验证

1. 每个 BUG 至少一个旧实现会失败的回归测试。
2. 用 OpenClaw 2026.7.1 验证目录、已安装 schema、离线 status 和无效 ID 拒绝。
3. 验证 WhatsApp QR start/wait 状态机的成功、刷新、超时、取消和错误。
4. 运行前端测试、TypeScript、生产构建、Rust fmt/test 与 diff 检查。
5. 在桌面和窄屏视口检查目录、账户、schema 编辑和二维码弹窗。
