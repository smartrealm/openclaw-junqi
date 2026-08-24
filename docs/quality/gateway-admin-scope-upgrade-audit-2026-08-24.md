# Gateway 管理员权限升级链路审计

## 审计结论

审计依据为 2026-08-24 更新后的 OpenClaw 官方主线提交
`a9fdb68496d636461d11e8be29323de55636e337`，重点核对
`docs/gateway/operator-scopes.md`、`packages/gateway-client/src/scope-upgrade.ts` 和
`src/gateway/server-methods/device-scope-upgrade.ts`。

OpenClaw 对 `sessions.patch` 采用参数级权限：会话组织字段和单会话模型使用
`operator.write`，thinking、fast、verbose、trace 和 reasoning 等运行参数使用
`operator.admin`。JunQi 对这两类写入的分流与官方契约一致。

## 缺陷

### BUG-01：管理员拒绝后没有进入官方设备权限升级协议

严重级别：P1。

当前特权连接收到结构化 `MISSING_SCOPE` 后立即拒绝原业务操作，只发布一个恢复界面事件。
恢复界面没有调用官方 `device.scopes.requestUpgrade` 和 `device.scopes.waitUpgrade`，因此拿不到
当前设备的待批准请求，也无法接收批准后轮换的设备令牌。界面建议用户重配或重试，但代码没有
建立可继续原操作的状态链路。

影响范围不是会话设置单一入口，而是所有经统一特权请求器发起的管理员写入。

### BUG-02：业务通知泄漏底层英文授权错误

严重级别：P1。

`useSessionRuntimeSettings` 对未知错误直接显示 `Error.message`。由于 BUG-01 让管理员拒绝直接返回，
通知最终显示 `missing scope: operator.admin`。这既不是可操作的本地化说明，也错误暗示保存流程已经
结束，而全局权限恢复界面可能同时存在。

## 目标链路

1. 日常连接继续只申请日常最小权限，不把管理员权限永久加入普通 Chat 连接。
2. 特权连接收到结构化 `MISSING_SCOPE` 后暂停原操作，并发布统一权限恢复状态；管理员写入申请
   `operator.admin`，其他专用连接只申请 Gateway 明确返回的缺失权限。
3. 用户在恢复界面明确请求管理员权限后，当前已核验主连接调用官方权限升级 RPC。
4. JunQi 展示 Gateway 返回的准确请求标识；本地所选运行时可在用户确认后批准该准确请求，远程
   Gateway 保留手工或 Control UI 审批入口。
5. `waitUpgrade` 仅接受相同请求标识的结构化终态。批准时先把轮换设备令牌写入当前 Gateway
   端点绑定的系统凭据作用域，再清除共享令牌优先级并使用设备令牌重连。
   后续普通启动也优先恢复该端点绑定的设备凭据；仅首次设置和用户显式 token 输入继续使用
   当前请求指定的共享凭据。
6. 新主连接完成运行时身份核验后，统一特权请求器重新捕获连接身份并重放尚未发送的原 RPC。
7. 拒绝、过期、取消、身份换代、令牌保存失败和协议不可用均保持失败语义，不伪造成功。

## 验证边界

自动化测试覆盖协议字段校验、设备令牌先存后重连、主连接身份围栏、原业务 RPC 只在新授权连接
认证后发送，以及底层授权错误不再泄漏为会话设置通知。当前机器不作为目标环境证据；macOS、
Windows 和 Linux 的真实系统凭据库授权、远程 Gateway 审批与安装包交互仍需目标平台实测。

## 自动化验证结果

- 使用项目锁定 `pnpm@9.15.9` 执行 `lint`，模块边界、版本一致性和 TypeScript 检查通过。
- 使用同一版本执行完整 `test`，前端与脚本测试通过。
- 使用同一版本执行生产 `build`，协作插件、钉钉插件、TypeScript 和 Vite 构建通过。
- scope upgrade、凭据安全、连接目标恢复、会话设置和恢复界面定向测试通过。
- `git diff --check`、三语 JSON 解析和本任务完整文件 Emoji 扫描通过。
