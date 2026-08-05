# OpenClaw Hook 状态只读投影

日期：2026-08-04

## 依据

- 当前本地官方源码 `/Users/wei/DevTool/project/mine/gui/Openclaw/packages/gateway-protocol/src/schema/hooks.ts` 将 `hooks.status` 定义为空对象请求。
- 当前本地官方源码 `/Users/wei/DevTool/project/mine/gui/Openclaw/src/gateway/methods/core-descriptors.ts` 将该方法定义为 `operator.read` 的 `2026.7` 增量能力。
- 当前本地官方源码 `/Users/wei/DevTool/project/mine/gui/Openclaw/src/gateway/server-methods/hooks-status.ts` 和 `src/hooks/hooks-status.ts` 证明 Gateway 基于活动插件注册表与工作区 Hook 计算状态报告；原始报告含工作区、受管 Hook、文件和处理器路径。

## 当前行为

1. 维护中心的 Hook 状态区不会在挂载时请求 Gateway。用户点击读取按钮后，JunQi 以 attested connection id 调用 `hooks.status`，严格发送 `{}`。
2. JunQi 只投影名称、描述、可加载状态、已知阻塞原因、事件、未知核心触发事件与 plugin id。原始工作区路径、Hook 文件/处理器路径、Hook key、安装选项、配置检查、环境变量名称和需求详情均在客户端边界丢弃。
3. 面板不提供安装、启用、禁用、重载或配置写入。Hook 的管理权与具体副作用始终由 OpenClaw CLI、配置和插件运行时拥有。
4. Gateway 的 method-not-found、断线和连接身份变更均显示为不可用；已知安全字段无效显示为协议无效。方法广告遗漏不阻止真实请求。

## 验证结果

- 已通过：`node --import ./test-setup.ts --import tsx --test src/services/gateway/OpenClawHooksStatusClient.test.ts src/components/settings/OpenClawHooksStatusPanel.test.tsx src/components/settings/MaintenanceCenter.test.ts`，13 项回归测试通过。
- 已通过：`pnpm lint`、`pnpm test`、`pnpm test:rust`（709 通过、0 失败、3 跳过）、`pnpm build` 与 `pnpm verify:openclaw-docs`。
- 已通过：三份语言包 JSON 校验、`git diff --check` 与本次修改完整文件的 Emoji 扫描。

## 未验证边界

- 尚未在真实 Gateway 中读取 Hook 报告，未声明任何 Hook、事件、可加载状态或权限范围已在现场验证。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证维护界面、远程 Gateway 的 `operator.read` 授权或插件运行时差异。
