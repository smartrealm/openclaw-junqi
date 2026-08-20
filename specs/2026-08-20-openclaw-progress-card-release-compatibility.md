# OpenClaw 已发布 Gateway 进度卡兼容规格

日期：2026-08-20

## 上游依据

- OpenClaw 官方主线提交 `70b6f44f13e5a4c0c860e5412b9b5c3bb2272b1d`。
- `progressCard.get` 与 `progressCard.changed` 是当前持久化进度卡契约。
- OpenClaw 官方 Android、iOS 和 macOS 客户端明确保留 `stream: "plan"` 投影，用于尚未提供 `progressCard.get` 的已发布 Gateway。
- 兼容投影只在当前连接对 `progressCard.get` 返回精确 `unknown method` 后启用；能力未知、请求失败或新 Gateway 双发事件时不得启用。

## BUG-PROGRESS-01：已发布 Gateway 的计划流被丢弃

### 当前行为

JunQi 只读取 `progressCard.get`。当前连接明确返回方法不存在后，官方 `stream: "plan"` 事件继续落入通用数据层，聊天输入区和动态岛均无法展示进度。

### 目标行为

当前已认证连接通过真实 RPC 证明 `progressCard.get` 不可用后，JunQi 将同一会话、同一有效运行中的官方 `stream: "plan"` 更新投影为临时进度卡。连接支持持久化进度卡时忽略该双发事件。

### 验收条件

- 已发布 Gateway 的合法计划更新能显示步骤、状态和说明。
- 新 Gateway 同时发送持久化卡片和计划流时，只显示持久化卡片。
- 能力探测尚未完成时到达的计划更新不会丢失，也不会提前显示。
- 不读取 transcript，不从工具回执推断计划终态。

## BUG-PROGRESS-02：变更事件没有按官方修订语义收敛

### 当前行为

所有 `progressCard.changed` 都触发重新读取。`revision: null` 不会立即清空，重复修订也会重复请求；修订值只检查有限数，没有检查正安全整数。

### 目标行为

事件只接受正安全整数或 `null`。`null` 在当前连接和会话内立即清空；与当前卡片相同的修订不读取；更改提示继续通过连接围栏读取权威卡片。

### 验收条件

- 非法修订不会改变状态或触发读取。
- `null` 清空不依赖额外 RPC。
- 重复修订不产生重复读取。
- 连接切换后的事件和旧响应不能覆盖当前连接。

## UI 边界

- 继续复用聊天输入区上方的 `ProgressCard`、`StatusIcon`、`ChatMarkdownRenderer` 和现有 Aegis 主题 token。
- 默认只显示紧凑进度按钮，用户通过点击或键盘操作展开有界步骤详情；同一卡片保留用户的收起偏好。
- 本轮不新增另一套计划卡片，不在消息 transcript 中插入伪造消息或工具结果。
- 旧发布流的本地修订号只用于同一连接内的稳定渲染，不对外宣称为 OpenClaw 持久化修订。
- 进度读取是可选投影。当前连接没有返回真实卡片时，聊天输入区不渲染错误占位或空卡片；读取失败只结束加载，不创造任务状态。
