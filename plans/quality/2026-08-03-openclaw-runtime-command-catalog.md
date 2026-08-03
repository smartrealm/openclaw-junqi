# OpenClaw 运行时命令目录对齐计划

日期：2026-08-03

## 实施顺序

1. 核对 `commands.list` handler、schema、权限、agent/provider/scope 解析与当前静态页面、Composer 链路。
2. 新增严格、连接围栏保护的 `OpenClawCommandsClient` 及回归测试，并从 Gateway facade 暴露只读读取方法。
3. 新增 hook，在 `/openclaw-commands` 页面按当前 Gateway 显示来源、作用域、别名、参数及真实加载状态。
4. 让 Composer 按 active session 的可验证 agent 拉取 text 命令，移除静态命令表和参数推断。
5. 删除 CLI 参考页面数据、固定侧栏类别/计数及多语言陈旧条目；更新索引、验证并用中文提交。

## 文件范围

- `src/services/gateway/OpenClawCommandsClient.ts`
- `src/services/gateway/OpenClawCommandsClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawCommands.ts`
- `src/pages/OpenClawCommands/`
- `src/components/Chat/message-input/`
- `src/data/slashCommands.ts`
- `src/components/Layout/NavSidebarPanels.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引

## 不做的事情

- 不执行 CLI、不开 shell、不调用浏览器 fallback，也不为目录加载申请写权限。
- 不在本地维护 OpenClaw 命令、参数 choices、插件能力或 agent 可见性副本。
- 不把未知或未广告的 Gateway 方法当作版本兼容回退，也不以当前开发机安装状态替代目标 Gateway 事实。
