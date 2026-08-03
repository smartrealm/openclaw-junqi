# OpenClaw 运行时命令目录对齐规格

日期：2026-08-03

## 目标

JunQi 的命令目录与聊天斜杠补全只消费当前 OpenClaw Gateway 的 `commands.list` 协议，准确呈现当前 agent
可用的 native、skill 与 plugin 命令及其参数元数据。

## 约束

1. 只能使用官方只读 `commands.list`；Gateway 未广告该方法时不得发送请求、不得显示静态目录。
2. 请求只传官方 schema 允许的字段。当前聊天 session key 可解析出非空 agent ID 时才传 `agentId`；否则省略。
3. 客户端必须验证 entry 的 name、description、source、scope、acceptsArgs、category、alias、argument、choice 与
   dynamic 类型；未知枚举或无效结构必须拒绝整个响应，不补默认值。
4. 返回值与请求必须绑定连接身份。Gateway 重连、断线、当前 session 变更或请求代次更新后，迟到结果不得进入 UI。
5. 斜杠选择器仅插入 Gateway 返回的 text alias。参数选择器仅使用当前参数位已声明的静态 choices；dynamic
   参数不得被模型目录、硬编码列表或本地推断替代。
6. JunQi 不在 slash picker 中实现或拦截看似 OpenClaw 的 `/clear`、`/new`、`/compact`、`/model` 等命令。
   会话、模型和工具的独立桌面控件继续按各自已对齐的 OpenClaw RPC 工作。

## 验收条件

- 有能力广告且响应合法时，命令页与 Composer 都显示当前 Gateway 目录；技能和插件的命令不需要客户端预注册。
- 指定 agent 的命令切换、连接变更和重新加载不会显示其他 agent 或旧连接返回的命令。
- 命令页不显示 CLI copy/run 功能、固定命令数量、固定类别或从外部文档推断的影响等级。
- 断线、方法未广告、RPC 拒绝和响应无效时，用户能看到明确的不可用或失败状态，且不会看到前一次目录。
- 回归测试、静态检查和文档链接验证通过；真实 Gateway 与目标平台验证另行记录，不以自动化替代。
