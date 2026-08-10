# OpenClaw 配置最小补丁写入审计

日期：2026-08-09

## 依据

最新版 OpenClaw Gateway 协议定义 `config.patch`，接受 `raw`、`baseHash` 和可选 `replacePaths`。服务端以 JSON Merge Patch 处理对象，并对包含稳定 `id` 的数组按条目合并；数组缩减必须显式声明替换路径。`config.set` 是完整原始配置替换。

## 审计结论

JunQi 的配置页和渠道配置仓此前重读快照后调用 `config.set`。即使附带 `baseHash`，完整替换仍会把客户端未拥有的数组与并发改动带入写入范围，违背最小条目更新的控制面约束。

## 目标行为

- 所有 JunQi 配置写入改用官方 `config.patch` 和当前快照的 `baseHash`。
- 对象只发送原始草稿到目标草稿的差异；稳定 `id` 数组只发送改变或新增的条目。
- 删除、重排或非 `id` 数组变更发送完整目标数组，并明确列入 `replacePaths`。
- Gateway 未返回 `ok: true` 时失败关闭；不以本地草稿伪造成功。

## 验证范围

自动化覆盖标量、对象删除、稳定 `id` 条目更新、数组删除与客户端 RPC 参数。真实 Gateway 的配置冲突、插件数组和跨平台桌面流程仍需后续真机验收。
