# OpenClaw 会话模型选择锁对齐

## 权威依据

OpenClaw 的 [Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.list` 作为当前会话索引，并将 `sessions.patch` 作为会话覆盖的控制面入口。官方 [会话行类型](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts) 包含 `modelSelectionLocked?: boolean`；[patch handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/sessions-patch.ts) 在会话锁定时先于模型目录加载拒绝 `model` 字段。其官方测试证明：模型切换与恢复默认模型都被拒绝，非模型元数据 patch 不受该锁影响。

## 发现

JunQi 之前未投影锁定字段，因此桌面模型选择器可继续呈现模型切换和恢复默认模型操作；Gateway 最终会拒绝这些写入，但用户不能在操作前看到原生约束，面板打开后发生的会话刷新也没有本地提交防线。

## 实现边界

- 仅接受严格布尔 `true`，将它投影到现有会话状态；缺失、`false` 和非布尔值均不制造锁定状态。
- 锁定时仅禁用模型候选和恢复默认模型，并以锁图标及本地化可访问名称说明状态。供应商浏览和其他原生会话设置不被混同为模型权限。
- 模型保存和恢复默认模型前从最新 Zustand 会话行重新检查锁状态。若面板打开后锁已变化，客户端在发送 `sessions.patch` 前停止写入并提示真实锁定原因。
- JunQi 永远不写入、伪造或解除该字段；最终授权和写入结论仍以 Gateway 响应为准。

## 验证结果

- 定向回归通过：会话模型锁领域判定、提交临界区防线与会话状态存储共 53 项测试通过。
- `pnpm lint` 通过，包含 TypeScript、模块边界与版本一致性检查。
- `pnpm test` 通过，覆盖全部前端与脚本测试。测试输出中的既有 React 服务端渲染 `useLayoutEffect` 警告未升级为失败。
- `pnpm build` 通过，包含协作插件包契约、TypeScript 和 Vite 生产构建。
- `pnpm verify:openclaw-docs` 通过。
- `git diff --check` 通过。

## 未验证边界

未在真实模型锁定会话和 macOS、Windows、CentOS、Ubuntu 真机完成视觉与键盘验收；这些平台验证不能由本机 TypeScript 构建替代。
