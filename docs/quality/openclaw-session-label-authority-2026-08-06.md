# OpenClaw 会话标签权威性记录

日期：2026-08-06

## 审计结论

OpenClaw 的 `sessions.create` 成功响应返回 `entry.label`，后续 `sessions.list` 继续投影该会话名称。JunQi 只能展示或在 Gateway 缺失该字段时提供只读回退，不能根据客户端界面语言猜测某个服务端标签是否是占位符。

## 修复

- 移除会话标签展示中的固定英文和中文占位符正则。
- JunQi 新建空白会话时按最终展示 label 记录默认名称来源；即使 OpenClaw 创建响应省略 `entry.label`，也会以请求标签作为最终显示值并保留标记。首条提示后，标签页和侧边栏显示该消息摘要。该标记只存于客户端会话投影，不是 OpenClaw 协议字段，也不会写回 Gateway。
- 手动重命名或 Gateway 返回不同 label 后，移除来源标记并原样展示 Gateway label。
- 无标签时使用已有 topic、首条消息或 session key，不写回 Gateway。

## 验证

- 定向回归：65 项通过，覆盖多语言 label、默认来源标记、缺失创建响应 label、新建会话、会话列表回灌、重命名和 fork。
- `pnpm lint`：通过，包含模块边界、版本一致性和 TypeScript 检查。
- `pnpm build`：通过，包含协作插件契约校验、打包、TypeScript 和 Vite 生产构建。
- `git diff --check` 与本次修改文件 Emoji 扫描：通过。
- 待执行桌面真机验收。
