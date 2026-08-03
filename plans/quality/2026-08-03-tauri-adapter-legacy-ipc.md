# Tauri 适配器遗留 IPC 契约实施计划

日期：2026-08-03

## 执行顺序

1. 为平台、存储路径、系统指标与 bridge 返回类型建立可执行的前端 DTO 契约。
2. 将 adapter 的窗口句柄、平台 IPC 和全局赋值迁移到严格类型；保留 browser preview 的显式 no-op 语义。
3. 将 `systemMetrics` 添加到 ambient declaration，并移除性能页的 `any`。
4. 删除没有产品调用方的 device 与 terminal bridge 及其声明，保持 Rust command 与 OpenClaw PTY 路径不变。
5. 增加 DTO 与 bridge shape 回归测试，执行 TypeScript、相关 Rust、文档链接、差异和字符检查。

## 文件范围

- `src/api/tauri-adapter.ts`
- `src/api/tauriAdapterContracts.ts`
- `src/api/tauriAdapterContracts.test.ts`
- `src/types/global.d.ts`
- `src/pages/Performance.tsx`
- `src/pages/SettingsPage.tsx`
- `src-tauri/src/commands/system.rs`
- 本轮 audit、spec、plan、validation 与目录索引

## 完成判据

- [x] 所有保留的 adapter IPC 返回在进入 UI 前有严格 DTO 约束。
- [x] 无调用方的 device 与 terminal bridge 已从 renderer 表面移除。
- [x] Performance 只使用正式声明的 metrics subscription。
- [x] 定向测试、TypeScript、Rust、官方链接和差异检查有可复现记录。
