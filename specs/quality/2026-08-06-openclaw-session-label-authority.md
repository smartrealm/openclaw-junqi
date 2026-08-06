# OpenClaw 会话标签权威性

日期：2026-08-06

## 依据

- OpenClaw `sessions.create` 协议接收可选 `label`，Gateway 成功响应返回 `entry.label`。
- OpenClaw `sessions.list` 行携带会话 `label`，该字段是会话条目的服务端投影。

## 当前行为

JunQi 的新建入口以当前语言的 `chat.newSessionLabel` 作为创建请求的默认标签。旧展示逻辑按固定英文和简体中文正则把部分标签猜为占位符，导致“新会话”“New chat”“新會話”在不同界面得到不同结果。

## 目标行为

Gateway label 保持权威。仅 JunQi 创建的空白会话默认 label 会在客户端投影中被显式标记；首条提示消息出现后，标签页和侧边栏使用该消息作为只读展示标题。该标记不属于 Gateway 协议，既不写入也不修改 Gateway。手动重命名或 Gateway 返回不同 label 时标记失效并原样展示 Gateway label。

OpenClaw 创建响应允许缺失 `entry.label`；此时 JunQi 以本次请求的 label 作为最终展示值，并按该最终值判定默认名称来源，不能因响应字段缺失而漏掉展示转换。

## 验收

- [x] 简体中文、繁体中文和英文的新建默认标签均能在首条提示后显示消息标题。
- [x] 非 JunQi 默认的 Gateway label 不会被客户端改写。
- [x] Gateway 缺失 label 时仍保留原有展示回退。
