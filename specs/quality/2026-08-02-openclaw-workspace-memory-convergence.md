# OpenClaw 工作区记忆收敛规格

## 目标

记忆浏览只展示当前 OpenClaw 工作区中已被官方文档定义的 `MEMORY.md` 与 `memory/*.md` 记录，不得展示无法实际调用的本地目录或外部 Memory API 配置。

## 验收条件

- 当前工作区路径必须通过 Rust `get_workspace_path` 取得。
- 目录和文件读取必须经过现有受 `projectPath` 约束的 typed 文件 IPC。
- 遍历最多读取 200 个 Markdown 文件、深度最多三层，并且 `MEMORY.md` 不存在时仍可正常展示空状态。
- 记忆页面只能读取、刷新、筛选和查看内容；不得调用 HTTP Memory API、`window.aegis.memory`、任意本地路径或未定义的 CRUD 接口。
- 移除相应的设置状态、兼容桥和虚假运行时默认端点。
- 页面、服务、国际化和测试中不得残留 `memoryApi`、`memoryMode`、`memoryLocalPath` 或 `readLocal` 产品调用。

## 非目标

- 不在本页实现记忆编辑、删除、embedding 探测、Dreaming 修复或 REM harness。
- 不把 Gateway 诊断协议伪装成通用记忆数据 API。
