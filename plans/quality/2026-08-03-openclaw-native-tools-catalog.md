# OpenClaw 原生工具目录对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 `tools.catalog` schema、`operator.read` 权限、handler 的 agent/profile/plugin
   语义和当前方法广告。
2. 新增严格的 `OpenClawToolsCatalogClient`，保留官方 core/plugin、risk、optional、tags
   和 default profile 字段。
3. 在 Gateway data store 中按连接、请求代次和 agent 管理目录，处理能力未广告、断线、
   agent 删除、迟到响应和 UI 缓存新鲜度。
4. 在 Config Manager Tools 页面把 agent 级全局目录和 Session 级有效工具分开呈现，补充
   三种语言文案。
5. 更新三层文档，执行目标测试、lint、完整测试、构建、官方链接、差异和无 Emoji 检查，
   使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawToolsCatalogClient.ts`
- `src/services/gateway/OpenClawToolsCatalogClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/ConfigManager/ToolsTab.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不在 JunQi 本地推断 agent profile 或插件工具，不把 catalog 当作 Session 最终权限。
- 本计划对应的目录读取路径不调用 `tools.invoke`，不主动连接或列举 MCP 工具；工具调用另由独立原生对齐计划负责。
- 不把 OpenClaw 安装版本写成能力开关，不在 Gateway 未广告或响应无法验证时伪造目录。
