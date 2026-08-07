# `sessions.list` 终止页验证

## 依据

使用当前 OpenClaw Gateway 的真实 `sessions.list` 响应复现。终止页返回 `sessions`、`totalCount`、`nextOffset: null` 和 `hasMore: false`，但可以省略 `offset`。

## 当前行为

JunQi 的分页解析器要求所有响应都包含与请求一致的 `offset`，因此把合法的单页终止响应判定为非法，工作区显示“无法加载工作区数据”。

## 目标行为

终止页允许省略 `offset`，并按第一页处理；声明 `hasMore: true` 的响应仍必须返回当前 `offset` 和向前推进的 `nextOffset`，避免丢失分页边界。

## 验证结果

- 已通过 OpenClaw CLI 请求确认当前 Gateway 返回的终止页形状。
- 已增加终止页省略 `offset` 的回归测试。

## 未验证边界

尚未在解锁后的桌面窗口中完成本次修复包的截图验收；需完成构建并重新拉起后验证工作区、会话列表和消息发送。
