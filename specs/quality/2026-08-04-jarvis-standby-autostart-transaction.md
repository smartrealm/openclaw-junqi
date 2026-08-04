# Jarvis 待机自动启动事务围栏

## 目标行为

1. 启用 Jarvis 待机前，必须由 Tauri command 回执确认应用自动启动为 `enabled: true`。
2. 只有确认成功后才能持久化并发布选定的 OpenClaw session key。
3. 启用后的本地绑定写入失败时，必须请求关闭刚启用的应用自动启动；不得报告待机已启用。
4. 关闭 Jarvis 待机前，必须由 Tauri command 回执确认应用自动启动为 `enabled: false`。
5. 只有确认关闭后才能清除并发布本地 session key；清除失败时必须请求恢复应用自动启动。
6. 一个偏好订阅者的异常不得阻断其他订阅者，且不得改变 OpenClaw Gateway、trigger、routing、Talk
   或 session 数据。
7. 登录启动后，仅当认证 Gateway 的当前会话快照出现已保存的精确 session key 时，应用根才可选中该
   会话并进入正常唤醒监听门禁。绑定不存在、连接未认证或快照未出现目标时保持待验证，不能创建会话、
   推断 session identity 或重新写入 Gateway。
8. 同一认证连接和同一待命绑定只恢复一次；用户在该连接中手动切换会话后不得被后台恢复再次覆盖。
   连接重建后可重新依据新的 Gateway 快照恢复。

## 验收

- 未确认的 enable 或 disable 回执不能改变已持久化的待机会话。
- 启用等待系统回执期间，应用根运行时不能从偏好订阅读到新绑定。
- 每次成功事务仅在完整状态达成后发布一次偏好更新。
- 回归覆盖精确 Gateway 会话选择、目标缺失失败关闭、同连接去重和连接重建后的再次恢复资格。
- 所有状态变化仍只使用已注册的 typed Tauri command；不访问平台私有注册表、Desktop Entry 或
  OpenClaw 内部状态文件。

## 非目标

- 不改变 OpenClaw `voicewake.*`、`talk.*`、session routing 或 Gateway service autostart。
- 不声称 macOS、Windows、CentOS、Ubuntu 已完成登录项真机验证。
