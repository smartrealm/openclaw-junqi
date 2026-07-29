# 设置与运行时一致性实施计划

日期：2026-07-28

## 任务

- [x] 核对设置页、设置 store、子面板和运行时消费者。
- [x] 消除页签本地状态与 URL 状态重复。
- [x] 为设置内容关闭重复卡片入场动画。
- [x] 抽取页面与终端共用的稳定设置开关并覆盖组件行为。
- [x] 统一独立任务与工作区任务终端的设置来源。
- [x] 增加通知偏好运行时桥接。
- [x] 延迟存储统计到对应页签。
- [x] 为用户触发的设置操作补充失败反馈和禁用状态。
- [x] 删除无实现、无挂载和无加载的遗留设置代码。
- [x] 将 locale 收敛为三套实际应用语言并核对 OpenClaw 版本文档。
- [x] 增加定向回归测试。
- [x] 运行完整 lint、测试、生产构建和 diff 检查。

## 主要影响文件

- `src/pages/SettingsPage.tsx`
- `src/components/settings/TerminalSettingsPanel.tsx`
- `src/pages/AgentRunView.tsx`
- `src/runtime/NotificationPreferencesRuntime.tsx`
- `src/stores/settingsStore.ts`
- `src/i18n/languages.ts`
- `src/locales/{zh,zh-TW,en}.json`
- `src/components/shared/GlassCard.tsx`

## 回滚与验证边界

本轮不改变 Rust IPC 契约。删除的 Picovoice 本地键属于未实现功能遗留，不迁移为其他存储。删除 `ar.json` 只影响 JunQi 未加载资源，不影响由 OpenClaw 自己托管的 Control UI locale。
