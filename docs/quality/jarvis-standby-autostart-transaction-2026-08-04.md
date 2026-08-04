# Jarvis 待机自动启动事务围栏

日期：2026-08-04

## 结论

Jarvis 待机由两个独立持久状态组成：Tauri 管理的 JunQi 登录自动启动，以及仅保存已选 OpenClaw
session key 的本地待机绑定。旧 Settings 调用先后修改两者，却忽略自动启动 command 返回的
`enabled` 回执；某一步失败时，界面可能显示已启用，而登录后没有可恢复的会话，或保留待机绑定却
未成功注册系统自动启动。

修复将二者收敛为可回滚事务。启用时先由 Tauri 确认 `enabled: true`，再写入会话绑定并通知应用根
运行时；写入失败则请求关闭系统自动启动。关闭时先由 Tauri 确认 `enabled: false`，再清除绑定并
通知运行时；清除失败则请求恢复系统自动启动。偏好订阅者异常被隔离，不能阻止其他运行时所有者更新。

## 权威边界

- 本地 `src-tauri/src/commands/app_autostart.rs` 在 enable 或 disable 后重新读取插件状态，并以
  `{ enabled }` 作为唯一确认回执。
- 官方 [Voice wake 文档](https://docs.openclaw.ai/nodes/voicewake) 规定触发词和路由由 Gateway
  持久化并广播；本修复不读取、写入或模拟这些状态。
- 本地绑定只保留用户明确选择的 canonical OpenClaw session key，不保存 Gateway token、连接 ID、
  音频或转录内容；它不改变 OpenClaw service 的所有权或生命周期。

## 验证结果

- `VoiceWakePreference` 回归覆盖启用回执前不得发布、未确认 enable/disable 保留原绑定、本地写入或
  清除失败后的系统回滚，以及订阅者隔离；6 项定向测试通过。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`pnpm exec tsc --noEmit` 与
  `git diff --check` 通过。

## 未验证边界

自动化只验证本地状态机和 typed IPC 调用。macOS、Windows、CentOS、Ubuntu 的真实登录项注册、
权限、休眠恢复和托盘常驻仍需目标平台实测；未获得这些证据前不得声称跨平台待机已经真机验证。
