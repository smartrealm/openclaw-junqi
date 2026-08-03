# P0 IPC 与 Gateway 边界收敛

## 问题

页面仍有直接导入 `@tauri-apps/api/core` 和直接调用 `invoke` 的路径。页面因此同时承担界面状态、原生命令名称和序列化字段，Rust command 变更时只能靠运行时发现。Gateway 传输层也保留无约束的 `any`，响应和事件的边界不容易被 TypeScript 发现。

## 目标行为

1. `src/pages/` 不直接依赖 Tauri core IPC；页面只调用 `src/api/tauri-commands.ts` 中按 command 契约定义的出口。
2. 页面相关的任务、终端、会话导出、项目初始化、宠物窗口和 QuickChat 操作都经过命名 wrapper，参数字段与 Rust `serde(rename_all = "camelCase")` 一一对应。
3. Gateway Connection、MessageRouter 和 Gateway facade 的传输参数、响应回调和事件消息使用 `unknown`、记录类型或泛型，不使用 `any` 掩盖协议漂移。
4. 边界检查和回归测试在源码阶段阻止原始页面 IPC 回归。

## 范围

本 P0 只覆盖页面到原生 IPC 的入口和 Gateway 传输层，不在同一批次重写全部页面到 service 的历史依赖，也不改变业务状态机或 OpenClaw RPC 的业务语义。后续 P1 再按领域迁移页面对 service 的依赖并细化 Gateway method response 类型。

## 验收条件

- [x] `node scripts/check-boundaries.mjs` 拒绝页面导入 Tauri core 或直接调用 `invoke`。
- [x] 边界测试包含违规样例和真实源码 smoke test。
- [x] 受影响页面不再出现原始 Tauri core IPC 调用。
- [x] P0 触及的 Gateway 传输文件生产代码 `any` 数量为零。
- [x] TypeScript、前端测试、边界检查和 Rust 相关检查通过。
- [x] 未改变浏览器 Provider、安装流程和现有用户工作区的未提交改动。

## 未验证边界

- 未在 Windows、Linux 真机上执行页面命令的打包后调用。
- Gateway 具体 method 的返回值仍由各领域 parser 负责，本规格不把所有 OpenClaw RPC 统一成一个宽泛结构。
