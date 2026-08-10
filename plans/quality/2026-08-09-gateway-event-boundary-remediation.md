# Gateway 实时事件边界整改计划

日期：2026-08-09

## 根因和影响链

1. 原始 WebSocket 事件由 Connection 交给 ChatHandler。
2. ChatHandler 在变体验证前调用 run sequence projection。
3. 畸形 event 因而占用 runId 和 seq，后续相同 seq 的官方有效 event 被忽略。
4. 协作 bridge 还接受一个不是官方顶层 Gateway event 的 direct fallback。
5. 结果是协议边界与 UI 投影耦合，且存在未证明的扩展入口。

## 实施顺序

### 第一阶段：纯解码器和失败回归

文件：

- `src/processing/openClawChatEvent.ts` 或同域新增纯模块
- 新增对应单元测试
- `src/runtime/OpenClawChatEventRuntime.test.ts`

步骤：

1. 写能复现“畸形 event 占用 seq”的失败测试。
2. 定义 record、字符串、序号和时间戳的纯验证辅助。
3. 以判别联合返回 Chat、Agent、Session Tool 或未识别事件。
4. 先运行定向测试，确认新测试在旧实现上失败。

### 第二阶段：接入 ChatHandler

文件：

- `src/runtime/OpenClawChatEventRuntime.ts`
- `src/processing/openClawChatEvent.ts`
- 相关测试

步骤：

1. 将 `handleEvent` 的 raw `any` 改为 `unknown`。
2. 先解码，再调用 run projection。
3. 将 assistant、lifecycle、thinking 的参数改为已解码 Agent payload。
4. 保留工具规范化器的职责，不重复其字段解析。
5. 删除被取代的旧字段读取和英文注释，新增或修改的注释使用中文。

### 第三阶段：清理协作 direct fallback

文件：

- `src/services/gateway/collaborationEventBridge.ts`
- `src/services/gateway/collaborationEventBridge.test.ts`
- `src/stores/collaborationSetupStore.test.ts`
- 关联设计文档

步骤：

1. 删除 direct top-level branch 和其测试。
2. 将 runtime feature fixture 改为官方 `agent` event。
3. 保留 malformed Agent stream 的失败关闭与 listener 隔离。
4. 全局搜索确认不再有同名顶层 event 假设。

### 第四阶段：验证和记录

已完成：运行事件、协作 bridge 与协作 setup 定向测试、`pnpm lint`、完整 `pnpm test`、完整
`pnpm test:rust`、`pnpm build`、`git diff --check`、完整修改文件 Emoji 扫描与
`PROJECT_STATUS.md` 回写；真实 Gateway 回放与三平台真机验证保持未完成。

## 后续独立工作

GNE-13 与 GNE-14 已在独立小批次完成，分别见
`plans/quality/2026-08-09-tauri-command-surface-remediation.md` 和
`plans/quality/2026-08-09-tauri-command-contract-executable-remediation.md`。后续只保留完整验证与真实运行时回放。
