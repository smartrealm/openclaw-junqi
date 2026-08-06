# OpenClaw 会话标签权威性记录

日期：2026-08-06

## 审计结论

OpenClaw 的 `sessions.create` 成功响应返回 `entry.label`，后续 `sessions.list` 继续投影该会话名称。JunQi 只能展示或在 Gateway 缺失该字段时提供只读回退，不能根据客户端界面语言猜测某个服务端标签是否是占位符。

## 修复

- 移除会话标签展示中的固定英文和中文占位符正则。
- JunQi 普通新建会话不发送 `label`。Gateway 响应缺失 `entry.label` 时，本地投影保持空值；界面仅使用本地化文案作为只读兜底，不写回 Gateway。
- Gateway 返回任意非空 label 时，所有页面原样展示该值；首条消息、语言或旧客户端状态均不能覆盖它。
- 无标签时使用已有 topic、首条消息或 session key，不写回 Gateway。

## 合并后全链审查（2026-08-06）

### BUG-SL-01：标题优先级在不同展示面分叉

`sidebarUtils.sessionTitle` 与 `getSessionDisplayLabel` 分别实现了标签、主题、消息和 key 的回退逻辑，
且主会话与首条消息的优先级不同。同一个无标签会话因此可能在侧栏、标签页和仪表盘呈现不同标题。

修复目标是仅保留 `getSessionDisplayLabel` 作为会话标题策略入口。调用方只注入本地化的主会话和通用
兜底文案；不再自行解释 Gateway label。

### BUG-SL-02：活动投影把无标签状态伪装成权威标签

`activitySessions` 曾在归一化和合并时以 session key 填充 `label`。该 key 随后被展示函数当作 Gateway
标签，导致新建会话在活动、时间线等页面显示 `agent:...`。修复目标是保留空 `label`，将 key 只作为
展示函数的最终只读回退。

### BUG-SL-03：页面级硬编码绕过本地化

时间线、智能体页和多智能体页直接传入固定中文或英文标签。修复目标是全部由各页面已有的翻译函数
提供文案，并通过同一展示函数处理。

## 验证

- 定向回归：80 项通过，覆盖普通创建省略 label、Gateway 标签权威性、空标签活动投影、会话列表回灌、重命名、分叉和会话状态机。
- `pnpm lint`：通过，包含模块边界、版本一致性和 TypeScript 检查。
- `git diff --check`：通过。
- 本次未执行生产构建或桌面真机验收；需用包含此工作区改动的制品验证新建会话与各展示面的实际效果。
