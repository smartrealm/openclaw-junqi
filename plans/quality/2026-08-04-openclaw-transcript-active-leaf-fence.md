# OpenClaw Transcript Active Leaf 围栏计划

1. [x] 读取更新后的官方 OpenClaw protocol schema、history handler 与 chat send admission。
2. [x] 审阅 JunQi session 投影、history 加载、普通发送、steer、重试和快捷发送入口。
3. [x] 增加严格 leaf/错误解析，并将 list/history 事实投影到 identity-bound Session。
4. [x] 仅在普通 `chat.send` 适配器中传递已验证 leaf。
5. [x] 对官方 leaf 冲突拒绝触发 history 刷新，保留失败输入且禁止自动重试。
6. [x] 增加解析、派发、发送事务和会话 identity 回归测试。
7. [ ] 在两个真实桌面客户端与真实 Gateway 上验证跨分支并发发送，覆盖 macOS、Windows、
   CentOS、Ubuntu。
