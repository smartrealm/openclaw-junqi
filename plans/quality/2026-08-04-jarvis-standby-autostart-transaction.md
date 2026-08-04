# Jarvis 待机自动启动事务围栏计划

1. 核对 Settings、偏好存储、typed Tauri command 和应用根订阅的完整链路。
2. 以 `VoiceWakePreference` 作为本地事务边界，按 `{ enabled }` 回执串联系统自动启动与会话绑定。
3. 在回执未确认、本地持久化失败和订阅者异常时保持或恢复一致状态。
4. 补充定向回归、规格、审计记录和完整仓库验证。
