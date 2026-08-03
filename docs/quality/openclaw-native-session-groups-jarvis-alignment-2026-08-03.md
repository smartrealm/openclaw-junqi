# OpenClaw 原生会话分组与 Jarvis 对齐

日期：2026-08-03

> 2026-08-04 校正：当前安装包的官方 method registry、schema 和 sessions handler 均没有
> `sessions.groups.*`。本文件关于 group catalog、`sessions.groups.put`、改名和删除 handler 的
> 结论不再有效，不能作为实现依据。当前行为与修复记录见
> [`openclaw-session-category-authority-alignment-2026-08-04.md`](openclaw-session-category-authority-alignment-2026-08-04.md)。
> 以下内容保留为历史审计记录。

## 结论

OpenClaw 已原生提供 `sessions.groups.list`、`sessions.groups.put`、
`sessions.groups.rename`、`sessions.groups.delete` 及 `sessions.patch.category`。
JunQi 的会话组目录和成员归属必须完全以这些 Gateway 状态为准。

此前 JunQi 在协议不支持时回退到 renderer `localStorage` 中的分组仓库，并让
Jarvis 唤醒只写 session `category`、不确保它存在于 Gateway group catalog。前者会
把客户端私有状态呈现为会话分组，后者使自定义唤醒词的会话不能稳定出现在原生组
目录中。两者均不符合 JunQi 仅作为 OpenClaw 客户端的边界。
同一旧仓库还会在 `pinned`、`unread`、`archived` 的原生 `sessions.patch` 不可用时，
把 renderer 本地状态展示为成功；这些字段也必须停止使用客户端私有成功状态。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw sessions schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw session groups handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-groups.ts)
- [OpenClaw session patch handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-mutations.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方 schema 将 catalog entry 定义为 `{ name, position }`；`category` 是 session
上的用户定义 bucket，不是另一套 Chat Group。`put` 替换有序 catalog，rename/delete
由 Gateway 更新/清空成员 session 的 category。权限分别是 `operator.read` 和
`operator.write`，不需要或不应为了普通分组操作提升至 `operator.admin`。

项目锁定的 OpenClaw 安装版本只用于本机复现，不是该能力的版本门禁。

## 当前行为

1. group client 使用普通已认证连接，严格读取 name 与 position；不接受部分或畸形
   Gateway catalog。
2. Gateway 不支持 group/category protocol 时，JunQi 清空本地 group catalog 并把
   原始不支持错误交回 UI，不生成 localStorage group 或本地 category membership。
3. 手动创建、改名、删除 group 后，JunQi 用 Gateway 返回的完整 catalog 刷新 UI；
   不根据用户输入构造成功的 group 快照。
4. Jarvis 识别到 Gateway-owned wake trigger 时，先确保同名 `Jarvis: <trigger>`
   category 通过官方 `sessions.patch.category` 归属当前 session。当前官方 patch handler
   会登记非空 category，因此 JunQi 不再发起前置的 `sessions.groups.list/put` 读改写；任一
   category mutation 未获 Gateway 确认，唤醒流程失败关闭。
5. session list 只使用 Gateway 的 `category` 形成 group membership；既有本地标题
   展示缓存不参与 group/category 归属，也不被描述为 OpenClaw 状态。
6. `pinned`、`unread`、`archived` 只取自 Gateway session record 或已确认的原生 patch，
   不再使用 localStorage 回退。
7. 同一 JunQi renderer 内的 catalog 写操作串行执行，防止 `put` 的完整目录替换覆盖
   另一个尚未提交的创建；该队列不保存或重放 OpenClaw 业务状态。

## 验证

- group client 回归覆盖普通连接、完整 catalog、畸形响应、原生 mutation 返回及同一
  renderer 的 catalog 写入串行化。
- chat store 回归覆盖不支持 protocol 时不创建本地 group、membership、pin、unread 或
  archive 状态。
- Jarvis wake 回归覆盖单次 category mutation、触发词命名与失败关闭。
- 本次依据最新版官方 `sessions-mutations` handler 的收敛已通过 Jarvis 分类、语音协调器与
  语音回归守护定向测试、`pnpm lint`、`pnpm test` 与 `pnpm verify:openclaw-docs`。
- 2026-08-03 已通过 `pnpm lint`、`pnpm test`、`pnpm build`、
  `pnpm verify:openclaw-docs`、`pnpm test:rust`、`pnpm collab:test`、
  `pnpm collab:validate` 和 `git diff --check`。
- Rust 测试通过 701 项；输出含既有 `src/commands/system.rs` 未使用变量警告，
  本次未修改该文件。TypeScript 全量测试输出还含既有 React SSR `useLayoutEffect`
  警告，未造成测试失败。

## 未验证边界

- 尚未在真实 Gateway 上并发修改 group catalog，验证 `put` 替换语义和跨客户端
  `sessions.changed` 刷新时序。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机执行后台唤醒后的组目录刷新验收。
- OpenClaw 未来若改变 groups schema、权限或 patch category 行为，必须重新核对官方
  schema、handler 和 method descriptor 后再调整客户端。
