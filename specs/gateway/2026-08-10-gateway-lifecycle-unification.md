# Gateway 生命周期统一规格

日期：2026-08-10

## 目标

JunQi 普通页面、组件和业务流程对 Gateway 的恢复、重连、重启与停止必须进入全局
`GatewayLifecycleCoordinator`。进程命令返回成功不能等同于 Gateway 可用。

## 完成条件

1. `reconnect`、`recover` 和 `restart` 只有在新 WebSocket 完成官方 `hello-ok`、取得不同于操作前的
   connection ID，并且 Runtime Identity 已验证且绑定同一 connection ID 后才返回成功。
2. `restart` 在连接收敛前仍须通过所选 Runtime 的认证端点探测，不能接入占用相同端口的其他 Gateway。
3. `stop` 与恢复、重连和重启共享前端单飞与串行化协调器，不允许 UI 直接调用停止 IPC。
4. 普通业务页面不得维护自己的重连轮询、超时、连接身份判定或进度状态机。
5. `aegis:gateway-progress` 只用于输出生命周期进度，浏览器事件不得成为生命周期命令入口。
6. 官方 Wizard 的显式目标与凭据交接、协作 bootstrap、OpenClaw 包更新继续保留各自事务，但不得被普通页面调用。
7. 边界扫描必须拒绝受控适配器之外的低层 ensure、restart、stop IPC，以及普通页面直接调用
   `gatewayManager.ensureRunning/reconnect/restart/stop`。

## 失败语义

- 进程重启成功但认证连接超时：整体失败，不刷新依赖 Gateway Session 的业务状态。
- 新连接未取得已验证 Runtime Identity：整体失败，不把端口健康显示为连接完成。
- 操作被更新的生命周期请求取代：返回 `superseded`，调用方不得显示成功。
- 未知或不可验证状态保持失败或待核验，不使用旧连接作为 fallback。

## 不在本规格内

- 不改变 OpenClaw 官方 Wizard、协作 bootstrap 或更新事务的上游语义。
- 不通过客户端版本号推断 Gateway 能力。
- 不把自动化测试等同于 macOS、Windows、Linux 或 Docker 真机验收。
