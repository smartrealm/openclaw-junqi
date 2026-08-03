# OpenClaw 原生有效工具目录对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 `tools.effective` schema、`operator.read` 权限、handler 的 Session 上下文
   解析和当前方法广告。
2. 新增严格的 `OpenClawToolsEffectiveClient`，只接受官方结构并保留可识别的来源、
   风险、拒绝标记和 notices。
3. 在 Gateway data store 中按连接、请求代次和 Session key 管理快照，处理发现遗漏、实际未知方法、
   断线、Session 删除、迟到响应和 30 秒 UI 缓存新鲜度。
4. 在 Config Manager 的 Tools 页面分开呈现配置 schema 与当前 Session 的只读有效工具，
   补充英文、简体中文和繁体中文文案。
5. 更新三层文档，执行目标测试、lint、完整测试、构建、官方链接、差异和无 Emoji 检查，
   使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawToolsEffectiveClient.ts`
- `src/services/gateway/OpenClawToolsEffectiveClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/ConfigManager/ToolsTab.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不本地计算 OpenClaw 工具 profile、allow/deny 或渠道/MCP 权限。
- 本计划对应的有效工具读取路径不调用 `tools.invoke`，不主动连接、创建或列举 MCP 工具；工具调用另由独立原生对齐计划负责。
- 不把 OpenClaw 安装版本写成能力开关，不用配置编辑器替代 Gateway 的有效结果。
- 不在 Gateway 真实响应无法验证时生成空工具、默认 profile 或伪成功状态；方法发现遗漏不构成响应。
