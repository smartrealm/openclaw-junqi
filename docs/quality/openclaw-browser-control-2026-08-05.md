# OpenClaw 浏览器控制记录

日期：2026-08-05

## 依据

本轮按当前项目实际安装的 OpenClaw 包核对 `browser.request` Gateway 方法、`operator.admin`
scope 和浏览器控制路由。该安装版本只用于核对当前协议，不作为 JunQi 的运行时版本门禁。

协议允许通过 Gateway 读取 profile、状态、标签页和快照，并执行启动、停止、打开、聚焦和关闭标签页。
Gateway 对持久化 profile 变更另有约束，JunQi 不在此入口推断或模拟该能力。

## 实现

- `OpenClawBrowserClient` 将协议字段、URL 限制和响应解析收敛在 Gateway 服务层。
- 浏览器控制请求复用短时管理员连接，普通会话连接的权限保持不变。
- Chat 顶部工具组增加单一“浏览器”入口；面板使用 Gateway 的 profile 和运行状态，不预置名称或版本分支。
- 浏览器未运行时仅显示状态，避免向未就绪的控制服务读取标签页。
- `existing-session` 和 `extension` driver 的打开、聚焦、关闭、快照操作要求本机用户确认。

## 自动化验证

- `OpenClawBrowserClient.test.ts` 覆盖请求形状、URL 和控制路径限制、不可用状态映射及非法响应拒绝。
- 已执行 TypeScript 类型检查。

## 未验证边界

- 尚未用真实 Gateway 对隔离 profile、当前用户登录态 profile 和浏览器扩展 profile 完成端到端验证。
- macOS、Windows、Linux 对浏览器发现、授权和关闭行为的差异需要在目标环境分别验证。
- Gateway 的管理员 scope 审批由 OpenClaw 所有；JunQi 仅忠实呈现其失败或批准结果。
