# OpenClaw Runtime 配置 Schema 信封审计

日期：2026-08-09

## 审计范围

本轮从配置中心“工具”标签的 Runtime schema 不可用提示出发，核对 `config.schema` 请求、权限、响应解析、
连接身份、缓存、结构化编辑器消费者、错误呈现和重试入口。范围覆盖工具、智能体、模型提供方高级配置和高级
设置共用的 schema 加载链路。

## 官方契约

OpenClaw 官方仓库远端 `main` 提交 `7a8eee4a363b6fd097a40d221aedcff14e61cc8c` 中：

- `ui/src/api/types.ts` 定义 `ConfigSchemaResponse` 为 `schema`、`uiHints`、`version`、`generatedAt` 四字段信封；
- `ui/src/lib/config/index.ts` 调用 `config.schema` 后将 `res.schema` 保存为表单 schema；
- `src/gateway/server-methods/config.ts` 的 handler 返回完整 schema 信封；
- `src/gateway/methods/core-descriptors.ts` 将 `config.schema` 定义为 `operator.admin`，将
  `config.schema.lookup` 定义为 `operator.read`。

`config.schema.lookup` 返回指定路径的浅层查询结果，不能直接替代当前结构化编辑器需要的完整嵌套 schema。
JunQi 继续通过既有受控授权通道读取完整 `config.schema`，不新增协议或能力判断。

## 发现

### BUG-RCS-01：响应信封被当成根 schema

严重级别：P1。

`loadOpenClawConfigSchema()` 将 Gateway 返回值直接交给 `configFieldSchema()`。后者从传入对象根部读取
`properties`，但官方根部是响应信封，真正的 JSON schema 位于 `schema` 字段。因此成功请求也会得到空字段，
工具页会稳定误报 Runtime schema 不可用，其他共用消费者也可能无法生成结构化编辑器。

### BUG-RCS-02：缓存未绑定 Gateway 连接身份

严重级别：P1。

当前模块用一个进程级 Promise 永久缓存成功结果。用户切换 Native 或 Docker Runtime、Gateway 重连或身份变化后，
后续页面仍可能读取旧连接返回的 schema。该结果没有连接 ID 和时序围栏，违反选定 Runtime 的配置归属边界。

### BUG-RCS-03：错误、空配置域与补救方式被混为一谈

严重级别：P2。

工具页把请求失败和 Runtime schema 中不存在 `tools` 可编辑字段统一显示为“Runtime schema 不可用”，并引导使用
原始编辑器或官方 Wizard。当前工具页没有可验证的原始编辑器入口，Wizard 也不是所有配置读取失败的通用修复；
界面同时缺少重试操作，用户无法区分连接、授权、响应非法和当前 Runtime 没有该配置域。

## 目标行为

- 严格解析官方响应信封，只把 `schema` 字段交给字段解析器；裸 schema 或缺失必需字段的响应失败关闭。
- schema 缓存绑定当前已认证 Gateway 连接 ID；连接变化后自动重新读取，旧连接的迟到结果不得进入新页面状态。
- 请求失败显示真实的读取失败状态和重试入口；成功读取但没有 `tools` 字段时显示“当前 Runtime 未公开可编辑工具字段”。
- 工具目录、有效工具和受控调用仍使用各自官方 RPC，不因配置 schema 缺失而被伪装成不可用。
- 不增加版本门禁、方法广告门禁、schema fallback、原始编辑器假入口或 Wizard 推断。

## 未验证边界

- 尚未连接真实 macOS、Windows、Linux 或 Docker Gateway 完成配置中心视觉验收。
- 尚未验证第三方插件动态扩展 `tools` schema 后的真实表单内容。
- 官方远端源码已通过固定提交下载核对；本轮未对远端执行构建或协议集成测试。

## 自动化验证

- `openclawConfigSchema.test.ts` 11 项通过，覆盖官方信封解析、非法响应、同连接缓存、连接切换、迟到响应围栏、
  强制重试和失败后恢复。
- `pnpm lint` 通过，包含 915 个文件的模块边界检查、版本一致性检查和 TypeScript 无输出检查。
- `pnpm test` 通过，前端与服务测试 2851 项、脚本测试 243 项均无失败。
- `pnpm build` 通过，协作插件、钉钉插件、TypeScript 和 Vite 生产构建完成。
- 测试输出仅包含项目已有的 Node 弃用警告和 Radix 服务端渲染警告。
