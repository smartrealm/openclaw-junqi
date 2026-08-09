# Jarvis 支持语音边界规格

日期：2026-08-09

## 当前目标

让 Jarvis UI 只表达当前 OpenClaw 官方可验证的能力：用户主动开启的 Talk、Gateway 语音配置编辑和真实失败状态。跨平台常驻唤醒在没有官方桌面运行时协议前保持不可用或待验证。

## 状态契约

- `Gateway 唤醒词` 表示 `voicewake.get/set` 返回或保存的 Gateway 配置，不表示 JunQi 正在监听麦克风。
- `唤醒路由` 表示 `voicewake.routing.get/set` 的官方配置，不表示当前手动 Talk 会话已经切换到该目标。
- `Jarvis Talk` 只有在用户主动操作、Gateway 连接已核验、`talk.catalog` 真实返回可用实时配置并成功创建 `talk.session` 后才进入活动态。
- Gateway 未提供官方桌面唤醒运行时、命中事件或节点扩展时，UI 必须显示不可用/待验证，不显示常驻、24 小时或已启用成功。

## UI 验收

- 设置页分开呈现 Gateway 配置与 JunQi 手动 Talk 的边界说明。
- 配置读取失败、保存失败和上游能力缺失继续内联显示，不伪造成功。
- Talk 活动时保留全窗口遮罩、Stop、重试、焦点和灵动岛/萌宠的非敏感阶段投影。

## 依据与未验证边界

依据为 OpenClaw 官方 Voice Wake、Talk 和 Gateway protocol 文档；当前 Gateway 和真实音频设备仍需现场验证。不得新增本地唤醒模型、后台采集 worker 或未定义 RPC。
