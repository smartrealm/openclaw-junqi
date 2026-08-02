# OpenClaw 工作区记忆出口收敛

## 依据

当前安装的 OpenClaw `2026.7.1-2` 文档将工作区中的 `MEMORY.md` 定义为可选长期记忆文件；`session-memory` hook 将会话摘录写入 `<workspace>/memory/YYYY-MM-DD-HHMM.md`。依据分别位于本机安装包的 `docs/start/openclaw.md` 与 `docs/automation/hooks.md`。

Gateway `doctor.memory.status` 与 `doctor.memory.remHarness` 是诊断协议，不是通用记忆 CRUD 接口。前者的主动探测会请求 embedding provider，后者需要 `operator.read`。本次不把它们伪装成文件浏览或写入能力。

## 原有问题

`MemoryExplorer` 允许用户在自定义 HTTP Memory API 和任意本地目录之间选择，但本地路径通过 `window.aegis.memory.readLocal` 读取；Tauri 适配器对该调用固定返回失败。外部 API 也不属于 OpenClaw 当前安装版本声明的运行时契约。页面同时直接承担加载、搜索、编辑、删除、关系查询和三种图形展示，实际能力与界面承诺不一致。

## 收敛后的边界

- `openclawWorkspaceMemory` 是唯一读取服务，仅通过已有的 `get_workspace_path`、`read_dir_entries` 和 `read_file_preview` typed IPC 读取当前 OpenClaw 工作区。
- 服务只读取 `MEMORY.md` 与 `memory/` 下有上限的 Markdown 文件；递归深度和文件数均有限制，所有路径继续由 Rust `validate_path_within` 约束。
- 页面是只读浏览与本地筛选，不保留外部 HTTP Memory API、任意目录、伪 CRUD、关系 API 或已失效的 `window.aegis.memory` 桥接。
- 修改或删除记忆文件继续属于工作区文件工作台的受保护编辑流程，本页不绕过文件并发与路径安全边界。

## 验证

- `src/services/openclawWorkspaceMemory.test.ts` 断言工作区目录、受限读写边界和遍历上限。
- `src/config/runtimeDefaults.test.ts` 确认运行时默认值只承担 Gateway 端点，不再维护虚假的 Memory API 默认端点。
- `pnpm exec tsc --noEmit` 通过。

## 未验证边界

- 未做含深层 `memory/` 目录和两百个以上文件的桌面真机验收；服务会在该上限停止读取，不应阻塞界面。
- 本次未接入需要 `operator.read` 的 REM harness，也未触发 `doctor.memory.status` 的 provider 探测；后续若增加诊断卡片，必须独立声明权限、探测成本和失败状态。
