# OpenClaw Gateway 方法广告发现边界修正计划

日期：2026-08-04

1. [x] 查阅最新官方 Gateway protocol、官方 chat handler 和当前安装 Runtime。
2. [x] 确认 `features.methods` 是非穷尽发现列表，记录此前本地发送门禁与官方契约的冲突。
3. [x] 删除通用 RPC 的本地方法广告拒绝，不影响连接和 identity fence。
4. [x] 将回归改为未广告方法仍能在普通及 fenced 路径发送。
5. [x] 更新验证结果，执行全量检查、确认 main 已是当前分支祖先并准备中文提交。
