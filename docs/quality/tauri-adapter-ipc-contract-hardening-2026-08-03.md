# Tauri Adapter IPC 契约加固记录

## 依据

本记录依据当前仓库的 Rust command 实现、Tauri 注册项、前端 `tauri-commands.ts` 包装器、`src/api/device-identity.ts` 类型，以及本机安装的 OpenClaw 版本无关的 Tauri IPC 契约。历史全量审计在 2026-07-31 将 `src/api/tauri-adapter.ts` 统计为 52 处 `any`；复核当前分支时实际剩余 9 处，均位于该适配器的错误、窗口、事件或返回值边界。

## 当前行为

- 平台信息按 Rust `PlatformInfo` 的 `os`、`arch`、`home_dir`、`desktop_dir` 字段接收。
- 设备签名按 `DeviceSignParams` 的可选 `nonce`、客户端身份、角色、权限范围和 token 接收，再交给设备身份模块生成签名。
- 终端创建明确接收 `{ id, pid }`，终端写入、调整大小、终止和打开目录明确声明无返回值。
- 系统指标事件按固定字段接收，性能页直接调用已声明的 `window.aegis.systemMetrics`，不再通过 `any` 访问。
- 窗口 API、错误处理和应用版本读取使用 `unknown`、明确的返回类型或现有运行时类型，不再用 `window as any` 掩盖契约。

## 目标行为

IPC 适配层的字段命名、可选性、返回值和错误边界必须能被 TypeScript 编译器和回归门禁发现。Rust `serde(rename_all = ...)` 或 command 返回结构变化时，不能静默退化为 `any` 或宽泛对象。

## 验证结果

- `src/api/tauri-adapter.ts` 当前 `any` 数量为 0。
- `src/api/tauriCommandsContract.test.ts` 增加了适配器无 `any`、平台信息返回类型、设备签名参数和性能页直接系统指标调用的门禁。
- `pnpm exec tsc --noEmit` 通过。
- 相关 Tauri command wrapper 与 Rust 返回类型已交叉核对。

## 未验证边界

- 未在 Windows、Linux 真机上执行 Tauri 打包后的 IPC 调用；当前验证是源码契约、TypeScript 编译和本机测试。
- `src/api/tauri-adapter.ts` 之外的生产代码仍存在非 IPC 场景的 `any`，不应将本记录解读为全仓类型清零。
