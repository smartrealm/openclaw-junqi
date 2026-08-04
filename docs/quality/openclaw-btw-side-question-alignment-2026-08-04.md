# OpenClaw `/btw` 临时侧问对齐验证记录

## 权威依据

当前安装的 OpenClaw 官方文档 `docs/tools/btw.md` 说明 `/btw` 是不写入 transcript 或 `chat.history` 的临时侧问，并由 `chat.side_result` 回传。当前安装源码 `dist/btw-command-DCsFmn36.js` 将 `/btw` 分类为临时 turn；`dist/chat-pg-BxhF6.js` 广播包含 `kind`、`runId`、`sessionKey`、`question`、`text`、`isError` 与 `ts` 的 `chat.side_result`，随后为同一 run 广播空 `chat.final`。

## 实现结果

- `openClawBtw.ts` 依据当前官方分类和结果字段严格解码 `/btw` 与 `chat.side_result`。
- `ChatSendCoordinator` 识别该指令后不创建乐观 transcript、不设置主输入中状态、不创建 Task checkpoint，也不进入 JunQi 本地队列。
- Gateway transport 以发送 idempotency key 登记临时 run，直接派发而不等待会话普通命令队列；Gateway RPC 明确失败时移除登记，传输不确定时保留登记以等待同连接后续事件。
- `ChatHandler` 仅接收本客户端登记且 session 匹配的临时结果；后续同 run 终态事件不会结算或替换主 Run。
- `chatStore` 仅维护内存结果，身份轮换、清空消息和删除会话时清理。`ChatView` 在聊天尾部显示可关闭卡片，空 transcript 也可见。

## 自动化验证

- `node --import ./test-setup.ts --import tsx --test src/services/gateway/openClawBtw.test.ts src/services/gateway/ChatHandler.test.ts src/services/chat/sendTransaction.test.ts`：69 项通过。
- `pnpm lint`：通过，包括模块边界、版本一致性和 TypeScript 无输出检查。
- `pnpm test`：通过；测试运行保留既有 React SSR `useLayoutEffect` 警告，但没有失败项。
- `pnpm build`：通过，包括协作插件 bundle、TypeScript 与 Vite 生产构建。
- `pnpm verify:openclaw-docs`：通过，核验当前 OpenClaw 官方命令文档链接。

## 未验证边界

没有启动真实 OpenClaw Gateway，也没有执行 macOS、Windows、CentOS 或 Ubuntu 真机测试。OpenClaw 官方定义该结果为非持久、不从 history 重放；JunQi 因此不尝试在重载或冷启动后恢复未收到的临时结果。
