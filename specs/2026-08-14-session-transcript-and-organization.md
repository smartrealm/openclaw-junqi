# 会话组织与 transcript 展示规格

## 会话组织

1. `sessions.patch` 必须返回 `ok: true`、精确会话 key 和对象类型的 `entry`。
2. 置顶开启以有效 `pinnedAt` 为确认，关闭以 `pinnedAt` 缺失为确认。
3. 归档开启以有效 `archivedAt` 且 `pinnedAt` 缺失为确认，关闭以 `archivedAt` 缺失为确认。
4. 标记未读以有效 `markedUnreadAt` 为确认；标记已读以 `markedUnreadAt` 缺失且 `lastReadAt` 有效为确认。
5. 分类设置以 `entry.category` 与请求值精确一致为确认；清除分类以字段缺失或空值为确认。
6. 归档调用在本地已知身份时必须发送 `expectedSessionId`。
7. 协议不支持、响应无法核验和其他失败必须显示面向用户的本地化说明，不显示内部错误码。
8. Gateway 未确认前不得修改本地组织投影。

## 新建与历史会话

1. 普通 `sessions.create` 成功后，新会话必须保留 key、sessionId、agentId 和 `activeLeafEntryId: null`。
2. 已确认空 transcript 的新会话不得触发首屏历史读取，也不得禁用输入框。
3. 已有会话在历史读取未完成且当前无消息时可以显示历史加载状态。
4. 历史已加载但虚拟列表尚无当前会话条目时，不得消费首次尾部定位。
5. 当前会话至少有一个时间线条目后执行一次首次尾部定位；侧栏切换、页签切换、新建、分叉、关闭和删除回退都使用同一规则，后续用户上滑继续受阅读锁保护。

## transcript 展示

1. assistant 的完整 JSON 对象或数组应格式化为带语言标识的 JSON 代码块。
2. 工具输出中的完整 JSON 应使用保留字面量的缩进格式展示。
3. 已有 Markdown 代码围栏不得重复包装。
4. JSON 格式化必须保留字符串和数字字面量，不以重新序列化改变内容。
5. 不完整或超出安全解析边界的内容保留原文。
6. 原始工具载荷继续可在来源记录中查看；格式化展示不得覆盖证据值。

## 验收

- 时间戳回执覆盖置顶、取消置顶、归档、恢复、标记未读和标记已读。
- 成功写入不再出现 `SESSION_ORGANIZATION_RESPONSE_INVALID` 通知。
- 归档文案不再声称数据位于本机。
- 新建空会话输入框立即可用。
- 打开已有长会话后首次显示位于最后一条记录。
- assistant JSON 与工具 JSON 输出均可读，非法 JSON 原样显示。
