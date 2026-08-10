# 钉钉接入状态与授权引导规格

日期：2026-08-10

## 行为契约

1. 插件状态未完成读取时，界面只能显示正在核对，不得判断为未安装或未授权。
2. 插件安装成功不等于当前 Session 已加载工具；用户重启 Gateway 后，JunQi 必须等待新的已核验连接身份。
3. 新连接身份成立后，JunQi 自动刷新 Session、当前 Session 的 `tools.effective`、插件状态和 DWS 身份。
4. Native 运行时使用 DWS 官方浏览器扫码授权；Docker 使用官方设备码授权。
5. 当前 Agent 授权必须由一个工作台动作完成，使用 `config.get` 的有效快照和 `hash`，通过一次最小
   `config.patch` 同时更新 Agent 工具策略与插件 `allowedAgentIds`。
6. Agent 的非空 `tools.allow` 追加插件 ID；未设置 `allow` 时追加 `tools.alsoAllow`；空 `allow` 保留
   OpenClaw 当前非限制语义。
7. 全局或当前 Agent 策略明确 `deny` 时不得自动移除拒绝规则。
8. 当前 Agent 不是显式配置、配置结构未知、Gateway 未确认写入或重启后仍是旧连接时，流程失败关闭并显示原因。
9. 授权成功只以新连接的 `tools.effective` 和 DWS 结构化投影为准，不以按钮完成、进程退出或旧缓存推断。

## 验收

- 插件探测进行中不会短暂出现“插件未就绪”或“Agent 未授权”。
- 重启按钮保持加载状态，直到新 connection ID 和 Runtime Identity 一致，随后页面自动更新。
- 当前 Agent 授权弹层不再要求用户进入 Advanced 编辑原始配置。
- Native 授权命令参数不包含 `--device`；Docker 授权命令仍包含 `--device`。
- 配置测试覆盖 `agents.list`、`agents.entries`、全局与 Agent 显式拒绝和隐式 Agent 边界。
