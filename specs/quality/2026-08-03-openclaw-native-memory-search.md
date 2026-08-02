# OpenClaw 原生记忆检索对齐规格

日期：2026-08-03

## 目标

在不改变 OpenClaw Gateway 归属的前提下，让 JunQi Memory Explorer 使用官方
`memory.search` 读取 Gateway 管理的记忆索引，同时保留工作区 Markdown 的受保护本地浏览。

## 约束

1. 只调用官方 descriptor 和 handler 已确认的 `memory.search`，权限保持 `operator.read`。
2. 请求只能发送官方支持的 `query`、`maxResults`、`minScore`、`agentId`；不得添加
   sessionKey、假想 group 或 JunQi 私有查询字段。
3. Gateway 是 agent 解析、索引状态、结果来源、分数和片段的权威。JunQi 不扫描远程
   Gateway 路径，不从本地文件、聊天 transcript 或自定义 API 合成结果。
4. 响应必须验证 `agentId`、`provider`、`searchMode`、`results` 及结果的官方字段；已知
   字段类型错误不得进入 UI，未来附加字段可以忽略。
5. 结果状态必须绑定当前 Gateway 连接和最新查询；断线、未广告能力、查询替换和迟到
   响应不能留下旧结果。

## 验收条件

- Memory Explorer 能在工作区文件和 Gateway 检索之间切换。
- Gateway 检索提交后只通过 data store 发出原生 `memory.search`，并展示 Gateway 返回
  的来源、路径、行号、片段和元数据。
- 未广告 `memory.search`、未连接、非法响应或 RPC 失败时，显示明确状态且不提供虚假
  本地替代结果。
- Gateway 结果不会写入持久化前端状态、日志或文件；工作区本地视图不受影响。
- TypeScript、边界、定向回归、完整测试和构建验证通过，文档记录实际与未验证边界。

## 非目标

- 不实现记忆编辑、删除、重建索引、embedding 探测、REM harness 或 Dreaming 修复。
- 不移除工作区 Markdown 浏览，直到官方 Gateway 能力覆盖该本地查看场景并完成独立审查。
- 不绑定某个 OpenClaw 安装版本，不硬编码默认 agent、Gateway 地址或平台路径。
