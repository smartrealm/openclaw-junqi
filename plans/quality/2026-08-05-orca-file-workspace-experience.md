# Orca 文件工作区体验实施计划

## 范围

把 Orca 可迁移的文件工作区交互映射到 JunQi 已有本地工作区能力：快速打开、结果层级和紧凑预览工作区样式。不复制或引入 Orca 的 Electron、SSH、浏览器、Monaco 或远程运行时实现。

## 实施顺序

1. 审核 Orca 文件快速打开、编辑器视图与 JunQi 的文件预览、Tauri command、工作区适配器和调用方。
2. 将本地搜索适配器的返回类型从路径列表收敛为带文件名、目录和扩展名的原生结果条目，并更新唯一调用方。
3. 新增可测试的快速打开键盘状态模型和 `FileExplorer` 内的本地工作区快速打开层。
4. 在既有 Aegis 令牌下调整标签与快速打开的高密度交互样式，不改变统一预览、写入和 OpenClaw Gateway 边界。
5. 运行目标测试、完整 TypeScript 测试、lint、构建、官方文档检查和差异检查；记录浏览器连接与跨平台真机未验证项。

## 文件范围

- `src/workspace-files/domain/types.ts`
- `src/workspace-files/adapters/localWorkspaceFiles.ts`
- `src/workspace-files/adapters/localWorkspaceFiles.test.ts`
- `src/components/FileExplorer/`
- `src/pages/AgentWorkspace/index.tsx`
- `src/styles/index.css`
- 本规格、审计记录和索引

## 非目标

- 不新增或修改 Tauri Rust command。
- 不创建 OpenClaw Gateway 命令、事件或状态。
- 不实现全盘、未跟踪文件、远程主机、会话附件或 Agent 工作目录的假搜索。
- 不把本机开发路径、平台名称或静态搜索结果写入生产代码。
